import { createCipheriv } from 'node:crypto';
import { Agent, fetch } from 'undici';
import { config } from '../config/index.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const insecureDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
});

const USER_AGENT = 'slack-hiware-approval/0.2 (Node.js)';

/** External base `.../hiware/v1/ext` → Auth base `.../hiware/api/v1/auth` */
export function deriveAuthBaseUrl(extBaseUrl) {
  const base = String(extBaseUrl || '').replace(/\/$/, '');
  if (/\/hiware\/v1\/ext$/i.test(base)) {
    return base.replace(/\/hiware\/v1\/ext$/i, '/hiware/api/v1/auth');
  }
  // fallback: strip trailing /ext or append relative to host root
  if (/\/hiware\//i.test(base)) {
    return base.replace(/\/hiware\/.*$/i, '/hiware/api/v1/auth');
  }
  throw new AppError('HIWARE_BASE_URL 에서 Auth URL을 파생할 수 없습니다', { status: 500 });
}

/** AES-128-CBC, IV=0x00×16, PKCS7 → Base64 (Login Interface 가이드) */
export function encryptPassword(plainPassword, randomKey) {
  const key = Buffer.from(String(randomKey), 'utf8');
  if (key.length !== 16) {
    throw new AppError(`HIWARE randomKey 길이가 16이 아닙니다 (${key.length})`, { status: 502 });
  }
  const iv = Buffer.alloc(16, 0);
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  const enc = Buffer.concat([cipher.update(String(plainPassword), 'utf8'), cipher.final()]);
  return enc.toString('base64');
}

function authFailureMessage(data) {
  const parts = [
    data?.content?.message,
    data?.content?.errorCode,
    data?.message,
    data?.errorCode,
  ]
    .filter(Boolean)
    .map(String);
  return parts.join(' ');
}

export function isAuthFailure(data, httpStatus) {
  if (httpStatus === 401 || httpStatus === 403) return true;
  const msg = authFailureMessage(data).toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('invalid authkey') ||
    msg.includes('authkey') ||
    msg.includes('api-token') ||
    msg.includes('api token') ||
    msg.includes('unauthorized') ||
    msg.includes('token expired') ||
    msg.includes('토큰이 만료') ||
    msg.includes('인증키가')
  );
}

export class HiwareClient {
  constructor(cfg = config.hiware) {
    this.baseUrl = cfg.baseUrl.replace(/\/$/, '');
    this.userId = cfg.userId || '';
    this.userPwd = cfg.userPwd || '';
    this.insecure = cfg.insecure;
    this.timeoutMs = cfg.timeoutMs;
    this.loginMode = Boolean(this.userId && this.userPwd);
    /** @type {string} 로그인 모드면 캐시(초기 비움). 정적 모드면 env 토큰 */
    this.apiToken = this.loginMode ? '' : cfg.apiToken || '';
    // 서비스 계정 로그인 + 결재자 임시 로그인 모두 Auth URL 필요
    this.authBaseUrl = this.baseUrl ? deriveAuthBaseUrl(this.baseUrl) : '';
    /** @type {Promise<string>|null} */
    this._loginInFlight = null;
  }

  async ensureToken({ force = false } = {}) {
    if (!this.loginMode) {
      if (!this.apiToken) {
        throw new AppError('HIWARE API Token 미설정', { status: 500, code: 'HIWARE_NO_TOKEN' });
      }
      return this.apiToken;
    }
    if (!force && this.apiToken) return this.apiToken;
    if (this._loginInFlight) return this._loginInFlight;

    this._loginInFlight = this._doLogin()
      .then((token) => {
        this.apiToken = token;
        logger.info('HIWARE login ok', { userId: this.userId });
        return token;
      })
      .finally(() => {
        this._loginInFlight = null;
      });

    return this._loginInFlight;
  }

  async _doLogin() {
    return this._loginWithCredentials(this.userId, this.userPwd);
  }

  /**
   * Login Interface로 authKey 발급. this.apiToken 은 변경하지 않음.
   * @param {string} userId
   * @param {string} password plain password
   * @returns {Promise<string>} authKey
   */
  async _loginWithCredentials(userId, password) {
    if (!this.authBaseUrl) {
      throw new AppError('HIWARE_BASE_URL 미설정 — Auth URL 파생 불가', { status: 500, code: 'HIWARE_LOGIN_ERROR' });
    }
    if (!userId || !password) {
      throw new AppError('HIWARE 로그인 ID/비밀번호가 필요합니다', { status: 400, code: 'HIWARE_LOGIN_ERROR' });
    }

    const rk = await this._rawRequest('GET', `${this.authBaseUrl}/randomKey`, { withToken: false });
    const issueKey = rk?.content?.issueKey;
    const randomKey = rk?.content?.randomKey;
    if (!issueKey || !randomKey) {
      throw new AppError('HIWARE randomKey 응답 이상', { status: 502, code: 'HIWARE_LOGIN_ERROR' });
    }

    const encPwd = encryptPassword(password, randomKey);
    const login = await this._rawRequest('POST', `${this.authBaseUrl}/login`, {
      withToken: false,
      body: {
        userId: String(userId),
        password: encPwd,
        issueKey,
        authProviderType: 'ID/PASSWORD',
        authProviderId: 'hiware',
      },
    });

    const authKey = login?.content?.authKey;
    if (!authKey) {
      const msg = authFailureMessage(login) || 'HIWARE login failed';
      throw new AppError(String(msg), { status: 502, code: 'HIWARE_LOGIN_ERROR' });
    }
    return String(authKey);
  }

  /**
   * 결재자 본인으로 1회성 로그인 (서비스 계정 토큰 유지).
   * @param {string} userId HIWARE userId
   * @param {string} password
   * @returns {Promise<string>} authKey
   */
  async loginAs(userId, password) {
    const token = await this._loginWithCredentials(userId, password);
    logger.info('HIWARE login ok (approver session)', { userId: String(userId) });
    return token;
  }

  clearToken() {
    this.apiToken = '';
  }

  async request(method, path, { query, body } = {}, { _retried = false } = {}) {
    if (this.loginMode) {
      await this.ensureToken();
    } else if (!this.apiToken) {
      throw new AppError('HIWARE API Token 미설정', { status: 500, code: 'HIWARE_NO_TOKEN' });
    }

    let url = `${this.baseUrl}${path}`;
    if (query) url += `?${new URLSearchParams(query)}`;

    try {
      return await this._rawRequest(method, url, { body, withToken: true });
    } catch (err) {
      if (
        this.loginMode &&
        !_retried &&
        err instanceof AppError &&
        (err.code === 'HIWARE_AUTH_ERROR' || isAuthFailure({ content: { message: err.message } }))
      ) {
        logger.warn('HIWARE auth failed — re-login and retry once', { path, method });
        this.clearToken();
        await this.ensureToken({ force: true });
        return this.request(method, path, { query, body }, { _retried: true });
      }
      throw err;
    }
  }

  /**
   * @param {string} method
   * @param {string} url absolute URL
   * @param {{ body?: object, withToken?: boolean, apiToken?: string }} opts
   */
  async _rawRequest(method, url, { body, withToken = true, apiToken } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers = {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      };
      if (withToken) {
        headers['API-Token'] = apiToken || this.apiToken;
      }

      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        ...(this.insecure ? { dispatcher: insecureDispatcher } : {}),
      });

      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new AppError(`HIWARE 응답 JSON 파싱 실패: ${text.slice(0, 200)}`, { status: 502 });
      }

      if (!res.ok && !data?.resultCode) {
        if (isAuthFailure(data, res.status)) {
          throw new AppError(`HIWARE auth HTTP ${res.status}`, {
            status: 502,
            code: 'HIWARE_AUTH_ERROR',
          });
        }
        throw new AppError(`HIWARE HTTP ${res.status}`, { status: 502 });
      }

      if (String(data?.resultCode) !== '200') {
        const msg = data?.content?.message || data?.content?.attributes || 'HIWARE API error';
        if (isAuthFailure(data, res.status)) {
          throw new AppError(String(msg), { status: 502, code: 'HIWARE_AUTH_ERROR' });
        }
        throw new AppError(String(msg), { status: 502, code: 'HIWARE_API_ERROR' });
      }

      return data;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new AppError('HIWARE API timeout', { status: 504 });
      }
      if (err instanceof AppError) throw err;
      const cause = err.cause;
      const detail = [
        err.message,
        cause?.code,
        cause?.message,
        cause?.reason,
      ]
        .filter(Boolean)
        .join(' | ');
      throw new AppError(`HIWARE 연결 실패: ${detail}`, {
        status: 502,
        code: 'HIWARE_NETWORK_ERROR',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  getUsers({ start = 0, limit = 100 } = {}) {
    return this.request('GET', '/users', { query: { start: String(start), limit: String(limit) } });
  }

  getUser(userNo, searchType = 'userNo') {
    return this.request('GET', `/users/${userNo}`, { query: { searchType } });
  }

  getApprovalDetail(apvApltNo) {
    return this.request('GET', '/approval/aplt/' + apvApltNo);
  }

  getIntray({ userNo, start = 0, limit = 100 } = {}) {
    const query = { start: String(start), limit: String(limit) };
    if (userNo) query.userNo = String(userNo);
    return this.request('GET', '/approval/auth-box/intray', { query });
  }

  batchApplyApv(items) {
    return this.request('POST', '/approval/aplt/applyApv', { body: items });
  }

  /**
   * 결재자 ID/PW로 임시 로그인 후 applyApv. 서비스 계정 this.apiToken 은 건드리지 않음.
   * @param {{ userId: string, password: string, items: object[] }} opts
   */
  async batchApplyApvAs({ userId, password, items }) {
    const token = await this.loginAs(userId, password);
    const url = `${this.baseUrl}/approval/aplt/applyApv`;
    return this._rawRequest('POST', url, { body: items, withToken: true, apiToken: token });
  }
}

export const hiwareClient = new HiwareClient();
