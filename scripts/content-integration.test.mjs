import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, rm, stat, realpath, writeFile, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from '../admin/server.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRf8AAAAASUVORK5CYII=', 'base64');
function command(root, args) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', BUILD_OUTPUT_DIR: join(root, 'dist') }, stdio: ['ignore','pipe','pipe'] });
    let output = '';
    child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
    child.on('error', reject); child.on('exit', code => code === 0 ? accept(output) : reject(new Error(output)));
  });
}

test('文件与 CMS 共用内容，监听发布更新静态页面且失败保留旧站', { timeout: 120000 }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'field-integration-')));
  let server;
  try {
    for (const name of ['src', 'public', 'scripts', 'lib', 'astro.config.mjs', 'package.json', 'tsconfig.json']) await cp(join(project, name), join(root, name), { recursive: true });
    await cp(join(project, 'node_modules'), join(root, 'node_modules'), { recursive: true, mode: constants.COPYFILE_FICLONE });
    // Content belongs to the site owner. Build this test's records explicitly in
    // its temporary copy, independent of anything authored in the actual site.
    await rm(join(root, 'src/content/blog'), { recursive: true, force: true });
    await mkdir(join(root, 'src/content/blog'));
    for (const collection of ['library', 'friends']) await writeFile(join(root, `src/content/${collection}.json`), '[]\n');
    server = createServer({ projectRoot: root, autoPublish: false, auth: false });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await (await fetch(base + '/api/session')).json();
    const headers = { Origin: base, 'X-CSRF-Token': session.csrf };
    const json = async (path, method = 'GET', body) => {
      const result = await fetch(base + path, { method, headers: { ...headers, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await result.json(); assert.ok(result.ok, JSON.stringify(value)); return value;
    };
    for (const collection of ['blog', 'library', 'friends']) assert.deepEqual(await json(`/api/${collection}`), []);
    const mediaResponse = await fetch(base + '/api/media', { method: 'POST', headers: { ...headers, 'Content-Type': 'image/png', 'X-File-Name': 'integration.png' }, body: png });
    assert.equal(mediaResponse.status, 201); const image = await mediaResponse.json();
    // A file dropped into a nested folder must be editable in CMS and publish through the same collection.
    const manualDirectory = join(root, 'src/content/blog/handwritten');
    await mkdir(manualDirectory);
    await writeFile(join(manualDirectory, '.draft.md'), 'hidden scratchpad without frontmatter');
    await writeFile(join(manualDirectory, '~backup.md'), 'editor backup without frontmatter');
    await mkdir(join(manualDirectory, '~backup'));
    await writeFile(join(manualDirectory, '~backup/ignored.md'), 'nested editor backup');
    const manualPath = join(manualDirectory, 'first.md');
    await writeFile(manualPath, `---\ntitle: 文件夹中的文章\npubDate: 2026-10-20T08:30:00.000Z\nauthor: Keep Me\n---\n\n## 文件与后台共用\n\n文件添加的正文。\n\n![本地插图](${image.url})\n`);
    const manual = (await json('/api/blog')).find(item => item.sourcePath === 'handwritten/first.md');
    assert.ok(manual); assert.equal(manual.slug, 'handwritten-first');
    await json(`/api/blog/${manual.id}`, 'PUT', { ...manual, title: 'CMS继续编辑的文件文章' });
    assert.match(await readFile(manualPath, 'utf8'), /author: Keep Me/);
    assert.match(await readFile(manualPath, 'utf8'), /CMS继续编辑的文件文章/);
    await writeFile(join(manualDirectory, 'private.md'), '---\ntitle: 手写的草稿\ndate: 2026-10-20\ndraft: true\n---\n\n手写草稿不应公开。\n');
    const settings = await json('/api/settings');
    await json('/api/settings', 'PUT', { ...settings, name: '集成测试站', title: '集成测试首页', url: 'https://blog.example.test/', intro: '你好 {name}，这是新的介绍。', aboutTitle: '认识 {name}', aboutBody: '从后台编辑的个人介绍', contactTitle: '继续交流', contactBody: '从后台编辑的联系文案', launchedAt: '2026-10-20T08:30:00+08:00', showRSS: false, defaultTheme: 'dark', logo: image.url, favicon: image.url, github: '', email: 'hello@example.test', pages: { ...settings.pages, blog: { ...settings.pages.blog, description: '' } }, categories: [...settings.categories, { id: 'new-category', label: '新分类', en: 'NEW' }], navigation: settings.navigation.map(item => ({ ...item, label: item.id === 'blog' ? '文章目录' : item.label, visible: item.id !== 'library' })) });
    for (const visible of [true, false]) await json('/api/friends', 'POST', { id: visible ? 'shown-friend' : 'hidden-friend', name: visible ? '已展示的朋友' : '不应展示的朋友', url: 'https://friend.example.test/', avatar: image.url, initials: '', description: '联动验证', label: 'FRIEND', kind: '朋友', order: 1, visible, demo: false });
    const post = { id: 'QA-PUBLIC', slug: 'qa-public-image', title: '带插图的新文章', summary: '本地图与外链图测试', categoryId: 'new-category', date: '2026-10-20', tags: ['图文'], readTime: 1, draft: false, demo: false, body: `## 插图\n\n![本地插图](${image.url})\n\n![图床插图](https://images.example.test/picture.jpg?width=600)\n` };
    await json('/api/blog', 'POST', post);
    await json('/api/blog', 'POST', { ...post, id: 'QA-DRAFT', slug: 'qa-private-draft', title: '不应公开的草稿', draft: true });
    const item = { id: 'qa-local-cover', title: '本地封面', original: '', type: 'book', typeLabel: '书籍', creator: '', date: '2026-10-20', rating: '', cover: image.url, note: '', detail: '', article: '/blog/qa-public-image/', tags: [], demo: false };
    await json('/api/library', 'POST', item);
    await json('/api/library', 'POST', { ...item, id: 'qa-remote-cover', title: '图床封面', cover: 'https://images.example.test/cover.png?size=2' });
    await command(root, [join(root, 'node_modules/astro/bin/astro.mjs'), 'build']);
    const home = await readFile(join(root, 'dist/index.html'), 'utf8');
    const blog = await readFile(join(root, 'dist/blog/index.html'), 'utf8');
    const friends = await readFile(join(root, 'dist/friends/index.html'), 'utf8');
    const library = await readFile(join(root, 'dist/library/index.html'), 'utf8');
    const article = await readFile(join(root, 'dist/blog/qa-public-image/index.html'), 'utf8');
    const rss = await readFile(join(root, 'dist/rss.xml'), 'utf8');
    assert.ok(blog.includes(`name="description" content="${settings.description}"`));
    assert.match(home, /集成测试站/); assert.match(home, /你好 集成测试站/); assert.match(home, /文章目录/);
    const chapterOffsets = ['welcome', 'about', 'archives', 'contact'].map(id => home.indexOf(`id="${id}"`));
    assert.ok(chapterOffsets.every((offset, index) => offset >= 0 && (index === 0 || offset > chapterOffsets[index - 1])), 'Home chapters retain the requested reading order');
    assert.match(home, /认识 集成测试站/); assert.match(home, /从后台编辑的个人介绍/); assert.match(home, /从后台编辑的联系文案/);
    assert.match(home, /data-launched-at="2026-10-20T08:30:00\+08:00"/); assert.match(home, /mailto:hello@example.test/);
    const archiveSource = home.match(/<script\b[^>]*id="archive-data"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(archiveSource, 'Home embeds a shared Blog/Library archive');
    const archive = JSON.parse(archiveSource);
    assert.ok(archive.posts.some(record => record.title === '本地封面' && record.cover === image.url));
    assert.ok(archive.posts.some(record => record.title === '图床封面' && record.cover === 'https://images.example.test/cover.png?size=2'));
    assert.ok(!archive.posts.some(record => record.title === '不应公开的草稿'));
    assert.ok(archive.posts.some(record => record.title === '带插图的新文章'));
    assert.match(home, /\/library\/#work-qa-local-cover/); assert.match(library, /id="work-qa-local-cover"/);
    assert.match(home, /data-default-theme="dark"/); assert.ok(!home.includes('type="application/rss+xml"'));
    assert.ok(home.includes('https://blog.example.test/')); assert.ok(!home.includes('qa-private-draft'));
    assert.match(home, /新分类/); assert.match(friends, /已展示的朋友/); assert.ok(!friends.includes('不应展示的朋友'));
    assert.ok(friends.includes('https://blog.example.test/')); assert.ok(friends.includes(image.url));
    assert.ok(article.includes(image.url)); assert.match(article, /images\.example\.test\/picture\.jpg/);
    const manualArticle = await readFile(join(root, 'dist/blog/handwritten-first/index.html'), 'utf8');
    assert.match(manualArticle, /CMS继续编辑的文件文章/); assert.ok(manualArticle.includes(image.url));
    assert.match(home, /CMS继续编辑的文件文章/); assert.match(blog, /CMS继续编辑的文件文章/);
    assert.ok(rss.includes('/blog/handwritten-first/')); assert.ok(!rss.includes('handwritten-private'));
    await assert.rejects(stat(join(root, 'dist/blog/handwritten-private/index.html')), { code: 'ENOENT' });
    assert.match(library, /images\.example\.test\/cover\.png/); assert.ok(library.includes(image.url));
    assert.ok(!rss.includes('qa-private-draft')); assert.ok(rss.includes('https://blog.example.test/blog/qa-public-image/'));
    await assert.rejects(stat(join(root, 'dist/blog/qa-private-draft/index.html')), { code: 'ENOENT' });
    assert.deepEqual(await readFile(join(root, 'dist', image.url)), png);
    await command(root, [join(root, 'scripts/verify.mjs')]);
    // Duplicate hand-written URLs fail the build instead of silently replacing a page.
    await writeFile(join(manualDirectory, 'duplicate.md'), '---\ntitle: 重复地址\ndate: 2026-10-20\nslug: handwritten-first\n---\n\n重复地址正文。\n');
    await assert.rejects(command(root, [join(root, 'node_modules/astro/bin/astro.mjs'), 'build']), /重复/);
    await rm(join(manualDirectory, 'duplicate.md'));
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    server = createServer({ projectRoot: root, autoPublish: true, auth: false });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const publishingBase = `http://127.0.0.1:${server.address().port}`;
    async function until(predicate) {
      const deadline = Date.now() + 30000;
      let state;
      while (Date.now() < deadline) {
        state = await (await fetch(publishingBase + '/api/publish/status')).json();
        if (predicate(state)) return state;
        await delay(100);
      }
      assert.fail(`publication did not reach expected state: ${JSON.stringify(state)}`);
    }
    await until(state => state.watch?.state === 'watching');
    const watchedPath = join(manualDirectory, 'auto.md');
    await writeFile(watchedPath, '---\ntitle: 自动部署的手写文章\ndate: 2026-10-20\n---\n\n无需点击后台发布。\n');
    const published = await until(state => state.state === 'published');
    const servedRoot = join(root, '.published/current');
    assert.match(await readFile(join(servedRoot, 'blog/handwritten-auto/index.html'), 'utf8'), /自动部署的手写文章/);
    const lastGoodRelease = await realpath(servedRoot);
    await writeFile(watchedPath, '---\ntitle: 尚未写完\n');
    await until(state => state.state === 'failed' && state.finishedAt !== published.finishedAt);
    assert.equal(await realpath(servedRoot), lastGoodRelease);
    await writeFile(watchedPath, '---\ntitle: 修复后自动重新发布\ndate: 2026-10-20\n---\n\n源文件修复后再次发布。\n');
    await until(state => state.state === 'published' && state.finishedAt !== published.finishedAt);
    assert.notEqual(await realpath(servedRoot), lastGoodRelease);
    assert.match(await readFile(join(servedRoot, 'blog/handwritten-auto/index.html'), 'utf8'), /修复后自动重新发布/);
  } finally {
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await rm(root, { recursive: true, force: true });
  }
});
