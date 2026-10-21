import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { zipSync } from 'fflate';
import { createServer } from './server.mjs';
import { unpackBackup, BACKUP_LIMITS } from './backup.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const rawPost = '---\r\ntitle: Original post\r\ndate: 2026-10-20\r\ncustom:\r\n  nested: [one, two]\r\ndraft: true\r\n---\r\n\r\n# Exact Markdown\r\n\r\nA **custom** source.\r\n';
const otherPost = '---\ntitle: Newer post\ndate: 2026-10-21\n---\n\nNewer content.\n';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pack = files => Buffer.from(zipSync(Object.fromEntries(files), { level: 6 }));
function repack(files) {
  const manifest = JSON.parse(files.get('manifest.json'));
  manifest.files = [...files].filter(([path]) => path !== 'manifest.json').map(([path, bytes]) => ({ path, size: bytes.length, sha256: sha(bytes) }));
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest))); return pack(files);
}
async function fixture(run, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'blog-backup-')), dataDir = join(root, 'src/content'), uploads = join(root, 'public/uploads');
  await mkdir(join(dataDir, 'blog/nested'), { recursive: true }); await mkdir(uploads, { recursive: true });
  const settings = JSON.parse(await readFile(new URL('../src/content/site.json', import.meta.url), 'utf8'));
  Object.assign(settings, { name: 'Backup fixture', favicon: '/uploads/source.png', logo: '/uploads/source.png', orbitImage: '' });
  await writeFile(join(dataDir, 'site.json'), JSON.stringify(settings, null, 2) + '\n');
  await writeFile(join(dataDir, 'library.json'), JSON.stringify([{ id: 'book-one', title: 'Book', type: 'books', typeLabel: 'Books', date: '2026-10-20', cover: '/uploads/source.png', tags: [], detail: 'Keep my notes', demo: false }]));
  await writeFile(join(dataDir, 'friends.json'), JSON.stringify([{ id: 'friend-one', name: 'Friend', url: 'https://example.com/', avatar: '/uploads/source.png', order: 0 }]));
  await writeFile(join(dataDir, 'blog/nested/中文 note.md'), rawPost); await writeFile(join(uploads, 'source.png'), png);
  await writeFile(join(dataDir, 'blog/.private.md'), 'hidden content'); await writeFile(join(dataDir, 'runtime.json'), '{"keep":true}');
  await mkdir(join(root, 'public/fonts')); await writeFile(join(root, 'public/fonts/keep.woff2'), 'font');
  if (options.publisher) { await mkdir(join(root, 'scripts')); await writeFile(join(root, 'scripts/publish.mjs'), options.publisher); }
  const server = createServer({ projectRoot: root, dataDir, auth: options.auth ?? false, autoPublish: Boolean(options.publisher), watchIntervalMs: 10, watchDebounceMs: 0, backupBeforeWrite: options.beforeWrite, backupNow: options.now });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map(); let csrf = '';
  async function request(path, method = 'GET', body, headers = {}) {
    const response = await fetch(base + path, { method, headers: { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '), ...(method === 'GET' ? {} : { Origin: base, 'X-CSRF-Token': csrf, 'Content-Type': Buffer.isBuffer(body) ? 'application/zip' : 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }) });
    for (const value of response.headers.getSetCookie()) { const [pair] = value.split(';'), index = pair.indexOf('='); if (pair.slice(index + 1)) jar.set(pair.slice(0, index), pair.slice(index + 1)); else jar.delete(pair.slice(0, index)); }
    const bytes = Buffer.from(await response.arrayBuffer()); let result; try { result = JSON.parse(bytes.toString()); } catch { result = bytes; }
    return { status: response.status, body: result, headers: response.headers };
  }
  if (!options.auth) csrf = (await request('/api/session')).body.csrf;
  try { await run({ root, dataDir, uploads, request, base, jar, setCsrf: value => { csrf = value; } }); }
  finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); }
}

test('ZIP backup roundtrip restores settings, nested raw Markdown, Library, Friends and captured images without replacing runtime files', () => fixture(async ({ root, dataDir, uploads, request }) => {
  const exported = await request('/api/backup/export'); assert.equal(exported.status, 200); assert.match(exported.headers.get('content-disposition'), /attachment; filename="personal-blog-backup-/);
  const files = unpackBackup(exported.body), manifest = JSON.parse(files.get('manifest.json'));
  assert.deepEqual(manifest.summary, { blog: 1, library: 1, friends: 1, images: 1 });
  assert.equal(files.get('content/blog/nested/中文 note.md').toString(), rawPost);
  assert.equal([...files.keys()].some(path => path.includes('runtime') || path.includes('private')), false);
  const imageId = `backup-${sha(png)}.png`; assert.ok(files.has(`images/${imageId}`));
  assert.equal(JSON.parse(files.get('content/site.json')).logo, `/uploads/${imageId}`);
  await writeFile(join(dataDir, 'blog/newer.md'), otherPost);
  const changedSettings = JSON.parse(await readFile(join(dataDir, 'site.json'))); changedSettings.name = 'Before restore'; await writeFile(join(dataDir, 'site.json'), JSON.stringify(changedSettings));
  await writeFile(join(dataDir, 'library.json'), '[]'); await writeFile(join(dataDir, 'friends.json'), '[]');
  const preview = await request('/api/backup/inspect', 'POST', exported.body, { 'X-File-Name': encodeURIComponent('我的备份.zip') });
  assert.equal(preview.status, 200); assert.equal(preview.body.filename, '我的备份.zip'); assert.deepEqual(preview.body.summary, manifest.summary);
  const restored = await request('/api/backup/restore', 'POST', { token: preview.body.token }); assert.equal(restored.status, 200, restored.body.error);
  assert.equal(restored.body.restored, true); assert.equal(restored.body.publish.enabled, false);
  assert.equal(JSON.parse(await readFile(join(dataDir, 'site.json'))).name, 'Backup fixture');
  assert.equal(await readFile(join(dataDir, 'blog/nested/中文 note.md'), 'utf8'), rawPost); await assert.rejects(readFile(join(dataDir, 'blog/newer.md')), { code: 'ENOENT' });
  assert.equal(JSON.parse(await readFile(join(dataDir, 'library.json')))[0].detail, 'Keep my notes'); assert.equal(JSON.parse(await readFile(join(dataDir, 'friends.json')))[0].name, 'Friend');
  assert.deepEqual(await readFile(join(uploads, imageId)), png); assert.deepEqual(await readFile(join(uploads, 'source.png')), png);
  assert.equal(await readFile(join(dataDir, 'blog/.private.md'), 'utf8'), 'hidden content'); assert.equal(await readFile(join(dataDir, 'runtime.json'), 'utf8'), '{"keep":true}'); assert.equal(await readFile(join(root, 'public/fonts/keep.woff2'), 'utf8'), 'font');
  const recovery = unpackBackup(await readFile(join(root, '.admin/backups', restored.body.rollbackId)));
  assert.equal(JSON.parse(recovery.get('content/site.json')).name, 'Before restore'); assert.ok(recovery.has('content/blog/newer.md'));
  assert.equal((await request('/api/backup/restore', 'POST', { token: preview.body.token })).status, 409);
}));

test('stale, modified and invalid backups are rejected before any content writes', () => fixture(async ({ dataDir, request }) => {
  const exported = (await request('/api/backup/export')).body;
  const preview = await request('/api/backup/inspect', 'POST', exported); assert.equal(preview.status, 200);
  await writeFile(join(dataDir, 'blog/newer.md'), otherPost);
  const stale = await request('/api/backup/restore', 'POST', { token: preview.body.token }); assert.equal(stale.status, 409); assert.match(stale.body.error, /Content changed/);
  assert.equal(await readFile(join(dataDir, 'blog/newer.md'), 'utf8'), otherPost);
  const before = await readFile(join(dataDir, 'site.json'));
  const corrupt = unpackBackup(exported); corrupt.set('content/site.json', Buffer.from('{}'));
  assert.equal((await request('/api/backup/inspect', 'POST', pack(corrupt))).status, 400);
  const invalid = unpackBackup(exported); invalid.set('content/blog/nested/中文 note.md', Buffer.from('invalid frontmatter'));
  assert.equal((await request('/api/backup/inspect', 'POST', repack(invalid))).status, 422);
  const duplicate = unpackBackup(exported); duplicate.set('content/blog/duplicate.md', Buffer.from('---\nid: repeated\nslug: same\ntitle: Duplicate\ndate: 2026-10-21\n---\n\nBody.'));
  duplicate.set('content/blog/other.md', duplicate.get('content/blog/duplicate.md'));
  assert.equal((await request('/api/backup/inspect', 'POST', repack(duplicate))).status, 422);
  assert.deepEqual(await readFile(join(dataDir, 'site.json')), before);
}));

test('a write failure rolls back changed content and retains a private recovery ZIP', () => fixture(async ({ root, dataDir, request }) => {
  const exported = (await request('/api/backup/export')).body;
  const originalSettings = JSON.parse(await readFile(join(dataDir, 'site.json'))); originalSettings.name = 'Keep this'; await writeFile(join(dataDir, 'site.json'), JSON.stringify(originalSettings));
  await writeFile(join(dataDir, 'library.json'), '[]');
  const before = new Map(await Promise.all(['site.json', 'library.json', 'friends.json'].map(async name => [name, await readFile(join(dataDir, name))])));
  const preview = await request('/api/backup/inspect', 'POST', exported);
  const result = await request('/api/backup/restore', 'POST', { token: preview.body.token }); assert.equal(result.status, 500); assert.match(result.body.error, /original content was recovered/);
  for (const [name, bytes] of before) assert.deepEqual(await readFile(join(dataDir, name)), bytes);
  assert.equal((await readdir(join(root, '.admin/backups'))).length, 1);
  assert.equal((await readdir(dataDir)).some(name => name.endsWith('.tmp')), false);
}, { beforeWrite: (_path, index) => { if (index === 1) throw new Error('simulated disk failure'); } }));

test('restore refuses symlink destinations without modifying their targets', () => fixture(async ({ root, dataDir, request }) => {
  const exported = (await request('/api/backup/export')).body, files = unpackBackup(exported);
  files.set('content/blog/link/new.md', Buffer.from(otherPost));
  await mkdir(join(root, 'outside')); await symlink(join(root, 'outside'), join(dataDir, 'blog/link'));
  const preview = await request('/api/backup/inspect', 'POST', repack(files)); assert.equal(preview.status, 200);
  const result = await request('/api/backup/restore', 'POST', { token: preview.body.token }); assert.equal(result.status, 409);
  assert.deepEqual(await readdir(join(root, 'outside')), []);
}));

test('a valid backup recovers broken current JSON and Markdown, preserving raw originals in its recovery ZIP', () => fixture(async ({ root, dataDir, request }) => {
  const exported = (await request('/api/backup/export')).body;
  await writeFile(join(dataDir, 'site.json'), '{broken settings'); await writeFile(join(dataDir, 'media.json'), 'broken media');
  await writeFile(join(dataDir, 'blog/nested/中文 note.md'), 'broken post');
  const preview = await request('/api/backup/inspect', 'POST', exported); assert.equal(preview.status, 200);
  const restored = await request('/api/backup/restore', 'POST', { token: preview.body.token }); assert.equal(restored.status, 200, restored.body.error);
  assert.equal(JSON.parse(await readFile(join(dataDir, 'site.json'))).name, 'Backup fixture'); assert.equal(await readFile(join(dataDir, 'blog/nested/中文 note.md'), 'utf8'), rawPost);
  const recovery = unpackBackup(await readFile(join(root, '.admin/backups', restored.body.rollbackId)));
  assert.equal(JSON.parse(recovery.get('manifest.json')).format, 'personal-blog-recovery');
  assert.equal(recovery.get('content/site.json').toString(), '{broken settings'); assert.equal(recovery.get('content/media.json').toString(), 'broken media'); assert.equal(recovery.get('content/blog/nested/中文 note.md').toString(), 'broken post');
}));

test('preview tokens expire and at most three prepared imports are retained', async () => {
  let now = Date.now();
  await fixture(async ({ request }) => {
    const exported = (await request('/api/backup/export')).body;
    const previews = []; for (let i = 0; i < 4; i++) previews.push((await request('/api/backup/inspect', 'POST', exported)).body);
    assert.equal((await request('/api/backup/restore', 'POST', { token: previews[0].token })).status, 409);
    now += 15 * 60 * 1000 + 1;
    assert.equal((await request('/api/backup/restore', 'POST', { token: previews[3].token })).status, 409);
  }, { now: () => now });
});

test('an independent publisher lock rejects restore before mutations', () => fixture(async ({ root, dataDir, request }) => {
  const exported = (await request('/api/backup/export')).body, files = unpackBackup(exported);
  const settings = JSON.parse(files.get('content/site.json')); settings.name = 'Blocked'; files.set('content/site.json', Buffer.from(JSON.stringify(settings)));
  const preview = await request('/api/backup/inspect', 'POST', repack(files));
  await mkdir(join(root, '.published')); await writeFile(join(root, '.published/.publish-lock'), JSON.stringify({ pid: process.pid, token: 'external' }));
  const restored = await request('/api/backup/restore', 'POST', { token: preview.body.token }); assert.equal(restored.status, 409); assert.match(restored.body.error, /publish lock/);
  assert.equal(JSON.parse(await readFile(join(dataDir, 'site.json'))).name, 'Backup fixture'); assert.equal(JSON.parse(await readFile(join(root, '.published/.publish-lock'))).token, 'external');
}));

test('watcher and publication see only the complete restore despite delayed individual writes', () => fixture(async ({ root, request }) => {
  const files = unpackBackup((await request('/api/backup/export')).body);
  const settings = JSON.parse(files.get('content/site.json')); settings.name = 'Restored together'; files.set('content/site.json', Buffer.from(JSON.stringify(settings))); files.set('content/library.json', Buffer.from('[]')); files.set('content/friends.json', Buffer.from('[]'));
  const preview = await request('/api/backup/inspect', 'POST', repack(files));
  const restored = await request('/api/backup/restore', 'POST', { token: preview.body.token }); assert.equal(restored.status, 200, restored.body.error);
  for (let i = 0; i < 60; i++) { if ((await request('/api/publish/status')).body.state === 'published') break; await setTimeout(10); }
  await setTimeout(80);
  const observations = (await readFile(join(root, 'observations.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(observations, [{ name: 'Restored together', library: 0, friends: 0 }]);
  await assert.rejects(readFile(join(root, '.published/.publish-lock')), { code: 'ENOENT' });
}, {
  beforeWrite: async () => { await setTimeout(30); },
  publisher: "import {readFile,appendFile} from 'node:fs/promises'; const site=JSON.parse(await readFile('src/content/site.json')); const library=JSON.parse(await readFile('src/content/library.json')); const friends=JSON.parse(await readFile('src/content/friends.json')); await appendFile('observations.jsonl',JSON.stringify({name:site.name,library:library.length,friends:friends.length})+'\\n');",
}));

test('ZIP parser rejects traversal, arbitrary files, duplicates, symlinks, corrupt CRC, local disagreement, overlaps and size bombs', () => {
  for (const path of ['../outside', '/content/site.json', 'content/../site.json', 'content\\site.json', 'content/blog/.hidden.md', 'content/blog/a.md/b.md', 'scripts/publish.mjs', '__proto__']) {
    const entries = new Map([[path, Buffer.from('x')]]); if (path === 'content/blog/a.md/b.md') entries.set('content/blog/a.md', Buffer.from('x'));
    assert.throws(() => unpackBackup(pack(entries)), undefined, path);
  }
  assert.throws(() => unpackBackup(pack(new Map([['content/blog/a.md', Buffer.from('a')], ['content/blog/A.md', Buffer.from('b')]]))), /Duplicate/);
  const source = pack(new Map([['content/site.json', Buffer.from('{}')]]));
  const central = source.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const symlinkZip = Buffer.from(source); symlinkZip.writeUInt32LE((0xa1ff << 16) >>> 0, central + 38); assert.throws(() => unpackBackup(symlinkZip), /symlinks/);
  const malformed = Buffer.from(source); malformed[30] = 120; assert.throws(() => unpackBackup(malformed), /disagree/);
  const crc = Buffer.from(source); crc[14] ^= 1; crc[central + 16] ^= 1; assert.throws(() => unpackBackup(crc), /checksum/);
  const oversized = Buffer.from(source); oversized.writeUInt32LE(0xffffffff, central + 24); assert.throws(() => unpackBackup(oversized), /limits/);
  assert.throws(() => unpackBackup(source, { ...BACKUP_LIMITS, compressed: 1 }), /upload limit/);
  assert.throws(() => unpackBackup(source, { ...BACKUP_LIMITS, expanded: 1 }), /Expanded/);
  assert.throws(() => unpackBackup(source, { ...BACKUP_LIMITS, entries: 0 }), /Too many/);
  assert.throws(() => unpackBackup(source.subarray(0, -2)), /directory/);
  const duplicate = Buffer.from(pack(new Map([['content/blog/a.md', Buffer.from('a')], ['content/blog/b.md', Buffer.from('b')]])));
  const first = duplicate.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])), second = duplicate.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), first + 1);
  duplicate.writeUInt32LE(duplicate.readUInt32LE(first + 42), second + 42); assert.throws(() => unpackBackup(duplicate), /disagree|Overlapping/);
});

test('backup APIs enforce authentication, same-origin CSRF and session-bound restore previews', () => fixture(async ({ request, setCsrf, base, jar }) => {
  for (const path of ['/api/backup/export', '/api/backup/inspect', '/api/backup/restore']) assert.equal((await request(path, path.endsWith('export') ? 'GET' : 'POST', path.endsWith('export') ? undefined : {})).status, 401);
  let state = await request('/api/auth/status'); setCsrf(state.body.csrf);
  const credentials = { username: 'admin', password: 'backup test password 2026' };
  state = await request('/api/auth/setup', 'POST', credentials); assert.equal(state.status, 200); setCsrf(state.body.csrf);
  const exported = (await request('/api/backup/export')).body;
  assert.equal((await request('/api/backup/inspect', 'POST', exported, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await request('/api/backup/inspect', 'POST', exported, { Origin: 'https://evil.example' })).status, 403);
  const preview = await request('/api/backup/inspect', 'POST', exported); assert.equal(preview.status, 200);
  const bootstrap = await fetch(base + '/api/auth/status').then(async response => ({ body: await response.json(), cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') }));
  const second = await fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: base, Cookie: bootstrap.cookie, 'X-CSRF-Token': bootstrap.body.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
  const login = await second.json(); const otherCookie = second.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const denied = await fetch(base + '/api/backup/restore', { method: 'POST', headers: { Origin: base, Cookie: otherCookie, 'X-CSRF-Token': login.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: preview.body.token }) }); assert.equal(denied.status, 409);
  assert.ok(jar.has('field_admin_session'));
  const restored = await request('/api/backup/restore', 'POST', { token: preview.body.token }); assert.equal(restored.status, 200, restored.body.error);
}, { auth: {} }));
