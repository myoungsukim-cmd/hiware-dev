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
    .replace(/<\/td>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text.length > maxLen) {
    text = `${text.slice(0, maxLen)}…`;
  }
  return text || '(내용 없음)';
}

export function truncate(text, maxLen = 300) {
  if (!text) return '';
  const s = String(text);
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}
