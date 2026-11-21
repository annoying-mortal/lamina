import { readFile, readdir, mkdir, writeFile, rename, unlink, lstat, realpath } from 'node:fs/promises';
import { join, resolve, dirname, relative, sep, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { detectRasterImage } from './image-format.mjs';

export const FILE_LIMIT = 256 * 1024 * 1024;
const types = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json',
  '.zip': 'application/zip', '.gz': 'application/gzip', '.tar': 'application/x-tar', '.7z': 'application/x-7z-compressed',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm',
};
export const fileMimeType = filename => types[extname(filename).toLowerCase()] || 'application/octet-stream';
const rasterTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
async function bytes(req) {
  if (Number(req.headers['content-length']) > FILE_LIMIT) fail(413, '文件不能超过 256 MiB。');
  return new Promise((accept, reject) => {
    const chunks = []; let size = 0; let settled = false;
    const error = (status, message) => { if (!settled) { settled = true; reject(Object.assign(new Error(message), { status })); } };
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > FILE_LIMIT) { error(413, '文件不能超过 256 MiB。'); return; }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!settled) { settled = true; accept(Buffer.concat(chunks)); } });
    req.on('aborted', () => error(400, '文件上传已中断。'));
    req.on('error', () => error(400, '文件上传失败。'));
  });
}
async function atomic(path, value) {
  const temp = join(dirname(path), `.${randomUUID()}.tmp`);
  try { await writeFile(temp, value, { flag: 'wx', mode: 0o644 }); await rename(temp, path); }
  finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

/** Caller checks the request, then revalidates authorization when a queued upload writes. */
export function createMediaStore({ projectRoot, mediaDir = join(projectRoot, 'public/static'), mediaIndexPath = join(projectRoot, 'src/content/media.json') }) {
  const uploads = resolve(mediaDir);
  const publicRoot = resolve(projectRoot, 'public');
  const legacyUploads = resolve(publicRoot, 'uploads');
  const indexPath = resolve(mediaIndexPath);
  let queue = Promise.resolve();
  const serialize = action => { const task = queue.then(action); queue = task.catch(() => {}); return task; };
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
  async function metadata() {
    try {
      const result = JSON.parse(await readFile(indexPath, 'utf8'));
      if (!Array.isArray(result)) fail(422, '文件目录索引损坏，请恢复备份后重试。');
      return result;
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function list() {
    await mkdir(uploads, { recursive: true });
    const names = new Map((await metadata()).map(record => [record.id, record]));
    const records = new Map();
    for (const root of new Set([uploads, legacyUploads])) {
      let entries;
      try { entries = await readdir(root, { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      for (const file of entries) {
        if (!file.isFile() || file.name.startsWith('.') || records.has(file.name)) continue;
        const info = await lstat(join(root, file.name));
        const record = names.get(file.name);
        const prefix = root === uploads ? '/static/' : '/uploads/';
        records.set(file.name, { id: file.name, name: record?.name || file.name, url: `${prefix}${encodeURIComponent(file.name)}`, mime: fileMimeType(file.name), size: info.size, createdAt: record?.createdAt || info.birthtime.toISOString() });
      }
    }
    return [...records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }
  async function serve(res, pathname) {
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { fail(400, '文件路径编码不正确。'); }
    const isUpload = decoded.startsWith('/static/') || decoded.startsWith('/uploads/');
    const local = isUpload ? decoded.slice(decoded.indexOf('/', 1) + 1) : decoded.slice(1);
    if (!local || local.split('/').some(segment => !segment || segment.startsWith('.')) || local.includes('\\') || /[\u0000-\u001f]/.test(local)) fail(404, '文件不存在。');
    const mime = fileMimeType(local);
    if (!isUpload && !mime.startsWith('image/')) fail(404, '文件不存在。');
    let data;
    for (const root of isUpload ? new Set([uploads, legacyUploads]) : [publicRoot]) {
      const file = resolve(root, local);
      if (!file.startsWith(root + sep)) fail(404, '文件不存在。');
      try {
        const resolvedRoot = await realpath(root);
        const resolvedFile = await realpath(file);
        if (!(await lstat(file)).isFile() || !resolvedFile.startsWith(resolvedRoot + sep) || relative(resolvedRoot, resolvedFile).split(sep).some(part => part.startsWith('.'))) fail(404, '文件不存在。');
        data = await readFile(file);
        break;
      } catch (error) { if (['ENOENT','ENOTDIR'].includes(error.code)) continue; throw error; }
    }
    if (!data) fail(404, '文件不存在。');
    const headers = { 'Content-Type': mime, 'Content-Length': data.length, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'no-cache' };
    if (!mime.startsWith('image/')) {
      const record = (await metadata()).find(record => record.id === local);
      const filename = encodeURIComponent(record?.name || local).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      headers['Content-Disposition'] = `attachment; filename*=UTF-8''${filename}`;
    }
    res.writeHead(200, headers); res.end(data);
  }
  return {
    async handle(req, res, pathname, runAuthorized = action => action()) {
      if (req.method === 'GET' && (pathname.startsWith('/static/') || pathname.startsWith('/uploads/') || pathname.startsWith('/covers/') || fileMimeType(pathname).startsWith('image/'))) { await serve(res, pathname); return true; }
      if (pathname !== '/api/media') return false;
      if (req.method === 'GET') { await queue; json(res, 200, await list()); return true; }
      if (req.method !== 'POST') fail(405, '文件仅支持浏览和上传。');
      const contentType = req.headers['content-type']?.split(';')[0].toLowerCase();
      let name;
      try { name = decodeURIComponent(req.headers['x-file-name'] || 'file.bin').trim(); } catch { fail(400, '文件名称编码不正确。'); }
      if (!name || name.length > 240 || /[\u0000-\u001f\u007f/\\]/.test(name)) fail(400, '文件名无效或过长。');
      const data = await bytes(req);
      const format = detectRasterImage(data);
      if (rasterTypes.has(contentType) || rasterTypes.has(fileMimeType(name))) {
        if (!format) fail(415, '请选择有效的 PNG、JPEG、GIF 或 WebP 图片。');
        if (rasterTypes.has(contentType) && contentType !== format.mime) fail(415, '文件内容与声明的图片类型不一致。');
      }
      const extension = extname(name).toLowerCase();
      const ext = format ? `.${format.ext}` : /^\.[a-z0-9]{1,16}$/.test(extension) ? extension : '.bin';
      const mime = format?.mime || fileMimeType(`file${ext}`);
      const record = await serialize(() => runAuthorized(async () => {
        await mkdir(uploads, { recursive: true });
        await mkdir(dirname(indexPath), { recursive: true });
        const id = `${randomUUID()}${ext}`;
        const record = { id, name: name.trim(), url: `/static/${id}`, mime, size: data.length, createdAt: new Date().toISOString() };
        const records = await metadata();
        await atomic(join(uploads, id), data);
        try { await atomic(indexPath, JSON.stringify([record, ...records], null, 2) + '\n'); }
        catch (error) { await unlink(join(uploads, id)); throw error; }
        return record;
      }));
      json(res, 201, record); return true;
    },
  };
}
