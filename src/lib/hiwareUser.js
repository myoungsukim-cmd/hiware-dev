/** HIWARE 목록 API emailAddr 마스킹 (예: ********) */
export function isMaskedEmail(email) {
  if (!email || typeof email !== 'string') return true;
  const trimmed = email.trim();
  if (!trimmed) return true;
  if (trimmed === '********') return true;
  if (/^[*＊]+$/.test(trimmed)) return true;
  return !trimmed.includes('@');
}

/** 상세 → 목록 순으로 첫 유효 이메일 */
export function pickEmail(...candidates) {
  for (const email of candidates) {
    if (!isMaskedEmail(email)) return email.trim();
  }
  return null;
}
