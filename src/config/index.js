import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDbEnv } from '../lib/dbEnv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dbEnv = resolveDbEnv(process.env);

function env(name, fallback = undefined) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    return undefined;
  }
  return v;
}

function envRequired(name) {
  const v = env(name);
  if (!v) throw new Error(`환경변수 필요: ${name}`);
  return v;
}

function envInt(name, fallback) {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`환경변수 ${name} 는 정수여야 합니다`);
  return n;
}

function envBool(name, fallback = false) {
  const raw = env(name);
  if (raw === undefined) return fallback;
  return raw === 'true' || raw === '1';
}

export const config = {
  nodeEnv: env('NODE_ENV', 'development'),
  isProd: env('NODE_ENV', 'development') === 'production',

  server: {
    port: envInt('PORT', 3000),
    host: env('HOST', '0.0.0.0'),
    trustProxy: envBool('TRUST_PROXY', false),
  },

  mysql: {
    host: dbEnv.host,
    port: dbEnv.port,
    user: dbEnv.user,
    password: dbEnv.password,
    database: dbEnv.database,
    poolSize: dbEnv.poolSize,
  },

  hiware: {
    baseUrl: env('HIWARE_BASE_URL', ''),
    apiToken: env('HIWARE_API_TOKEN', ''),
    /** Login Interface — ID/PW 있으면 자동 로그인·토큰 갱신 (TOKEN보다 우선) */
    userId: env('HIWARE_USER_ID', ''),
    userPwd: env('HIWARE_USER_PWD', ''),
    insecure: envBool('HIWARE_INSECURE', true),
    timeoutMs: envInt('HIWARE_TIMEOUT_MS', 120000),
    /** Login Interface v6.0.2+ 필수 Client IP (앱→HIWARE 출발지, 예: 172.25.2.201) */
    loginIpAddress: env('HIWARE_LOGIN_IP_ADDRESS', ''),
  },

  slack: {
    botToken: env('SLACK_BOT_TOKEN', ''),
    signingSecret: env('SLACK_SIGNING_SECRET', ''),
    skipSignature: envBool('SLACK_SKIP_SIGNATURE', false),
  },

  async: {
    corePoolSize: envInt('ASYNC_CORE_POOL_SIZE', 3),
    maxPoolSize: envInt('ASYNC_MAX_POOL_SIZE', 30),
    queueCapacity: envInt('ASYNC_QUEUE_CAPACITY', 50),
  },

  worker: {
    pollIntervalMs: envInt('JOB_POLL_INTERVAL_MS', 1000),
    batchSize: envInt('JOB_BATCH_SIZE', 5),
    maxAttempts: envInt('JOB_MAX_ATTEMPTS', 5),
  },

  approval: {
    commentMinLength: envInt('APPROVAL_COMMENT_MIN_LENGTH', 5),
    defaultStep: envInt('APPROVAL_DEFAULT_STEP', 1),
    /**
     * true=결재자 HIWARE ID/PW로 임시 로그인 후 applyApv (서비스 계정은 동기화만).
     * false=서비스 계정 토큰으로 대리 결재 (HIWARE가 허용할 때만).
     */
    applyAsApprover: envBool('APPROVAL_APPLY_AS_APPROVER', true),
    /** true=Modal 비밀번호를 applyApv body(apvUserPwd)에도 포함. applyAsApprover면 로그인에도 사용 */
    requireApvUserPwd: envBool('APPROVAL_REQUIRE_APV_USER_PWD', false),
    /**
     * true=결재자 로그인 시 2차 인증(MFA) 지원.
     * Google OTP / HI-OTP(code 08) 우선. Modal에 OTP 입력란 표시.
     */
    mfaGoogleOtp: envBool('APPROVAL_MFA_GOOGLE_OTP', false),
  },

  scheduler: {
    userSyncIntervalMs: envInt('JOB_USER_SYNC_INTERVAL_MS', 86_400_000),
    approvalSyncIntervalMs: envInt('JOB_APPROVAL_SYNC_INTERVAL_MS', 30_000),
    reminderIntervalMs: envInt('JOB_REMINDER_INTERVAL_MS', 900_000),
    reconcileIntervalMs: envInt('JOB_RECONCILE_INTERVAL_MS', 3_600_000),
  },

  reminder: {
    firstDelayMin: envInt('REMINDER_FIRST_DELAY_MIN', 60),
    intervalMin: envInt('REMINDER_INTERVAL_MIN', 120),
    maxCount: envInt('REMINDER_MAX_COUNT', 3),
  },

  startup: {
    runInitialSync: envBool('RUN_INITIAL_SYNC_ON_START', true),
  },
};

/** Modal/승인 시 HIWARE 비밀번호가 필요한지 (결재자 로그인 또는 apvUserPwd 정책) */
export function needsApvUserPwd() {
  return config.approval.applyAsApprover || config.approval.requireApvUserPwd;
}

/** Modal에 Google OTP(HI-OTP) 입력란을 표시할지 */
export function needsMfaOtp() {
  return config.approval.applyAsApprover && config.approval.mfaGoogleOtp;
}

export function validateApiConfig() {
  const missing = [];
  if (!config.mysql.password) missing.push('DB_PASSWORD (또는 MYSQL_PASSWORD)');
  if (!config.hiware.baseUrl) missing.push('HIWARE_BASE_URL');
  const hasLogin = Boolean(config.hiware.userId && config.hiware.userPwd);
  const hasToken = Boolean(config.hiware.apiToken);
  if (!hasLogin && !hasToken) {
    missing.push('HIWARE_USER_ID+HIWARE_USER_PWD (권장) 또는 HIWARE_API_TOKEN');
  } else if (config.hiware.userId && !config.hiware.userPwd) {
    missing.push('HIWARE_USER_PWD (HIWARE_USER_ID 설정 시 필수)');
  } else if (!config.hiware.userId && config.hiware.userPwd) {
    missing.push('HIWARE_USER_ID (HIWARE_USER_PWD 설정 시 필수)');
  }
  if (!config.slack.botToken) missing.push('SLACK_BOT_TOKEN');
  if (!config.slack.signingSecret && !config.slack.skipSignature) {
    missing.push('SLACK_SIGNING_SECRET (또는 SLACK_SKIP_SIGNATURE=true)');
  }
  if (missing.length) {
    throw new Error(`시작 불가 — .env 미설정: ${missing.join(', ')}`);
  }
}

export function validateWorkerConfig() {
  validateApiConfig();
}

export { env, envRequired, envInt, envBool };
