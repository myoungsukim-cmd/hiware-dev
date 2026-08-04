/** Asia/Seoul 기준 표시용 (서버 TZ 무관하게 로컬 KST) */
function nowKstParts() {
  const d = new Date();
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000 - d.getTimezoneOffset() * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return {
    y: kst.getUTCFullYear(),
    m: p(kst.getUTCMonth() + 1),
    d: p(kst.getUTCDate()),
    h: p(kst.getUTCHours()),
    min: p(kst.getUTCMinutes()),
    s: p(kst.getUTCSeconds()),
    ms: String(kst.getUTCMilliseconds()).padStart(3, '0'),
  };
}

export function formatNowKst() {
  const t = nowKstParts();
  return `${t.y}-${t.m}-${t.d} ${t.h}:${t.min}`;
}

/** 앱 로그용 KST 타임스탬프 (초·밀리초 포함) */
export function formatNowKstLog() {
  const t = nowKstParts();
  return `${t.y}-${t.m}-${t.d} ${t.h}:${t.min}:${t.s}.${t.ms}`;
}
