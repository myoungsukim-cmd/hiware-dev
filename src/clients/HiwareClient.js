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
    this.loginIpAddress = cfg.loginIpAddress || '';
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
    const result = await this._loginWithCredentials(this.userId, this.userPwd, { allowMfa: false });
    if (!result.authKey) {
      throw new AppError(
        '서비스 계정에 2차 인증(MFA)이 걸려 있습니다. MFA 없는 연동 계정을 사용하세요.',
        { status: 502, code: 'HIWARE_LOGIN_ERROR' }
      );
    }
    return result.authKey;
  }

  /**
   * Login Interface. this.apiToken 은 변경하지 않음.
   * @returns {Promise<{ authKey?: string, mfaRequired?: boolean, temporaryAccessKey?: string, currentStep?: number, factors?: object[] }>}
   */
  async _loginWithCredentials(userId, password, { allowMfa = false } = {}) {
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
    const body = {
      userId: String(userId),
      password: encPwd,
      issueKey,
      authProviderType: 'ID/PASSWORD',
      authProviderId: 'hiware',
    };
    if (this.loginIpAddress) {
      body.ipAddress = String(this.loginIpAddress);
    }

    let login;
    try {
      login = await this._rawRequest('POST', `${this.authBaseUrl}/login`, {
        withToken: false,
        body,
      });
    } catch (err) {
      // Worker 재시도 금지용 코드로 고정 (틀린 비밀번호 등)
      throw new AppError(err.message || 'HIWARE login failed', {
        status: err.status || 502,
        code: 'HIWARE_LOGIN_ERROR',
      });
    }

    const content = login?.content ?? {};

    // HI-OTP 미등록 등
    if (
      content.typeCode === '08'
      || String(login?.contentSimpleType || '').includes('RegisterOtp')
      || String(content.type || '').includes('RegisterOtp')
    ) {
      throw new AppError(
        'HI-OTP(Google OTP)가 미등록 상태입니다. HIWARE에서 OTP를 먼저 등록하세요.',
        { status: 502, code: 'HIWARE_OTP_NOT_REGISTERED' }
      );
    }

    if (content.authKey) {
      return { authKey: String(content.authKey) };
    }

    if (content.temporaryAccessKey) {
      if (!allowMfa) {
        throw new AppError(
          'HIWARE 2차 인증(MFA)이 필요합니다. APPROVAL_MFA_GOOGLE_OTP=true 후 OTP를 입력하세요.',
          { status: 502, code: 'HIWARE_MFA_REQUIRED' }
        );
      }
      return {
        mfaRequired: true,
        temporaryAccessKey: String(content.temporaryAccessKey),
        currentStep: Number(content.currentStep) || 1,
        factors: Array.isArray(content.factors) ? content.factors : [],
        timeout: content.timeout,
      };
    }

    const msg = authFailureMessage(login) || 'HIWARE login failed';
    throw new AppError(String(msg), { status: 502, code: 'HIWARE_LOGIN_ERROR' });
  }

  /**
   * 결재자 본인 로그인 (+ 옵션 MFA). 서비스 계정 토큰 유지.
   * @param {{ userId: string, password: string, otp?: string }} opts
   * @returns {Promise<string>} authKey
   */
  async loginAsApprover({ userId, password, otp }) {
    const allowMfa = Boolean(config.approval?.mfaGoogleOtp);
    const result = await this._loginWithCredentials(userId, password, { allowMfa });

    if (result.authKey) {
      logger.info('HIWARE login ok (approver session)', { userId: String(userId), mfa: false });
      return result.authKey;
    }

    if (!result.mfaRequired) {
      throw new AppError('HIWARE login failed', { status: 502, code: 'HIWARE_LOGIN_ERROR' });
    }

    const authCode = String(otp || '').trim();
    if (!authCode) {
      throw new AppError('Google OTP(인증번호)를 입력해 주세요.', {
        status: 400,
        code: 'HIWARE_OTP_REQUIRED',
      });
    }

    const factor = pickMfaFactor(result.factors);
    if (!factor) {
      throw new AppError('사용 가능한 2차 인증 수단이 없습니다.', {
        status: 502,
        code: 'HIWARE_MFA_NO_FACTOR',
      });
    }

    const type = String(factor.code ?? factor.type ?? '08');
    if (String(factor.preProcess || '') === 'SendOtp') {
      throw new AppError(
        'EMAIL/SMS OTP는 아직 지원하지 않습니다. HI-OTP(Google OTP, code 08) 계정을 사용하세요.',
        { status: 502, code: 'HIWARE_MFA_UNSUPPORTED' }
      );
    }

    let verified;
    try {
      verified = await this.additionalVerify({
        type,
        temporaryAccessKey: result.temporaryAccessKey,
        stepNumber: result.currentStep || 1,
        authCode,
      });
    } catch (err) {
      // 틀린 OTP — Worker 재시도 시 계정 잠금되므로 재시도 금지 코드로 고정
      throw new AppError(err.message || 'OTP 검증 실패', {
        status: err.status || 502,
        code: 'HIWARE_OTP_VERIFY_ERROR',
      });
    }

    const authKey = verified?.content?.authKey;
    if (!authKey) {
      const msg = authFailureMessage(verified) || 'OTP 검증 실패';
      throw new AppError(String(msg), { status: 502, code: 'HIWARE_OTP_VERIFY_ERROR' });
    }

    logger.info('HIWARE login ok (approver session)', {
      userId: String(userId),
      mfa: true,
      factor: type,
    });
    return String(authKey);
  }

  /** @deprecated use loginAsApprover */
  async loginAs(userId, password) {
    return this.loginAsApprover({ userId, password });
  }

  /**
   * @param {{ type: string, accessToken: string, langCode?: string }} opts
   */
  async sendOtp({ type, accessToken, langCode = '' }) {
    return this._rawRequest('POST', `${this.authBaseUrl}/sendOtp`, {
      withToken: false,
      body: {
        type: String(type),
        keyType: 'TEMPORARY_ACCESS_KEY',
        accessToken: String(accessToken),
        langCode: langCode || '',
      },
    });
  }

  /**
   * @param {{ type: string, temporaryAccessKey: string, stepNumber: number, authCode: string, issueKey?: string }} opts
   */
  async additionalVerify({ type, temporaryAccessKey, stepNumber, authCode, issueKey }) {
    const parameters = { authCode: String(authCode) };
    if (issueKey) parameters.issueKey = String(issueKey);

    return this._rawRequest('POST', `${this.authBaseUrl}/additionalVerify`, {
      withToken: false,
      body: {
        type: String(type),
        temporaryAccessKey: String(temporaryAccessKey),
        stepNumber: Number(stepNumber) || 1,
        parameters,
      },
    });
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
   * 결재자 ID/PW(+OTP)로 임시 로그인 후 applyApv. 서비스 계정 this.apiToken 은 건드리지 않음.
   * @param {{ userId: string, password: string, otp?: string, items: object[] }} opts
   */
  async batchApplyApvAs({ userId, password, otp, items }) {
    const token = await this.loginAsApprover({ userId, password, otp });
    const url = `${this.baseUrl}/approval/aplt/applyApv`;
    return this._rawRequest('POST', url, { body: items, withToken: true, apiToken: token });
  }
}

/** HI-OTP(08) 우선, 없으면 첫 factor */
function pickMfaFactor(factors) {
  const list = Array.isArray(factors) ? factors : [];
  const hiOtp = list.find((f) => String(f?.code) === '08' || /otp/i.test(String(f?.name || '')));
  return hiOtp || list[0] || null;
}

export const hiwareClient = new HiwareClient();
