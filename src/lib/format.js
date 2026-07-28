/** Asia/Seoul 기준 표시용 (서버 TZ 무관하게 로컬 KST) */
export function formatNowKst() {
  const d = new Date();
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000 - d.getTimezoneOffset() * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${kst.getUTCFullYear()}-${p(kst.getUTCMonth() + 1)}-${p(kst.getUTCDate())} ${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`;
}
