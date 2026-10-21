import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';

/** @typedef {{ id: string, slug: string, title: string, summary: string, categoryId: string, date: string, tags: string[], readTime: number, demo: boolean, draft: boolean, body: string }} Post */

function invalid(filename, message) {
  throw Object.assign(new Error(`文章 ${filename}：${message}`), { status: 422 });
}
function text(value, name, max, filename) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid(filename, `${name}不能为空，最长 ${max} 字。`);
  return value.trim();
}
function plainText(body) {
  return body.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^[ \t]*[>#*-]+[ \t]*/gm, '')
    .replace(/[`*_~]/g, '').replace(/\s+/g, ' ').trim();
}

/** A content file must not live in editor/hidden folders or use a temporary filename. */
export function isPostFile(filename) {
  const parts = filename.replaceAll('\\', '/').split('/');
  return parts.every(part => part && !part.startsWith('.') && !part.startsWith('~')) && filename.endsWith('.md');
}

/**
 * The filesystem, CMS and Astro share these defaults and validations.
 * Derived IDs are stable for a relative filename; an explicit id/slug survives renames.
 * @param {Record<string, unknown>} metadata
 * @param {{filename: string, body: string, defaultCategoryId?: string}} options
 * @returns {Post}
 */
export function normalizePostMetadata(metadata, { filename, body, defaultCategoryId = 'engineering' }) {
  filename = filename.replaceAll('\\', '/');
  if (!filename || filename.startsWith('/') || filename.split('/').includes('..')) invalid(filename, '文件路径不正确。');
  const digest = createHash('sha256').update(filename.normalize('NFC')).digest('hex').slice(0, 16);
  const stem = filename.replace(/\.md$/i, '');
  const candidate = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const defaultSlug = /^[\x20-\x7e]+$/.test(stem) && candidate && candidate.length <= 100 ? candidate : `post-${digest}`;
  const id = text(metadata.id ?? `FILE-${digest}`, 'ID', 80, filename);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id)) invalid(filename, 'ID 只能使用字母、数字、连字符或下划线。');
  const slug = text(metadata.slug ?? defaultSlug, 'slug', 100, filename);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) invalid(filename, 'slug 只能使用小写字母、数字及中间的连字符。');
  const title = text(metadata.title, 'title', 200, filename);
  const dateValue = metadata.date ?? metadata.pubDate;
  let date = dateValue instanceof Date && Number.isFinite(dateValue.getTime()) ? dateValue.toISOString().slice(0, 10) : dateValue;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(date)) invalid(filename, '请填写 date（或 pubDate），格式为 YYYY-MM-DD 或带时区的 ISO 时间戳。');
  const calendarDate = date.slice(0, 10);
  const parsed = new Date(`${calendarDate}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== calendarDate) invalid(filename, '日期不存在。');
  if (date.length > 10) {
    const timestamp = new Date(date);
    if (!Number.isFinite(timestamp.getTime())) invalid(filename, '时间戳不正确。');
    date = timestamp.toISOString().slice(0, 10);
  }
  if (typeof body !== 'string' || !body.trim() || body.length > 300000) invalid(filename, '正文不能为空，最长 300,000 字。');
  const summary = text(metadata.summary ?? metadata.description ?? (plainText(body).slice(0, 180) || title), 'summary', 1000, filename);
  const categoryId = text(metadata.categoryId ?? defaultCategoryId, 'categoryId', 60, filename);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(categoryId)) invalid(filename, 'categoryId 只能使用小写字母、数字及中间的连字符。');
  const sourceTags = metadata.tags ?? [];
  if (!Array.isArray(sourceTags) || sourceTags.length > 20) invalid(filename, 'tags 必须为数组，最多 20 个。');
  const tags = [...new Set(sourceTags.map(tag => text(tag, '标签', 40, filename)))];
  const cjk = (body.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
  const words = (body.match(/[a-zA-Z0-9]+/g) || []).length;
  const readTime = metadata.readTime ?? Math.max(1, Math.min(999, Math.ceil(cjk / 400 + words / 200)));
  if (typeof readTime !== 'number' || !Number.isInteger(readTime) || readTime < 1 || readTime > 999) invalid(filename, 'readTime 必须为 1–999 的整数。');
  for (const key of ['draft', 'demo']) if (metadata[key] !== undefined && typeof metadata[key] !== 'boolean') invalid(filename, `${key} 必须为 true 或 false。`);
  return { id, slug, title, summary, categoryId, date, tags, readTime, demo: metadata.demo === true, draft: metadata.draft === true, body: body.replace(/\r\n/g, '\n') };
}

/**
 * @param {string} raw
 * @param {{filename: string, defaultCategoryId?: string}} options
 * @returns {{post: Post, metadata: Record<string, unknown>}}
 */
export function parsePostSource(raw, options) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw.replace(/^\uFEFF/, ''));
  if (!match) invalid(options.filename, '缺少 YAML frontmatter，请在文件开头用 --- 包围标题和日期。');
  let metadata;
  try { metadata = parse(match[1]); }
  catch { invalid(options.filename, 'YAML 格式不正确。'); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) invalid(options.filename, '元数据必须为 YAML 对象。');
  return { post: normalizePostMetadata(metadata, { ...options, body: match[2].replace(/^\r?\n/, '') }), metadata };
}

/**
 * Read original YAML rather than values already coerced by the page framework.
 * @param {{filename: string, defaultCategoryId?: string}} options
 * @param {string} blogDirectory
 */
export async function readPostFile(options, blogDirectory = join(process.cwd(), 'src/content/blog')) {
  if (!isPostFile(options.filename)) invalid(options.filename, '不是有效的 Markdown 内容路径。');
  return parsePostSource(await readFile(join(blogDirectory, options.filename), 'utf8'), options);
}

/** @param {Array<{id: string, slug: string, _filename?: string, sourcePath?: string}>} posts */
export function assertUniquePosts(posts) {
  for (const key of ['id', 'slug']) {
    const seen = new Map();
    for (const post of posts) {
      const filename = post.sourcePath || post._filename || post.id;
      if (seen.has(post[key])) invalid(filename, `${key}「${post[key]}」与 ${seen.get(post[key])} 重复，请显式设置不同的 ${key}。`);
      seen.set(post[key], filename);
    }
  }
}
