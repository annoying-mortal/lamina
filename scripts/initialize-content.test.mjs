import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeContent } from './initialize-content.mjs';
import { createServer } from '../admin/server.mjs';

test('旧内容卷补齐新配置且多次启动不覆盖已保存的配置', async () => {
  const root = await mkdtemp(join(tmpdir(), 'field-upgrade-'));
  try {
    const defaultsDir = join(root, 'defaults'), contentDir = join(root, 'content');
    await mkdir(defaultsDir); await mkdir(contentDir);
    await writeFile(join(defaultsDir, 'site.json'), '{"name":"default"}');
    await writeFile(join(defaultsDir, 'friends.json'), '[]');
    await writeFile(join(contentDir, 'site.json'), '{"name":"mine"}');
    await initializeContent({ defaultsDir, contentDir });
    assert.equal(await readFile(join(contentDir, 'site.json'), 'utf8'), '{"name":"mine"}');
    assert.deepEqual(JSON.parse(await readFile(join(contentDir, 'friends.json'), 'utf8')), []);
    await writeFile(join(contentDir, 'friends.json'), '[{"name":"a friend"}]');
    await initializeContent({ defaultsDir, contentDir });
    assert.equal(await readFile(join(contentDir, 'friends.json'), 'utf8'), '[{"name":"a friend"}]');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a first deployment contains the canonical examples and templates, not local user articles', async () => {
  const contentDir = await mkdtemp(join(tmpdir(), 'blog-starter-'));
  try {
    await mkdir(join(contentDir, 'blog'));
    await writeFile(join(contentDir, 'blog/.gitkeep'), '');
    await initializeContent({ contentDir });
    const posts = (await readdir(join(contentDir, 'blog'))).filter(name => name.endsWith('.md')).sort();
    assert.deepEqual(posts, ['enter-title.md', 'markdown-guide.md']);
    for (const name of posts) {
      const source = await readFile(join(contentDir, 'blog', name), 'utf8');
      assert.match(source, /demo: true/);
      assert.match(source, /draft: false/);
    }
    const library = JSON.parse(await readFile(join(contentDir, 'library.json'), 'utf8'));
    for (const type of ['acgn', 'albums', 'books']) {
      const items = library.filter(item => item.type === type);
      assert.equal(items.length, 2);
      assert.equal(items.filter(item => item.title === 'Enter Title').length, 1);
      assert.ok(items.every(item => item.demo));
    }
    assert.equal(library.length, 6);
    const friends = JSON.parse(await readFile(join(contentDir, 'friends.json'), 'utf8'));
    assert.equal(friends.length, 2);
    assert.ok(friends.some(friend => friend.name === 'Me' && new URL(friend.url).origin === 'http://localhost:8080'));
    assert.ok(friends.some(friend => friend.name === 'Enter Title'));
    assert.equal(JSON.parse(await readFile(join(contentDir, '.content-initialized'), 'utf8')).status, 'complete');
    assert.equal(JSON.parse(await readFile(join(contentDir, 'site.json'), 'utf8')).name, 'Enter site name');
  } finally { await rm(contentDir, { recursive: true, force: true }); }
});

test('restarting an initialized site never resurrects removed examples or replace empty lists', async () => {
  const contentDir = await mkdtemp(join(tmpdir(), 'blog-no-reseed-'));
  try {
    await initializeContent({ contentDir });
    await rm(join(contentDir, 'blog'), { recursive: true });
    await writeFile(join(contentDir, 'library.json'), '[]');
    await writeFile(join(contentDir, 'friends.json'), '[]');
    await writeFile(join(contentDir, 'site.json'), '{"name":"My site"}');
    await initializeContent({ contentDir });
    assert.equal(await readFile(join(contentDir, 'site.json'), 'utf8'), '{"name":"My site"}');
    assert.equal(await readFile(join(contentDir, 'library.json'), 'utf8'), '[]');
    assert.equal(await readFile(join(contentDir, 'friends.json'), 'utf8'), '[]');
    await assert.rejects(readdir(join(contentDir, 'blog')), { code: 'ENOENT' });
  } finally { await rm(contentDir, { recursive: true, force: true }); }
});

test('an old content directory preserves user articles and gets no new sample records', async () => {
  const contentDir = await mkdtemp(join(tmpdir(), 'blog-existing-'));
  try {
    await mkdir(join(contentDir, 'blog'));
    await writeFile(join(contentDir, 'blog/mine.md'), '# My article');
    await writeFile(join(contentDir, 'library.json'), '[]');
    await initializeContent({ contentDir });
    assert.deepEqual(await readdir(join(contentDir, 'blog')), ['mine.md']);
    assert.equal(await readFile(join(contentDir, 'blog/mine.md'), 'utf8'), '# My article');
    assert.equal(await readFile(join(contentDir, 'library.json'), 'utf8'), '[]');
    assert.deepEqual(JSON.parse(await readFile(join(contentDir, 'friends.json'), 'utf8')), []);
  } finally { await rm(contentDir, { recursive: true, force: true }); }
});

test('an interrupted fresh copy resumes without replacing any files already copied', async () => {
  const contentDir = await mkdtemp(join(tmpdir(), 'blog-resume-seed-'));
  try {
    await writeFile(join(contentDir, '.content-initialized'), JSON.stringify({ version: 1, status: 'initializing', fresh: true }));
    await writeFile(join(contentDir, 'site.json'), '{"name":"Already copied"}');
    await initializeContent({ contentDir });
    assert.equal(await readFile(join(contentDir, 'site.json'), 'utf8'), '{"name":"Already copied"}');
    assert.equal((await readdir(join(contentDir, 'blog'))).filter(name => name.endsWith('.md')).length, 2);
    assert.equal(JSON.parse(await readFile(join(contentDir, 'library.json'), 'utf8')).length, 6);
  } finally { await rm(contentDir, { recursive: true, force: true }); }
});

test('Docker uses canonical defaults and excludes the local live content directory', async () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const dockerfile = await readFile(join(root, 'Dockerfile'), 'utf8');
  const ignored = await readFile(join(root, '.dockerignore'), 'utf8');
  assert.match(ignored, /^src\/content$/m);
  assert.match(dockerfile, /node scripts\/initialize-content\.mjs && npm run check && npm run build/);
  assert.doesNotMatch(dockerfile, /cp .*src\/content\/.*admin\/defaults/);
});

test('every starter record can be read and saved through the CMS without schema errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blog-starter-cms-'));
  const contentDir = join(root, 'content');
  let server;
  try {
    await initializeContent({ contentDir });
    server = createServer({ projectRoot: root, dataDir: contentDir, autoPublish: false, auth: false, watchContent: false });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/api/session`).then(response => response.json());
    const headers = { 'Content-Type': 'application/json', Origin: base, 'X-CSRF-Token': session.csrf };
    const settings = await fetch(`${base}/api/settings`).then(response => response.json());
    const settingsResponse = await fetch(`${base}/api/settings`, { method: 'PUT', headers, body: JSON.stringify(settings) });
    assert.equal(settingsResponse.status, 200, await settingsResponse.text());
    for (const [collection, expected] of [['blog', 2], ['library', 6], ['friends', 2]]) {
      const list = await fetch(`${base}/api/${collection}`).then(response => response.json());
      assert.equal(list.length, expected);
      for (const item of list) {
        const path = `${base}/api/${collection}/${encodeURIComponent(item.id)}`;
        const record = await fetch(path).then(response => response.json());
        const saved = await fetch(path, { method: 'PUT', headers, body: JSON.stringify(record) });
        assert.equal(saved.status, 200, `${collection}/${item.id}: ${await saved.text()}`);
      }
    }
  } finally {
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await rm(root, { recursive: true, force: true });
  }
});
