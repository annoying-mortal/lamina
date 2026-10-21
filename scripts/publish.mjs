import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, rename, symlink, rm, readdir, cp, stat, realpath } from 'node:fs/promises';
import { resolve, join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function command(file, args, options) {
  return new Promise((accept, reject) => {
    const child = spawn(file, args, { ...options, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? accept() : reject(new Error(`发布检查失败 (${signal || code})`)));
  });
}
async function has(path) { try { await stat(path); return true; } catch { return false; } }
async function assetFiles(root, prefix = '') {
  if (!await has(root)) return [];
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const name = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await assetFiles(join(root, entry.name), name));
    else if (entry.isFile()) files.push(name);
  }
  return files;
}

/** Build away from the served tree, then change only one symlink on success. */
export async function publish({ projectRoot = project, publishRoot = process.env.SITE_PUBLISH_ROOT || join(projectRoot, '.published'), build } = {}) {
  projectRoot = await realpath(projectRoot);
  publishRoot = resolve(publishRoot);
  if (publishRoot === resolve(projectRoot) || publishRoot === '/' || publishRoot === join(projectRoot, 'src') || publishRoot.startsWith(join(projectRoot, 'src') + sep)) throw new Error('发布目录不能覆盖项目源码');
  await mkdir(join(publishRoot, 'releases'), { recursive: true });
  const lock = join(publishRoot, '.publish-lock');
  const token = randomUUID();
  try { await writeFile(lock, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let active = true;
    try {
      const saved = JSON.parse(await readFile(lock, 'utf8'));
      try { process.kill(saved.pid, 0); } catch (error) { if (error.code === 'ESRCH') active = false; }
    } catch { /* An uncertain lock must not be removed. */ }
    if (active) throw new Error('已有发布任务正在执行');
    await rm(lock);
    await writeFile(lock, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
  }
  const id = `${Date.now()}-${token.slice(0, 8)}`;
  const release = join(publishRoot, 'releases', id);
  const buildDirectory = join(projectRoot, '.publish-build', token);
  const next = join(publishRoot, `.current-${token}`);
  let promoted = false;
  try {
    if (build) await build(release);
    else {
      // Astro keeps prerender bundles inside cwd so Node can resolve dependencies.
      // An external Docker volume cannot receive its assets via rename (EXDEV).
      // Build and verify on the project filesystem, then copy the completed site
      // to the release volume before changing the public symlink.
      const env = { ...process.env, BUILD_OUTPUT_DIR: buildDirectory, ASTRO_TELEMETRY_DISABLED: '1' };
      await command(process.execPath, [join(projectRoot, 'node_modules/astro/bin/astro.mjs'), 'build'], { cwd: projectRoot, env });
      await command(process.execPath, [join(projectRoot, 'scripts/verify.mjs')], { cwd: projectRoot, env });
      await cp(buildDirectory, release, { recursive: true });
    }
    if (!await has(join(release, 'index.html'))) throw new Error('发布产物缺少首页');
    // Container Nginx serves the persistent uploads volume directly. Avoid
    // retaining another complete image library in each historical release.
    if (process.env.SITE_UPLOADS_DIR) await rm(join(release, 'uploads'), { recursive: true, force: true });
    // Track this build's own assets so copied compatibility chunks can expire.
    await writeFile(join(release, '.assets.json'), JSON.stringify(await assetFiles(join(release, '_astro'))));
    // Existing tabs may still request a previous fingerprinted JS chunk.
    const oldReleases = (await readdir(join(publishRoot, 'releases'))).filter(name => name !== id).sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0)).slice(-2);
    for (const old of oldReleases) {
      const oldRoot = join(publishRoot, 'releases', old);
      const assets = join(oldRoot, '_astro');
      const manifest = join(oldRoot, '.assets.json');
      const files = await has(manifest) ? JSON.parse(await readFile(manifest, 'utf8')) : await assetFiles(assets);
      for (const file of files) {
        const target = join(release, '_astro', file);
        await mkdir(dirname(target), { recursive: true });
        await cp(join(assets, file), target, { force: false, errorOnExist: false });
      }
    }
    await symlink(relative(publishRoot, release), next);
    await rename(next, join(publishRoot, 'current'));
    promoted = true;
    const keep = new Set([id, ...oldReleases]);
    for (const old of await readdir(join(publishRoot, 'releases'))) if (!keep.has(old)) await rm(join(publishRoot, 'releases', old), { recursive: true, force: true });
    console.log(`已发布 ${id}`);
    return { release: id, directory: release };
  } finally {
    if (!build) await rm(buildDirectory, { recursive: true, force: true });
    await rm(next, { force: true });
    if (!promoted) await rm(release, { recursive: true, force: true });
    try { if (JSON.parse(await readFile(lock, 'utf8')).token === token) await rm(lock); } catch {}
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publish().catch(error => { console.error(error.message); process.exitCode = 1; });
}
