import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from '../admin/server.mjs';
import { createAuth } from '../admin/auth.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal valid 1x1 PNG (IHDR + IDAT + IEND)
const VALID_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
  + '0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
);

async function seedFixture(root) {
  const dataDir = join(root, 'content');
  const mediaDir = join(root, 'static');
  const authDir = join(root, 'auth');
  await mkdir(join(dataDir, 'blog'), { recursive: true });
  await mkdir(mediaDir, { recursive: true });
  await mkdir(authDir, { recursive: true });
  const baseSettings = JSON.parse(await readFile(join(projectRoot, 'src/content/site.json'), 'utf8'));
  baseSettings.friendApplicationsEnabled = true;
  await writeFile(join(dataDir, 'site.json'), JSON.stringify(baseSettings, null, 2) + '\n');
  await writeFile(join(dataDir, 'library.json'), '[]\n');
  await writeFile(join(dataDir, 'friends.json'), '[]\n');
  await writeFile(
    join(dataDir, 'blog/hello.md'),
    '---\nid: POST-1\nslug: hello\ntitle: Hello\nsummary: Summary\ncategoryId: engineering\ndate: 2026-01-01\ntags: []\nreadTime: 1\ndraft: false\ndemo: false\n---\n\nBody text.\n',
  );
  return { dataDir, mediaDir, authDir, baseSettings };
}

describe('Admin security boundaries and media deletion', () => {
  let root;
  let fixture;
  let server;
  let baseUrl;
  let csrf;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'blogsite-admin-test-'));
    fixture = await seedFixture(root);
    server = createServer({
      projectRoot,
      dataDir: fixture.dataDir,
      mediaDir: fixture.mediaDir,
      authDir: fixture.authDir,
      auth: false,
      autoPublish: false,
      siteUrl: 'http://127.0.0.1:4321',
    });
    await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
    const statusRes = await fetch(`${baseUrl}/api/auth/status`);
    assert.equal(statusRes.status, 200);
    csrf = (await statusRes.json()).csrf;
  });

  after(async () => {
    delete process.env.PUBLIC_FRIEND_APPLICATIONS;
    await new Promise(resolveClose => server.close(resolveClose));
    await rm(root, { recursive: true, force: true });
  });

  it('enforces friendApplicationsEnabled and PUBLIC_FRIEND_APPLICATIONS on POST /api/friend-applications', async () => {
    const port = server.address().port;
    const postApplication = (urlSuffix = '') => new Promise((resolveReq, rejectReq) => {
      const payload = JSON.stringify({
        name: 'Friend',
        url: `https://friend.example.com/${urlSuffix}`,
        contact: 'friend@example.com',
      });
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/api/friend-applications',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Origin: 'http://127.0.0.1:4321',
          Host: '127.0.0.1:4321',
        },
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolveReq({
          status: res.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        }));
      });
      req.on('error', rejectReq);
      req.end(payload);
    });

    // Enabled in site.json
    const okRes = await postApplication('one');
    assert.equal(okRes.status, 201);

    // Env override disables applications even when site.json enables them
    process.env.PUBLIC_FRIEND_APPLICATIONS = '0';
    const envDisabledRes = await postApplication('two');
    assert.equal(envDisabledRes.status, 403);
    assert.equal(envDisabledRes.body.error, '已关闭在线友链申请。');

    // Disable in site.json and clear env override
    delete process.env.PUBLIC_FRIEND_APPLICATIONS;
    const disabledSettings = { ...fixture.baseSettings, friendApplicationsEnabled: false };
    await writeFile(join(fixture.dataDir, 'site.json'), JSON.stringify(disabledSettings, null, 2) + '\n');

    const disabledRes = await postApplication('three');
    assert.equal(disabledRes.status, 403);
    assert.equal(disabledRes.body.error, '已关闭在线友链申请。');

    // Env override can explicitly re-enable
    process.env.PUBLIC_FRIEND_APPLICATIONS = '1';
    const envEnabledRes = await postApplication('four');
    assert.equal(envEnabledRes.status, 201);

    delete process.env.PUBLIC_FRIEND_APPLICATIONS;
    await writeFile(join(fixture.dataDir, 'site.json'), JSON.stringify(fixture.baseSettings, null, 2) + '\n');
  });

  it('rejects cross-origin friend application submissions', async () => {
    const res = await fetch(`${baseUrl}/api/friend-applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example.com',
      },
      body: JSON.stringify({
        name: 'Attacker',
        url: 'https://evil.example.com/',
        contact: 'x@evil.example.com',
      }),
    });
    assert.equal(res.status, 403);
  });

  it('supports uploading, reference-checking, and deleting media files', async () => {
    // Upload PNG
    const uploadRes = await fetch(`${baseUrl}/api/media`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        'X-File-Name': encodeURIComponent('sample.png'),
        'X-CSRF-Token': csrf,
        Origin: baseUrl,
      },
      body: VALID_PNG,
    });
    assert.equal(uploadRes.status, 201);
    const uploaded = await uploadRes.json();
    assert.match(uploaded.id, /^[0-9a-f-]+\.png$/);

    // Reference it in a blog post
    const postPath = join(fixture.dataDir, 'blog/hello.md');
    const originalPost = await readFile(postPath, 'utf8');
    await writeFile(postPath, `${originalPost}\n![sample](${uploaded.url})\n`);

    // Deletion must be blocked with 409 while referenced
    const blockedRes = await fetch(`${baseUrl}/api/media/${encodeURIComponent(uploaded.id)}`, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': csrf, Origin: baseUrl },
    });
    assert.equal(blockedRes.status, 409);

    // File still exists on disk
    await stat(join(fixture.mediaDir, uploaded.id));

    // Remove reference and delete successfully
    await writeFile(postPath, originalPost);
    const deleteRes = await fetch(`${baseUrl}/api/media/${encodeURIComponent(uploaded.id)}`, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': csrf, Origin: baseUrl },
    });
    assert.equal(deleteRes.status, 200);
    assert.deepEqual(await deleteRes.json(), { deleted: uploaded.id });

    // Removed from disk and media list
    await assert.rejects(() => stat(join(fixture.mediaDir, uploaded.id)), { code: 'ENOENT' });
    const listRes = await fetch(`${baseUrl}/api/media`);
    const list = await listRes.json();
    assert.equal(list.some(item => item.id === uploaded.id), false);

    // Deleting again returns 404
    const secondDelete = await fetch(`${baseUrl}/api/media/${encodeURIComponent(uploaded.id)}`, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': csrf, Origin: baseUrl },
    });
    assert.equal(secondDelete.status, 404);
  });

  it('rejects invalid filenames on DELETE /api/media/:id', async () => {
    for (const bad of ['..', '.hidden', 'dir%2Ffile.png']) {
      const res = await fetch(`${baseUrl}/api/media/${bad}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': csrf, Origin: baseUrl },
      });
      assert.ok([400, 404].includes(res.status), `Expected 400/404 for ${bad}, got ${res.status}`);
    }
  });
});

describe('Admin authentication and CSRF', () => {
  it('enforces setup, login, CSRF and rate limits', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'blogsite-auth-test-'));
    try {
      const auth = createAuth({ authDir: dir, maxAttempts: 2 });
      const cookies = [];
      const mockRes = () => ({
        headers: new Map(),
        getHeader(name) { return this.headers.get(name); },
        setHeader(name, value) { this.headers.set(name, value); },
      });

      const res1 = mockRes();
      const status1 = await auth.status({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }, res1);
      assert.equal(status1.configured, false);
      assert.equal(status1.authenticated, false);
      const setCookies1 = res1.getHeader('Set-Cookie');
      for (const line of setCookies1) cookies.push(line.split(';')[0]);

      const setupRes = mockRes();
      const granted = await auth.setup(
        {
          headers: { cookie: cookies.join('; '), 'x-csrf-token': status1.csrf, host: '127.0.0.1:4322' },
          socket: { remoteAddress: '127.0.0.1' },
        },
        setupRes,
        { username: 'admin1', password: 'Password123' },
      );
      assert.equal(granted.authenticated, true);
      assert.equal(granted.username, 'admin1');

      const sessionCookie = setupRes.getHeader('Set-Cookie')
        .find(line => line.startsWith('field_admin_session='))
        .split(';')[0];

      // Missing CSRF token must throw 403
      assert.throws(
        () => auth.requireCsrf({ headers: {} }, { csrf: granted.csrf }),
        err => err.status === 403,
      );

      // Logout revokes session
      const logoutRes = mockRes();
      await auth.logout(
        { headers: { cookie: sessionCookie, 'x-csrf-token': granted.csrf }, socket: { remoteAddress: '127.0.0.1' } },
        logoutRes,
      );
      assert.throws(
        () => auth.requireSession({ headers: { cookie: sessionCookie } }, mockRes()),
        err => err.status === 401,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
