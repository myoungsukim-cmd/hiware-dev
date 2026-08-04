export class AppError extends Error {
  constructor(message, { status = 500, code = 'APP_ERROR' } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export class TaskRejectedError extends Error {
  constructor(message = 'Async task rejected: queue capacity exceeded') {
    super(message);
    this.name = 'TaskRejectedError';
    this.status = 503;
    this.code = 'TASK_REJECTED';
  }
}

export class ValidationError extends AppError {
  constructor(message) {
    super(message, { status: 400, code: 'VALIDATION_ERROR' });
    this.name = 'ValidationError';
  }
}

/** 비밀번호/OTP 등 자격증명 오류 — Worker 재시도 시 HIWARE 계정 잠금 유발 */
const NON_RETRYABLE_JOB_CODES = new Set([
  'HIWARE_LOGIN_ERROR',
  'HIWARE_OTP_VERIFY_ERROR',
  'HIWARE_OTP_REQUIRED',
  'HIWARE_OTP_NOT_REGISTERED',
  'HIWARE_MFA_REQUIRED',
  'HIWARE_MFA_NO_FACTOR',
  'HIWARE_MFA_UNSUPPORTED',
  'VALIDATION_ERROR',
]);

export function isNonRetryableJobError(err) {
  if (!err) return false;
  if (err.code && NON_RETRYABLE_JOB_CODES.has(err.code)) return true;
  if (err.status === 400) return true;
  const msg = String(err.message || '').toLowerCase();
  return (
    msg.includes('invalid authcode')
    || msg.includes('invalid password')
    || msg.includes('authcode')
    || msg.includes('failurecount')
    || msg.includes('failure count')
    || msg.includes('로그인')
    || msg.includes('비밀번호')
    || msg.includes('패스워드')
    || msg.includes('인증번호')
    || msg.includes('otp')
  );
}
