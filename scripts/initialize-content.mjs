import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const markerName = '.content-initialized';

async function writeMissing(path, source) {
  await mkdir(dirname(path), { recursive: true });
  try { await writeFile(path, source, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}

async function hasContent(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.gitkeep', '.DS_Store', markerName].includes(entry.name)) continue;
    if (!entry.isDirectory() || await hasContent(join(directory, entry.name))) return true;
  }
  return false;
}

async function copyStarterPosts(defaultsDir, contentDir) {
  let entries;
  try { entries = await readdir(defaultsDir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const source = join(defaultsDir, entry.name), target = join(contentDir, entry.name);
    if (entry.isDirectory()) await copyStarterPosts(source, target);
    else if (entry.isFile() && entry.name.endsWith('.md')) await writeMissing(target, await readFile(source));
  }
}

/** Seed only a new directory. Existing sites receive missing config files, never sample records. */
export async function initializeContent({ defaultsDir = join(project, 'admin/defaults'), contentDir = join(project, 'src/content') } = {}) {
  await mkdir(contentDir, { recursive: true });
  const marker = join(contentDir, markerName);
  let state;
  try { state = JSON.parse(await readFile(marker, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (state?.status === 'complete') return;
  if (state && state.status !== 'initializing') throw new Error('Invalid content initialization marker.');

  const fresh = state ? state.fresh === true : !await hasContent(contentDir);
  if (!state) await writeMissing(marker, JSON.stringify({ version: 1, status: 'initializing', fresh }));

  for (const name of ['site.json', 'library.json', 'friends.json']) {
    let source;
    if (!fresh && name !== 'site.json') source = '[]\n';
    else {
      try { source = await readFile(join(defaultsDir, name)); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    }
    await writeMissing(join(contentDir, name), source);
  }
  if (fresh) await copyStarterPosts(join(defaultsDir, 'blog'), join(contentDir, 'blog'));

  // A completed marker prevents intentionally deleted examples from reappearing.
  // The initial marker lets an interrupted first copy finish on the next startup.
  const nextMarker = `${marker}.next`;
  await writeFile(nextMarker, JSON.stringify({ version: 1, status: 'complete', fresh }) + '\n', { mode: 0o600 });
  await rename(nextMarker, marker);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await initializeContent();
