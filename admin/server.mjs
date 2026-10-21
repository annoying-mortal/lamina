import http from 'node:http';
import { readFile, readdir, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { stringify } from 'yaml';
import { normalizeImageUrl } from '../lib/image-url.mjs';
import { parsePostSource, assertUniquePosts, isPostFile } from '../lib/posts.mjs';
import { homeSettings, ABOUT_HIGHLIGHT_LIMIT } from '../lib/home-settings.mjs';
import { librarySettings, normalizeLibraryTypeId } from '../lib/library-settings.mjs';
import { createMediaStore } from './media.mjs';
import { createAuth } from './auth.mjs';
import { createContentWatch } from './content-watch.mjs';
import { createBackupStore, readBackupBody } from './backup.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const assetFiles = new Map([
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/account.js', ['account.js', 'text/javascript; charset=utf-8']],
  ['/backup.js', ['backup.js', 'text/javascript; charset=utf-8']],
  ['/ui.js', ['ui.js', 'text/javascript; charset=utf-8']],
  ['/media.js', ['media.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/login.js', ['login.js', 'text/javascript; charset=utf-8']],
  ['/login.css', ['login.css', 'text/css; charset=utf-8']],
  ['/theme.js', ['theme.js', 'text/javascript; charset=utf-8']],
  ['/i18n.js', ['i18n.js', 'text/javascript; charset=utf-8']],
  ['/settings-preview.js', ['settings-preview.js', 'text/javascript; charset=utf-8']],
]);
const displayFontPaths = new Set([
  '/fonts/chogokuboso-gothic/chogokuboso-gothic.woff2',
  '/fonts/geom/geom.woff2',
  '/fonts/alimama-fangyuan/alimama-fangyuan.woff2',
  '/fonts/michroma/michroma.woff2', '/fonts/montserrat/montserrat.woff2',
  '/fonts/oxanium/oxanium.woff2', '/fonts/syncopate/syncopate-regular.woff2',
  '/fonts/syncopate/syncopate-bold.woff2',
]);
const fontStylePaths = new Set([
  '/fonts.css', '/typography.css', '/fonts/alimama-fangyuan/fonts.css',
  '/fonts/lxgw-wenkai/fonts.css', '/fonts/jetbrains-mono/fonts.css',
]);
const fontDocs = new Map([['/fonts/NOTICE.txt', 'text/plain; charset=utf-8'], ['/fonts/MiSans-license.pdf', 'application/pdf'], ['/fonts/misans-webfont-4.3.1/source.json', 'application/json; charset=utf-8'], ['/fonts/misans-webfont-4.3.1/UPSTREAM-README.md', 'text/plain; charset=utf-8']]);
const revision = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex').slice(0, 24);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const assert = (condition, message, status = 400) => { if (!condition) fail(status, message); };
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value, name = 'ID') => {
  assert(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value), `${name} 只能使用字母、数字、连字符或下划线，最长 80 字。`);
  return value;
};
function string(value, name, max, required = true) {
  assert(typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0), `${name}${required ? '不能为空，且' : ''}不能超过 ${max} 字。`);
  return value.trim();
}
function date(value) {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), '日期应为 YYYY-MM-DD。');
  const parsed = new Date(`${value}T00:00:00Z`);
  assert(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, '请输入有效日期。');
  return value;
}
function launchDate(value) {
  const text = string(value ?? '', '运行计时起点', 40, false);
  if (!text) return '';
  assert(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(text), '运行计时起点应为含时区的 ISO 时间，例如 2026-10-20T21:28:15+08:00；留空则不显示计时。');
  date(text.slice(0, 10));
  assert(!/[+-]14:(?!00)/.test(text) && Number.isFinite(Date.parse(text)), '请输入有效的运行计时起点与时区。');
  return text;
}
function tags(value) {
  assert(Array.isArray(value) && value.length <= 20, '标签最多 20 个。');
  return [...new Set(value.map(tag => string(tag, '标签', 40)))];
}
function boolean(value, fallback = false, name = '示例标记') {
  assert(value === undefined || typeof value === 'boolean', `${name}必须为布尔值。`);
  return value ?? fallback;
}
function imageUrl(value, name, allowEmpty = true) {
  const text = string(value ?? '', name, 4000, !allowEmpty);
  try { return normalizeImageUrl(text, { allowEmpty }); }
  catch (error) { fail(400, `${name}：${error.message}`); }
}
function httpUrl(value, name, allowEmpty = false) {
  const text = string(value ?? '', name, 4000, !allowEmpty);
  assert(!text || /^https?:\/\//i.test(text), `${name}应为完整的 HTTP 或 HTTPS 地址。`);
  return imageUrl(text, name, allowEmpty);
}
function validSettings(value) {
  assert(isObject(value), '站点设置格式不正确。');
  const navigationIds = ['home', 'blog', 'library', 'friends'];
  assert(Array.isArray(value.navigation) && value.navigation.length === navigationIds.length, '导航需包含 Home、Blog、Library、Friends 四项，可调整顺序或隐藏。');
  const navigation = value.navigation.map(item => {
    assert(isObject(item) && navigationIds.includes(item.id), '导航 ID 不正确。');
    return { id: item.id, label: string(item.label, '导航名称', 40), visible: boolean(item.visible, true, '导航可见性') };
  });
  assert(new Set(navigation.map(item => item.id)).size === navigationIds.length, '导航 ID 不能重复。');
  assert(Array.isArray(value.categories) && value.categories.length >= 1 && value.categories.length <= 30, '文章分类需保留 1–30 个。');
  const categories = value.categories.map(item => {
    assert(isObject(item), '分类格式不正确。');
    const id = string(item.id, '分类 ID', 60);
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id), '分类 ID 只接受小写字母、数字及中间的连字符。');
    return { id, label: string(item.label, '分类名称', 60), en: string(item.en ?? '', '分类英文名称', 100, false) };
  });
  assert(new Set(categories.map(item => item.id)).size === categories.length, '分类 ID 不能重复。');
  assert(Array.isArray(value.libraryTypes) && value.libraryTypes.length >= 1 && value.libraryTypes.length <= 30, 'Library must contain 1–30 categories.');
  const libraryTypes = value.libraryTypes.map(item => {
    assert(isObject(item), 'Each Library category must be an object.');
    const id = string(item.id, 'Library category ID', 60);
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id), 'Library category IDs may contain lowercase letters, digits and internal hyphens.');
    assert(normalizeLibraryTypeId(id) === id, `Library category ID "${id}" is reserved for legacy content; use "${normalizeLibraryTypeId(id)}" instead.`);
    return { id, label: string(item.label, 'Library category name', 60), en: string(item.en ?? '', 'Library category English name', 100, false) };
  });
  assert(new Set(libraryTypes.map(item => item.id)).size === libraryTypes.length, 'Library category IDs must be unique.');
  assert(libraryTypes.some(item => item.id !== 'all'), 'Keep at least one Library category besides All.');
  assert(isObject(value.pages), '页面设置格式不正确。');
  const pages = {};
  for (const id of ['blog', 'library', 'friends']) {
    const page = value.pages[id];
    assert(isObject(page), `缺少 ${id} 页面设置。`);
    pages[id] = { title: string(page.title, '页面标题', 160), eyebrow: string(page.eyebrow ?? '', '页面眉题', 200, false), description: string(page.description ?? '', '页面介绍', 2000, false) };
  }
  const email = string(value.email ?? '', '电子邮箱', 254, false);
  assert(email === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), '电子邮箱格式不正确。');
  assert(['system', 'light', 'dark'].includes(value.defaultTheme), '默认主题应为 system、light 或 dark。');
  const home = { ...homeSettings(value), ...value };
  assert(Array.isArray(home.aboutHighlights) && home.aboutHighlights.length <= ABOUT_HIGHLIGHT_LIMIT, `About highlights must contain no more than ${ABOUT_HIGHLIGHT_LIMIT} items.`);
  const aboutHighlights = home.aboutHighlights.map(item => {
    assert(isObject(item), 'Each About highlight must be an object.');
    return {
      label: string(item.label ?? '', 'Highlight label', 80, false),
      title: string(item.title, 'Highlight title', 200),
      description: string(item.description ?? '', 'Highlight description', 500, false),
      period: string(item.period ?? '', 'Highlight period', 80, false),
      url: httpUrl(string(item.url ?? '', 'Highlight URL', 2000, false), 'Highlight URL', true),
    };
  });
  return {
    name: string(value.name, '站点名称', 100), title: string(value.title, '浏览器标题', 200), description: string(value.description, '站点描述', 2000),
    url: httpUrl(value.url, '站点地址', true), tagline: string(value.tagline ?? '', '首页标语', 1000, false), intro: string(value.intro ?? '', '首页介绍', 4000, false),
    eyebrow: string(value.eyebrow ?? '', '首页眉题', 200, false), footerNote: string(value.footerNote ?? '', '页脚文字', 500, false), footerLabel: string(value.footerLabel ?? '', '页脚标签', 100, false),
    github: httpUrl(value.github, 'GitHub 地址', true), email,
    logo: imageUrl(value.logo, '站点 Logo'), favicon: imageUrl(value.favicon, '浏览器图标', false), orbitImage: imageUrl(value.orbitImage, '圆环图片'),
    defaultTheme: value.defaultTheme, showRSS: boolean(value.showRSS, true, 'RSS 开关'), demo: boolean(value.demo),
    archiveSubtitle: string(value.archiveSubtitle ?? '', '档案副标题', 160, false), archiveTitle: string(value.archiveTitle ?? '', '档案标题', 160, false),
    homeEdition: string(value.homeEdition ?? '', '首页版本文字', 200, false), navigation, pages, categories, libraryTypes,
    aboutEyebrow: string(home.aboutEyebrow, '个人介绍上方小字', 200, false), aboutTitle: string(home.aboutTitle, '个人介绍标题', 300, false), aboutBody: string(home.aboutBody, '个人介绍正文', 6000, false),
    aboutHighlights,
    contactEyebrow: string(home.contactEyebrow, '联系页上方小字', 200, false), contactTitle: string(home.contactTitle, '联系页标题', 300, false), contactBody: string(home.contactBody, '联系页正文', 4000, false),
    launchedAt: launchDate(value.launchedAt),
  };
}
function validFriend(value) {
  assert(isObject(value), '友链格式不正确。');
  assert(Number.isInteger(value.order) && value.order >= 0 && value.order <= 999999, '排序应为 0–999999 的整数。');
  return {
    id: identifier(value.id), name: string(value.name, '网站名称', 200), url: httpUrl(value.url, '网站地址'),
    avatar: imageUrl(value.avatar, '友链头像'), initials: string(value.initials ?? '', '文字头像', 12, false),
    description: string(value.description ?? '', '网站介绍', 2000, false), label: string(value.label ?? '', '标签', 100, false),
    kind: string(value.kind ?? '', '友链类型', 60, false), order: value.order,
    visible: boolean(value.visible, true, '友链可见性'), demo: boolean(value.demo),
  };
}
function validPost(value, categories, draftDefault = false) {
  assert(isObject(value), '文章内容格式不正确。');
  const id = identifier(value.id);
  const slug = string(value.slug, '文章网址', 100);
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug), '文章网址只接受小写字母、数字及中间的连字符。');
  assert(categories.some(item => item.id === value.categoryId), '请选择有效分类。');
  assert(Number.isInteger(value.readTime) && value.readTime > 0 && value.readTime <= 999, '阅读时长应为 1–999 分钟。');
  assert(typeof value.body === 'string' && value.body.trim().length && value.body.length <= 300000, 'Markdown 正文不能为空，最长 300,000 字。');
  return {
    id, slug, title: string(value.title, '标题', 200), summary: string(value.summary, '摘要', 1000),
    categoryId: value.categoryId, date: date(value.date), tags: tags(value.tags), readTime: value.readTime,
    demo: boolean(value.demo), draft: boolean(value.draft, draftDefault, '草稿标记'), body: value.body.replace(/\r\n/g, '\n'),
  };
}
function validLibrary(value, libraryTypes) {
  assert(isObject(value), '收藏内容格式不正确。');
  const type = libraryTypes.find(item => item.id !== 'all' && item.id === normalizeLibraryTypeId(value.type));
  assert(type, 'Select a configured Library category. All is an aggregate tab and cannot be assigned to an item.');
  const cover = imageUrl(value.cover, '封面地址');
  const article = value.article || null;
  assert(article === null || (typeof article === 'string' && /^\/blog\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(article)), '关联文章应为 /blog/article-slug/ 格式。');
  const rating = string(value.rating ?? '', '评分', 4, false);
  assert(rating === '' || (/^(?:\d(?:\.\d)?|10(?:\.0)?)$/.test(rating)), '评分应为 0–10，可留空。');
  return {
    id: identifier(value.id), title: string(value.title, '作品名称', 200), original: string(value.original ?? '', '原名', 200, false),
    type: type.id, typeLabel: string(value.typeLabel || type.label, '类型名称', 60), creator: string(value.creator ?? '', '创作者', 200, false),
    date: date(value.date), rating, cover, note: string(value.note ?? '', '短评', 1000, false),
    detail: string(value.detail ?? '', '详细记录', 20000, false), article, tags: tags(value.tags), demo: boolean(value.demo),
  };
}
async function atomicWrite(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${randomBytes(12).toString('hex')}.tmp`);
  try { await writeFile(temp, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); await rename(temp, path); }
  finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function bodyJson(req) {
  assert(req.headers['content-type']?.split(';')[0] === 'application/json', '请使用 JSON 请求内容。', 415);
  const buffers = []; let length = 0;
  await new Promise((resolve, reject) => {
    let settled = false;
    req.on('data', chunk => {
      if (settled) return;
      length += chunk.length;
      if (length > 1024 * 1024) { settled = true; reject(Object.assign(new Error('请求内容过大，最多 1 MiB。'), { status: 413 })); return; }
      buffers.push(chunk);
    });
    req.on('end', () => { if (!settled) { settled = true; resolve(); } });
    req.on('error', error => { if (!settled) { settled = true; reject(error); } });
  });
  try { return JSON.parse(Buffer.concat(buffers).toString('utf8')); }
  catch { fail(400, 'JSON 格式不正确。'); }
}

/** A local CMS. dataDir may point to a temporary fixture for tests. */
export function createServer(options = {}) {
  const projectRoot = resolve(options.projectRoot || join(here, '..'));
  const authOptions = isObject(options.auth) ? options.auth : {};
  const auth = options.auth === false ? null : createAuth({
    ...authOptions,
    authDir: options.authDir || process.env.ADMIN_AUTH_DIR || join(projectRoot, '.admin'),
    secureCookies: authOptions.secureCookies ?? process.env.ADMIN_SECURE_COOKIES === '1',
    loopbackPublished: authOptions.loopbackPublished ?? process.env.ADMIN_LOOPBACK_PUBLISHED === '1',
    allowRemoteSetup: authOptions.allowRemoteSetup ?? process.env.ADMIN_ALLOW_REMOTE_SETUP === '1',
  });
  const dataDir = resolve(options.dataDir || join(projectRoot, 'src/content'));
  const blogDir = join(dataDir, 'blog');
  const libraryPath = join(dataDir, 'library.json');
  const friendsPath = join(dataDir, 'friends.json');
  const settingsPath = join(dataDir, 'site.json');
  const uploadsDir = resolve(options.mediaDir || process.env.SITE_UPLOADS_DIR || join(projectRoot, 'public/uploads'));
  const media = createMediaStore({ projectRoot, mediaDir: uploadsDir, mediaIndexPath: join(dataDir, 'media.json') });
  const siteUrl = options.siteUrl || process.env.ADMIN_SITE_URL || process.env.SITE_URL || 'http://127.0.0.1:4321';
  const autoPublish = options.autoPublish ?? process.env.ADMIN_AUTO_PUBLISH === '1';
  const token = randomBytes(32).toString('hex');
  const configuredHosts = options.allowedHosts || (process.env.ADMIN_ALLOWED_HOSTS || '').split(',').filter(Boolean);
  const publish = { enabled: autoPublish, state: 'idle', requestedAt: null, finishedAt: null, error: null, output: '' };
  let mutationQueue = Promise.resolve();
  let publishing = false;
  let publishAgain = false;
  let publishChild = null;
  let restoring = false;
  const publishRoot = resolve(process.env.SITE_PUBLISH_ROOT || join(projectRoot, '.published'));
  const restorePublishToken = randomBytes(32).toString('hex');
  let closed = false;
  const serialize = action => {
    const task = mutationQueue.then(action);
    mutationQueue = task.catch(() => {});
    return task;
  };
  async function readPosts() {
    await mkdir(blogDir, { recursive: true });
    const settings = await readSettings();
    const defaultCategoryId = settings.categories[0]?.id || 'engineering';
    const files = [];
    async function collect(directory = '') {
      for (const entry of await readdir(join(blogDir, directory), { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name.startsWith('~')) continue;
        const filename = join(directory, entry.name);
        if (entry.isDirectory()) await collect(filename);
        else if (entry.isFile() && isPostFile(filename)) files.push(filename);
      }
    }
    await collect();
    const records = await Promise.all(files.map(async filename => {
      const raw = await readFile(join(blogDir, filename), 'utf8');
      const { post, metadata } = parsePostSource(raw, { filename, defaultCategoryId });
      return { ...post, revision: revision(raw), _filename: filename, _metadata: metadata };
    }));
    assertUniquePosts(records);
    return records.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  }
  const publicPost = ({ _filename, _metadata, ...post }) => ({ ...post, sourcePath: _filename.replaceAll('\\', '/') });
  async function readArray(path, label) {
    let raw;
    try { raw = await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    let value;
    try { value = JSON.parse(raw); } catch { fail(422, `${label} 格式不正确，请先修复文件。`); }
    assert(Array.isArray(value), `${label} 必须是一个数组。`, 422);
    return value;
  }
  const readLibrary = async () => (await readArray(libraryPath, 'library.json')).map(item => ({ ...item, type: normalizeLibraryTypeId(item.type) }));
  const readFriends = () => readArray(friendsPath, 'friends.json');
  async function readSettings() {
    let raw;
    try { raw = await readFile(settingsPath, 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // Temporary fixtures and pre-settings content volumes inherit the checked-in seed.
      raw = await readFile(join(here, '../src/content/site.json'), 'utf8');
    }
    let value;
    try { value = JSON.parse(raw); } catch { fail(422, 'site.json 格式不正确，请先修复文件。'); }
    assert(isObject(value) && Array.isArray(value.categories), 'site.json 必须包含站点设置和分类数组。', 422);
    return { ...value, ...homeSettings(value), ...librarySettings(value) };
  }
  const publicItem = item => ({ ...item, revision: revision(item) });
  function requestPublish() {
    if (!autoPublish || closed) return;
    if (restoring) { publishAgain = true; return; }
    if (publishing) { publishAgain = true; publish.state = 'queued'; return; }
    publishing = true;
    publish.state = 'building'; publish.requestedAt = new Date().toISOString(); publish.error = null; publish.output = '';
    const child = spawn(process.execPath, [join(projectRoot, 'scripts/publish.mjs')], {
      cwd: projectRoot, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    publishChild = child;
    const append = chunk => { publish.output = (publish.output + chunk.toString()).slice(-8000); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    let completed = false;
    const finish = (code, error) => {
      if (completed) return; completed = true;
      publishing = false; publishChild = null; publish.finishedAt = new Date().toISOString();
      publish.state = code === 0 ? 'published' : 'failed';
      publish.error = code === 0 ? null : error?.message || `构建退出码 ${code}；已保存的内容仍在，线上版本保留。`;
      if (publishAgain) { publishAgain = false; requestPublish(); }
    };
    child.on('error', error => finish(1, error));
    child.on('close', code => finish(code));
  }
  const contentWatch = createContentWatch({
    contentDir: dataDir, uploadsDir,
    enabled: autoPublish && (options.watchContent ?? process.env.ADMIN_WATCH_CONTENT !== '0'),
    intervalMs: options.watchIntervalMs ?? 1000, debounceMs: options.watchDebounceMs ?? 1500,
    onChange: () => requestPublish(),
  });
  publish.watch = contentWatch.status;
  const backups = createBackupStore({
    projectRoot, dataDir, uploadsDir, siteUrl, readSettings,
    backupDir: options.backupDir || join(options.authDir || process.env.ADMIN_AUTH_DIR || join(projectRoot, '.admin'), 'backups'),
    validators: {
      settings: value => validSettings({ ...value, ...homeSettings(value), ...librarySettings(value) }),
      library: validLibrary, friend: validFriend, post: validPost,
    },
    acknowledge: (path, bytes) => contentWatch.acknowledge(path, bytes),
    beforeWrite: options.backupBeforeWrite,
    now: options.backupNow,
  });
  async function writeContent(path, raw) {
    await atomicWrite(path, raw);
    contentWatch.acknowledge(path, raw);
  }
  function validateAccess(req) {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 4322;
    const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, ...configuredHosts]);
    assert(hosts.has(req.headers.host), '此后台只接受已配置的本机 Host。', 403);
    const origin = req.headers.origin;
    if (origin) assert(origin === `http://${req.headers.host}` || (configuredHosts.includes(req.headers.host) && origin === `https://${req.headers.host}`), '来源校验未通过。', 403);
    assert(!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']), '禁止跨站访问后台。', 403);
    if (!['GET', 'HEAD'].includes(req.method)) {
      assert(origin, '修改请求必须提供同源 Origin。', 403);
      if (!auth) {
        const supplied = req.headers['x-csrf-token'];
        assert(typeof supplied === 'string' && /^[a-f0-9]{64}$/.test(supplied) && timingSafeEqual(Buffer.from(supplied), Buffer.from(token)), '安全令牌已失效，请刷新后台后重试。', 403);
      }
    }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' http: https: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      validateAccess(req);
      const pathname = new URL(req.url, 'http://local.invalid').pathname;
      if (req.method === 'GET' && pathname === '/healthz') { json(200, { status: 'ok' }); return; }
      if (req.method === 'GET' && pathname === '/api/auth/status') {
        const state = auth ? await auth.status(req, res) : { configured: true, authenticated: true, csrf: token };
        let settings;
        try { settings = await readSettings(); } catch { settings = {}; }
        let logo = ''; try { logo = normalizeImageUrl(settings.logo || ''); } catch {}
        let orbitImage = ''; try { orbitImage = normalizeImageUrl(settings.orbitImage || ''); } catch {}
        json(200, { ...state, name: settings.name || 'Enter site name', defaultTheme: settings.defaultTheme || 'system', archiveTitle: settings.archiveTitle || 'Enter archive title', siteUrl, logo, orbitImage }); return;
      }
      if (pathname.startsWith('/api/auth/')) {
        assert(auth, '测试模式下不提供鉴权操作。', 409);
        assert(req.method === 'POST', '此地址仅支持 POST。', 405);
        const action = pathname.slice('/api/auth/'.length);
        assert(['setup', 'login', 'logout'].includes(action), '未找到这个地址。', 404);
        if (action === 'logout') { json(200, await auth.logout(req, res)); return; }
        const input = await bodyJson(req);
        json(200, await auth[action](req, res, input)); return;
      }
      if (req.method === 'GET' && ['/', '/login', '/login/'].includes(pathname)) {
        const file = !auth || auth.session(req, res) ? 'index.html' : 'login.html';
        const content = await readFile(join(here, 'public', file));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(content); return;
      }
      if (req.method === 'GET' && assetFiles.has(pathname)) {
        const [file, contentType] = assetFiles.get(pathname);
        res.writeHead(200, { 'Content-Type': contentType }); res.end(await readFile(join(here, 'public', file))); return;
      }
      const font = /^\/fonts\/misans-webfont-4\.3\.1\/(light|regular|demibold|bold)\/(\d{1,3})\.woff2$/.exec(pathname);
      // Login and CMS previews share these fonts; expose runtime assets only,
      // including the complete WenKai partition (000–093 for each weight).
      const readingFont = /^\/fonts\/lxgw-wenkai\/(light|regular|medium)\/0(?:[0-8]\d|9[0-3])\.woff2$/.test(pathname);
      const displayFont = displayFontPaths.has(pathname) || /^\/fonts\/jetbrains-mono\/jetbrains-mono-(400|500|600|700)-(normal|italic)\.woff2$/.test(pathname);
      const fontStyle = fontStylePaths.has(pathname);
      if (req.method === 'GET' && (fontStyle || displayFont || readingFont || (font && Number(font[2]) <= 188) || fontDocs.has(pathname))) {
        let content;
        try { content = await readFile(join(projectRoot, 'public', pathname.slice(1))); }
        catch (error) { if (error.code === 'ENOENT') fail(404, '字体资源不存在。'); throw error; }
        const type = fontStyle ? 'text/css; charset=utf-8' : font || displayFont || readingFont ? 'font/woff2' : fontDocs.get(pathname);
        if (font) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        if (displayFont || readingFont) res.setHeader('Cache-Control', 'public, max-age=3600');
        res.writeHead(200, { 'Content-Type': type }); res.end(content); return;
      }
      const session = auth ? auth.requireSession(req, res) : { csrf: token };
      if (auth && !['GET', 'HEAD'].includes(req.method)) auth.requireCsrf(req, session);
      const runAuthorized = action => auth ? auth.withSession(req, res, action) : action();
      if (pathname === '/api/account') {
        assert(auth, '测试模式下不提供账号设置。', 409);
        if (req.method === 'GET') { json(200, auth.account(req, res)); return; }
        assert(req.method === 'PUT', '账号设置仅支持读取和更新。', 405);
        const input = await bodyJson(req);
        assert(isObject(input), '请求内容必须是一个 JSON 对象。');
        json(200, await auth.updateAccount(req, res, input)); return;
      }
      if (pathname.startsWith('/api/backup/')) {
        if (req.method === 'GET' && pathname === '/api/backup/export') {
          const result = await serialize(async () => {
            if (auth) auth.requireSession(req, res);
            const archive = await backups.export();
            if (auth) auth.requireSession(req, res);
            return archive;
          });
          res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${result.filename}"`, 'Content-Length': result.bytes.length, 'X-Backup-Warnings': result.warnings.length }); res.end(result.bytes); return;
        }
        if (req.method === 'POST' && pathname === '/api/backup/inspect') {
          const bytes = await readBackupBody(req);
          let filename = req.headers['x-file-name'] || ''; try { filename = decodeURIComponent(filename); } catch { fail(400, 'Invalid backup filename encoding.'); }
          json(200, await serialize(() => runAuthorized(() => backups.inspect(bytes, session.csrf, filename)))); return;
        }
        if (req.method === 'POST' && pathname === '/api/backup/restore') {
          const input = await bodyJson(req);
          assert(isObject(input) && typeof input.token === 'string' && /^[a-f0-9]{64}$/.test(input.token), 'Upload and inspect a backup before restoring.');
          const result = await serialize(() => backups.restore(input.token, session.csrf, {
            authorize: runAuthorized,
            begin: async () => {
              assert(!publishing, 'A publish is running. Wait for it to finish, then inspect the backup again.', 409);
              restoring = true;
              try {
                // The standalone publisher uses the same lock, preventing a CLI
                // publish from reading a restore between individual file renames.
                await mkdir(publishRoot, { recursive: true });
                try { await writeFile(join(publishRoot, '.publish-lock'), JSON.stringify({ pid: process.pid, token: restorePublishToken, operation: 'restore' }), { flag: 'wx', mode: 0o600 }); }
                catch (error) { if (error.code === 'EEXIST') fail(409, 'A publish lock is active. Finish publishing, then inspect the backup again.'); throw error; }
                await contentWatch.pause();
              } catch (error) {
                try { if (JSON.parse(await readFile(join(publishRoot, '.publish-lock'), 'utf8')).token === restorePublishToken) await unlink(join(publishRoot, '.publish-lock')); } catch {}
                restoring = false; contentWatch.resume(); throw error;
              }
            },
            end: async () => {
              try { if (JSON.parse(await readFile(join(publishRoot, '.publish-lock'), 'utf8')).token === restorePublishToken) await unlink(join(publishRoot, '.publish-lock')); }
              finally { restoring = false; contentWatch.resume(); }
            },
          }));
          publishAgain = false; requestPublish(); json(200, { ...result, publish }); return;
        }
        fail(405, 'Unsupported backup request.');
      }
      if (req.method === 'GET' && (pathname === '/api/media' || pathname.startsWith('/uploads/'))) await mutationQueue;
      if (await media.handle(req, res, pathname, action => serialize(() => runAuthorized(action)))) return;
      if (req.method === 'GET' && pathname === '/api/session') { await mutationQueue; const settings = await readSettings(); json(200, { csrf: session.csrf, authEnabled: Boolean(auth), ...(auth ? { username: session.username } : {}), categories: settings.categories, libraryTypes: settings.libraryTypes.filter(item => item.id !== 'all'), siteUrl, publish }); return; }
      if (req.method === 'GET' && pathname === '/api/publish/status') { json(200, publish); return; }
      if (req.method === 'POST' && pathname === '/api/publish') {
        assert(autoPublish, '本地开发模式保存后自动热更新，无需发布。', 409);
        await runAuthorized(() => requestPublish()); json(202, publish); return;
      }
      if (pathname === '/api/settings') {
        if (req.method === 'GET') { await mutationQueue; json(200, publicItem(await readSettings())); return; }
        assert(req.method === 'PUT', '站点设置仅支持读取和更新。', 405);
        const input = await bodyJson(req);
        assert(isObject(input), '请求内容必须是一个 JSON 对象。');
        const result = await serialize(() => runAuthorized(async () => {
          const previous = await readSettings();
          assert(input.revision === revision(previous), '站点设置已被其它窗口修改，请重新载入后再保存。', 409);
          const settings = { ...previous, ...validSettings({ ...homeSettings(previous), ...librarySettings(previous), ...input }) };
          const remaining = new Set(settings.categories.map(item => item.id));
          const blocked = (await readPosts()).filter(post => !remaining.has(post.categoryId));
          assert(!blocked.length, `无法移除正在使用的分类，请先移动这些文章（含草稿）：${blocked.slice(0, 5).map(post => post.title).join('、')}${blocked.length > 5 ? '…' : ''}。`, 409);
          const remainingLibrary = new Set(settings.libraryTypes.filter(item => item.id !== 'all').map(item => item.id));
          const blockedLibrary = (await readLibrary()).filter(item => !remainingLibrary.has(item.type));
          assert(!blockedLibrary.length, `Cannot remove a Library category that contains items. Move or delete these items first: ${blockedLibrary.slice(0, 5).map(item => item.title).join(', ')}${blockedLibrary.length > 5 ? '…' : ''}.`, 409);
          await writeContent(settingsPath, JSON.stringify(settings, null, 2) + '\n');
          return publicItem(settings);
        }));
        requestPublish(); json(200, result); return;
      }
      const match = /^\/api\/(blog|library|friends)(?:\/([^/]+))?$/.exec(pathname);
      assert(match, '未找到这个地址。', 404);
      const [, kind, rawId] = match;
      let id;
      if (rawId) { try { id = decodeURIComponent(rawId); } catch { fail(400, 'ID 编码不正确。'); } identifier(id); }
      if (req.method === 'GET') {
        await mutationQueue;
        const records = kind === 'blog' ? (await readPosts()).map(publicPost) : (await (kind === 'friends' ? readFriends() : readLibrary())).map(publicItem);
        if (!id) json(200, records);
        else { const record = records.find(item => item.id === id); assert(record, '记录不存在，可能已被删除。', 404); json(200, record); }
        return;
      }
      assert(['POST', 'PUT', 'DELETE'].includes(req.method), '此地址不支持这个请求方法。', 405);
      assert((req.method === 'POST' && !id) || (req.method !== 'POST' && id), '请求地址不正确。', 405);
      const input = await bodyJson(req);
      assert(isObject(input), '请求内容必须是一个 JSON 对象。');
      const result = await serialize(() => runAuthorized(async () => {
        if (kind === 'blog') {
          const posts = await readPosts();
          const existing = posts.find(post => post.id === id);
          if (id) { assert(existing, '文章不存在，可能已被删除。', 404); assert(input.revision === existing.revision, '文章已被其它窗口修改，请重新载入后再保存。', 409); }
          if (req.method === 'DELETE') {
            const path = join(blogDir, existing._filename);
            await unlink(path); contentWatch.acknowledge(path, null); return { deleted: id };
          }
          const settings = await readSettings();
          const post = validPost(input, settings.categories, existing?.draft ?? false);
          if (id) assert(post.id === id, '已有文章的 ID 不能修改。');
          assert(!posts.some(item => item.id === post.id && item.id !== id), '这个文章 ID 已存在。', 409);
          assert(!posts.some(item => item.slug === post.slug && item.id !== id), '这个文章网址已存在。', 409);
          const filename = existing?._filename || `${post.slug}.md`;
          assert(existing || !posts.some(item => item._filename === filename), '同名文章文件已存在。', 409);
          const { body, ...knownMetadata } = post;
          const metadata = { ...existing?._metadata, ...knownMetadata };
          delete metadata.pubDate;
          delete metadata.description;
          const raw = `---\n${stringify(metadata, { lineWidth: 0 })}---\n\n${body.trim()}\n`;
          await writeContent(join(blogDir, filename), raw);
          return { ...post, body: body.trim() + '\n', revision: revision(raw), sourcePath: filename.replaceAll('\\', '/') };
        }
        const items = await (kind === 'friends' ? readFriends() : readLibrary());
        const path = kind === 'friends' ? friendsPath : libraryPath;
        const label = kind === 'friends' ? '友链' : '收藏';
        const index = items.findIndex(item => item.id === id);
        if (id) { assert(index >= 0, `${label}不存在，可能已被删除。`, 404); assert(input.revision === revision(items[index]), `${label}已被其它窗口修改，请重新载入后再保存。`, 409); }
        if (req.method === 'DELETE') { items.splice(index, 1); await writeContent(path, JSON.stringify(items, null, 2) + '\n'); return { deleted: id }; }
        const item = kind === 'friends' ? validFriend(input) : validLibrary(input, (await readSettings()).libraryTypes);
        if (id) assert(item.id === id, `已有${label}的 ID 不能修改。`);
        assert(!items.some(entry => entry.id === item.id && entry.id !== id), `这个${label} ID 已存在。`, 409);
        if (id) items[index] = item; else items.unshift(item);
        await writeContent(path, JSON.stringify(items, null, 2) + '\n');
        return publicItem(item);
      }));
      requestPublish();
      json(req.method === 'POST' ? 201 : 200, result);
    } catch (error) {
      if (!error.status) console.error('[admin]', error);
      if (!res.headersSent) json(error.status || 500, { error: error.status ? error.message : '无法读取或保存文件，请检查后台终端。' });
      else res.end();
    }
  });
  // Large ZIP uploads need time to arrive; headers and all body-size bounds remain strict.
  server.requestTimeout = 120000;
  server.headersTimeout = 10000;
  server.on('close', () => { closed = true; publishAgain = false; void contentWatch.close(); if (publishChild) publishChild.kill('SIGTERM'); });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.ADMIN_HOST || '127.0.0.1';
  const port = Number(process.env.ADMIN_PORT || 4322);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('ADMIN_PORT 必须是有效端口。');
  const server = createServer();
  server.listen(port, host, () => console.log(`内容后台：http://${host}:${port}/`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
