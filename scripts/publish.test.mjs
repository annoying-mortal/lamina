import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, readlink, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publish } from './publish.mjs';

test('external release roots receive verified project-local builds and failures clean staging', async () => {
  const project = await mkdtemp(join(tmpdir(), 'blog-build-project-'));
  const published = await mkdtemp(join(tmpdir(), 'blog-build-volume-'));
  try {
    await mkdir(join(project, 'node_modules/astro/bin'), { recursive: true });
    await mkdir(join(project, 'scripts'));
    await writeFile(join(project, 'node_modules/astro/bin/astro.mjs'), `
      import { mkdir, writeFile } from 'node:fs/promises';
      import { join, relative, isAbsolute } from 'node:path';
      const output = process.env.BUILD_OUTPUT_DIR;
      const local = relative(process.cwd(), output);
      if (local.startsWith('..') || isAbsolute(local)) throw new Error('Build escaped project filesystem');
      await mkdir(join(output, '_astro'), { recursive: true });
      await writeFile(join(output, 'index.html'), 'verified release');
      await writeFile(join(output, '_astro/style.css'), 'body {}');
    `);
    await writeFile(join(project, 'scripts/verify.mjs'), `
      import { readFile, writeFile } from 'node:fs/promises';
      import { join } from 'node:path';
      const output = process.env.BUILD_OUTPUT_DIR;
      await readFile(join(output, 'index.html'));
      await writeFile(join(output, 'verified.txt'), 'passed');
    `);
    await publish({ projectRoot: project, publishRoot: published });
    assert.equal(await readFile(join(published, 'current/index.html'), 'utf8'), 'verified release');
    assert.equal(await readFile(join(published, 'current/verified.txt'), 'utf8'), 'passed');
    assert.equal(await readFile(join(published, 'current/_astro/style.css'), 'utf8'), 'body {}');
    assert.deepEqual(await readdir(join(project, '.publish-build')), []);
    const current = await readlink(join(published, 'current'));
    await writeFile(join(project, 'scripts/verify.mjs'), 'process.exitCode = 1;');
    await assert.rejects(publish({ projectRoot: project, publishRoot: published }), /发布检查失败/);
    assert.equal(await readlink(join(published, 'current')), current);
    assert.deepEqual(await readdir(join(project, '.publish-build')), []);
    assert.equal((await readdir(join(published, 'releases'))).length, 1);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(published, { recursive: true, force: true });
  }
});

test('发布失败保留已上线版本，成功时原子切换并保留旧资源', async () => {
  const root = await mkdtemp(join(tmpdir(), 'field-publish-'));
  try {
    await publish({ publishRoot: root, build: async out => {
      await mkdir(join(out, '_astro'), { recursive: true });
      await writeFile(join(out, 'index.html'), 'first');
      await writeFile(join(out, '_astro', 'old.js'), 'old chunk');
    } });
    const before = await readlink(join(root, 'current'));
    await assert.rejects(publish({ publishRoot: root, build: async out => {
      await mkdir(out, { recursive: true });
      await writeFile(join(out, 'index.html'), 'broken');
      throw new Error('syntax error');
    } }), /syntax error/);
    assert.equal(await readlink(join(root, 'current')), before);
    assert.equal(await readFile(join(root, 'current/index.html'), 'utf8'), 'first');
    await publish({ publishRoot: root, build: async out => {
      await mkdir(out, { recursive: true }); await writeFile(join(out, 'index.html'), 'second');
    } });
    assert.equal(await readFile(join(root, 'current/index.html'), 'utf8'), 'second');
    assert.equal(await readFile(join(root, 'current/_astro/old.js'), 'utf8'), 'old chunk');
    assert.equal((await readdir(join(root, 'releases'))).length, 2);
    for (const version of ['third', 'fourth']) await publish({ publishRoot: root, build: async out => {
      await mkdir(out, { recursive: true }); await writeFile(join(out, 'index.html'), version);
    } });
    assert.equal((await readdir(join(root, 'releases'))).length, 3);
    await assert.rejects(readFile(join(root, 'current/_astro/old.js')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
