/**
 * HIWARE htmlCnts → Slack mrkdwn용 평문
 */
export function htmlToPlainText(html, maxLen = 2500) {
  if (!html) return '(내용 없음)';

  let text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/th>/gi, ' ')
    .replace(/<\/td>/gi, ' ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;|&#x0*A0;/gi, ' ')
    .replace(/&ensp;|&emsp;|&thinsp;/gi, ' ')
    .replace(/&lrm;|&rlm;|&#8206;|&#8207;|&#x0*200[EF];/gi, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      if (code === 160) return ' ';
      if (code === 8206 || code === 8207) return '';
      try {
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = Number.parseInt(h, 16);
      if (code === 0xa0) return ' ';
      if (code === 0x200e || code === 0x200f) return '';
      try {
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    })
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200e\u200f]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text.length > maxLen) {
    text = text.slice(0, maxLen) + '…';
  }
  return text || '(내용 없음)';
}

export function truncate(text, maxLen = 300) {
  if (!text) return '';
  const s = String(text);
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}
