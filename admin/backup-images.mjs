import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, realpath, open } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { resolve, join, dirname, relative, sep, basename } from 'node:path';
import { parseDocument, isMap, isSeq, isScalar } from 'yaml';
import { detectRasterImage } from './image-format.mjs';

export const IMAGE_LIMIT = 20 * 1024 * 1024;
const TOTAL_LIMIT = 256 * 1024 * 1024;
const imageKey = /^(?:logo|favicon|orbitImage|cover|avatar|image|thumbnail|poster|banner)$/i;
const fail = message => { throw Object.assign(new Error(message), { status: 422 }); };

/** Only images are restored into the public uploads directory. SVG is deliberately passive. */
export function validateBackupImage(bytes) {
  const data = Buffer.from(bytes);
  if (!data.length || data.length > IMAGE_LIMIT) fail('Image exceeds the 20 MiB limit.');
  const raster = detectRasterImage(data);
  if (raster) return raster;
  if (data.length >= 22 && data.readUInt16LE(0) === 0 && data.readUInt16LE(2) === 1 && data.readUInt16LE(4) > 0 && data.length >= 6 + data.readUInt16LE(4) * 16) {
    for (let i = 0; i < data.readUInt16LE(4); i++) { const p = 6 + i * 16; if (!data.readUInt32LE(p + 8) || data.readUInt32LE(p + 12) + data.readUInt32LE(p + 8) > data.length) fail('Invalid ICO image.'); }
    return { ext: 'ico', mime: 'image/x-icon' };
  }
  if (data.length >= 24 && data.toString('ascii', 4, 8) === 'ftyp' && data.readUInt32BE(0) <= data.length && /(?:avif|avis)/.test(data.toString('ascii', 8, Math.min(data.readUInt32BE(0), 64)))) return { ext: 'avif', mime: 'image/avif' };
  // XML comments are inert; remove only literal, closed comments before decoding
  // entities, so encoded comment markers cannot hide active SVG elements.
  const xml = decodeEntities(data.toString('utf8').replace(/^\uFEFF/, '').replace(/<!--[\s\S]*?-->/g, '').trim());
  if (/^(?:<\?xml[^?]*\?>\s*)?<svg(?:\s|>)/i.test(xml) && /(?:<\/svg\s*>|\/>)\s*$/i.test(xml)) {
    if (/<!|<\?(?!xml\b)|<\s*(?:[\w.-]+:)?(?:script|foreignObject|iframe|object|embed|audio|video|animate|animateMotion|animateTransform|set)\b|\son[\w:-]*\s*=|\b(?:javascript|vbscript)\s*:|@import|\\/i.test(xml)) fail('Active SVG content is not supported in backups.');
    for (const match of xml.matchAll(/\b(?:[\w.-]+:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) if (!(match[1] ?? match[2] ?? match[3]).startsWith('#')) fail('SVG external references are not supported in backups.');
    for (const match of xml.matchAll(/url\s*\(([^)]*)\)/gi)) if (!/^\s*['"]?#[\w:.-]+['"]?\s*$/.test(match[1])) fail('SVG external references are not supported in backups.');
    return { ext: 'svg', mime: 'image/svg+xml' };
  }
  fail('Unsupported or invalid image (PNG, JPEG, GIF, WebP, SVG, ICO or AVIF expected).');
}

/** Restrict remote downloads to public addresses, including every DNS answer and redirect. */
export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase();
    return /^[23]/.test(normalized) && !/^2001:(?:0*:|db8:|2:|10:|20:)/.test(normalized) && !normalized.startsWith('2002:');
  }
  return false;
}
function publicUrl(value) {
  let url; try { url = new URL(value); } catch { fail('Invalid image URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) fail('Only public HTTP(S) image URLs on ports 80/443 can be downloaded.');
  url.hash = ''; return url;
}
export async function fetchBackupImage(value, { deadline = Date.now() + 12000, resolveHost = lookup } = {}) {
  let url = publicUrl(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) fail('Image download timed out.');
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    let timer;
    let answers;
    try {
      answers = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await Promise.race([
        resolveHost(hostname, { all: true, verbatim: true }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Image DNS lookup timed out.')), Math.min(remaining, 5000)); timer.unref?.(); }),
      ]);
    } finally { clearTimeout(timer); }
    if (!answers.length || answers.some(answer => !isPublicAddress(answer.address))) fail('Private or reserved image destinations are not downloadable.');
    const answer = answers[0];
    const response = await new Promise((accept, reject) => {
      const request = (url.protocol === 'https:' ? https : http).get(url, {
        agent: false, signal: AbortSignal.timeout(Math.max(1, Math.min(10000, deadline - Date.now()))),
        headers: { Accept: 'image/*', 'User-Agent': 'PersonalBlog-Backup/1.0' },
        lookup: (_host, options, callback) => options?.all ? callback(null, [answer]) : callback(null, answer.address, answer.family),
      }, res => {
        // A rejected/redirect response never needs its body; close it immediately.
        res.on('error', reject);
        res.on('aborted', () => reject(new Error('Image download was interrupted.')));
        if ([301,302,303,307,308].includes(res.statusCode)) { accept({ redirect: res.headers.location }); res.destroy(); return; }
        if (res.statusCode !== 200) { reject(new Error(`Image returned HTTP ${res.statusCode}.`)); res.destroy(); return; }
        if (Number(res.headers['content-length']) > IMAGE_LIMIT) { reject(new Error('Image exceeds the 20 MiB limit.')); res.destroy(); return; }
        const chunks = []; let size = 0;
        res.on('data', chunk => { size += chunk.length; if (size > IMAGE_LIMIT) { res.destroy(new Error('Image exceeds the 20 MiB limit.')); } else chunks.push(chunk); });
        res.on('end', () => accept({ data: Buffer.concat(chunks) }));
      });
      request.on('error', reject);
    });
    if (response.data) return response.data;
    if (!response.redirect || redirects === 3) fail('Too many or invalid image redirects.');
    url = publicUrl(new URL(response.redirect, url).href);
  }
}

function safeLocalPath(value) {
  let path; try { path = decodeURIComponent(value.split(/[?#]/)[0]); } catch { fail('Invalid local image path.'); }
  if (!path || /[\\\x00-\x1f\x7f]/.test(path) || path.split('/').some(part => part === '..' || (part.startsWith('.') && part !== '.') || part.startsWith('~')) || /%(?:2e|2f|5c|00)/i.test(path)) fail('Unsafe local image path.');
  return path;
}
async function readLocal(root, path) {
  root = resolve(root); const file = resolve(root, path);
  if (!file.startsWith(root + sep)) fail('Image is outside the content directory.');
  // Reject symlinks at every level, not just the final image.
  let current = root;
  for (const part of relative(root, file).split(sep)) { current = join(current, part); if ((await lstat(current)).isSymbolicLink()) fail('Symlink images are not included.'); }
  const rootReal = await realpath(root); const fileReal = await realpath(file);
  if (!fileReal.startsWith(rootReal + sep)) fail('Image is outside the content directory.');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > IMAGE_LIMIT) fail('Image is not a regular file or exceeds 20 MiB.'); return await handle.readFile(); }
  finally { await handle.close(); }
}

/** Locate common Markdown inline/reference images, HTML images and image-valued frontmatter. */
function decodeEntities(text) {
  return text.replace(/&(?:#(x[0-9a-f]+|[0-9]+)|(amp|lt|gt|quot|apos));/gi, (raw, code, named) => {
    if (named) return {amp:'&',lt:'<',gt:'>',quot:'\"',apos:"'"}[named.toLowerCase()];
    const value = code.toLowerCase().startsWith('x') ? parseInt(code.slice(1),16) : Number(code);
    return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : raw;
  });
}
const markdownUrl = value => decodeEntities(value).replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
const referenceLabel = value => markdownUrl(value).trim().replace(/\s+/g, ' ').toLowerCase();
function escapedAt(text, index) { let count = 0; while (index > 0 && text[--index] === '\\') count++; return count % 2 === 1; }

/** Record source spans, so equal URLs in prose, links and examples never change. */
function findReferences(text, { direct = false, frontmatter = false } = {}) {
  const references = [], spans = new Set();
  function add(start, end, url = markdownUrl(text.slice(start, end)), render = value => value) {
    const key = `${start}:${end}`;
    if (!url || /^(?:data:|#)/i.test(url) || spans.has(key)) return;
    spans.add(key); references.push({ start, end, raw: text.slice(start, end), url, render });
  }
  if (direct) { const start = text.search(/\S/); if (start >= 0) add(start, text.trimEnd().length, text.trim()); return references; }
  const masked = text.split('');
  const mask = (start, end) => { for (let i = start; i < end; i++) if (!/[\r\n]/.test(masked[i])) masked[i] = ' '; };
  if (frontmatter) {
    const header = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    if (header) {
      const start = header[0].indexOf('\n') + 1;
      const document = parseDocument(header[1]);
      function visit(node, key = '') {
        if (isScalar(node) && typeof node.value === 'string' && imageKey.test(key) && node.range) {
          const [a, b] = node.range, raw = header[1].slice(a, b);
          add(start + a, start + b, node.value.trim(), value => JSON.stringify(value) + (raw.match(/\r?\n$/)?.[0] || ''));
        } else if (isMap(node)) for (const pair of node.items) visit(pair.value, String(pair.key?.value ?? ''));
        else if (isSeq(node)) for (const item of node.items) visit(item, key);
      }
      if (!document.errors.length) visit(document.contents);
      mask(0, header[0].length);
    }
  }
  // Mask comments and code without changing offsets or the original source bytes.
  for (const match of text.matchAll(/<!--[\s\S]*?(?:-->|$)|<(pre|code|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi)) mask(match.index, match.index + match[0].length);
  let fence = null;
  for (const line of masked.join('').matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!line[0]) continue;
    const body = line[0].replace(/\r?\n$/, '');
    const marker = /^ {0,3}(?:> ?)*(`{3,}|~{3,})(.*)$/.exec(body);
    if (fence) { mask(line.index, line.index + line[0].length); if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null; }
    else if (marker && !(marker[1][0] === '`' && marker[2].includes('`'))) { fence = marker[1]; mask(line.index, line.index + line[0].length); }
  }
  let visible = masked.join('');
  for (let i = 0; i < visible.length; i++) {
    if (visible[i] !== '`' || escapedAt(visible, i)) continue;
    let end = i + 1; while (visible[end] === '`') end++;
    const marker = visible.slice(i, end); let close = visible.indexOf(marker, end);
    while (close >= 0 && (visible[close - 1] === '`' || visible[close + marker.length] === '`')) close = visible.indexOf(marker, close + marker.length);
    if (close >= 0) { mask(i, close + marker.length); i = close + marker.length - 1; } else i = end - 1;
  }
  visible = masked.join('');
  const definitions = new Map();
  for (const match of visible.matchAll(/^ {0,3}\[((?:\\.|[^\]\\])+)\]:[ \t]*(?:<([^>\r\n]+)>|(\S+))/gmd)) {
    const label = referenceLabel(match[1]), group = match[2] === undefined ? 3 : 2;
    const end = match.indices[group][1], after = end + (group === 2 ? 1 : 0);
    const title = /^[ \t]+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^\r\n]*\))/.exec(text.slice(after))?.[0] || '';
    if (!definitions.has(label)) definitions.set(label, { start: match.indices[group][0], end, title });
    mask(match.index, match.index + match[0].length);
  }
  visible = masked.join('');
  const imageUses = [], linkUses = new Set();
  const brackets = /(!?)\[((?:\\.|[^\[\]\\])*)\]/g; let match;
  while ((match = brackets.exec(visible))) {
    if (escapedAt(visible, match.index)) continue;
    const image = match[1] === '!', labelEnd = match.index + match[0].length;
    if (visible[labelEnd] === '(') {
      let start = labelEnd + 1; while (/\s/.test(visible[start] || '') && start < visible.length) start++;
      let end = start, after;
      if (visible[start] === '<') { start++; end = visible.indexOf('>', start); if (end < 0) continue; after = end + 1; }
      else { let depth = 0; for (; end < visible.length; end++) { if (visible[end] === '\\') { end++; continue; } if (visible[end] === '(') depth++; else if (visible[end] === ')') { if (!depth) break; depth--; } else if (/\s/.test(visible[end]) && !depth) break; } after = end; }
      const closing = /^\s*(?:(?:"[^"\n]*"|'[^'\n]*'|\([^\n]*\))\s*)?\)/.exec(visible.slice(after));
      if (closing) { if (image) add(start, end); brackets.lastIndex = after + closing[0].length; }
      continue;
    }
    let end = labelEnd, label = match[2];
    const explicit = /^\[((?:\\.|[^\]\\])*)\]/.exec(visible.slice(labelEnd));
    if (explicit) { label = explicit[1] || label; end += explicit[0].length; brackets.lastIndex = end; }
    label = referenceLabel(label);
    if (image) imageUses.push({ label, start: match.index, end, alt: text.slice(match.index, labelEnd) });
    else if (visible[match.index - 1] !== '!' && visible[match.index - 1] !== ']') linkUses.add(label);
  }
  for (const use of imageUses) {
    const definition = definitions.get(use.label); if (!definition) continue;
    const url = markdownUrl(text.slice(definition.start, definition.end));
    // A shared definition must keep ordinary links pointing at their original URL.
    if (linkUses.has(use.label)) add(use.start, use.end, url, value => `${use.alt}(<${value}>${definition.title})`);
    else add(definition.start, definition.end, url);
  }
  for (const tag of visible.matchAll(/<(?:img|source)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    if (escapedAt(visible, tag.index)) continue;
    for (const attr of tag[0].matchAll(/\s(src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gid)) {
      const group = attr[2] !== undefined ? 2 : attr[3] !== undefined ? 3 : 4;
      const value = attr[group], offset = tag.index + attr.indices[group][0];
      if (attr[1].toLowerCase() === 'src') { add(offset, offset + value.length, decodeEntities(value)); continue; }
      let cursor = 0;
      while (cursor < value.length) {
        while (/[\s,]/.test(value[cursor] || '') && cursor < value.length) cursor++;
        const start = cursor; while (cursor < value.length && !/\s/.test(value[cursor])) cursor++;
        const token = value.slice(start, cursor), url = token.replace(/,+$/, '');
        if (url) add(offset + start, offset + start + url.length, decodeEntities(url));
        if (token.endsWith(',')) continue;
        while (cursor < value.length && value[cursor] !== ',') cursor++;
      }
    }
  }
  return references;
}
function warningSource(source) {
  try { const url = new URL(source); return `${url.origin}${url.pathname}`.slice(0, 2000); } catch { return source.slice(0, 2000); }
}

/** Produces a portable snapshot only; live content and uploaded images are never changed. */
export async function prepareBackupImages({ files, projectRoot, dataDir, uploadsDir, siteUrl, downloadImage = fetchBackupImage }) {
  const output = new Map(files); const warnings = []; const jobs = new Map(); const units = []; const jsonFiles = new Map(); const changedJson = new Set();
  const site = JSON.parse(files.get('content/site.json').toString('utf8'));
  const localOrigins = new Set();
  for (const value of [siteUrl, site.url]) { try { localOrigins.add(new URL(value).origin); } catch {} }
  function collect(text, filename, options, commit) {
    const unit = { text, edits: [], commit }; units.push(unit);
    for (const reference of findReferences(text, options)) {
      const key = `${filename}\0${reference.url}`;
      if (!jobs.has(key)) jobs.set(key, { url: reference.raw, sourceUrl: reference.url, filename, targets: [] });
      jobs.get(key).targets.push({ unit, reference });
    }
  }
  function walk(value, filename, key = '', commit = () => {}) {
    if (typeof value === 'string') collect(value, filename, { direct: imageKey.test(key) }, text => { commit(text); changedJson.add(filename); });
    else if (Array.isArray(value)) value.forEach((item, index) => walk(item, filename, key, text => { value[index] = text; }));
    else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) walk(item, filename, name, text => { value[name] = text; });
  }
  for (const [filename, bytes] of files) {
    if (filename === 'content/media.json') continue;
    if (filename.endsWith('.json')) { const value = JSON.parse(bytes.toString('utf8')); jsonFiles.set(filename, value); walk(value, filename); }
    else if (filename.endsWith('.md')) collect(bytes.toString('utf8'), filename, { frontmatter: true }, text => output.set(filename, Buffer.from(text)));
  }
  if (jobs.size > 5000) fail('Backup references more than 5,000 images.');
  const cache = new Map(); const metadata = new Map(); let total = 0; const deadline = Date.now() + 90000;
  async function capture({ url, sourceUrl = url, filename, targets }) {
    let source = sourceUrl;
    if (/^https?:\/\//i.test(source)) {
      let parsed;
      try { parsed = new URL(source); }
      catch { warnings.push(`${filename}: ${warningSource(url)} — Invalid image URL. Original URL kept.`); return; }
      if (localOrigins.has(parsed.origin)) source = parsed.pathname + parsed.search + parsed.hash;
    }
    const cacheKey = /^https?:\/\//i.test(source) || source.startsWith('/') ? source : `${filename}\0${source}`;
    if (!cache.has(cacheKey)) cache.set(cacheKey, (async () => {
      let data;
      if (/^https?:\/\//i.test(source)) data = await downloadImage(source, { deadline: Math.min(deadline, Date.now() + 12000) });
      else {
        if (source.startsWith('//') || /^[a-z][\w+.-]*:/i.test(source)) fail('Unsupported image URL.');
        const path = safeLocalPath(source);
        if (path.startsWith('/uploads/')) data = await readLocal(uploadsDir, path.slice(9));
        else if (path.startsWith('/')) data = await readLocal(join(projectRoot, 'public'), path.slice(1));
        else {
          const contentPath = filename.replace(/^content\//, '');
          try { data = await readLocal(dataDir, join(dirname(contentPath), path)); }
          catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; data = await readLocal(join(projectRoot, 'public'), path); }
        }
      }
      const { ext, mime } = validateBackupImage(data);
      const id = `backup-${createHash('sha256').update(data).digest('hex')}.${ext}`;
      if (!metadata.has(id)) {
        total += data.length; if (total > TOTAL_LIMIT) fail('Referenced images exceed the 256 MiB backup limit.');
        output.set(`images/${id}`, Buffer.from(data));
        metadata.set(id, { id, name: (basename(source.split(/[?#]/)[0]) || id).slice(0, 200), url: `/uploads/${id}`, mime, size: data.length, createdAt: new Date().toISOString() });
      }
      const fragment = source.includes('#') ? '#' + source.split('#').slice(1).join('#') : '';
      return `/uploads/${id}${fragment}`;
    })());
    try {
      const replacement = await cache.get(cacheKey);
      for (const { unit, reference } of targets) unit.edits.push({ start: reference.start, end: reference.end, value: reference.render(replacement) });
    } catch (error) { warnings.push(`${filename}: ${warningSource(url)} — ${error.code === 'ENOENT' ? 'Local image not found; original URL kept.' : `${String(error.message).slice(0, 2000)} Original URL kept.`}`); }
  }
  const queue = [...jobs.values()]; let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => { while (cursor < queue.length) await capture(queue[cursor++]); }));
  for (const unit of units) {
    if (!unit.edits.length) continue;
    const pieces = []; let cursor = 0;
    for (const edit of unit.edits.sort((a, b) => a.start - b.start || b.end - a.end)) {
      if (edit.start < cursor) continue;
      pieces.push(unit.text.slice(cursor, edit.start), edit.value); cursor = edit.end;
    }
    pieces.push(unit.text.slice(cursor)); unit.commit(pieces.join(''));
  }
  for (const filename of changedJson) output.set(filename, Buffer.from(JSON.stringify(jsonFiles.get(filename), null, 2) + '\n'));
  output.set('content/media.json', Buffer.from(JSON.stringify([...metadata.values()], null, 2) + '\n'));
  return { files: output, warnings: [...new Set(warnings)].sort(), imageCount: metadata.size };
}
