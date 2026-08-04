/** Asia/Seoul 기준 (서버 TZ와 무관) */
function nowKstParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    fractionalSecondDigits: 3,
  }).formatToParts(new Date());

  const get = (type) => parts.find((p) => p.type === type)?.value ?? '00';
  // en-CA + hour12:false 에서 자정은 "24"로 나오는 경우 보정
  let h = get('hour');
  if (h === '24') h = '00';

  return {
    y: get('year'),
    m: get('month'),
    d: get('day'),
    h,
    min: get('minute'),
    s: get('second'),
    ms: (get('fractionalSecond') || '000').padStart(3, '0'),
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
