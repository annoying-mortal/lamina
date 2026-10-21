import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, realpath, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { init, parse } from 'es-module-lexer';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requiredThreeEntries = [
  'three',
  'three/addons/loaders/GLTFLoader.js',
  'three/addons/environments/RoomEnvironment.js',
  'three/addons/postprocessing/EffectComposer.js',
  'three/addons/postprocessing/RenderPass.js',
  'three/addons/postprocessing/OutputPass.js',
  'three/addons/postprocessing/BokehPass.js',
  'three/addons/postprocessing/SSAOPass.js',
  'three/addons/postprocessing/Pass.js',
];

async function unusedPort() {
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}
function launch(root, args) {
  const child = spawn(process.execPath, [join(root, 'node_modules/astro/bin/astro.mjs'), ...args], {
    cwd: root,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', BUILD_OUTPUT_DIR: join(root, 'dist') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const append = chunk => { output = (output + chunk.toString()).slice(-64000); };
  child.stdout.on('data', append); child.stderr.on('data', append);
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  // The caller awaits this promise; attach a handler immediately for startup errors.
  done.catch(() => {});
  return { child, done, output: () => output };
}
async function command(root, args) {
  const process = launch(root, args);
  const timeout = setTimeout(() => process.child.kill('SIGKILL'), 45000);
  try {
    const result = await process.done;
    assert.equal(result.code, 0, `astro ${args.join(' ')} failed (${result.signal || result.code}):\n${process.output()}`);
  } finally { clearTimeout(timeout); }
}
async function stop(process) {
  if (!process) return;
  if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill('SIGTERM');
  const timeout = setTimeout(() => process.child.kill('SIGKILL'), 5000);
  try { await process.done; } finally { clearTimeout(timeout); }
}
async function ready(base, process) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    assert.equal(process.child.exitCode, null, `dev server exited:\n${process.output()}`);
    try {
      const response = await fetch(base + '/', { signal: AbortSignal.timeout(2000) });
      if (response.ok) { await response.text(); return; }
    } catch { /* Startup includes initial content sync and dependency optimization. */ }
    await delay(200);
  }
  assert.fail(`dev server did not become ready:\n${process.output()}`);
}
async function moduleCode(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const source = await response.text();
  assert.equal(response.status, 200, `${url} returned ${response.status}: ${source.slice(0, 500)}`);
  assert.match(response.headers.get('content-type') || '', /(?:java|ecma)script/, `${url} should contain JavaScript`);
  return source;
}
async function sceneGraph(base) {
  await init();
  const seen = new Map();
  const queue = [new URL('/src/archive/scene.ts', base).href];
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    const source = await moduleCode(url); seen.set(url, source);
    const [imports] = parse(source);
    for (const item of imports) {
      if (!item.specifier || !/^(?:\.?\.?\/)/.test(item.specifier)) continue;
      const imported = new URL(item.specifier, url);
      if (imported.origin !== base) continue;
      if (imported.pathname.startsWith('/src/archive/') || imported.pathname.startsWith('/node_modules/.vite/')) queue.push(imported.href);
    }
  }
  return seen;
}

test('running archive dependency URLs survive concurrent Astro sync and production builds', { timeout: 120000 }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'field-dev-cache-')));
  let dev;
  try {
    for (const name of ['src', 'public', 'scripts', 'lib', 'astro.config.mjs', 'package.json', 'package-lock.json', 'tsconfig.json']) {
      await cp(join(project, name), join(root, name), { recursive: true, mode: constants.COPYFILE_FICLONE });
    }
    const modules = join(project, 'node_modules');
    await cp(modules, join(root, 'node_modules'), {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
      filter: path => !path.startsWith(join(modules, '.vite')),
    });
    const port = await unusedPort();
    const base = `http://127.0.0.1:${port}`;
    // Astro 7 otherwise auto-backgrounds in agent environments, leaving an orphan after this test.
    dev = launch(root, ['dev', '--ignore-lock', '--host', '127.0.0.1', '--port', String(port)]);
    await ready(base, dev);
    const graph = await sceneGraph(base);
    const dependencyUrls = [...graph.keys()].filter(url => new URL(url).pathname.startsWith('/node_modules/.vite/'));
    assert.ok(dependencyUrls.length >= 10, 'fetch the optimized Three.js entries and their shared chunks');
    assert.ok(dependencyUrls.every(url => new URL(url).pathname.startsWith('/node_modules/.vite/blog-dev/')), 'development dependencies must use their own cache directory');
    const metadataPath = join(root, 'node_modules/.vite/blog-dev/deps/_metadata.json');
    const before = JSON.parse(await readFile(metadataPath, 'utf8'));
    for (const entry of requiredThreeEntries) assert.ok(before.optimized[entry], `${entry} must be optimized before visiting the archive`);

    // Both commands create a separate temporary Vite environment while dev remains live.
    for (const operation of ['sync', 'build']) {
      await command(root, [operation]);
      for (const url of dependencyUrls) await moduleCode(url);
      const after = JSON.parse(await readFile(metadataPath, 'utf8'));
      assert.equal(after.browserHash, before.browserHash, `${operation} must not replace dev's optimized dependency metadata`);
    }
    const refreshed = await sceneGraph(base);
    assert.ok(refreshed.has(new URL('/src/archive/scene.ts', base).href));
    assert.equal((await fetch(base + '/assets/archive-cassette.glb')).status, 200);
  } catch (error) {
    error.message += `\nDev server output:\n${dev?.output() || '(not started)'}`;
    throw error;
  } finally {
    await stop(dev);
    await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
  }
});
