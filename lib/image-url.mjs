/** Preserve remote image URLs during normal editing; explicit ZIP export may download them. */
export function normalizeImageUrl(value, { allowEmpty = true } = {}) {
  if (typeof value !== 'string' || value.length > 2000) throw new Error('图片地址应为不超过 2000 字的 URL。');
  const text = value.trim();
  if (!text && allowEmpty) return '';
  if (!text || /[\\\u0000-\u001f\u007f]/.test(text)) throw new Error('图片地址包含无效字符。');
  if (text.startsWith('/')) {
    if (text.startsWith('//')) throw new Error('图片地址不能省略协议。');
    let path;
    try { path = decodeURIComponent(text.split(/[?#]/)[0]); } catch { throw new Error('图片路径编码不正确。'); }
    if (path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path) || path.split('/').some(segment => segment === '..' || segment === '.') || /%(?:2e|2f|5c|00)/i.test(path)) throw new Error('图片路径不能包含目录穿越或重复编码。');
    const url = new URL(text, 'http://local.invalid');
    if (url.origin !== 'http://local.invalid') throw new Error('图片路径无效。');
    return url.pathname + url.search + url.hash;
  }
  let url;
  try { url = new URL(text); } catch { throw new Error('请使用站内 /uploads/... 路径或完整的 HTTP(S) 图片地址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('图片地址只支持 HTTP(S)，且不能包含账号密码。');
  return url.href;
}
