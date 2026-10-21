import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { isPostFile } from '../lib/posts.mjs';

// Verify the built website, so missing routes and broken links fail the release.
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(process.env.BUILD_OUTPUT_DIR || join(project, 'dist'));
let passed = 0;
const failures = [];
function check(condition, description) {
  if (condition) passed += 1;
  else failures.push(description);
}
async function exists(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}
async function filesAt(path) {
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const absolute = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await filesAt(absolute));
    else files.push(absolute);
  }
  return files;
}
const decode = value => value.replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&quot;', '"');
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(match => [match[1], decode(match[2] ?? match[3])]));
}
function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map(match => attributes(match[0]));
}
function diskPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  return join(dist, decoded, extname(decoded) ? '' : 'index.html');
}
async function readRoute(route) {
  const path = diskPath(route);
  const present = await exists(path);
  check(present, `${route} 页面不存在，请先运行 npm run build`);
  return present ? readFile(path, 'utf8') : '';
}

try {
  const settings = JSON.parse(await readFile(join(project, 'src/content/site.json'), 'utf8'));
  const routes = ['/', '/blog/', '/library/', '/friends/'];
  const core = new Map(await Promise.all(routes.map(async route => [route, await readRoute(route)])));
  const htmlFiles = (await filesAt(dist)).filter(path => path.endsWith('.html'));
  const articles = htmlFiles.filter(path => path.startsWith(join(dist, 'blog') + '/') && path !== join(dist, 'blog/index.html'));
  const blogSource = join(project, 'src/content/blog');
  const sourceArticles = (await filesAt(blogSource)).filter(path => isPostFile(relative(blogSource, path)));
  // Source count, rather than a hard-coded nine, keeps the check useful as the blog grows.
  const publishedSource = [];
  for (const file of sourceArticles) {
    const source = await readFile(file, 'utf8');
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
    if (!frontmatter || parse(frontmatter[1])?.draft !== true) publishedSource.push(file);
  }
  check(articles.length === publishedSource.length, `文章输出数 ${articles.length} 与 Markdown 文章数 ${publishedSource.length} 不一致`);
  const home = core.get('/') ?? '';
  const chapterOffsets = ['welcome', 'about', 'archives', 'contact'].map(id => home.indexOf(`id="${id}"`));
  check(chapterOffsets.every((offset, index) => offset >= 0 && (index === 0 || offset > chapterOffsets[index - 1])), 'Home 应依次包含首页、个人介绍、三维档案和联系页');
  const archiveSource = home.match(/<script\b[^>]*id="archive-data"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  check(Boolean(archiveSource), 'Home 缺少 Blog 与 Library 共用的档案数据');
  if (archiveSource) {
    const archive = JSON.parse(archiveSource);
    const librarySource = JSON.parse(await readFile(join(project, 'src/content/library.json'), 'utf8'));
    check(archive.posts.filter(record => record.kind === 'blog').length === publishedSource.length, 'Home 的 Blog 档案与公开文章数量不一致');
    check(archive.posts.filter(record => record.kind === 'library').length === librarySource.length, 'Home 的 Library 档案与收藏数量不一致');
    check(new Set(archive.posts.map(record => record.id)).size === archive.posts.length, 'Home 档案 ID 冲突');
    for (const record of archive.posts) {
      check(archive.categories.some(category => category.id === record.categoryId), `档案 ${record.title} 缺少对应分类`);
      const target = new URL(record.href, 'http://verify.local');
      check(await exists(diskPath(target.pathname)), `档案 ${record.title} 的访问入口不存在`);
      if (record.kind === 'library') check(tags(core.get('/library/') ?? '', 'dialog').some(tag => tag.id === decodeURIComponent(target.hash.slice(1))), `收藏 ${record.title} 的详情链接没有匹配弹窗`);
    }
  }

  const titles = new Set();
  for (const file of htmlFiles) {
    const html = await readFile(file, 'utf8');
    const route = '/' + file.slice(dist.length + 1).replace(/index\.html$/, '');
    const label = route || '/';
    check(/<!doctype html>/i.test(html), `${label} 缺少 HTML doctype`);
    check(/<html\b[^>]*\blang=["']en["']/i.test(html), `${label} is missing the default English document language`);
    check((html.match(/<main\b/gi) ?? []).length === 1 && /<nav\b/i.test(html), `${label} 应有且只有一个 main，并包含语义 nav`);
    check((html.match(/<h1\b/gi) ?? []).length === 1, `${label} 应有且只有一个 h1`);
    const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim();
    check(Boolean(title), `${label} 缺少 title`);
    check(!titles.has(title), `${label} 页面标题重复`);
    titles.add(title);
    const meta = tags(html, 'meta');
    check(meta.some(tag => tag.name === 'description' && tag.content?.trim()), `${label} 缺少页面描述`);
    const links = tags(html, 'link');
    check(links.some(tag => tag.rel === 'canonical' && /^https?:\/\//.test(tag.href ?? '')), `${label} 缺少绝对 canonical URL`);
    check(links.some(tag => tag.rel === 'icon'), `${label} 缺少 favicon`);
    check(settings.showRSS === false || links.some(tag => tag.type === 'application/rss+xml'), `${label} 缺少 RSS 发现链接`);

    for (const tag of [...tags(html, 'a'), ...links, ...tags(html, 'script'), ...tags(html, 'img')]) {
      const value = tag.href ?? tag.src;
      if (!value || !value.startsWith('/') || value.startsWith('//')) continue;
      const pathname = new URL(value, 'http://verify.local').pathname;
      check(await exists(diskPath(pathname)), `${label} 引用了缺失的本地路径 ${pathname}`);
    }
    if (articles.includes(file)) {
      check(/<article\b/i.test(html), `${label} 缺少 article 语义容器`);
      check(tags(html, 'time').some(tag => tag.datetime), `${label} 缺少机器可读发布时间`);
    }
  }

  const rssPath = join(dist, 'rss.xml');
  const rssExists = await exists(rssPath);
  check(rssExists, '缺少 rss.xml');
  if (rssExists) {
    const rss = await readFile(rssPath, 'utf8');
    check(/<rss\b/.test(rss) && /<channel>/.test(rss), 'RSS 格式缺少 rss/channel');
    check((rss.match(/<item>/g) ?? []).length === articles.length, 'RSS 条目数与文章页数量不一致');
  }
  check(await exists(join(dist, 'favicon.svg')), '缺少 favicon.svg');
  check(await exists(join(dist, 'robots.txt')), '缺少 robots.txt');
  const modelPath = join(dist, 'assets/archive-cassette.glb');
  const modelExists = await exists(modelPath);
  check(modelExists, '缺少三维档案 GLB 资源');
  if (modelExists) {
    const model = await readFile(modelPath);
    check(model.subarray(0, 4).toString() === 'glTF' && model.readUInt32LE(4) === 2, '档案资源不是有效的 GLB 2 文件');
  }

  // Follow initial JavaScript imports: Blog/Library/Friends must not eagerly load the 3D scene.
  async function eagerScripts(html) {
    const queue = [...tags(html, 'script').map(tag => tag.src), ...tags(html, 'link').filter(tag => tag.rel === 'modulepreload').map(tag => tag.href)].filter(Boolean);
    const visited = new Set();
    let combined = '';
    while (queue.length) {
      const source = queue.pop();
      if (!source.startsWith('/') || visited.has(source)) continue;
      visited.add(source);
      const file = diskPath(source);
      if (!await exists(file)) continue;
      const code = await readFile(file, 'utf8');
      combined += '\n' + code;
      for (const match of code.matchAll(/\b(?:import|export)\s*(?:[^;"'()]*?\bfrom\s*)?["']([^"']+)["']/g)) {
        if (match[1].startsWith('.')) queue.push(new URL(match[1], `http://verify.local${source}`).pathname);
        else if (match[1].startsWith('/')) queue.push(match[1]);
      }
    }
    return combined;
  }
  for (const route of ['/blog/', '/library/', '/friends/']) {
    const html = core.get(route) ?? '';
    const js = await eagerScripts(html);
    check(!html.includes('archive-cassette.glb'), `${route} 直接引用三维模型`);
    check(!/archive-cassette\.glb|THREE\.WebGLRenderer|createArchiveScene/.test(js), `${route} 初始脚本加载了三维场景`);
  }

  if (failures.length) {
    console.error(`验证失败：${failures.length} 项，已通过 ${passed} 项。`);
    failures.forEach(failure => console.error(`  - ${failure}`));
    process.exitCode = 1;
  } else console.log(`验证通过：${passed} 项；${articles.length} 篇文章，4 个主要页面，RSS、SEO、本地链接和三维资源隔离均正常。`);
} catch (error) {
  console.error(`无法完成验证：${error.message}\n请先运行 npm run build。`);
  process.exitCode = 1;
}
