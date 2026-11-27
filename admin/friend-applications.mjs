import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

// The frontend proxy preserves Host and Origin; forwarded headers are not trusted.
export function validateApplicationOrigin(req, siteUrl) {
  let origin, site;
  try { origin = new URL(req.headers.origin); site = new URL(siteUrl); }
  catch { fail(403, '请从本站的友链页面提交申请。'); }
  const localAlias = loopback.has(site.hostname) && loopback.has(origin.hostname) && origin.protocol === site.protocol && origin.port === site.port;
  if (!['http:', 'https:'].includes(origin.protocol) || req.headers.origin !== origin.origin || req.headers.host !== origin.host || (origin.origin !== site.origin && !localAlias) || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) fail(403, '请从本站的友链页面提交申请。');
}

function application(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, '请填写友链申请。');
  if (typeof input.website_confirm === 'string' && input.website_confirm.trim().length > 0) fail(400, '请从本站的友链页面提交申请。');
  const text = (key, label, limit) => {
    const value = input[key];
    if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) fail(400, `${label}不能为空，且不能超过 ${limit} 字。`);
    return value.trim();
  };
  const name = text('name', '网站名称', 80);
  const contact = text('contact', '联系方式', 254);
  const rawUrl = text('url', '网站地址', 2000);
  let url;
  try { url = new URL(rawUrl); } catch { fail(400, '网站地址应为完整的 HTTP 或 HTTPS 地址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || !/^https?:\/\//i.test(rawUrl) || /\s|\\/.test(rawUrl) || url.username || url.password) fail(400, '网站地址应为不含账号密码的完整 HTTP 或 HTTPS 地址。');
  return { name, url: url.href, contact };
}

export function createFriendApplications({ directory, write, now = Date.now, windowMs = 10 * 60 * 1000, maxAttempts = 30, maxPerIp = 20 } = {}) {
  const path = join(directory, 'friend-applications.json');
  let queue = Promise.resolve();
  let windowStarted = now(), attempts = 0;
  const ipWindows = new Map();
  const serialize = action => { const task = queue.then(action); queue = task.catch(() => {}); return task; };
  async function read() {
    try {
      const rows = JSON.parse(await readFile(path, 'utf8'));
      if (!Array.isArray(rows)) throw new Error('Invalid friend application inbox.');
      return rows;
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function save(rows) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await write(path, JSON.stringify(rows, null, 2) + '\n');
  }
  return {
    consumeAttempt(ipKey = '') {
      const current = now();
      if (current - windowStarted >= windowMs) { windowStarted = current; attempts = 0; ipWindows.clear(); }
      if (ipKey) {
        let entry = ipWindows.get(ipKey);
        if (!entry || current - entry.started >= windowMs) entry = { started: current, count: 0 };
        if (entry.count + 1 > maxPerIp) fail(429, '申请过于频繁，请稍后再试。');
        if (!ipWindows.has(ipKey) && ipWindows.size >= 1000) ipWindows.delete(ipWindows.keys().next().value);
        entry.count += 1;
        ipWindows.set(ipKey, entry);
      }
      if (++attempts > maxAttempts) fail(429, '申请过于频繁，请稍后再试。');
    },
    async list() { await queue; return read(); },
    submit(input) {
      const value = application(input);
      return serialize(async () => {
        const rows = await read();
        if (rows.some(row => row.url === value.url)) fail(409, '该网站已有待处理申请，请勿重复提交。');
        if (rows.length >= 200) fail(429, '申请箱暂时已满，请稍后再试。');
        const record = { id: randomUUID(), ...value, createdAt: new Date(now()).toISOString() };
        await save([record, ...rows]);
        return { submitted: true };
      });
    },
    remove(id, runAuthorized) {
      return serialize(() => runAuthorized(async () => {
        const rows = await read();
        const index = rows.findIndex(row => row.id === id);
        if (index < 0) fail(404, '申请不存在，可能已被处理。');
        rows.splice(index, 1);
        await save(rows);
        return { deleted: id };
      }));
    },
  };
}
