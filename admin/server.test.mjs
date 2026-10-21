import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { setTimeout } from 'node:timers/promises';
import { createServer } from './server.mjs';
import { parse } from 'yaml';
import { DEFAULT_LIBRARY_TYPES, librarySettings, normalizeLibraryTypeId, resolveLibraryTypes } from '../lib/library-settings.mjs';

const samplePost = overrides => ({ id: 'POST-001', slug: 'first-note', title: '第一篇文章', summary: '测试摘要', categoryId: 'engineering', date: '2026-10-19', tags: ['测试'], readTime: 3, demo: false, body: '# Hello\n\n保留中文、代码和 **Markdown**。', ...overrides });
const sampleItem = overrides => ({ id: 'item-one', title: '测试收藏', original: 'A RECORD', type: 'book', typeLabel: '小说', creator: '作者', date: '2026-10-19', rating: '', cover: '', note: '一条短评', detail: '详细记录', article: null, tags: ['文学'], demo: false, ...overrides });
const sampleFriend = overrides => ({ id: 'friend-one', name: '一个朋友', url: 'https://example.com/', avatar: '', initials: '友', description: '记录有意思的事情。', label: 'NEIGHBOR', kind: '朋友', order: 0, visible: true, demo: false, ...overrides });

async function fixture(run, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'field-notes-admin-'));
  const dataDir = join(directory, 'content');
  await mkdir(join(dataDir, 'blog'), { recursive: true });
  await writeFile(join(dataDir, 'library.json'), '[]\n');
  if (options.publisher) { await mkdir(join(directory, 'scripts')); await writeFile(join(directory, 'scripts/publish.mjs'), options.publisher); }
  const server = createServer({
    projectRoot: directory, dataDir, autoPublish: Boolean(options.publisher), auth: false,
    watchContent: options.watchContent, watchIntervalMs: options.watchIntervalMs, watchDebounceMs: options.watchDebounceMs,
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${base}/api/session`).then(response => response.json());
  const request = async (path, method = 'GET', body, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', Origin: base, 'X-CSRF-Token': session.csrf }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  try { await run({ base, request, dataDir, directory, session, server }); }
  finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await rm(directory, { recursive: true, force: true }); }
}

test('health and session are usable without a token and include safe response headers', () => fixture(async ({ request, session }) => {
  assert.match(session.csrf, /^[a-f0-9]{64}$/); assert.equal(session.categories.length, 3);
  const result = await request('/healthz'); assert.equal(result.status, 200); assert.deepEqual(result.body, { status: 'ok' });
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('x-frame-options'), 'DENY');
}));

test('blog create, update and delete persist the full Markdown content and stable metadata', () => fixture(async ({ request, dataDir }) => {
  let result = await request('/api/blog', 'POST', samplePost()); assert.equal(result.status, 201);
  assert.equal((await request('/api/blog')).body.length, 1);
  const path = join(dataDir, 'blog/first-note.md');
  const saved = await readFile(path, 'utf8'); assert.match(saved, /id: POST-001/); assert.match(saved, /保留中文/);
  result = await request('/api/blog/POST-001', 'PUT', { ...result.body, title: '已修改', slug: 'updated-slug', body: '## 新正文\n\n```js\nconst x = 1;\n```' }); assert.equal(result.status, 200);
  assert.equal((await request('/api/blog/POST-001')).body.slug, 'updated-slug');
  assert.match(await readFile(path, 'utf8'), /const x = 1;/); assert.deepEqual(await readdir(join(dataDir, 'blog')), ['first-note.md']);
  const deleted = await request('/api/blog/POST-001', 'DELETE', { revision: result.body.revision }); assert.equal(deleted.status, 200);
  assert.deepEqual(await readdir(join(dataDir, 'blog')), []); assert.equal((await request('/api/blog/POST-001')).status, 404);
}));

test('concurrent creates do not lose library records and leave valid JSON without temp files', () => fixture(async ({ request, dataDir }) => {
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => request('/api/library', 'POST', sampleItem({ id: `item-${i}` }))));
  assert.ok(results.every(result => result.status === 201));
  const items = JSON.parse(await readFile(join(dataDir, 'library.json'), 'utf8'));
  assert.equal(items.length, 12); assert.equal(new Set(items.map(item => item.id)).size, 12);
  assert.deepEqual((await readdir(dataDir)).sort(), ['blog', 'library.json']);
}));

test('library edit and delete round-trip music, optional fields, tags and article links', () => fixture(async ({ request }) => {
  let result = await request('/api/library', 'POST', sampleItem({ type: 'music', typeLabel: '专辑', tags: ['器乐', '器乐'], cover: 'https://example.com/cover.jpg' }));
  assert.equal(result.status, 201); assert.deepEqual(result.body.tags, ['器乐']);
  result = await request('/api/library/item-one', 'PUT', { ...result.body, title: '改名', article: '/blog/first-note/', rating: '9.5' });
  assert.equal(result.status, 200); assert.equal(result.body.rating, '9.5');
  assert.equal((await request('/api/library/item-one')).body.article, '/blog/first-note/');
  assert.equal((await request('/api/library/item-one', 'DELETE', { revision: result.body.revision })).status, 200);
  assert.equal((await request('/api/library')).body.length, 0);
}));

test('Library settings have ordered defaults, preserve custom labels and isolate mutable copies', () => {
  assert.deepEqual(librarySettings({}).libraryTypes.map(item => item.label), ['All', 'ACGN', 'Albums', 'Books', 'Others']);
  const copy = resolveLibraryTypes(undefined); copy[0].label = 'Changed';
  assert.equal(DEFAULT_LIBRARY_TYPES[0].label, 'All');
  assert.deepEqual(resolveLibraryTypes([{ id: 'music', label: 'Records', en: 'RECORDS' }, { id: 'all', label: 'Everything', en: '' }]), [{ id: 'albums', label: 'Records', en: 'RECORDS' }, { id: 'all', label: 'Everything', en: '' }]);
  assert.equal(normalizeLibraryTypeId('book'), 'books'); assert.equal(normalizeLibraryTypeId('screen'), 'acgn'); assert.equal(normalizeLibraryTypeId('custom'), 'custom');
  assert.deepEqual(resolveLibraryTypes([]), DEFAULT_LIBRARY_TYPES);
});

test('Library categories support add, rename, reorder and delete with live item choices', () => fixture(async ({ request, session, dataDir }) => {
  assert.deepEqual(session.libraryTypes.map(item => item.id), ['acgn', 'albums', 'books', 'others']);
  let settings = (await request('/api/settings')).body;
  assert.deepEqual(settings.libraryTypes.map(item => item.id), ['all', 'acgn', 'albums', 'books', 'others']);
  const custom = { id: 'projects', label: 'Projects', en: 'PROJECTS' };
  let result = await request('/api/settings', 'PUT', { ...settings, libraryTypes: [custom, ...settings.libraryTypes].map(item => item.id === 'all' ? { ...item, label: 'Everything' } : item) });
  assert.equal(result.status, 200); settings = result.body;
  assert.equal(settings.libraryTypes[0].id, 'projects'); assert.equal(settings.libraryTypes[1].label, 'Everything');
  assert.equal((await request('/api/session')).body.libraryTypes[0].id, 'projects');
  let item = await request('/api/library', 'POST', sampleItem({ type: 'projects', typeLabel: '' }));
  assert.equal(item.status, 201); assert.equal(item.body.type, 'projects'); assert.equal(item.body.typeLabel, 'Projects');
  result = await request('/api/settings', 'PUT', { ...settings, libraryTypes: settings.libraryTypes.map(type => type.id === 'projects' ? { ...type, label: 'Work', en: 'WORK' } : type) });
  assert.equal(result.status, 200); settings = result.body;
  assert.equal((await request('/api/session')).body.libraryTypes[0].label, 'Work');
  assert.equal((await request('/api/library/item-one')).body.type, 'projects');
  assert.equal((await request('/api/library', 'POST', sampleItem({ id: 'aggregate', type: 'all' }))).status, 400);
  result = await request('/api/settings', 'PUT', { ...settings, libraryTypes: settings.libraryTypes.filter(type => type.id !== 'projects') });
  assert.equal(result.status, 409); assert.match(result.body.error, /Move or delete.*测试收藏/);
  item = await request('/api/library/item-one', 'PUT', { ...item.body, type: 'others' }); assert.equal(item.status, 200);
  result = await request('/api/settings', 'PUT', { ...settings, libraryTypes: settings.libraryTypes.filter(type => !['projects', 'all'].includes(type.id)) });
  assert.equal(result.status, 200); settings = result.body;
  assert.equal(settings.libraryTypes.some(type => ['projects', 'all'].includes(type.id)), false);
  assert.equal((await request('/api/library', 'POST', sampleItem({ id: 'removed', type: 'projects' }))).status, 400);
  const olderClient = { ...settings, name: 'Older client name edit' }; delete olderClient.libraryTypes;
  result = await request('/api/settings', 'PUT', olderClient); assert.equal(result.status, 200);
  assert.deepEqual(result.body.libraryTypes, settings.libraryTypes);
  assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'site.json'), 'utf8')).libraryTypes, settings.libraryTypes);
}));

test('legacy Library items read as current types, block category deletion and migrate on save', () => fixture(async ({ request, dataDir }) => {
  const original = ['music', 'book', 'screen'].map((type, index) => sampleItem({ id: `legacy-${index}`, title: `Legacy ${type}`, type }));
  const source = JSON.stringify(original, null, 2) + '\n'; await writeFile(join(dataDir, 'library.json'), source);
  let records = (await request('/api/library')).body;
  assert.deepEqual(records.map(item => item.type), ['albums', 'books', 'acgn']);
  assert.equal(await readFile(join(dataDir, 'library.json'), 'utf8'), source);
  const initial = (await request('/api/settings')).body;
  const blocked = await request('/api/settings', 'PUT', { ...initial, libraryTypes: initial.libraryTypes.filter(type => type.id !== 'albums') });
  assert.equal(blocked.status, 409); assert.match(blocked.body.error, /Legacy music/);
  const saved = await request('/api/library/legacy-0', 'PUT', { ...records[0], title: 'Updated legacy record' });
  assert.equal(saved.status, 200); assert.equal(saved.body.type, 'albums');
  assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'library.json'), 'utf8')).map(item => item.type), ['albums', 'books', 'acgn']);
  records = (await request('/api/library')).body;
  assert.equal((await request('/api/library/legacy-1', 'DELETE', { revision: records[1].revision })).status, 200);
}));

test('Library settings reject empty, duplicate, invalid and reserved category IDs', () => fixture(async ({ request }) => {
  const initial = (await request('/api/settings')).body;
  for (const libraryTypes of [null, [], [{ id: 'all', label: 'All' }], [...initial.libraryTypes, initial.libraryTypes[1]], [{ id: 'bad id', label: 'Invalid' }], [{ id: 'music', label: 'Legacy alias' }], [{ id: 'projects', label: '' }], Array.from({ length: 31 }, (_, index) => ({ id: `type-${index}`, label: 'Category' }))]) {
    assert.equal((await request('/api/settings', 'PUT', { ...initial, libraryTypes })).status, 400, JSON.stringify(libraryTypes));
  }
  assert.deepEqual((await request('/api/settings')).body.libraryTypes, initial.libraryTypes);
}));

test('shared orbit image supports local and remote URLs, rejects dangerous URLs and survives older clients', () => fixture(async ({ request }) => {
  let settings = (await request('/api/settings')).body;
  assert.equal(settings.orbitImage, '');
  for (const input of ['/uploads/圆环 图片.svg', 'https://images.example.com/圆环 image.png', '']) {
    const saved = await request('/api/settings', 'PUT', { ...settings, orbitImage: input }); assert.equal(saved.status, 200);
    settings = saved.body;
    const expected = input.startsWith('https:') ? new URL(input).href : encodeURI(input);
    assert.equal(settings.orbitImage, expected); assert.equal((await request('/api/auth/status')).body.orbitImage, expected);
    const oldClient = { ...settings, name: 'Older client' }; delete oldClient.orbitImage;
    const preserved = await request('/api/settings', 'PUT', oldClient); assert.equal(preserved.status, 200); assert.equal(preserved.body.orbitImage, expected); settings = preserved.body;
  }
  for (const orbitImage of ['javascript:alert(1)', 'data:image/svg+xml,foo', '//evil.example/image.png', '/uploads/../secret', '/uploads/%2e%2e/secret', 'file:///etc/passwd']) {
    assert.equal((await request('/api/settings', 'PUT', { ...settings, orbitImage })).status, 400, orbitImage);
  }
}));

test('anonymous login status exposes only a safe orbit image and keeps settings private', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blog-orbit-login-'));
  const contentDir = join(root, 'src/content'); await mkdir(contentDir, { recursive: true });
  const settings = { name: 'Public name', categories: [], orbitImage: '/uploads/orbit.svg', privateCustomField: 'not-public', email: 'private@example.com' };
  await writeFile(join(contentDir, 'site.json'), JSON.stringify(settings));
  const server = createServer({ projectRoot: root, autoPublish: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let status = await fetch(`${base}/api/auth/status`).then(response => response.json());
    assert.equal(status.authenticated, false); assert.equal(status.orbitImage, '/uploads/orbit.svg');
    for (const field of ['privateCustomField', 'email', 'categories', 'libraryTypes', 'username']) assert.equal(Object.hasOwn(status, field), false, field);
    assert.equal((await fetch(`${base}/api/settings`)).status, 401);
    await writeFile(join(contentDir, 'site.json'), JSON.stringify({ ...settings, orbitImage: 'javascript:alert(1)' }));
    status = await fetch(`${base}/api/auth/status`).then(response => response.json()); assert.equal(status.orbitImage, '');
  } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await rm(root, { recursive: true, force: true }); }
});

test('stale revisions reject competing edits instead of silently replacing newer content', () => fixture(async ({ request }) => {
  const original = (await request('/api/blog', 'POST', samplePost())).body;
  const updates = await Promise.all(['A', 'B'].map(title => request('/api/blog/POST-001', 'PUT', { ...original, title })));
  assert.deepEqual(updates.map(result => result.status).sort(), [200, 409]);
  assert.equal((await request('/api/blog/POST-001', 'DELETE', { revision: original.revision })).status, 409);
  const library = (await request('/api/library', 'POST', sampleItem())).body;
  assert.equal((await request('/api/library/item-one', 'PUT', { ...library, title: '新版' })).status, 200);
  assert.equal((await request('/api/library/item-one', 'PUT', { ...library, title: '旧版' })).status, 409);
}));

test('duplicate IDs and slugs fail without touching existing posts', () => fixture(async ({ request }) => {
  assert.equal((await request('/api/blog', 'POST', samplePost())).status, 201);
  assert.equal((await request('/api/blog', 'POST', samplePost({ slug: 'different' }))).status, 409);
  assert.equal((await request('/api/blog', 'POST', samplePost({ id: 'POST-002' }))).status, 409);
  assert.equal((await request('/api/blog')).body.length, 1);
  const results = await Promise.all([1, 2].map(() => request('/api/library', 'POST', sampleItem())));
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
}));

test('CSRF, cross-site origins and DNS-rebinding Hosts are rejected', () => fixture(async ({ base, request }) => {
  assert.equal((await request('/api/blog', 'POST', samplePost(), { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await request('/api/blog', 'POST', samplePost(), { 'X-CSRF-Token': 'é'.repeat(64) })).status, 403);
  assert.equal((await request('/api/blog', 'POST', samplePost(), { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('/api/blog', 'POST', samplePost(), { Origin: '' })).status, 403);
  const status = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/api/session`, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(status, 403); assert.equal((await request('/api/blog')).body.length, 0);
}));

test('path traversal IDs, unsafe slugs and symlinked Markdown files cannot be modified', () => fixture(async ({ request, dataDir, directory }) => {
  for (const id of ['../escape', 'a/b', 'a\\b', '..', '/absolute']) assert.equal((await request('/api/blog', 'POST', samplePost({ id }))).status, 400);
  assert.equal((await request('/api/blog', 'POST', samplePost({ slug: '../escape' }))).status, 400);
  assert.equal((await request('/api/blog/a%2Fb', 'PUT', samplePost())).status, 400);
  const external = join(directory, 'external.md'); await writeFile(external, 'unchanged'); await symlink(external, join(dataDir, 'blog/link.md'));
  assert.equal((await request('/api/blog')).body.length, 0);
  assert.equal((await request('/api/blog/link', 'DELETE', { revision: 'x' })).status, 404);
  assert.equal(await readFile(external, 'utf8'), 'unchanged');
}));

test('invalid content, dates, protocols and oversized fields are rejected', () => fixture(async ({ request }) => {
  for (const values of [{ date: '2026-02-31' }, { readTime: 0 }, { title: '' }, { body: '' }, { categoryId: 'else' }, { tags: ['x'.repeat(41)] }, { demo: 'true' }]) {
    assert.equal((await request('/api/blog', 'POST', samplePost(values))).status, 400, JSON.stringify(values));
  }
  for (const values of [{ cover: 'javascript:alert(1)' }, { cover: 'data:image/svg+xml,foo' }, { cover: '//evil.example/a.jpg' }, { cover: '/a/../file' }, { cover: '/a/%2e%2e/file' }, { rating: '10.1' }, { article: 'https://evil.example/' }, { type: 'film' }]) {
    assert.equal((await request('/api/library', 'POST', sampleItem(values))).status, 400, JSON.stringify(values));
  }
}));

test('malformed JSON, wrong media type and unsupported methods return clear errors', () => fixture(async ({ base, session, request }) => {
  const response = await fetch(`${base}/api/blog`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf }, body: '{' });
  assert.equal(response.status, 400);
  assert.equal((await request('/api/blog', 'POST', samplePost(), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await request('/api/blog', 'PATCH', {})).status, 405);
  assert.equal((await request('/api/blog', 'POST', null)).status, 400);
  assert.equal((await request('/api/blog', 'POST', samplePost({ body: 'x'.repeat(1024 * 1024) }))).status, 413);
  assert.equal((await request('/api/publish', 'POST', { command: 'anything' })).status, 409);
}));

test('publication runs a fixed script and queues changes made during a build', () => fixture(async ({ request, directory }) => {
  assert.equal((await request('/api/blog', 'POST', samplePost())).status, 201);
  await setTimeout(40);
  assert.equal((await request('/api/library', 'POST', sampleItem())).status, 201);
  let status;
  for (let tries = 0; tries < 60; tries++) {
    await setTimeout(30); status = (await request('/api/publish/status')).body;
    if (status.state === 'published') break;
  }
  assert.equal(status.state, 'published');
  assert.equal((await readFile(join(directory, 'runs.log'), 'utf8')).split('\n').filter(Boolean).length, 2);
}, { publisher: `import { appendFile } from 'node:fs/promises';\nawait new Promise(resolve => setTimeout(resolve, 180));\nawait appendFile('runs.log', 'published\\n');\n` }));

test('a failed publisher reports failure without losing saved source content', () => fixture(async ({ request, dataDir }) => {
  assert.equal((await request('/api/blog', 'POST', samplePost())).status, 201);
  let status;
  for (let tries = 0; tries < 30; tries++) {
    await setTimeout(20); status = (await request('/api/publish/status')).body;
    if (status.state === 'failed') break;
  }
  assert.equal(status.state, 'failed'); assert.match(status.output, /fixture build failed/);
  assert.match(await readFile(join(dataDir, 'blog/first-note.md'), 'utf8'), /第一篇文章/);
}, { publisher: `console.error('fixture build failed'); process.exitCode = 1;\n` }));

test('friend CRUD persists all fields, normalizes Unicode URLs and protects revisions', () => fixture(async ({ request, dataDir }) => {
  const input = sampleFriend({ url: 'http://example.com/中文 空格?q=一些文字', avatar: '/covers/头像 图片.svg', visible: false, demo: true, order: 7 });
  let result = await request('/api/friends', 'POST', input);
  assert.equal(result.status, 201); assert.equal(result.body.url, new URL(input.url).href);
  assert.equal(result.body.avatar, '/covers/%E5%A4%B4%E5%83%8F%20%E5%9B%BE%E7%89%87.svg');
  assert.equal(result.body.visible, false); assert.equal(result.body.kind, '朋友'); assert.equal(result.body.order, 7);
  const before = result.body;
  result = await request('/api/friends/friend-one', 'PUT', { ...before, name: '新名称', visible: true, demo: false });
  assert.equal(result.status, 200); assert.equal(result.body.visible, true);
  assert.equal((await request('/api/friends/friend-one', 'PUT', { ...before, name: '旧窗口' })).status, 409);
  assert.equal((await request('/api/friends/friend-one', 'DELETE', { revision: before.revision })).status, 409);
  assert.equal((await request('/api/friends', 'POST', sampleFriend())).status, 409);
  assert.equal((await request('/api/friends/friend-one')).body.name, '新名称');
  assert.equal(JSON.parse(await readFile(join(dataDir, 'friends.json'), 'utf8'))[0].name, '新名称');
  assert.equal((await request('/api/friends/friend-one', 'DELETE', { revision: result.body.revision })).status, 200);
  assert.deepEqual((await request('/api/friends')).body, []);
}));

test('parallel friend creates are serialized without losing records', () => fixture(async ({ request, dataDir }) => {
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => request('/api/friends', 'POST', sampleFriend({ id: `friend-${index}`, order: index }))));
  assert.ok(results.every(result => result.status === 201));
  assert.equal(JSON.parse(await readFile(join(dataDir, 'friends.json'), 'utf8')).length, 10);
}));

test('settings persist complete content, reordered navigation and revision conflicts', () => fixture(async ({ request, dataDir }) => {
  const initial = (await request('/api/settings')).body;
  assert.equal(initial.navigation.length, 4); assert.equal(initial.categories.length, 3);
  const value = { ...initial, name: '我的站点', tagline: '第一行\n第二行', intro: '你好，我是 {name}。\n换行介绍。', url: 'http://example.com/个人空间', logo: 'http://example.com/站点 logo.png', email: 'hello@example.com', defaultTheme: 'dark', showRSS: false, navigation: [...initial.navigation].reverse().map(item => ({ ...item, visible: item.id !== 'library' })), pages: { ...initial.pages, friends: { title: '朋友们', eyebrow: 'OUR NEIGHBORS', description: '一些喜欢的小站。' } } };
  const result = await request('/api/settings', 'PUT', value);
  assert.equal(result.status, 200); assert.equal(result.body.name, '我的站点');
  assert.equal(result.body.tagline, '第一行\n第二行'); assert.equal(result.body.intro, '你好，我是 {name}。\n换行介绍。');
  assert.equal(result.body.navigation[0].id, 'friends'); assert.equal(result.body.navigation.find(item => item.id === 'library').visible, false);
  assert.equal(result.body.defaultTheme, 'dark'); assert.equal(result.body.showRSS, false);
  assert.equal(result.body.logo, new URL(value.logo).href); assert.equal(result.body.url, new URL(value.url).href);
  const file = JSON.parse(await readFile(join(dataDir, 'site.json'), 'utf8'));
  assert.equal(file.pages.friends.title, '朋友们'); assert.equal(Object.hasOwn(file, 'revision'), false);
  assert.equal((await request('/api/settings', 'PUT', value)).status, 409);
  const competing = await Promise.all(['A', 'B'].map(name => request('/api/settings', 'PUT', { ...result.body, name })));
  assert.deepEqual(competing.map(item => item.status).sort(), [200, 409]);
}));

test('home settings preserve old site content, editable copy and custom fields without inventing uptime', () => fixture(async ({ request, dataDir }) => {
  const initial = (await request('/api/settings')).body;
  const homeFields = ['aboutEyebrow', 'aboutTitle', 'aboutBody', 'contactEyebrow', 'contactTitle', 'contactBody', 'launchedAt'];
  const legacy = { ...initial, intro: '这是原有的个人简介。', customIdentity: { motto: '保留自定义数据' } };
  for (const name of [...homeFields, 'revision']) delete legacy[name];
  await writeFile(join(dataDir, 'site.json'), JSON.stringify(legacy));
  const loaded = (await request('/api/settings')).body;
  assert.equal(loaded.aboutBody, legacy.intro); assert.equal(loaded.launchedAt, '');
  assert.equal(loaded.aboutTitle, 'Enter about title');
  assert.equal(loaded.contactEyebrow, 'Enter contact label');
  const edited = { ...loaded, aboutEyebrow: 'ABOUT ME', aboutTitle: '关于 {name}', aboutBody: '第一段。\n\n第二段。', contactEyebrow: 'CONTACT', contactTitle: '来聊聊，\n慢慢说。', contactBody: '你好。\n保持联系。', launchedAt: '2026-10-20T21:28:15+08:00' };
  let saved = await request('/api/settings', 'PUT', edited);
  assert.equal(saved.status, 200);
  for (const field of homeFields) assert.equal(saved.body[field], edited[field]);
  const olderClient = { ...saved.body, name: '旧客户端修改站名' };
  for (const field of homeFields) delete olderClient[field];
  saved = await request('/api/settings', 'PUT', olderClient);
  assert.equal(saved.status, 200);
  for (const field of homeFields) assert.equal(saved.body[field], edited[field]);
  const file = JSON.parse(await readFile(join(dataDir, 'site.json'), 'utf8'));
  assert.deepEqual(file.customIdentity, legacy.customIdentity); assert.equal(file.intro, legacy.intro);
  saved = await request('/api/settings', 'PUT', { ...saved.body, aboutBody: '', contactBody: '', launchedAt: '' });
  assert.equal(saved.status, 200); assert.equal(saved.body.launchedAt, ''); assert.equal(saved.body.aboutBody, ''); assert.equal(saved.body.contactBody, '');
}));

test('home settings require real launch timestamps with timezone and bound editable copy', () => fixture(async ({ request }) => {
  let initial = (await request('/api/settings')).body;
  for (const launchedAt of ['2026-10-20', '2026-10-20T21:28:15', '2026-02-30T12:00:00Z', '2025-02-29T12:00:00+08:00', '2026-10-20T24:00:00Z', '2026-10-20T12:60:00Z', '2026-10-20T12:00:60Z', '2026-10-20T12:00:00+14:30', '2026-10-20T12:00:00+08:60', '2026-10-20T12:00:00+15:00', 123]) {
    assert.equal((await request('/api/settings', 'PUT', { ...initial, launchedAt })).status, 400, String(launchedAt));
  }
  for (const fields of [{ aboutTitle: 123 }, { aboutBody: 'x'.repeat(6001) }, { contactTitle: 'x'.repeat(301) }, { contactEyebrow: null }]) {
    assert.equal((await request('/api/settings', 'PUT', { ...initial, ...fields })).status, 400, JSON.stringify(fields).slice(0, 100));
  }
  for (const launchedAt of ['2024-02-29T23:59:59Z', '2026-10-20T21:28:15.123+08:00', '2026-10-20T00:00:00-04:00', '2026-10-20T00:00:00+14:00']) {
    const result = await request('/api/settings', 'PUT', { ...initial, launchedAt });
    assert.equal(result.status, 200); assert.equal(result.body.launchedAt, launchedAt); initial = result.body;
  }
}));

test('About highlights migrate older settings, preserve order and survive older clients', () => fixture(async ({ request, dataDir }) => {
  const initial = (await request('/api/settings')).body;
  const legacy = { ...initial }; delete legacy.aboutHighlights; delete legacy.revision;
  await writeFile(join(dataDir, 'site.json'), JSON.stringify(legacy));
  const loaded = (await request('/api/settings')).body;
  assert.equal(loaded.aboutHighlights.length, 3);
  assert.ok(loaded.aboutHighlights.every(item => item.title.startsWith('Enter ') && item.url === ''));
  const aboutHighlights = [
    { label: 'TEACHING', title: '教学实践', description: '保留用户输入。\nSecond line.', period: '2025–2026', url: 'https://example.com/实践' },
    { label: '', title: 'Project milestone', description: '', period: '', url: '' },
  ];
  const expected = aboutHighlights.map(item => ({ ...item, url: item.url ? new URL(item.url).href : '' }));
  let saved = await request('/api/settings', 'PUT', { ...loaded, aboutHighlights });
  assert.equal(saved.status, 200); assert.deepEqual(saved.body.aboutHighlights, expected);
  assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'site.json'), 'utf8')).aboutHighlights, expected);
  const olderClient = { ...saved.body, name: 'Preserve achievements' }; delete olderClient.aboutHighlights;
  saved = await request('/api/settings', 'PUT', olderClient);
  assert.equal(saved.status, 200); assert.deepEqual(saved.body.aboutHighlights, expected);
  saved = await request('/api/settings', 'PUT', { ...saved.body, aboutHighlights: [...expected].reverse() });
  assert.equal(saved.status, 200); assert.deepEqual(saved.body.aboutHighlights, [...expected].reverse());
  saved = await request('/api/settings', 'PUT', { ...saved.body, aboutHighlights: [] });
  assert.equal(saved.status, 200); assert.deepEqual(saved.body.aboutHighlights, []);
  assert.deepEqual((await request('/api/settings')).body.aboutHighlights, []);
}));

test('About highlights reject malformed rows, oversized content and unsafe links without writing', () => fixture(async ({ request, dataDir }) => {
  const initial = (await request('/api/settings')).body;
  const item = { label: '', title: 'A milestone', description: '', period: '', url: '' };
  const invalid = [null, {}, 'items', [null], [[]], [{}], [{ ...item, title: '' }],
    Array.from({ length: 7 }, () => item), [{ ...item, title: 'x'.repeat(201) }], [{ ...item, label: 'x'.repeat(81) }],
    [{ ...item, description: 'x'.repeat(501) }], [{ ...item, period: 'x'.repeat(81) }], [{ ...item, url: 'https://example.com/' + 'x'.repeat(2000) }],
    [{ ...item, period: 2026 }], ...['javascript:alert(1)', '//example.com', '/blog/', 'file:///tmp/a', 'https://example.com/\npath'].map(url => [{ ...item, url }]),
  ];
  for (const aboutHighlights of invalid) {
    const result = await request('/api/settings', 'PUT', { ...initial, aboutHighlights });
    assert.equal(result.status, 400, JSON.stringify(aboutHighlights).slice(0, 100));
  }
  assert.deepEqual((await request('/api/settings')).body.aboutHighlights, initial.aboutHighlights);
  assert.equal((await readdir(dataDir)).includes('site.json'), false);
}));

test('dynamic categories and explicit drafts round-trip without restarting the server', () => fixture(async ({ request, dataDir }) => {
  const initial = (await request('/api/settings')).body;
  let settings = (await request('/api/settings', 'PUT', { ...initial, categories: [...initial.categories, { id: 'travel', label: '旅行手记', en: 'TRAVEL' }] })).body;
  assert.equal((await request('/api/session')).body.categories.at(-1).id, 'travel');
  let post = await request('/api/blog', 'POST', samplePost({ categoryId: 'travel', draft: true }));
  assert.equal(post.status, 201); assert.equal(post.body.draft, true);
  assert.match(await readFile(join(dataDir, 'blog/first-note.md'), 'utf8'), /draft: true/);
  const withoutDraft = { ...post.body, title: '草稿改名' }; delete withoutDraft.draft;
  post = await request('/api/blog/POST-001', 'PUT', withoutDraft);
  assert.equal(post.status, 200); assert.equal(post.body.draft, true);
  const removal = await request('/api/settings', 'PUT', { ...settings, categories: initial.categories });
  assert.equal(removal.status, 409); assert.match(removal.body.error, /草稿改名/);
  post = await request('/api/blog/POST-001', 'PUT', { ...post.body, categoryId: 'reading', draft: false });
  assert.equal(post.status, 200); assert.equal(post.body.draft, false);
  settings = await request('/api/settings', 'PUT', { ...settings, categories: initial.categories });
  assert.equal(settings.status, 200);
  assert.equal((await request('/api/blog', 'POST', samplePost({ id: 'POST-NEW', slug: 'new-category', categoryId: 'travel' }))).status, 400);
}));

test('legacy Markdown without a draft field remains published by default', () => fixture(async ({ request, dataDir }) => {
  await writeFile(join(dataDir, 'blog/legacy.md'), '---\nid: LEGACY\nslug: legacy\ntitle: 旧文\nsummary: 简介\ncategoryId: engineering\ndate: 2026-10-20\ntags: []\nreadTime: 2\ndemo: false\n---\n正文\n');
  const result = await request('/api/blog/LEGACY'); assert.equal(result.status, 200); assert.equal(result.body.draft, false);
}));

test('category reference protection includes nested Markdown drafts', () => fixture(async ({ request, dataDir }) => {
  await mkdir(join(dataDir, 'blog/2026'));
  await writeFile(join(dataDir, 'blog/2026/nested.md'), '---\nid: NESTED\nslug: nested\ntitle: 子目录草稿\nsummary: 简介\ncategoryId: engineering\ndate: 2026-10-20\ntags: []\nreadTime: 2\ndemo: false\ndraft: true\n---\n正文\n');
  const initial = (await request('/api/settings')).body;
  const result = await request('/api/settings', 'PUT', { ...initial, categories: initial.categories.filter(item => item.id !== 'engineering') });
  assert.equal(result.status, 409); assert.match(result.body.error, /子目录草稿/);
  const post = (await request('/api/blog/NESTED')).body;
  const updated = await request('/api/blog/NESTED', 'PUT', { ...post, title: '子目录更新' }); assert.equal(updated.status, 200);
  assert.match(await readFile(join(dataDir, 'blog/2026/nested.md'), 'utf8'), /子目录更新/);
}));

test('minimal handwritten Markdown is editable in place and preserves custom frontmatter', () => fixture(async ({ request, dataDir }) => {
  const initial = (await request('/api/settings')).body;
  assert.equal((await request('/api/settings', 'PUT', { ...initial, categories: [...initial.categories].reverse() })).status, 200);
  await mkdir(join(dataDir, 'blog/notes'));
  const path = join(dataDir, 'blog/notes/中文手记.md');
  await writeFile(path, '---\ntitle: 手写的文章\ndate: 2026-10-20\nauthor: 自己\ncustom:\n  featured: true\n  aliases: [first, second]\n---\n\n正文会自动产生摘要。\n');
  const list = await request('/api/blog');
  assert.equal(list.status, 200);
  const post = list.body[0];
  assert.equal(post.sourcePath, 'notes/中文手记.md');
  assert.equal(post.title, '手写的文章');
  assert.equal(post.categoryId, initial.categories.at(-1).id);
  assert.ok(post.id); assert.ok(post.slug); assert.ok(post.summary); assert.ok(post.readTime >= 1);
  assert.equal(post.draft, false); assert.equal(post.demo, false);
  assert.equal(Object.hasOwn(post, '_metadata'), false); assert.equal(Object.hasOwn(post, '_filename'), false);
  const saved = await request(`/api/blog/${post.id}`, 'PUT', { ...post, title: '后台更新的文章', body: post.body + '\n新增一段。', sourcePath: '../must-not-move.md' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.sourcePath, 'notes/中文手记.md');
  const raw = await readFile(path, 'utf8');
  const metadata = parse(/^---\n([\s\S]*?)\n---/.exec(raw)[1]);
  assert.equal(metadata.author, '自己');
  assert.deepEqual(metadata.custom, { featured: true, aliases: ['first', 'second'] });
  assert.equal(metadata.id, post.id); assert.equal(metadata.slug, post.slug);
  assert.equal(metadata.title, '后台更新的文章'); assert.match(raw, /新增一段/);
  assert.deepEqual(await readdir(join(dataDir, 'blog')), ['notes']);
  const reread = (await request(`/api/blog/${post.id}`)).body;
  assert.equal(reread.id, post.id); assert.equal(reread.sourcePath, post.sourcePath);
}));

test('Hiro-style aliases become canonical fields on CMS save without moving the source', () => fixture(async ({ request, dataDir }) => {
  await mkdir(join(dataDir, 'blog/imported'));
  const path = join(dataDir, 'blog/imported/hiro-note.md');
  await writeFile(path, '---\ntitle: 导入的 Hiro 文章\npubDate: 2026-10-20T23:30:00-07:00\ndescription: 原来的描述\nauthor: 博主\ncustom:\n  description: 自定义嵌套字段应保留\n---\n\n文章正文。\n');
  const listed = await request('/api/blog');
  assert.equal(listed.status, 200);
  const post = listed.body[0];
  assert.equal(post.sourcePath, 'imported/hiro-note.md');
  assert.equal(post.date, '2026-10-21');
  assert.equal(post.summary, '原来的描述');
  const saved = await request(`/api/blog/${post.id}`, 'PUT', { ...post, summary: '后台更新的摘要', date: '2026-10-22' });
  assert.equal(saved.status, 200); assert.equal(saved.body.sourcePath, post.sourcePath);
  const raw = await readFile(path, 'utf8');
  const metadata = parse(/^---\n([\s\S]*?)\n---/.exec(raw)[1]);
  assert.equal(metadata.date, '2026-10-22'); assert.equal(metadata.summary, '后台更新的摘要');
  assert.equal(Object.hasOwn(metadata, 'pubDate'), false);
  assert.equal(Object.hasOwn(metadata, 'description'), false);
  assert.equal(metadata.author, '博主');
  assert.deepEqual(metadata.custom, { description: '自定义嵌套字段应保留' });
  assert.deepEqual(await readdir(join(dataDir, 'blog/imported')), ['hiro-note.md']);
  const fresh = (await request(`/api/blog/${post.id}`)).body;
  assert.equal(fresh.date, metadata.date); assert.equal(fresh.summary, metadata.summary);
}));

test('CMS skips hidden paths, editor backups and non-lowercase Markdown extensions', () => fixture(async ({ request, dataDir }) => {
  const blog = join(dataDir, 'blog');
  for (const directory of ['.hidden', '~backup', 'nested']) await mkdir(join(blog, directory));
  for (const name of ['.hidden/bad.md', '~backup/bad.md', '.bad.md', '~bad.md', 'bad.md~', 'bad.md.tmp', 'bad.MD', 'nested/.bad.md']) {
    await writeFile(join(blog, name), 'invalid frontmatter should never be read');
  }
  const source = '---\ntitle: 正常文章\ndate: 2026-10-20\n---\n正文\n';
  await writeFile(join(blog, 'visible.md'), source);
  await writeFile(join(blog, 'nested/visible.md'), source);
  const result = await request('/api/blog');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.map(post => post.sourcePath).sort(), ['nested/visible.md', 'visible.md']);
}));

test('external Markdown changes cause revision conflicts and are returned by a fresh read', () => fixture(async ({ request, dataDir }) => {
  const original = (await request('/api/blog', 'POST', samplePost())).body;
  assert.equal(original.sourcePath, 'first-note.md');
  const path = join(dataDir, 'blog/first-note.md');
  const raw = (await readFile(path, 'utf8')).replace('第一篇文章', '外部编辑器修改');
  await writeFile(path, raw);
  const result = await request('/api/blog/POST-001', 'PUT', { ...original, title: '过期页面修改' });
  assert.equal(result.status, 409);
  assert.equal(await readFile(path, 'utf8'), raw);
  const fresh = (await request('/api/blog/POST-001')).body;
  assert.equal(fresh.title, '外部编辑器修改');
  assert.notEqual(fresh.revision, original.revision);
  assert.equal((await request('/api/blog/POST-001', 'PUT', { ...fresh, title: '合并后的修改' })).status, 200);
}));

test('externally duplicated IDs or slugs fail with both source paths before any CMS write', () => fixture(async ({ request, dataDir }) => {
  const pathA = join(dataDir, 'blog/a.md');
  const pathB = join(dataDir, 'blog/b.md');
  const source = (id, slug) => `---\nid: ${id}\nslug: ${slug}\ntitle: 外部文件\ndate: 2026-10-20\n---\n正文\n`;
  await writeFile(pathA, source('A', 'same'));
  await writeFile(pathB, source('B', 'same'));
  const duplicateSlug = await request('/api/blog');
  assert.equal(duplicateSlug.status, 422);
  assert.match(duplicateSlug.body.error, /a\.md/); assert.match(duplicateSlug.body.error, /b\.md/);
  assert.equal((await request('/api/blog', 'POST', samplePost())).status, 422);
  await writeFile(pathB, source('A', 'different'));
  const duplicateId = await request('/api/blog');
  assert.equal(duplicateId.status, 422);
  assert.match(duplicateId.body.error, /ID|id/);
  assert.deepEqual((await readdir(join(dataDir, 'blog'))).sort(), ['a.md', 'b.md']);
}));

test('external changes queue a second build and acknowledged CMS saves do not build twice', () => fixture(async ({ request, dataDir, directory }) => {
  const until = async condition => {
    for (let tries = 0; tries < 200; tries++) { if (await condition()) return; await setTimeout(20); }
    assert.fail('publication condition timed out');
  };
  const status = async () => (await request('/api/publish/status')).body;
  const runs = async () => {
    try { return (await readFile(join(directory, 'runs.log'), 'utf8')).trim().split('\n').filter(Boolean).length; }
    catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  };
  await until(async () => (await status()).watch.state === 'watching');
  assert.equal((await request('/api/session')).body.publish.watch.enabled, true);
  await writeFile(join(dataDir, 'blog/external.md'), '---\ntitle: 外部文章\ndate: 2026-10-20\n---\n正文\n');
  await until(async () => (await runs()) === 1);
  await writeFile(join(dataDir, 'friends.json'), '[]\n');
  await until(async () => (await status()).state === 'queued');
  await until(async () => (await runs()) === 2 && (await status()).state === 'published');
  assert.equal((await request('/api/blog', 'POST', samplePost())).status, 201);
  await until(async () => (await runs()) === 3 && (await status()).state === 'published');
  await setTimeout(200);
  assert.equal(await runs(), 3);
  const last = await status();
  assert.equal(last.watch.mode, 'poll'); assert.ok(last.watch.lastChangeAt); assert.equal(last.watch.error, null);
}, {
  watchIntervalMs: 20, watchDebounceMs: 60,
  publisher: `import { appendFile } from 'node:fs/promises';\nawait appendFile('runs.log', 'started\\n');\nawait new Promise(resolve => setTimeout(resolve, 220));\n`,
}));

test('friend and settings validation rejects unsafe URLs and invalid structural changes', () => fixture(async ({ request }) => {
  for (const changes of [{ url: 'javascript:alert(1)' }, { url: '//example.com' }, { url: 'https://name:secret@example.com/' }, { avatar: '/covers/../secret' }, { avatar: 'data:image/png,abc' }, { order: -1 }, { visible: 'true' }, { id: '../evil' }]) {
    assert.equal((await request('/api/friends', 'POST', sampleFriend(changes))).status, 400, JSON.stringify(changes));
  }
  const initial = (await request('/api/settings')).body;
  for (const changes of [{ url: '/relative' }, { github: 'javascript:alert(1)' }, { logo: '//example.com/image.png' }, { favicon: '' }, { email: 'wrong' }, { defaultTheme: 'pink' }, { showRSS: 'false' }, { categories: [] }, { categories: [...initial.categories, initial.categories[0]] }, { navigation: [initial.navigation[0]] }, { navigation: initial.navigation.map(() => initial.navigation[0]) }]) {
    assert.equal((await request('/api/settings', 'PUT', { ...initial, ...changes })).status, 400, JSON.stringify(changes));
  }
  assert.equal((await request('/api/blog', 'POST', samplePost({ draft: 'true' }))).status, 400);
}));

test('settings and friend writes share the controlled publication queue', () => fixture(async ({ request, directory }) => {
  const initial = (await request('/api/settings')).body;
  assert.equal((await request('/api/settings', 'PUT', { ...initial, name: '发布设置' })).status, 200);
  await setTimeout(30);
  assert.equal((await request('/api/friends', 'POST', sampleFriend())).status, 201);
  let status;
  for (let tries = 0; tries < 60; tries++) {
    await setTimeout(25); status = (await request('/api/publish/status')).body;
    if (status.state === 'published') break;
  }
  assert.equal(status.state, 'published');
  assert.equal((await readFile(join(directory, 'runs.log'), 'utf8')).split('\n').filter(Boolean).length, 2);
}, { publisher: `import { appendFile } from 'node:fs/promises';\nawait new Promise(resolve => setTimeout(resolve, 140));\nawait appendFile('runs.log', 'published\\n');\n` }));
