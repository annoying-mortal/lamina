import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Buffer } from 'node:buffer';
import { PassThrough } from 'node:stream';
import { createServer } from './server.mjs';
import { createMediaStore } from './media.mjs';
import { normalizeImageUrl } from '../lib/image-url.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRf8AAAAASUVORK5CYII=', 'base64');
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'field-media-'));
  const dataDir = join(root, 'src/content');
  const mediaDir = join(root, 'public/static');
  await mkdir(dataDir, { recursive: true });
  const server = createServer({ projectRoot: root, dataDir, autoPublish: false, auth: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await (await fetch(base + '/api/session')).json();
  const upload = (data = png, headers = {}) => fetch(base + '/api/media', { method: 'POST', headers: { Origin: base, 'X-CSRF-Token': session.csrf, 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent('本地 插图.png'), ...headers }, body: data });
  try { await run({ root, dataDir, mediaDir, base, upload }); }
  finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); }
}

test('图片URL支持中文路径、查询串和图床，拒绝危险协议与目录穿越', () => {
  assert.equal(normalizeImageUrl('/uploads/插图 一.png?v=2'), '/uploads/%E6%8F%92%E5%9B%BE%20%E4%B8%80.png?v=2');
  assert.equal(normalizeImageUrl('https://images.example.test/photo?size=2&key=abc'), 'https://images.example.test/photo?size=2&key=abc');
  assert.equal(normalizeImageUrl('http://localhost:8080/photo.png'), 'http://localhost:8080/photo.png');
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:image/png;base64,a', '//other.test/x', '/a/../secret', '/a/%2e%2e/secret', '/a/%252e%252e/secret', '/a\\b', 'https://u:p@example.com/x', '/%00x']) assert.throws(() => normalizeImageUrl(bad));
});

test('上传持久化图片及原名，后台预览读取同一字节，不公开素材索引', () => fixture(async ({ upload, base, mediaDir, dataDir }) => {
  const response = await upload(); assert.equal(response.status, 201);
  const item = await response.json();
  assert.equal(item.name, '本地 插图.png'); assert.equal(item.mime, 'image/png'); assert.match(item.url, /^\/static\/[0-9a-f-]+\.png$/);
  assert.deepEqual(await readFile(join(mediaDir, item.id)), png);
  assert.equal(JSON.parse(await readFile(join(dataDir, 'media.json'), 'utf8'))[0].id, item.id);
  const list = await (await fetch(base + '/api/media')).json(); assert.equal(list.length, 1); assert.equal(list[0].url, item.url);
  const image = await fetch(base + item.url); assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png'); assert.equal(image.headers.get('x-content-type-options'), 'nosniff'); assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  assert.equal((await fetch(base + '/uploads/.media.json')).status, 404);
}));

test('上传拒绝伪装图片、损坏签名与路径文件名', () => fixture(async ({ upload }) => {
  assert.equal((await upload(png, { 'Content-Type': 'image/jpeg' })).status, 415);
  assert.equal((await upload(Buffer.from('<script>alert(1)</script>'))).status, 415);
  assert.equal((await upload(png.subarray(0, 24))).status, 415);
  assert.equal((await upload(png, { 'X-File-Name': '..%2Fsecret.png' })).status, 400);
}));

test('文件上传接受超过原 10 MiB 限制的文件', () => fixture(async ({ upload, mediaDir }) => {
  const data = Buffer.alloc(10 * 1024 * 1024 + 1, 42);
  const response = await upload(data, { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'large.bin' });
  assert.equal(response.status, 201);
  const record = await response.json();
  assert.equal(record.size, data.length);
  assert.deepEqual(await readFile(join(mediaDir, record.id)), data);
}));

test('文件上传对声明长度和分块请求均执行 256 MiB 上限', async () => {
  const root = await mkdtemp(join(tmpdir(), 'field-media-limit-'));
  const store = createMediaStore({ projectRoot: root });
  const request = new PassThrough();
  request.method = 'POST';
  request.headers = { 'content-type': 'application/octet-stream', 'x-file-name': 'large.bin' };
  const exceedsLimit = error => error.status === 413 && error.message === '文件不能超过 256 MiB。';
  try {
    await assert.rejects(store.handle({ method: 'POST', headers: { ...request.headers, 'content-length': String(256 * 1024 * 1024 + 1) } }, {}, '/api/media'), exceedsLimit);
    let rejected = false;
    const pending = assert.rejects(store.handle(request, {}, '/api/media').catch(error => { rejected = true; throw error; }), exceedsLimit);
    const chunk = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < 256; i++) request.write(chunk);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rejected, false, '恰好 256 MiB 时应继续接受请求');
    request.end(Buffer.from([0]));
    await pending;
  } finally {
    request.destroy();
    await rm(root, { recursive: true, force: true });
  }
});

test('并行上传不丢索引且重名文件各有独立地址', () => fixture(async ({ upload, base }) => {
  const results = await Promise.all(Array.from({ length: 4 }, () => upload()));
  assert.ok(results.every(result => result.status === 201));
  const records = await (await fetch(base + '/api/media')).json();
  assert.equal(records.length, 4); assert.equal(new Set(records.map(item => item.id)).size, 4);
}));

test('素材路径不读取外部符号链接，上传仍受CSRF限制', () => fixture(async ({ root, mediaDir, upload, base }) => {
  await mkdir(mediaDir, { recursive: true });
  const secret = join(root, 'private.png'); await writeFile(secret, png); await symlink(secret, join(mediaDir, 'escape.png'));
  assert.equal((await fetch(base + '/uploads/escape.png')).status, 404);
  assert.equal((await upload(png, { 'X-CSRF-Token': '' })).status, 403);
  assert.deepEqual(await (await fetch(base + '/api/media')).json(), []);
}));

test('上传在读取完毕及轮到写入时重新鉴权，撤销后的排队上传不会落盘', async () => {
  const root = await mkdtemp(join(tmpdir(), 'field-media-auth-'));
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  let firstAuthorized;
  const entered = new Promise(resolve => { firstAuthorized = resolve; });
  let active = true;
  let authorizations = 0;
  const authorize = async action => {
    authorizations++;
    if (!active) throw Object.assign(new Error('登录已过期，请重新登录。'), { status: 401 });
    if (authorizations === 1) { firstAuthorized(); await firstGate; }
    return action();
  };
  const uploadRequest = () => {
    const request = new PassThrough();
    request.method = 'POST';
    request.headers = { 'content-type': 'image/png', 'x-file-name': 'picture.png' };
    return request;
  };
  const response = () => ({ status: null, body: null, writeHead(status) { this.status = status; }, end(raw) { this.body = JSON.parse(raw); } });
  const store = createMediaStore({ projectRoot: root });
  const first = uploadRequest();
  const firstResponse = response();
  const firstTask = store.handle(first, firstResponse, '/api/media', authorize);
  try {
    first.write(png.subarray(0, 20));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(authorizations, 0, '网络请求体尚未完成，不应占用账号鉴权队列');
    first.end(png.subarray(20));
    await entered;
    const second = uploadRequest();
    const secondTask = assert.rejects(store.handle(second, response(), '/api/media', authorize), error => error.status === 401);
    second.end(png);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(authorizations, 1, '第二张图片等待前一写入结束');
    active = false;
    releaseFirst();
    await firstTask;
    await secondTask;
    assert.equal(authorizations, 2);
    assert.equal(firstResponse.status, 201);
    const records = JSON.parse(await readFile(join(root, 'src/content/media.json'), 'utf8'));
    assert.equal(records.length, 1);
    assert.equal(records[0].id, firstResponse.body.id);
  } finally {
    releaseFirst();
    first.destroy();
    await firstTask.catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});


test('文件上传到 static：PDF、文本、ZIP、无扩展名文件可下载，SVG 可作为图片使用', () => fixture(async ({ upload, base, mediaDir }) => {
  const examples = [
    ['说明.pdf', '%PDF-1.7 sample', 'application/pdf'],
    ['notes.txt', 'hello world', 'text/plain'],
    ['archive.zip', 'PK sample', 'application/zip'],
    ['README', 'no extension', 'application/octet-stream'],
    ['logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>', 'image/svg+xml'],
    ['page.html', '<script>alert(1)</script>', 'application/octet-stream'],
  ];
  for (const [name, data, mime] of examples) {
    const response = await upload(Buffer.from(data), { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name) });
    assert.equal(response.status, 201, name);
    const record = await response.json();
    assert.equal(record.mime, mime); assert.equal(record.name, name);
    assert.match(record.url, /^\/static\/[0-9a-f-]+\.[a-z0-9]+$/);
    assert.equal(await readFile(join(mediaDir, record.id), 'utf8'), data);
    const download = await fetch(base + record.url);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), mime);
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
    assert.match(download.headers.get('content-security-policy'), /sandbox/);
    if (mime === 'image/svg+xml') assert.equal(download.headers.get('content-disposition'), null);
    else assert.equal(download.headers.get('content-disposition'), `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    assert.equal(await download.text(), data);
    assert.equal(await (await fetch(base + record.url.replace('/static/', '/uploads/'))).text(), data, 'old prefix aliases new storage');
  }
  const records = await (await fetch(base + '/api/media')).json();
  assert.equal(records.length, examples.length);
  assert.ok(examples.every(([name, , mime]) => records.some(record => record.name === name && record.mime === mime)));
}));

test('已有 uploads 文件继续列出和访问，不移动或覆盖原文件', () => fixture(async ({ root, upload, base }) => {
  const legacy = join(root, 'public/uploads');
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, 'legacy.png'), png);
  const response = await upload(); assert.equal(response.status, 201);
  const list = await (await fetch(base + '/api/media')).json();
  assert.equal(list.length, 2);
  assert.equal(list.find(item => item.id === 'legacy.png').url, '/uploads/legacy.png');
  for (const prefix of ['/uploads/', '/static/']) {
    assert.deepEqual(Buffer.from(await (await fetch(base + prefix + 'legacy.png')).arrayBuffer()), png);
  }
  assert.deepEqual(await readFile(join(legacy, 'legacy.png')), png);
  assert.equal((await fetch(base + '/static/%2e%2e%2Fsrc%2Fcontent%2Fmedia.json')).status, 404);
}));

test('identical audio reuses an upload even with a new name, a legacy path or concurrent requests', () => fixture(async ({ root, mediaDir, upload, base }) => {
  const legacy = join(root, 'public/uploads');
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, 'old.mp3'), 'old');
  const send = (name, bytes) => upload(Buffer.from(bytes), { 'Content-Type': 'audio/mpeg', 'X-File-Name': name });
  const old = await send('renamed.mp3', 'old');
  assert.equal(old.status, 200);
  assert.equal((await old.json()).url, '/uploads/old.mp3');
  const pair = await Promise.all([send('one.mp3', 'new'), send('two.mp3', 'new')]);
  assert.deepEqual(pair.map(response => response.status).sort(), [200, 201]);
  const [one, two] = await Promise.all(pair.map(response => response.json()));
  assert.equal(one.id, two.id);
  assert.equal((await send('one.mp3', 'alt')).status, 201);
  assert.equal((await (await fetch(base + '/api/media')).json()).length, 3);

  await writeFile(join(mediaDir, 'old-copy.mp3'), 'old');
  const session = await (await fetch(base + '/api/session')).json();
  const album = { id: 'test-album', title: 'Album', type: 'albums', date: '2026-10-20', tracks:
    ['/uploads/old.mp3', '/static/old-copy.mp3'].map((src, idx) => ({ id: String(idx), title: 'Track', src })) };
  const save = body => fetch(base + '/api/library', { method: 'POST', headers: {
    Origin: base, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json',
  }, body: JSON.stringify(body) });
  const conflict = await save({ ...album, tags: [] });
  assert.equal(conflict.status, 400);
  assert.match((await conflict.json()).error, /同一音频/);
  assert.equal((await save({ ...album, tags: [], tracks: album.tracks.slice(0, 1) })).status, 201);
  assert.equal((await save({ ...album, id: 'second-album', tags: [], tracks: album.tracks.slice(0, 1) })).status, 201);
}));
