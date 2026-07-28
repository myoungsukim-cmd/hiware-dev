import { config } from '../config/index.js';

export function validateComment(comment) {
  const trimmed = (comment || '').trim();
  if (trimmed.length < config.approval.commentMinLength) {
    return {
      ok: false,
      message: `의견은 ${config.approval.commentMinLength}자 이상 입력해 주세요.`,
    };
  }
  return { ok: true, value: trimmed };
}
