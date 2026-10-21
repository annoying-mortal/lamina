import { readFile, readdir, mkdir, writeFile, rename, unlink, lstat, realpath } from 'node:fs/promises';
import { join, resolve, dirname, relative, sep, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { detectRasterImage } from './image-format.mjs';

const LIMIT = 10 * 1024 * 1024;
const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif' };
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
async function bytes(req) {
  if (Number(req.headers['content-length']) > LIMIT) fail(413, '图片不能超过 10 MiB。');
  return new Promise((accept, reject) => {
    const chunks = []; let size = 0; let settled = false;
    const error = (status, message) => { if (!settled) { settled = true; reject(Object.assign(new Error(message), { status })); } };
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > LIMIT) { error(413, '图片不能超过 10 MiB。'); return; }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!settled) { settled = true; accept(Buffer.concat(chunks)); } });
    req.on('aborted', () => error(400, '图片上传已中断。'));
    req.on('error', () => error(400, '图片上传失败。'));
  });
}
async function atomic(path, value) {
  const temp = join(dirname(path), `.${randomUUID()}.tmp`);
  try { await writeFile(temp, value, { flag: 'wx', mode: 0o644 }); await rename(temp, path); }
  finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

/** Caller checks the request, then revalidates authorization when a queued upload writes. */
export function createMediaStore({ projectRoot, mediaDir = join(projectRoot, 'public/uploads'), mediaIndexPath = join(projectRoot, 'src/content/media.json') }) {
  const uploads = resolve(mediaDir);
  const publicRoot = resolve(projectRoot, 'public');
  const indexPath = resolve(mediaIndexPath);
  let queue = Promise.resolve();
  const serialize = action => { const task = queue.then(action); queue = task.catch(() => {}); return task; };
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
  async function metadata() {
    try {
      const result = JSON.parse(await readFile(indexPath, 'utf8'));
      if (!Array.isArray(result)) fail(422, '素材目录索引损坏，请恢复备份后重试。');
      return result;
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function list() {
    await mkdir(uploads, { recursive: true });
    const names = new Map((await metadata()).map(record => [record.id, record]));
    const records = [];
    for (const file of await readdir(uploads, { withFileTypes: true })) {
      if (!file.isFile() || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(?:png|jpe?g|gif|webp|svg|ico|avif)$/i.test(file.name)) continue;
      const info = await lstat(join(uploads, file.name));
      const record = names.get(file.name);
      records.push({ id: file.name, name: record?.name || file.name, url: `/uploads/${file.name}`, mime: types[extname(file.name).toLowerCase()], size: info.size, createdAt: record?.createdAt || info.birthtime.toISOString() });
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }
  async function serve(res, pathname) {
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { fail(400, '图片路径编码不正确。'); }
    const isUpload = decoded.startsWith('/uploads/');
    const root = isUpload ? uploads : publicRoot;
    const local = decoded.slice(isUpload ? 9 : 1);
    if (!local || local.split('/').some(segment => !segment || segment.startsWith('.')) || local.includes('\\') || /[\u0000-\u001f]/.test(local)) fail(404, '图片不存在。');
    const file = resolve(root, local);
    if (!file.startsWith(root + sep) || !types[extname(file).toLowerCase()]) fail(404, '图片不存在。');
    let data;
    try {
      const resolvedRoot = await realpath(root);
      const resolvedFile = await realpath(file);
      if (!(await lstat(file)).isFile() || !resolvedFile.startsWith(resolvedRoot + sep) || relative(resolvedRoot, resolvedFile).split(sep).some(part => part.startsWith('.'))) fail(404, '图片不存在。');
      data = await readFile(file);
    } catch (error) { if (error.status) throw error; if (['ENOENT','ENOTDIR'].includes(error.code)) fail(404, '图片不存在。'); throw error; }
    res.writeHead(200, { 'Content-Type': types[extname(file).toLowerCase()], 'Content-Length': data.length, 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'no-cache' }); res.end(data);
  }
  return {
    async handle(req, res, pathname, runAuthorized = action => action()) {
      if (req.method === 'GET' && (pathname.startsWith('/uploads/') || pathname.startsWith('/covers/') || types[extname(pathname).toLowerCase()])) { await serve(res, pathname); return true; }
      if (pathname !== '/api/media') return false;
      if (req.method === 'GET') { await queue; json(res, 200, await list()); return true; }
      if (req.method !== 'POST') fail(405, '素材仅支持浏览和上传；不会自动删除被文章使用的图片。');
      const contentType = req.headers['content-type']?.split(';')[0].toLowerCase();
      if (!['image/png','image/jpeg','image/gif','image/webp'].includes(contentType)) fail(415, '仅支持 PNG、JPEG、GIF 和 WebP 图片。');
      const data = await bytes(req);
      const format = detectRasterImage(data);
      if (!format) fail(415, '请选择有效的 PNG、JPEG、GIF 或 WebP 图片；不接受 SVG 或其它文件。');
      const { ext, mime } = format;
      if (contentType !== mime) fail(415, '文件内容与声明的图片类型不一致。');
      let name;
      try { name = decodeURIComponent(req.headers['x-file-name'] || `image.${ext}`); } catch { fail(400, '文件名称编码不正确。'); }
      if (!name.trim() || name.length > 240 || /[\u0000-\u001f\u007f/\\]/.test(name)) fail(400, '文件名无效或过长。');
      const record = await serialize(() => runAuthorized(async () => {
        await mkdir(uploads, { recursive: true });
        await mkdir(dirname(indexPath), { recursive: true });
        const id = `${randomUUID()}.${ext}`;
        const record = { id, name: name.trim(), url: `/uploads/${id}`, mime, size: data.length, createdAt: new Date().toISOString() };
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
