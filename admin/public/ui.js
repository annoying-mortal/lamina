import { t } from './i18n.js';
export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function safeImageUrl(value) {
  const input = String(value || '').trim();
  if (!input || /[\u0000-\u001f\u007f\\]/.test(input)) return '';
  if (input.startsWith('/') && !input.startsWith('//')) return input;
  try { const url = new URL(input); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
export function siteImageUrl(value, siteUrl) {
  const image = safeImageUrl(value);
  if (!image.startsWith('/')) return image;
  try {
    const base = new URL(siteUrl);
    return ['http:', 'https:'].includes(base.protocol) ? new URL(image, base).href : '';
  } catch { return ''; }
}
export function imagePreview(value, alt = '') {
  const img = element('img'); img.alt = alt; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
  const url = safeImageUrl(value); if (url) img.src = url; else img.hidden = true;
  img.addEventListener('error', () => { img.hidden = true; }); return img;
}
export function markdownImage(url, alt = '') {
  const safe = safeImageUrl(url);
  return safe ? `![${String(alt).replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/[\r\n]/g, ' ')}](<${safe.replace(/</g, '%3C').replace(/>/g, '%3E')}>)` : '';
}
function inlineText(text, container) {
  const pattern = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    container.append(document.createTextNode(text.slice(cursor, match.index)));
    const raw = match[2].replace(/^<|>$/g, '');
    const safe = safeImageUrl(raw);
    if (safe) {
      const figure = element('span', 'markdown-image');
      const img = imagePreview(safe, match[1]);
      const failure = element('small', 'muted', t('Image unavailable. Check the URL.', '图片无法显示，请检查地址。')); failure.hidden = true;
      img.addEventListener('error', () => { failure.hidden = false; });
      figure.append(img, failure); if (match[1]) figure.append(element('small', '', match[1])); container.append(figure);
    } else container.append(document.createTextNode(match[0]));
    cursor = match.index + match[0].length;
  }
  container.append(document.createTextNode(text.slice(cursor)));
}
export function renderMarkdown(body, container) {
  container.replaceChildren();
  let code = null; let paragraph = [];
  const flush = () => { if (paragraph.length) { const p = element('p'); inlineText(paragraph.join('\n'), p); container.append(p); paragraph = []; } };
  for (const line of body.split('\n')) {
    if (/^```/.test(line)) { flush(); if (code !== null) { const pre = element('pre'); pre.append(element('code', '', code.join('\n'))); container.append(pre); code = null; } else code = []; }
    else if (code !== null) code.push(line);
    else if (/^#{1,6}\s/.test(line)) { flush(); const match = /^(#{1,6})\s+(.*)$/.exec(line); const h = element(`h${Math.min(match[1].length + 1, 6)}`); inlineText(match[2], h); container.append(h); }
    else if (/^>\s?/.test(line)) { flush(); const quote = element('blockquote'); inlineText(line.replace(/^>\s?/, ''), quote); container.append(quote); }
    else if (!line.trim()) flush(); else paragraph.push(line);
  }
  flush(); if (code !== null) { const pre = element('pre'); pre.append(element('code', '', code.join('\n'))); container.append(pre); }
}
