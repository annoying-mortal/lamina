import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './server.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Follow the deployed stylesheets rather than duplicating their asset list: a
// newly imported family must also work on the separate, authenticated CMS host.
async function typographyAssets() {
  const assets = new Map();
  async function visit(path) {
    if (assets.has(path)) return;
    assert.match(path, /^\/(?:typography\.css|fonts\.css|fonts\/[a-z0-9./-]+\.(?:css|woff2))$/);
    if (path.endsWith('.woff2')) {
      assets.set(path, Buffer.from('wOF2-fixture'));
      return;
    }
    const css = await readFile(join(projectRoot, 'public', path), 'utf8');
    assets.set(path, css);
    for (const [, , raw] of css.matchAll(/url\(\s*(['"]?)([^'"\s)]+)\1\s*\)/g)) {
      const url = new URL(raw, `https://fixture.invalid${path}`);
      assert.equal(url.origin, 'https://fixture.invalid', 'production typography uses self-hosted assets');
      assert.equal(url.search, '');
      await visit(url.pathname);
    }
  }
  await visit('/typography.css');
  return assets;
}

test('all shared typography imports load before login without exposing neighboring files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blog-font-assets-'));
  const assets = await typographyAssets();
  for (const [path, content] of assets) {
    const file = join(root, 'public', path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  await mkdir(join(root, 'src/content/blog'), { recursive: true });
  const protectedPaths = [
    '/fonts/private.json', '/fonts/geom/original.ttf',
    '/fonts/alimama-fangyuan/SOURCE.json', '/fonts/lxgw-wenkai/regular/094.woff2',
    '/fonts/lxgw-wenkai/regular/999.woff2',
    '/fonts/lxgw-wenkai/bold/000.woff2', '/fonts/lxgw-wenkai/regular/0.woff2',
    '/fonts/jetbrains-mono/jetbrains-mono-900-normal.woff2',
    '/fonts/jetbrains-mono/SOURCE.json', '/fonts/custom/unknown.woff2',
  ];
  for (const path of protectedPaths) {
    const file = join(root, 'public', path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, 'must not be served');
  }
  const server = createServer({ projectRoot: root, autoPublish: false, watchContent: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(base).then(r => r.text());
    assert.match(login, /href="\/typography.css"/);
    const paths = [...assets.keys()];
    for (let start = 0; start < paths.length; start += 20) {
      await Promise.all(paths.slice(start, start + 20).map(async path => {
        const response = await fetch(base + path);
        assert.equal(response.status, 200, path);
        if (path.endsWith('.woff2')) {
          assert.equal(response.headers.get('content-type'), 'font/woff2', path);
          assert.equal(await response.text(), 'wOF2-fixture', path);
        } else {
          assert.match(response.headers.get('content-type'), /text\/css/, path);
          assert.equal(await response.text(), assets.get(path), path);
        }
      }));
    }
    for (const path of ['/api/settings', ...protectedPaths, '/fonts/geom/%2e%2e/private.json']) {
      assert.equal((await fetch(base + path)).status, 401, path);
    }
  } finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await rm(root, { recursive: true, force: true });
  }
});
