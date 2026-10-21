import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePostSource, assertUniquePosts, isPostFile } from '../lib/posts.mjs';

const source = (metadata = '', body = '## 开始\n\n这是 **第一篇** 手写文章。') => `---\ntitle: 我的文章\ndate: 2026-10-20\n${metadata}---\n\n${body}\n`;
const parse = (raw, filename = 'notes/first.md') => parsePostSource(raw, { filename, defaultCategoryId: 'thinking' }).post;

test('minimal Markdown has the same deterministic defaults across reads and supports Hiro field names', () => {
  const post = parse(source());
  assert.match(post.id, /^FILE-[a-f0-9]{16}$/);
  assert.equal(post.slug, 'notes-first'); assert.equal(post.categoryId, 'thinking');
  assert.equal(post.draft, false); assert.deepEqual(post.tags, []); assert.equal(post.readTime, 1);
  assert.equal(post.summary, '开始 这是 第一篇 手写文章。');
  assert.deepEqual(parse(source()), post);
  const hiro = parse('---\ntitle: Hiro\npubDate: 2026-10-20\ndescription: 导入摘要\n---\n正文');
  assert.equal(hiro.date, '2026-10-20'); assert.equal(hiro.summary, '导入摘要');
  for (const quoted of ['', '"']) {
    const timestamp = parse(`---\ntitle: Hiro\npubDate: ${quoted}2026-10-20T23:30:00-07:00${quoted}\n---\n正文`);
    assert.equal(timestamp.date, '2026-10-21');
  }
  const chinese = parse(source(), '随笔/你好.md');
  assert.match(chinese.slug, /^post-[a-f0-9]{16}$/);
  assert.notEqual(chinese.slug, parse(source(), '随笔/另一篇.md').slug);
});

test('explicit metadata and unknown frontmatter survive parsing without being rewritten', () => {
  const raw = source('id: MY-ID\nslug: fixed-address\ndraft: true\nreadTime: 7\ntags: [随笔, 随笔]\nauthor: 示例作者\ncustom:\n  value: keep\n');
  const { post, metadata } = parsePostSource(raw, { filename: 'renamed.md' });
  assert.equal(post.id, 'MY-ID'); assert.equal(post.slug, 'fixed-address');
  assert.equal(post.draft, true); assert.equal(post.readTime, 7);
  assert.deepEqual(post.tags, ['随笔']); assert.deepEqual(metadata.custom, { value: 'keep' });
  assert.equal(metadata.author, '示例作者');
});

test('invalid metadata reports its filename and duplicate routes fail before publication', () => {
  for (const raw of [
    source().replace('2026-10-20', '2026-02-31'), source('draft: \"false\"\n'),
    source('slug: ../private\n'), source('tags: one\n'), source('readTime: 0\n'), source('', ''),
    source().replace('2026-10-20', '2026-02-31T08:30:00Z'),
    '# Missing frontmatter',
  ]) assert.throws(() => parse(raw), /文章 notes\/first.md/);
  assert.throws(() => assertUniquePosts([
    { ...parse(source('slug: same\n'), 'one.md'), sourcePath: 'one.md' },
    { ...parse(source('slug: same\n'), 'two.md'), sourcePath: 'two.md' },
  ]), /two\.md.*slug.*one\.md/);
});

test('only supported Markdown files outside hidden and editor folders are articles', () => {
  for (const path of ['first.md', 'notes/first.md', '随笔/第一篇.md']) assert.equal(isPostFile(path), true);
  for (const path of ['.draft.md', '~backup.md', '.notes/first.md', 'notes/~backup/first.md', 'first.mdx', 'first.md.tmp']) assert.equal(isPostFile(path), false);
});
