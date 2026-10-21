import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './server.mjs';
import { createAuth } from './auth.mjs';

const password = '  私人的档案 密码 2026  ';
async function fixture(run, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'field-auth-'));
  const authDir = join(root, '.admin');
  await mkdir(join(root, 'src/content/blog'), { recursive: true });
  const server = createServer({ projectRoot: root, authDir, autoPublish: false, auth: options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  function client() {
    const jar = new Map();
    return {
      jar,
      async request(path, method = 'GET', data, headers = {}) {
        const response = await fetch(base + path, { method, headers: { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '), ...(method === 'GET' ? {} : { Origin: base, 'Content-Type': 'application/json' }), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
        const setCookie = response.headers.getSetCookie();
        for (const value of setCookie) { const [pair] = value.split(';'); const i = pair.indexOf('='); const key = pair.slice(0, i); const token = pair.slice(i + 1); if (token) jar.set(key, token); else jar.delete(key); }
        const text = await response.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
        return { status: response.status, body, headers: response.headers, setCookie };
      },
    };
  }
  const visitor = client();
  const status = await visitor.request('/api/auth/status');
  const setup = (username = 'admin') => visitor.request('/api/auth/setup', 'POST', { username, password }, { 'X-CSRF-Token': status.body.csrf });
  try { await run({ root, authDir, base, visitor, status, setup, client, server }); }
  finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); }
}

test('authentication is enabled by default, protects content APIs and only caches versioned fonts', () => fixture(async ({ root, visitor, status, authDir }) => {
  assert.equal(status.status, 200); assert.equal(status.body.configured, false); assert.equal(status.body.authenticated, false);
  assert.equal(status.body.setupTokenRequired, false); assert.equal('username' in status.body, false);
  assert.match(status.body.csrf, /^[a-f0-9]{64}$/); assert.equal(status.body.name, 'Enter site name');
  assert.equal(status.body.siteUrl, 'http://127.0.0.1:4321');
  assert.ok(status.setCookie[0].includes('HttpOnly')); assert.ok(status.setCookie[0].includes('SameSite=Strict'));
  for (const path of ['/api/session', '/api/account', '/api/blog', '/api/library', '/api/friends', '/api/settings', '/api/media', '/api/publish/status', '/uploads/anything.png']) assert.equal((await visitor.request(path)).status, 401, path);
  assert.equal((await visitor.request('/api/settings', 'PUT', {}, { 'X-CSRF-Token': status.body.csrf })).status, 401);
  assert.equal((await visitor.request('/healthz')).status, 200);
  await assert.rejects(readFile(join(authDir, 'auth.json')), { code: 'ENOENT' });
  assert.match((await readFile(join(authDir, 'setup-token'), 'utf8')).trim(), /^[a-f0-9]{64}$/);
  assert.equal((await stat(join(authDir, 'setup-token'))).mode & 0o777, 0o600);
  assert.equal((await visitor.request('/.admin/setup-token')).status, 401);
  await mkdir(join(root, 'public/fonts/misans-webfont-4.3.1/regular'), { recursive: true });
  await writeFile(join(root, 'public/fonts/misans-webfont-4.3.1/regular/0.woff2'), 'font fixture');
  await writeFile(join(root, 'public/fonts.css'), '@font-face { font-family: fixture; }');
  const font = await visitor.request('/fonts/misans-webfont-4.3.1/regular/0.woff2');
  assert.equal(font.status, 200); assert.equal(font.headers.get('content-type'), 'font/woff2');
  assert.equal(font.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const stylesheet = await visitor.request('/fonts.css'); assert.equal(stylesheet.status, 200);
  assert.equal(stylesheet.headers.get('cache-control'), 'no-store');
  assert.equal(status.headers.get('cache-control'), 'no-store');
}));

test('setup stores only a private scrypt hash, rotates CSRF and grants a cookie session', () => fixture(async ({ visitor, status, setup, authDir }) => {
  const result = await setup(); assert.equal(result.status, 200); assert.equal(result.body.authenticated, true);
  assert.notEqual(result.body.csrf, status.body.csrf);
  const cookie = result.setCookie.find(value => value.startsWith('field_admin_session='));
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Path=\//); assert.match(cookie, /Max-Age=43200/);
  const raw = await readFile(join(authDir, 'auth.json'), 'utf8');
  assert.equal(raw.includes(password), false); const stored = JSON.parse(raw);
  assert.equal(stored.version, 2); assert.equal(stored.username, 'admin'); assert.equal(stored.algorithm, 'scrypt'); assert.match(stored.hash, /^[a-f0-9]{128}$/);
  assert.equal((await stat(join(authDir, 'auth.json'))).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(authDir), ['auth.json']);
  assert.equal((await visitor.request('/api/blog')).status, 200);
  assert.equal((await visitor.request('/api/session')).body.csrf, result.body.csrf);
  const publicStatus = await visitor.request('/api/auth/status'); assert.equal(publicStatus.body.configured, true); assert.equal(publicStatus.body.authenticated, true);
  assert.equal(JSON.stringify(publicStatus.body).includes(stored.hash), false);
  assert.equal((await visitor.request('/.admin/auth.json')).status, 404);
  assert.equal((await visitor.request('/uploads/../.admin/auth.json')).status, 404);
  assert.equal((await visitor.request('/api/auth/logout', 'POST', {}, { 'X-CSRF-Token': status.body.csrf })).status, 403);
}));

test('wrong passwords have one failure message, valid passwords preserve spaces, and logout revokes old cookies', () => fixture(async ({ visitor, setup, client }) => {
  const initial = await setup(); const oldCookie = visitor.jar.get('field_admin_session');
  assert.equal((await visitor.request('/api/auth/logout', 'POST', {}, { 'X-CSRF-Token': initial.body.csrf })).status, 200);
  assert.equal(visitor.jar.has('field_admin_session'), false);
  assert.equal((await visitor.request('/api/blog', 'GET', undefined, { Cookie: `field_admin_session=${oldCookie}` })).status, 401);
  const loginStatus = (await visitor.request('/api/auth/status')).body;
  const headers = { 'X-CSRF-Token': loginStatus.csrf };
  const wrong = await visitor.request('/api/auth/login', 'POST', { username: 'admin', password: 'definitely-wrong-password' }, headers);
  const trimmed = await visitor.request('/api/auth/login', 'POST', { username: 'admin', password: password.trim() }, headers);
  const missing = await visitor.request('/api/auth/login', 'POST', {}, headers);
  assert.equal(wrong.status, 401); assert.equal(trimmed.status, 401); assert.equal(missing.status, 401);
  assert.equal(wrong.body.error, missing.body.error); assert.equal(wrong.body.error, trimmed.body.error);
  const correct = await visitor.request('/api/auth/login', 'POST', { username: 'admin', password }, headers);
  assert.equal(correct.status, 200); assert.notEqual(visitor.jar.get('field_admin_session'), oldCookie);
  const outsider = client(); assert.equal((await outsider.request('/api/blog')).status, 401);
}));

test('bootstrap and authenticated CSRF tokens are cookie-bound and reject cross-origin requests', () => fixture(async ({ visitor, status, client, setup }) => {
  const other = client(); const otherStatus = await other.request('/api/auth/status');
  assert.equal((await other.request('/api/auth/setup', 'POST', { username: 'admin', password }, { 'X-CSRF-Token': status.body.csrf })).status, 403);
  assert.equal((await visitor.request('/api/auth/setup', 'POST', { username: 'admin', password }, { 'X-CSRF-Token': status.body.csrf, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await visitor.request('/api/auth/setup', 'POST', { username: 'admin', password }, { 'X-CSRF-Token': status.body.csrf, Origin: '' })).status, 403);
  assert.equal((await visitor.request('/api/auth/setup', 'POST', { username: 'admin', password })).status, 403);
  const result = await setup(); assert.equal(result.status, 200);
  assert.equal((await visitor.request('/api/friends', 'POST', {}, { 'X-CSRF-Token': otherStatus.body.csrf })).status, 403);
  assert.equal((await visitor.request('/api/auth/logout', 'POST', {})).status, 403);
}));

test('parallel initial setup succeeds exactly once and cannot overwrite the stored password', () => fixture(async ({ visitor, status, client, authDir }) => {
  const other = client(); const otherStatus = await other.request('/api/auth/status');
  const results = await Promise.all([
    visitor.request('/api/auth/setup', 'POST', { username: 'admin', password }, { 'X-CSRF-Token': status.body.csrf }),
    other.request('/api/auth/setup', 'POST', { username: 'admin', password: 'another-valid-password' }, { 'X-CSRF-Token': otherStatus.body.csrf }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const before = await readFile(join(authDir, 'auth.json'), 'utf8');
  const fresh = client(); const bootstrap = await fresh.request('/api/auth/status');
  assert.equal(bootstrap.body.configured, true);
  assert.equal((await fresh.request('/api/auth/setup', 'POST', { username: 'admin', password: 'attempt-overwrite-pass' }, { 'X-CSRF-Token': bootstrap.body.csrf })).status, 409);
  assert.equal(await readFile(join(authDir, 'auth.json'), 'utf8'), before);
}));

test('sessions and bootstrap tokens expire, while stored credentials survive expiry', async () => {
  let clock = 1000000;
  await fixture(async ({ visitor, setup }) => {
    assert.equal((await setup()).status, 200);
    clock += 1100;
    assert.equal((await visitor.request('/api/blog')).status, 401);
    const status = await visitor.request('/api/auth/status'); assert.equal(status.body.configured, true); assert.equal(status.body.authenticated, false);
    clock += 2100;
    assert.equal((await visitor.request('/api/auth/login', 'POST', { username: 'admin', password }, { 'X-CSRF-Token': status.body.csrf })).status, 403);
    const fresh = await visitor.request('/api/auth/status');
    assert.equal((await visitor.request('/api/auth/login', 'POST', { username: 'admin', password }, { 'X-CSRF-Token': fresh.body.csrf })).status, 200);
  }, { now: () => clock, sessionTtlMs: 1000, bootstrapTtlMs: 2000 });
});

test('repeated login failures are rate limited independently of bootstrap cookie renewal', () => fixture(async ({ visitor, setup, client }) => {
  const created = await setup(); await visitor.request('/api/auth/logout', 'POST', {}, { 'X-CSRF-Token': created.body.csrf });
  const bootstrap = await visitor.request('/api/auth/status'); const headers = { 'X-CSRF-Token': bootstrap.body.csrf };
  assert.equal((await visitor.request('/api/auth/login', 'POST', { username: 'wrong-user', password }, headers)).status, 401);
  assert.equal((await visitor.request('/api/auth/login', 'POST', { username: 'admin', password: 'not-the-password' }, headers)).status, 401);
  const renewed = client(); const other = await renewed.request('/api/auth/status');
  const limited = await renewed.request('/api/auth/login', 'POST', { username: 'admin', password }, { 'X-CSRF-Token': other.body.csrf });
  assert.equal(limited.status, 429);
}, { maxAttempts: 2 }));

test('setup accepts 12–128 characters only and never trims the password', () => fixture(async ({ visitor, status }) => {
  const headers = { 'X-CSRF-Token': status.body.csrf };
  assert.equal((await visitor.request('/api/auth/setup', 'POST', { username: 'admin', password: 'short' }, headers)).status, 400);
  assert.equal((await visitor.request('/api/auth/setup', 'POST', { username: 'admin', password: 'x'.repeat(129) }, headers)).status, 400);
  assert.equal((await visitor.request('/api/auth/setup', 'POST', { username: 'admin', password: '密'.repeat(12) }, headers)).status, 200);
}));

test('first setup refuses nonlocal peers unless the explicit loopback-published private bridge mode is enabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'field-auth-peer-'));
  try {
    for (const [peer, loopbackPublished, expected] of [['203.0.113.10', false, 403], ['172.20.0.1', false, 403], ['203.0.113.10', true, 403]]) {
      const auth = createAuth({ authDir: root, loopbackPublished });
      const headers = new Map(); const res = { getHeader: key => headers.get(key), setHeader: (key, value) => headers.set(key, value) };
      const req = { headers: { host: '127.0.0.1:4322' }, socket: { remoteAddress: peer } };
      const status = await auth.status(req, res);
      req.headers.cookie = headers.get('Set-Cookie')[0].split(';')[0]; req.headers['x-csrf-token'] = status.csrf;
      await assert.rejects(auth.setup(req, res, { username: 'admin', password }), error => error.status === expected);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a Docker private-network peer needs the one-time terminal token and cannot discover it through status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'field-auth-token-'));
  try {
    const auth = createAuth({ authDir: root, loopbackPublished: true });
    const headers = new Map(); const res = { getHeader: key => headers.get(key), setHeader: (key, value) => headers.set(key, value) };
    const req = { headers: { host: 'localhost:4322' }, socket: { remoteAddress: '172.20.0.99' } };
    const status = await auth.status(req, res);
    assert.equal(status.setupTokenRequired, true);
    const token = (await readFile(join(root, 'setup-token'), 'utf8')).trim();
    assert.equal(JSON.stringify(status).includes(token), false);
    req.headers.cookie = headers.get('Set-Cookie')[0].split(';')[0]; req.headers['x-csrf-token'] = status.csrf;
    await assert.rejects(auth.setup(req, res, { username: 'admin', password }), error => error.status === 403);
    await assert.rejects(auth.setup(req, res, { username: 'admin', password, setupToken: 'f'.repeat(64) }), error => error.status === 403);
    const result = await auth.setup(req, res, { username: 'admin', password, setupToken: token }); assert.equal(result.authenticated, true);
    await assert.rejects(readFile(join(root, 'setup-token')), { code: 'ENOENT' });
    assert.match(await readFile(join(root, 'auth.json'), 'utf8'), /"algorithm": "scrypt"/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('public first setup is disabled by default and requires an explicit secure HTTPS configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'field-auth-remote-policy-'));
  try {
    for (const [name, options, origin] of [
      ['default', { secureCookies: true }, 'https://cms.example:30080'],
      ['without-secure-cookies', { allowRemoteSetup: true }, 'https://cms.example:30080'],
      ['http-origin', { allowRemoteSetup: true, secureCookies: true }, 'http://cms.example:30080'],
      ['foreign-origin', { allowRemoteSetup: true, secureCookies: true }, 'https://other.example'],
    ]) {
      const authDir = join(root, name);
      const auth = createAuth({ authDir, ...options });
      const headers = new Map(); const res = { getHeader: key => headers.get(key), setHeader: (key, value) => headers.set(key, value) };
      const req = { headers: { host: 'cms.example:30080', origin }, socket: { remoteAddress: '203.0.113.10' } };
      const status = await auth.status(req, res);
      req.headers.cookie = headers.get('Set-Cookie')[0].split(';')[0]; req.headers['x-csrf-token'] = status.csrf;
      const setupToken = (await readFile(join(authDir, 'setup-token'), 'utf8')).trim();
      await assert.rejects(auth.setup(req, res, { username: 'new-owner', password, setupToken }), error => error.status === 403, name);
      await assert.rejects(readFile(join(authDir, 'auth.json')), { code: 'ENOENT' });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('opted-in HTTPS setup requires CSRF and a private token, then creates one account and deletes the token', async () => {
  const root = await mkdtemp(join(tmpdir(), 'field-auth-remote-token-'));
  try {
    // Covers both direct network clients and the private Docker peer of a TLS proxy.
    for (const peer of ['203.0.113.10', '172.20.0.1']) {
      const authDir = join(root, peer);
      const auth = createAuth({ authDir, allowRemoteSetup: true, secureCookies: true });
      const headers = new Map(); const res = { getHeader: key => headers.get(key), setHeader: (key, value) => headers.set(key, value) };
      const req = { headers: { host: 'cms.example:30080', origin: 'https://cms.example:30080' }, socket: { remoteAddress: peer } };
      const status = await auth.status(req, res);
      assert.equal(status.setupTokenRequired, true);
      assert.match(headers.get('Set-Cookie')[0], /; Secure/);
      const setupToken = (await readFile(join(authDir, 'setup-token'), 'utf8')).trim();
      assert.equal(JSON.stringify(status).includes(setupToken), false);
      req.headers.cookie = headers.get('Set-Cookie')[0].split(';')[0];
      await assert.rejects(auth.setup(req, res, { username: 'new-owner', password, setupToken }), error => error.status === 403);
      req.headers['x-csrf-token'] = status.csrf;
      await assert.rejects(auth.setup(req, res, { username: 'new-owner', password }), error => error.status === 403);
      await assert.rejects(auth.setup(req, res, { username: 'new-owner', password, setupToken: 'f'.repeat(64) }), error => error.status === 403);
      await assert.rejects(readFile(join(authDir, 'auth.json')), { code: 'ENOENT' });
      const result = await auth.setup(req, res, { username: 'new-owner', password, setupToken });
      assert.equal(result.authenticated, true); assert.equal(result.username, 'new-owner');
      await assert.rejects(readFile(join(authDir, 'setup-token')), { code: 'ENOENT' });
      const stored = await readFile(join(authDir, 'auth.json'), 'utf8');
      assert.equal(JSON.parse(stored).username, 'new-owner');
      headers.clear(); req.headers.cookie = '';
      const next = await auth.status(req, res);
      assert.equal(next.configured, true); assert.equal(next.setupTokenRequired, false);
      req.headers.cookie = headers.get('Set-Cookie')[0].split(';')[0]; req.headers['x-csrf-token'] = next.csrf;
      await assert.rejects(auth.setup(req, res, { username: 'replacement', password, setupToken }), error => error.status === 409);
      assert.equal(await readFile(join(authDir, 'auth.json'), 'utf8'), stored);
      await assert.rejects(readFile(join(authDir, 'setup-token')), { code: 'ENOENT' });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function login(client, username = 'admin', suppliedPassword = password) {
  const status = await client.request('/api/auth/status');
  return client.request('/api/auth/login', 'POST', { username, password: suppliedPassword }, { 'X-CSRF-Token': status.body.csrf });
}

test('setup accepts a custom case-sensitive username and login requires both credentials without revealing which failed', () => fixture(async ({ visitor, setup, client }) => {
  const created = await setup('Reader.notes-01');
  assert.equal(created.status, 200); assert.equal(created.body.username, 'Reader.notes-01');
  assert.equal((await visitor.request('/api/session')).body.username, 'Reader.notes-01');
  assert.equal((await visitor.request('/api/session')).body.authEnabled, true);
  const account = await visitor.request('/api/account');
  assert.deepEqual(account.body, { username: 'Reader.notes-01', csrf: created.body.csrf });
  const outsider = client();
  assert.equal('username' in (await outsider.request('/api/auth/status')).body, false);
  const wrongName = await login(outsider, 'admin');
  const wrongCase = await login(outsider, 'reader.notes-01');
  const wrongPassword = await login(outsider, 'Reader.notes-01', 'not-the-password');
  assert.equal(wrongName.status, 401); assert.equal(wrongCase.status, 401); assert.equal(wrongPassword.status, 401);
  assert.equal(wrongName.body.error, wrongPassword.body.error); assert.equal(wrongCase.body.error, wrongPassword.body.error);
  const status = await outsider.request('/api/auth/status');
  const missing = await outsider.request('/api/auth/login', 'POST', { password }, { 'X-CSRF-Token': status.body.csrf });
  assert.equal(missing.status, 401); assert.equal(missing.body.error, wrongName.body.error);
  assert.equal((await login(outsider, 'Reader.notes-01')).status, 200);
}));

test('setup validates username syntax and does not silently trim or normalize names', () => fixture(async ({ visitor, status, authDir }) => {
  const headers = { 'X-CSRF-Token': status.body.csrf };
  for (const username of ['', 'ab', '中文名', ' padded ', '_first', 'a/b', 'a'.repeat(33), null]) {
    assert.equal((await visitor.request('/api/auth/setup', 'POST', { username, password }, headers)).status, 400, String(username));
  }
  await assert.rejects(readFile(join(authDir, 'auth.json')), { code: 'ENOENT' });
  assert.equal((await visitor.request('/api/auth/setup', 'POST', { username: '7.valid_Name', password }, headers)).status, 200);
}, { maxAttempts: 20 }));

test('legacy v1 credentials keep their exact password hash and become v2 only on an explicit account change', () => fixture(async ({ visitor, setup, authDir, client }) => {
  const created = await setup();
  await visitor.request('/api/auth/logout', 'POST', {}, { 'X-CSRF-Token': created.body.csrf });
  const legacy = JSON.parse(await readFile(join(authDir, 'auth.json'), 'utf8'));
  legacy.version = 1;
  await writeFile(join(authDir, 'auth.json'), JSON.stringify(legacy, null, 2) + '\n', { mode: 0o600 });
  const rawLegacy = await readFile(join(authDir, 'auth.json'), 'utf8');
  const returning = client(); const loggedIn = await login(returning);
  assert.equal(loggedIn.status, 200); assert.equal(loggedIn.body.username, 'admin');
  assert.equal(await readFile(join(authDir, 'auth.json'), 'utf8'), rawLegacy);
  const oldCookie = returning.jar.get('field_admin_session');
  const renamed = await returning.request('/api/account', 'PUT', { username: 'Reader', currentPassword: password, newPassword: '' }, { 'X-CSRF-Token': loggedIn.body.csrf });
  assert.equal(renamed.status, 200); assert.equal(renamed.body.username, 'Reader');
  assert.notEqual(renamed.body.csrf, loggedIn.body.csrf); assert.notEqual(returning.jar.get('field_admin_session'), oldCookie);
  const updated = JSON.parse(await readFile(join(authDir, 'auth.json'), 'utf8'));
  assert.equal(updated.version, 2); assert.equal(updated.hash, legacy.hash); assert.equal(updated.salt, legacy.salt); assert.equal(updated.createdAt, legacy.createdAt);
  assert.equal((await stat(join(authDir, 'auth.json'))).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(authDir), ['auth.json']);
  assert.equal((await login(client(), 'Reader')).status, 200);
  assert.equal((await login(client(), 'admin')).status, 401);
}));

test('account changes require current password and CSRF, preserve credentials on failure, and revoke every old session', () => fixture(async ({ visitor, setup, authDir, client }) => {
  const created = await setup(); const other = client(); const otherLogin = await login(other);
  const before = await readFile(join(authDir, 'auth.json'), 'utf8');
  const oldCookie = visitor.jar.get('field_admin_session');
  const input = { username: 'new-owner', currentPassword: password, newPassword: 'new private password 2026' };
  assert.equal((await visitor.request('/api/account', 'PUT', input)).status, 403);
  assert.equal((await visitor.request('/api/account', 'PUT', input, { 'X-CSRF-Token': otherLogin.body.csrf })).status, 403);
  assert.equal((await visitor.request('/api/account', 'PUT', { ...input, currentPassword: 'incorrect current password' }, { 'X-CSRF-Token': created.body.csrf })).status, 403);
  assert.equal((await visitor.request('/api/account', 'PUT', { ...input, currentPassword: undefined }, { 'X-CSRF-Token': created.body.csrf })).status, 403);
  assert.equal((await visitor.request('/api/account', 'PUT', { ...input, newPassword: 'short' }, { 'X-CSRF-Token': created.body.csrf })).status, 400);
  assert.equal((await visitor.request('/api/account', 'PUT', { ...input, username: 'invalid user' }, { 'X-CSRF-Token': created.body.csrf })).status, 400);
  assert.equal(await readFile(join(authDir, 'auth.json'), 'utf8'), before);
  const result = await visitor.request('/api/account', 'PUT', input, { 'X-CSRF-Token': created.body.csrf });
  assert.equal(result.status, 200); assert.equal(result.body.username, input.username); assert.notEqual(result.body.csrf, created.body.csrf);
  const after = JSON.parse(await readFile(join(authDir, 'auth.json'), 'utf8'));
  assert.notEqual(after.hash, JSON.parse(before).hash); assert.notEqual(after.salt, JSON.parse(before).salt);
  assert.equal(JSON.stringify(result.body).includes(input.newPassword), false); assert.equal(JSON.stringify(result.body).includes(after.hash), false);
  assert.equal((await visitor.request('/api/account', 'GET', undefined, { Cookie: `field_admin_session=${oldCookie}` })).status, 401);
  assert.equal((await other.request('/api/account')).status, 401);
  // Passive stale-cookie checks never clear a newly rotated cookie.
  assert.equal((await login(client(), input.username, input.newPassword)).status, 200);
  assert.equal((await login(client(), input.username, password)).status, 401);
  assert.equal((await login(client(), 'admin', input.newPassword)).status, 401);
  const current = await visitor.request('/api/account');
  assert.equal((await visitor.request('/api/account', 'PUT', { username: input.username, currentPassword: input.newPassword }, { 'X-CSRF-Token': created.body.csrf })).status, 403);
  assert.equal(current.body.username, input.username);
}));

test('parallel account updates cannot overwrite one another and a concurrent old login cannot restore a revoked session', () => fixture(async ({ visitor, setup, client, authDir }) => {
  const created = await setup(); const other = client(); const otherLogin = await login(other);
  const stale = client(); const bootstrap = await stale.request('/api/auth/status');
  const results = await Promise.all([
    visitor.request('/api/account', 'PUT', { username: 'first-owner', currentPassword: password }, { 'X-CSRF-Token': created.body.csrf }),
    other.request('/api/account', 'PUT', { username: 'second-owner', currentPassword: password }, { 'X-CSRF-Token': otherLogin.body.csrf }),
    stale.request('/api/auth/login', 'POST', { username: 'admin', password }, { 'X-CSRF-Token': bootstrap.body.csrf }),
  ]);
  assert.deepEqual(results.slice(0, 2).map(result => result.status).sort(), [200, 401]);
  assert.ok([200, 401].includes(results[2].status));
  assert.equal((await stale.request('/api/account')).status, 401);
  const winner = results[0].status === 200 ? 0 : 1;
  const stored = JSON.parse(await readFile(join(authDir, 'auth.json'), 'utf8'));
  assert.equal(stored.username, winner === 0 ? 'first-owner' : 'second-owner');
  assert.equal((await (winner === 0 ? visitor : other).request('/api/account')).status, 200);
  assert.equal((await (winner === 0 ? other : visitor).request('/api/account')).status, 401);
}));

test('account endpoints expose no credentials to anonymous visitors or auth-disabled fixtures', async () => {
  await fixture(async ({ visitor, status, setup, authDir, client }) => {
    assert.equal((await visitor.request('/api/account')).status, 401);
    assert.equal((await visitor.request('/api/account', 'PUT', { username: 'attacker', currentPassword: password }, { 'X-CSRF-Token': status.body.csrf })).status, 401);
    await setup('private-owner');
    const anonymous = client(); const publicState = await anonymous.request('/api/auth/status');
    assert.equal('username' in publicState.body, false); assert.equal(JSON.stringify(publicState.body).includes('private-owner'), false);
    const account = await visitor.request('/api/account');
    assert.deepEqual(Object.keys(account.body).sort(), ['csrf', 'username']);
    const stored = JSON.parse(await readFile(join(authDir, 'auth.json'), 'utf8'));
    assert.equal(JSON.stringify(account.body).includes(stored.hash), false);
  });
  const root = await mkdtemp(join(tmpdir(), 'field-auth-disabled-'));
  const server = createServer({ projectRoot: root, auth: false, autoPublish: false });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await (await fetch(base + '/api/session')).json();
    assert.equal(session.authEnabled, false); assert.equal('username' in session, false);
    assert.equal((await fetch(base + '/api/account')).status, 409);
    assert.equal((await fetch(base + '/api/account', { method: 'PUT', headers: { Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf }, body: '{}' })).status, 409);
  } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); }
});

test('a content request with a slow body is reauthorized after account rotation without clearing the new cookie', () => fixture(async ({ visitor, setup, base, server }) => {
  const created = await setup();
  const oldCookie = visitor.jar.get('field_admin_session');
  const payload = JSON.stringify({ id: 'late-friend', name: 'Late request', url: 'https://example.com', avatar: '', order: 0 });
  let requestSeen;
  const seen = new Promise(resolve => { requestSeen = resolve; });
  const observe = req => { if (req.url === '/api/friends' && req.method === 'POST') { server.off('request', observe); requestSeen(); } };
  server.on('request', observe);
  let slow;
  const response = new Promise((resolve, reject) => {
    slow = http.request(base + '/api/friends', { method: 'POST', headers: {
      Origin: base, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload),
      Cookie: `field_admin_session=${oldCookie}`, 'X-CSRF-Token': created.body.csrf,
    } }, incoming => {
      let raw = '';
      incoming.on('data', chunk => { raw += chunk; });
      incoming.on('end', () => resolve({ status: incoming.statusCode, headers: incoming.headers, body: raw }));
    });
    slow.on('error', reject); slow.write(payload.slice(0, 1));
  });
  await seen;
  const changed = await visitor.request('/api/account', 'PUT', { username: 'new-owner', currentPassword: password }, { 'X-CSRF-Token': created.body.csrf });
  assert.equal(changed.status, 200);
  slow.end(payload.slice(1));
  const late = await response;
  assert.equal(late.status, 401);
  assert.equal(late.headers['set-cookie'], undefined);
  assert.deepEqual((await visitor.request('/api/friends')).body, []);
  assert.equal((await visitor.request('/api/account')).body.username, 'new-owner');
}));
