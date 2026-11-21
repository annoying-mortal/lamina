import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from './server.mjs';
import { createFriendApplications } from './friend-applications.mjs';

const sample = { name: '一个小站', url: 'https://example.com/#/about', contact: 'owner@example.com' };
async function fixture(run, siteUrl = 'http://127.0.0.1:4321') {
  const root = await mkdtemp(join(tmpdir(), 'friend-applications-'));
  const authDir = join(root, 'private');
  const dataDir = join(root, 'src/content');
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, 'friends.json'), '[]\n');
  const server = createServer({ projectRoot: root, dataDir, authDir, siteUrl, autoPublish: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, adminOrigin = `http://127.0.0.1:${port}`;
  function request(path, method = 'GET', body, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
        const chunks = [];
        res.on('data', data => chunks.push(data));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body; try { body = JSON.parse(text); } catch { body = text; }
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      });
      req.on('error', reject);
      if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
      req.end();
    });
  }
  const origin = new URL(siteUrl).origin;
  const publicHeaders = { Host: new URL(siteUrl).host, Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' };
  const submit = (value = sample, headers = {}, path = '/api/friend-applications') => request(path, 'POST', value, { ...publicHeaders, ...headers });
  async function administrator() {
    const initial = await request('/api/auth/status');
    const bootstrap = initial.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');
    const result = await request('/api/auth/setup', 'POST', { username: 'admin', password: 'Admin1234' }, { Origin: adminOrigin, 'Content-Type': 'application/json', Cookie: bootstrap, 'X-CSRF-Token': initial.body.csrf });
    assert.equal(result.status, 200);
    return { Cookie: result.headers['set-cookie'].map(value => value.split(';')[0]).join('; '), Origin: adminOrigin, 'X-CSRF-Token': result.body.csrf };
  }
  try { await run({ root, authDir, dataDir, submit, request, administrator, publicHeaders }); }
  finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); }
}

test('anonymous applications persist privately; only signed-in administrators can list and delete them', () => fixture(async ({ authDir, dataDir, root, submit, request, administrator }) => {
  const result = await submit({ ...sample, name: '  一个小站  ', description: 'not stored' });
  assert.equal(result.status, 201); assert.deepEqual(result.body, { submitted: true });
  assert.equal(result.headers['access-control-allow-origin'], undefined);
  const path = join(authDir, 'friend-applications.json');
  const [saved] = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(Object.keys(saved).sort(), ['id', 'name', 'url', 'contact', 'createdAt'].sort());
  assert.equal(saved.name, sample.name); assert.equal(saved.url, sample.url); assert.equal(saved.contact, sample.contact);
  assert.ok(Number.isFinite(Date.parse(saved.createdAt)));
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(authDir)).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(dataDir), ['friends.json']);
  assert.equal(await readFile(join(dataDir, 'friends.json'), 'utf8'), '[]\n');
  assert.deepEqual((await createFriendApplications({ directory: authDir }).list()), [saved], 'a fresh store reads persisted applications');
  assert.equal((await request('/api/friend-applications')).status, 401);
  assert.equal((await request('/private/friend-applications.json')).status, 401);
  const admin = await administrator();
  assert.deepEqual((await request('/api/friend-applications', 'GET', undefined, admin)).body, [saved]);
  assert.equal((await request(`/api/friend-applications/${saved.id}`, 'DELETE', undefined, { ...admin, 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await request(`/api/friend-applications/${saved.id}`, 'DELETE', undefined, { ...admin, Origin: 'https://other.test' })).status, 403);
  const deleted = await request(`/api/friend-applications/${saved.id}`, 'DELETE', undefined, admin);
  assert.equal(deleted.status, 200); assert.deepEqual(deleted.body, { deleted: saved.id });
  assert.deepEqual((await request('/api/friend-applications', 'GET', undefined, admin)).body, []);
  assert.equal((await request(`/api/friend-applications/${saved.id}`, 'DELETE', undefined, admin)).status, 404);
  assert.equal((await request('/private/friend-applications.json', 'GET', undefined, admin)).status, 404);
  await assert.rejects(stat(join(root, 'public/friend-applications.json')), { code: 'ENOENT' });
}));

test('public submission checks configured frontend Origin and Host without trusting forwarded headers', () => fixture(async ({ submit, publicHeaders }) => {
  for (const headers of [
    { Origin: '' }, { Origin: 'null' }, { Origin: 'https://evil.test', Host: 'evil.test' },
    { Host: 'other.test' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' },
    { Origin: 'https://evil.test', 'X-Forwarded-Host': publicHeaders.Host, 'X-Forwarded-Proto': 'http' },
  ]) assert.equal((await submit(sample, headers)).status, 403);
  for (const host of ['127.0.0.1:4321', 'localhost:4321', '[::1]:4321']) {
    assert.equal((await submit({ ...sample, url: `https://example.com/${encodeURIComponent(host)}` }, { Host: host, Origin: `http://${host}` })).status, 201);
  }
  for (const path of ['/api/friend-applications/', '/api/friend-applications?submit=1', '/api/%66riend-applications']) assert.notEqual((await submit(sample, {}, path)).status, 201);
}));

test('configured HTTPS site works through the anonymous proxy while other ports and local origins are rejected', () => fixture(async ({ submit }) => {
  assert.equal((await submit()).status, 201);
  for (const origin of ['http://blog.example.test', 'https://blog.example.test:444', 'http://127.0.0.1:4321']) {
    assert.equal((await submit(sample, { Host: new URL(origin).host, Origin: origin })).status, 403);
  }
}, 'https://blog.example.test'));

test('applications validate bounded JSON fields and reject concurrent duplicate website submissions', () => fixture(async ({ submit, authDir }) => {
  const results = await Promise.all([submit(), submit()]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  const invalid = [null, [], { ...sample, name: '' }, { ...sample, name: 'x'.repeat(81) }, { ...sample, contact: '' }, { ...sample, contact: 'x'.repeat(255) }, { ...sample, contact: 'line\nbreak' }, { ...sample, url: 'javascript:alert(1)' }, { ...sample, url: 'https://user:pass@example.com' }, { ...sample, url: 'https://example.com/' + 'x'.repeat(2000) }];
  for (const value of invalid) assert.equal((await submit(value)).status, 400);
  assert.equal((await submit('{broken')).status, 400);
  assert.equal((await submit(sample, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await submit('x'.repeat(8193))).status, 413, 'chunked bodies also respect the limit');
  assert.equal((await submit('x', { 'Content-Length': '8193' })).status, 413);
  assert.equal(JSON.parse(await readFile(join(authDir, 'friend-applications.json'), 'utf8')).length, 1);
}));

test('public submissions are bounded across requests and the private inbox has a fixed capacity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'friend-inbox-limits-'));
  let time = 0;
  const store = createFriendApplications({ directory, now: () => time, write: (path, text) => writeFile(path, text, { mode: 0o600 }) });
  try {
    for (let index = 0; index < 30; index++) store.consumeAttempt();
    assert.throws(() => store.consumeAttempt(), error => error.status === 429);
    time = 10 * 60 * 1000; store.consumeAttempt();
    await writeFile(join(directory, 'friend-applications.json'), JSON.stringify(Array.from({ length: 200 }, (_, index) => ({ id: `${index}`, url: `https://example.com/${index}` }))));
    await assert.rejects(store.submit(sample), error => error.status === 429);
    assert.equal((await store.list()).length, 200);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('queued inbox deletion rechecks authorization before persisting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'friend-inbox-auth-'));
  const store = createFriendApplications({ directory, write: (path, text) => writeFile(path, text, { mode: 0o600 }) });
  try {
    await store.submit(sample);
    const [record] = await store.list();
    await assert.rejects(store.remove(record.id, () => { throw Object.assign(new Error('revoked'), { status: 401 }); }), error => error.status === 401);
    assert.deepEqual(await store.list(), [record]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
