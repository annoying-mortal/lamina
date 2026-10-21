import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, mkdir, readFile, rm, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { createContentWatch } from './content-watch.mjs';

async function until(condition, message = 'condition was not reached') {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) { if (await condition()) return; await setTimeout(15); }
  assert.fail(message);
}
async function fixture(run, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'field-content-watch-'));
  const contentDir = join(root, 'content');
  const uploadsDir = join(root, 'uploads');
  await mkdir(join(contentDir, 'blog/nested'), { recursive: true });
  await mkdir(uploadsDir);
  const changes = [];
  const watcher = createContentWatch({
    contentDir, uploadsDir, intervalMs: 20, debounceMs: 90,
    onChange: async event => { changes.push(event); if (options.onChange) await options.onChange(event); },
    ...options,
  });
  try { await watcher.ready; await run({ root, contentDir, uploadsDir, watcher, changes }); }
  finally { await watcher.close(); await rm(root, { recursive: true, force: true }); }
}

test('polling detects nested Markdown, JSON and uploads additions, edits and removals', () => fixture(async ({ contentDir, uploadsDir, changes }) => {
  const post = join(contentDir, 'blog/nested/article.md');
  const json = join(contentDir, 'site.json');
  const image = join(uploadsDir, 'local.png');
  await writeFile(post, 'first');
  await until(() => changes.length === 1);
  assert.deepEqual(changes[0].paths, [post]);
  await writeFile(post, 'second');
  await until(() => changes.length === 2);
  assert.deepEqual(changes[1].paths, [post]);
  await writeFile(json, '{"name":"new"}');
  await writeFile(image, 'image bytes');
  await until(() => changes.length === 3);
  assert.deepEqual(changes[2].paths.sort(), [json, image].sort());
  await Promise.all([unlink(post), unlink(json), unlink(image)]);
  await until(() => changes.length === 4);
  assert.deepEqual(changes[3].paths.sort(), [post, json, image].sort());
  await setTimeout(180);
  assert.equal(changes.length, 4, 'unchanged snapshots must not repeatedly publish');
}));

test('touches, temporary files, unrelated files and symlinks do not publish', () => fixture(async ({ root, contentDir, uploadsDir, watcher, changes }) => {
  const post = join(contentDir, 'blog/real.md');
  await writeFile(post, 'content');
  watcher.acknowledge(post, 'content');
  await until(() => watcher.status.state === 'watching');
  await utimes(post, new Date(), new Date(Date.now() + 2000));
  await mkdir(join(contentDir, '.hidden'));
  await writeFile(join(contentDir, '.hidden/hidden.md'), 'hidden');
  await writeFile(join(contentDir, 'blog/.draft.md'), 'temporary');
  await writeFile(join(contentDir, 'blog/partial.md.tmp'), 'temporary');
  await writeFile(join(contentDir, 'blog/~draft.md'), 'temporary');
  await writeFile(join(contentDir, 'notes.txt'), 'unrelated');
  const outside = join(root, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'other.md'), 'private');
  await symlink(outside, join(contentDir, 'blog/linked-directory'));
  await symlink(join(outside, 'other.md'), join(contentDir, 'blog/linked.md'));
  await symlink(join(outside, 'other.md'), join(uploadsDir, 'linked.png'));
  await setTimeout(300);
  assert.deepEqual(changes, []);
}));

test('continuous partial writes settle before publishing the completed source once', () => fixture(async ({ contentDir, watcher, changes }) => {
  const post = join(contentDir, 'blog/writing.md');
  await writeFile(post, '---\ntitle: ');
  await until(() => watcher.status.state === 'settling');
  for (const part of ['New\n', 'date: 2026-10-20\n', '---\n', '# Complete\n']) {
    await setTimeout(30);
    assert.equal(changes.length, 0, 'publishing must wait while content is changing');
    await appendFile(post, part);
  }
  await until(() => changes.length === 1);
  assert.match(await readFile(post, 'utf8'), /# Complete\n$/);
  await setTimeout(180);
  assert.equal(changes.length, 1);
}));

test('acknowledging exact CMS writes leaves concurrent external changes pending', () => fixture(async ({ contentDir, watcher, changes }) => {
  const external = join(contentDir, 'blog/external.md');
  const managed = join(contentDir, 'blog/cms.md');
  await writeFile(external, 'outside editor');
  await until(() => watcher.status.state === 'settling');
  await writeFile(managed, 'CMS saved bytes');
  watcher.acknowledge(managed, 'CMS saved bytes');
  await until(() => changes.length === 1);
  assert.deepEqual(changes[0].paths, [external]);
  await writeFile(managed, 'new CMS bytes');
  watcher.acknowledge(managed, 'new CMS bytes');
  await writeFile(managed, 'external edit immediately afterwards');
  await until(() => changes.length === 2);
  assert.deepEqual(changes[1].paths, [managed]);
  await unlink(managed); watcher.acknowledge(managed, null);
  await setTimeout(220);
  assert.equal(changes.length, 2, 'CMS deletion is also acknowledged');
}));

test('closing cancels pending publication and polling; disabled watch stays inactive', () => fixture(async ({ contentDir, watcher, changes }) => {
  await writeFile(join(contentDir, 'blog/pending.md'), 'not stable yet');
  await until(() => watcher.status.state === 'settling');
  await watcher.close();
  const checked = watcher.status.lastCheckedAt;
  await writeFile(join(contentDir, 'blog/after-close.md'), 'later');
  await setTimeout(200);
  assert.equal(watcher.status.state, 'stopped');
  assert.equal(watcher.status.lastCheckedAt, checked);
  assert.deepEqual(changes, []);
  const inactive = createContentWatch({ contentDir, uploadsDir: join(contentDir, 'absent'), enabled: false, onChange: () => assert.fail('disabled watcher fired') });
  await inactive.ready;
  assert.equal(inactive.status.enabled, false);
  assert.equal(inactive.status.lastCheckedAt, null);
  await inactive.close();
}));
