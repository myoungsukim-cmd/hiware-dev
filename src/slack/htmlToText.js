/**
 * HIWARE htmlCnts → Slack mrkdwn용 평문
 *
 * HIWARE 웹 UI는 자간용으로 글자 사이 `&nbsp;` 를 넣는 경우가 많음
 * → 태그 제거 후 "김 태 양", "& n b s p ;" 형태로 보임. 이를 복원함.
 */
export function htmlToPlainText(html, maxLen = 2900) {
  if (!html) return '(내용 없음)';

  let text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/t[hd]>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    // 1차 엔티티
    .replace(/&nbsp;?|&#160;|&#x0*A0;/gi, ' ')
    .replace(/&ensp;|&emsp;|&thinsp;/gi, ' ')
    .replace(/&lrm;|&rlm;|&#8206;|&#8207;|&#x0*200[EF];/gi, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => decodeCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => decodeCodePoint(Number.parseInt(h, 16)))
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200e\u200f\ufeff]/g, '')
    .replace(/\r\n/g, '\n');

  // 자간용 nbsp 때문에 엔티티가 "& n b s p ;" 로 분해된 경우
  text = text
    .replace(/&\s*n\s*b\s*s\s*p\s*;/gi, ' ')
    .replace(/&\s*l\s*r\s*m\s*;/gi, '')
    .replace(/&\s*r\s*l\s*m\s*;/gi, '')
    .replace(/&\s*#\s*1\s*6\s*0\s*;/gi, ' ')
    .replace(/&\s*#\s*x?\s*0*a\s*0\s*;/gi, ' ')
    .replace(/&\s*#\s*8\s*2\s*0\s*[67]\s*;/gi, '');

  // 글자 사이 강제 공백 복원 (김 태 양 → 김태양)
  text = collapseLetterSpacing(text);

  text = text
    .replace(/\t+/g, ' | ')
    .replace(/[ \t]*\|[ \t]*/g, ' | ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\|[ \t]*\|/g, '|')
    .replace(/^\s*\|\s*/gm, '')
    .replace(/\s*\|\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  text = insertSectionBreaks(text);

  if (text.length > maxLen) {
    text = text.slice(0, maxLen) + '…';
  }
  return text || '(내용 없음)';
}

function decodeCodePoint(code) {
  if (!Number.isFinite(code)) return '';
  if (code === 160) return ' ';
  if (code === 8206 || code === 8207 || code === 65279) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/**
 * "김 태 양 - 2 0 2 6" 처럼 한 글자씩 띄운 구간을 붙임.
 * 줄/셀(|) 단위로 처리해 일반 단어 공백은 최대한 보존.
 */
function collapseLetterSpacing(text) {
  return text
    .split('\n')
    .map((line) =>
      line
        .split('\t')
        .map((cell) => collapseSpacedTokenRun(cell))
        .join('\t')
    )
    .join('\n');
}

function collapseSpacedTokenRun(cell) {
  const trimmed = cell.trim();
  if (!trimmed) return '';

  // 공백으로만 나뉜 토큰이 모두 1글자면 자간 벌림으로 보고 연결
  const parts = trimmed.split(/ +/);
  if (parts.length >= 2 && parts.every((p) => [...p].length === 1)) {
    return parts.join('');
  }

  // 혼합: "일반 서 버" 같은 케이스는 연속 1글자 구간만 결합
  return trimmed.replace(/(?:[^\s] )+[^\s]/g, (run) => {
    const toks = run.split(' ');
    if (toks.length >= 2 && toks.every((t) => [...t].length === 1)) {
      return toks.join('');
    }
    return run;
  });
}

function insertSectionBreaks(text) {
  const headers = [
    '상신 사유',
    '상신자 정보',
    '대상자 정보',
    '접근 대상',
    '허용 기간',
    '결재 라인',
    '결재자 목록',
    '개별 정책',
    '개별 상세',
  ];
  let out = text;
  for (const h of headers) {
    const re = new RegExp('([^\\n])(' + escapeRegExp(h) + ')', 'g');
    out = out.replace(re, '$1\n\n$2');
  }
  out = out.replace(/([.。])([가-힣A-Za-z])/g, '$1\n$2');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function truncate(text, maxLen = 300) {
  if (!text) return '';
  const s = String(text);
  if (s.length <= maxLen) return s;
  // ellipsis 포함해 maxLen 이하로 (Slack modal title 등 24자 제한)
  if (maxLen <= 1) return '…'.slice(0, maxLen);
  return s.slice(0, maxLen - 1) + '…';
}
