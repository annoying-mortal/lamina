import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parsePostSource, assertUniquePosts, isPostFile } from '../lib/posts.mjs';
import { resolveFriendApplicationsEnabled } from '../lib/home-settings.mjs';
import { createBackupStore, unpackBackup } from '../admin/backup.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('Markdown post parsing and validation', () => {
  it('parses valid frontmatter and calculates defaults', () => {
    const raw = '---\ntitle: Test Post\ndate: 2026-05-01\ntags: [one, one, two]\n---\n\nHello world content.';
    const { post } = parsePostSource(raw, { filename: 'notes/test.md' });
    assert.equal(post.slug, 'notes-test');
    assert.deepEqual(post.tags, ['one', 'two']);
    assert.equal(post.readTime, 1);
    assert.equal(post.draft, false);
  });

  it('rejects invalid calendar dates and duplicate slugs', () => {
    assert.throws(
      () => parsePostSource('---\ntitle: Bad\ndate: 2026-02-30\n---\n\nText', { filename: 'bad.md' }),
      err => err.status === 422,
    );
    assert.throws(
      () => assertUniquePosts([
        { id: 'A', slug: 'same', sourcePath: 'a.md' },
        { id: 'B', slug: 'same', sourcePath: 'b.md' },
      ]),
      err => err.status === 422,
    );
    assert.equal(isPostFile('.hidden.md'), false);
    assert.equal(isPostFile('~draft.md'), false);
    assert.equal(isPostFile('sub/post.md'), true);
  });
});

describe('resolveFriendApplicationsEnabled', () => {
  it('applies environment overrides before configured value', () => {
    assert.equal(resolveFriendApplicationsEnabled(true, '0'), false);
    assert.equal(resolveFriendApplicationsEnabled(true, 'false'), false);
    assert.equal(resolveFriendApplicationsEnabled(false, '1'), true);
    assert.equal(resolveFriendApplicationsEnabled(false, 'true'), true);
    assert.equal(resolveFriendApplicationsEnabled(false, undefined), false);
    assert.equal(resolveFriendApplicationsEnabled(undefined, undefined), true);
  });
});

describe('Backup export, inspect, and restore', () => {
  it('exports a valid ZIP, inspects it, restores changes, and creates a rollback snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'blogsite-backup-test-'));
    try {
      const dataDir = join(root, 'content');
      const uploadsDir = join(root, 'static');
      const backupDir = join(root, 'backups');
      await mkdir(join(dataDir, 'blog'), { recursive: true });
      await mkdir(uploadsDir, { recursive: true });
      const siteJson = await readFile(join(projectRoot, 'src/content/site.json'), 'utf8');
      await writeFile(join(dataDir, 'site.json'), siteJson);
      await writeFile(join(dataDir, 'library.json'), '[]\n');
      await writeFile(join(dataDir, 'friends.json'), '[]\n');
      await writeFile(
        join(dataDir, 'blog/post-1.md'),
        '---\nid: P1\nslug: post-1\ntitle: Original\nsummary: S\ncategoryId: engineering\ndate: 2026-01-01\ntags: []\nreadTime: 1\ndraft: false\ndemo: false\n---\n\nOriginal body.\n',
      );

      const settings = JSON.parse(siteJson);
      const store = createBackupStore({
        projectRoot,
        dataDir,
        uploadsDir,
        backupDir,
        siteUrl: 'http://127.0.0.1:4321',
        readSettings: async () => settings,
        validators: {
          settings: v => v,
          library: v => v,
          friend: v => v,
          post: v => v,
        },
      });

      const exported = await store.export();
      const unpacked = unpackBackup(exported.bytes);
      assert.equal(unpacked.has('manifest.json'), true);
      assert.equal(unpacked.has('content/blog/post-1.md'), true);

      // Mutate content, then inspect & restore original backup
      await writeFile(
        join(dataDir, 'blog/post-1.md'),
        '---\nid: P1\nslug: post-1\ntitle: Modified\nsummary: S\ncategoryId: engineering\ndate: 2026-01-01\ntags: []\nreadTime: 1\ndraft: false\ndemo: false\n---\n\nModified body.\n',
      );
      const inspected = await store.inspect(exported.bytes, 'sess-1', 'backup.zip');
      assert.equal(inspected.summary.blog, 1);

      const restored = await store.restore(inspected.token, 'sess-1');
      assert.equal(restored.restored, true);
      assert.match(restored.rollbackId, /^before-restore-.*\.zip$/);
      const restoredPost = await readFile(join(dataDir, 'blog/post-1.md'), 'utf8');
      assert.match(restoredPost, /Original body\./);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
