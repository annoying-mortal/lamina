import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSatteriMarkdownProcessor } from '@astrojs/markdown-satteri';
import { markdownMath } from '../lib/markdown-math.mjs';
import { markdownCode } from '../lib/markdown-code.mjs';
import { parsePostSource } from '../lib/posts.mjs';

const processor = await createSatteriMarkdownProcessor({
  features: { math: true },
  mdastPlugins: [markdownMath],
  hastPlugins: [markdownCode],
  shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, wrap: true },
});

test('article formulas render inline and as a display block beside text and an external image', async () => {
  // No blank paragraphs between these lines: this is also valid in a CMS body.
  const source = [
    '请填写内容',
    '`请填写代码`',
    '![请填写图片说明](https://example.com/article.jpg)',
    '$ \\frac{1}{2}=0.5 $',
    '$$',
    'F=\\frac{GMm}{r^2}',
    '$$',
  ].join('\n');
  const { code } = await processor.render(source);

  assert.equal((code.match(/class="katex"/g) || []).length, 2);
  assert.equal((code.match(/class="katex-display"/g) || []).length, 1);
  assert.equal((code.match(/<math\b/g) || []).length, 2);
  assert.match(code, /<math\b[^>]*display="block"/);
  assert.match(code, /<mfrac>/);
  assert.match(code, /<code>请填写代码<\/code>/);
  assert.match(code, /<img\b[^>]*src="https:\/\/example\.com\/article\.jpg"/);
  assert.doesNotMatch(code, /katex-error/);
});

test('inline and fenced code keep dollar delimiters literal', async () => {
  const source = [
    '`$ \\frac{1}{2} $`',
    '',
    '```python',
    'price = "$5"',
    'formula = "$x$"',
    '$$',
    '\\frac{1}{2}',
    '$$',
    '```',
  ].join('\n');
  const { code } = await processor.render(source);

  assert.doesNotMatch(code, /class="katex(?:-display)?"/);
  assert.match(code, /<code>\$ \\frac\{1\}\{2\} \$<\/code>/);
  assert.match(code, /<pre\b[\s\S]*<code>/);
  assert.match(code, /\$5/);
  assert.match(code, /\$x\$/);
  assert.match(code, /\$\$/);
});

test('a malformed formula remains visible without rejecting the article build', async () => {
  const { code } = await processor.render('请填写内容 $ \\frac{1}{ $ 后续内容');

  assert.match(code, /class="katex-error"/);
  assert.match(code, /请填写内容/);
  assert.match(code, /后续内容/);
  assert.match(code, /\\frac\{1\}\{/);
});

test('math support preserves normal Markdown headings, tables, links and remote images', async () => {
  const source = [
    '## Heading',
    '',
    '| Column | Value |',
    '| --- | --- |',
    '| 请填写内容 | 42 |',
    '',
    '[请填写链接说明](https://example.com/article/)',
    '',
    '![请填写图片说明](https://example.com/cover.svg)',
  ].join('\n');
  const { code, metadata } = await processor.render(source);

  assert.deepEqual(metadata.headings, [{ depth: 2, slug: 'heading', text: 'Heading' }]);
  assert.match(code, /<h2 id="heading">Heading<\/h2>/);
  assert.match(code, /<table>/);
  assert.match(code, /<th>Column<\/th>/);
  assert.match(code, /<td>请填写内容<\/td>/);
  assert.match(code, /<a href="https:\/\/example\.com\/article\/">请填写链接说明<\/a>/);
  assert.match(code, /<img\b[^>]*src="https:\/\/example\.com\/cover\.svg"[^>]*alt="请填写图片说明"/);
  assert.doesNotMatch(code, /class="katex(?:-display)?"/);
});

test('code frames render language and Copy outside the copied code, including plain code', async () => {
  const { code } = await processor.render([
    '```python', 'print("Copy <this> & $literal$")', '```', '',
    '```bash', 'printf "%s\\n" "Hello"', '```', '',
    '```', 'plain <text>', '```', '',
    '    indented code',
  ].join('\n'));
  const frames = [...code.matchAll(/<div class="code-wrapper">([\s\S]*?)<\/div>/g)].map(match => match[1]);
  assert.equal(frames.length, 4);
  assert.deepEqual(frames.map(frame => /class="code-language"[^>]*>([^<]+)<\/span>/.exec(frame)?.[1]), ['python', 'bash', 'text', 'text']);
  for (const frame of frames) {
    assert.match(frame, /^<pre\b[\s\S]*<code>[\s\S]*<\/code><\/pre><span class="code-language"/);
    assert.match(frame, /<button class="copy-code" type="button" aria-label="Copy code">Copy<\/button>$/);
    const codeOnly = /<code>([\s\S]*?)<\/code>/.exec(frame)[1];
    assert.doesNotMatch(codeOnly, /class="(?:copy-code|code-language)"/);
  }
  assert.match(frames[0], /&lt;this&gt; &amp; \$literal\$/);
  assert.match(frames[0], /\$literal\$/);
  assert.doesNotMatch(code, /class="katex/);
});

test('the shipped guide renders supported Markdown features and valid linked examples', async () => {
  const source = await readFile(new URL('../admin/defaults/blog/markdown-guide.md', import.meta.url), 'utf8');
  const { post } = parsePostSource(source, { filename: 'markdown-guide.md' });
  assert.equal(post.demo, true);
  assert.equal(post.draft, false);
  const { code, metadata } = await processor.render(post.body);
  for (const depth of [2, 3, 4, 5, 6]) assert.ok(metadata.headings.some(heading => heading.depth === depth));
  assert.doesNotMatch(code, /<h1\b/); // The article title supplies the page's only level-one heading.
  for (const tag of ['em', 'strong', 'del', 'ul', 'ol', 'blockquote', 'hr', 'br', 'table', 'thead', 'tbody', 'details', 'summary', 'kbd', 'mark', 'sub', 'sup', 'abbr', 'dl', 'dt', 'dd']) assert.match(code, new RegExp(`<${tag}(?:\\s|>)`), tag);
  assert.match(code, /<ol start="7">/);
  assert.match(code, /<input type="checkbox" checked disabled>/);
  assert.match(code, /<input type="checkbox" disabled>/);
  assert.match(code, /style="text-align: center"/);
  assert.match(code, /style="text-align: right"/);
  assert.match(code, /href="mailto:hello@example\.com"/);
  assert.match(code, /href="\/blog\/enter-title\/"/);
  assert.match(code, /href="#code-blocks"/);
  assert.match(code, /src="\/images\/markdown-example\.svg"/);
  assert.match(code, /src="https:\/\/f4\.bcbits\.com\/img\/a1974877315_5\.jpg"/);
  assert.match(code, /data-footnote-ref/);
  assert.match(code, /data-footnote-backref/);
  assert.match(code, /<section data-footnotes/);
  assert.equal((code.match(/class="katex"/g) || []).length, 4);
  assert.equal((code.match(/class="katex-display"/g) || []).length, 2);
  assert.doesNotMatch(code, /katex-error/);
  assert.doesNotMatch(post.body, /mermaid/i);
  for (const language of ['python', 'bash', 'javascript', 'json', 'css', 'markdown', 'text']) assert.ok(code.includes(`aria-label="Code language">${language}</span>`), language);
  assert.match(await readFile(new URL('../public/images/markdown-example.svg', import.meta.url), 'utf8'), /<svg\b/);
});

test('the blank post is a public, editable Enter Title template', async () => {
  const source = await readFile(new URL('../admin/defaults/blog/enter-title.md', import.meta.url), 'utf8');
  const { post } = parsePostSource(source, { filename: 'enter-title.md' });
  assert.equal(post.title, 'Enter Title');
  assert.equal(post.slug, 'enter-title');
  assert.equal(post.demo, true);
  assert.equal(post.draft, false);
  assert.deepEqual(post.tags, ['Enter tag']);
  assert.match(post.body, /Enter content/);
});
