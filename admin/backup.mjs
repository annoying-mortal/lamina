import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { zipSync } from 'fflate';
import { parsePostSource, assertUniquePosts, isPostFile } from '../lib/posts.mjs';
import { prepareBackupImages, validateBackupImage } from './backup-images.mjs';

export const BACKUP_LIMITS = Object.freeze({ compressed: 256 * 1024 * 1024, expanded: 512 * 1024 * 1024, entries: 10000, image: 20 * 1024 * 1024, json: 8 * 1024 * 1024, markdown: 2 * 1024 * 1024 });
const FORMAT = 'personal-blog-backup';
const TTL = 15 * 60 * 1000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const check = (condition, message, status = 400) => { if (!condition) fail(status, message); };
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const decode = bytes => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail(400, 'Backup contains invalid UTF-8 text.'); } };
const parseJson = (bytes, name) => { try { return JSON.parse(decode(bytes)); } catch (error) { if (error.status) throw error; fail(400, `${name} contains invalid JSON.`); } };
const imageName = /^images\/(backup-([a-f0-9]{64})\.(png|jpg|gif|webp|svg|ico|avif))$/;
const allowed = path => path === 'manifest.json' || /^content\/(site|library|friends|media)\.json$/.test(path) || (path.startsWith('content/blog/') && isPostFile(path.slice(13))) || imageName.test(path);
const fileLimit = path => path.startsWith('images/') ? BACKUP_LIMITS.image : path.endsWith('.md') ? BACKUP_LIMITS.markdown : BACKUP_LIMITS.json;
function safePath(path) {
  check(path.length > 0 && path.length <= 1000 && !/[\\\u0000-\u001f\u007f:]/.test(path) && !path.startsWith('/') && !path.split('/').some(part => !part || part.startsWith('.') || part.startsWith('~')), 'Unsafe path in ZIP backup.');
  return path;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }

/** Check the central directory before allocating decompression buffers. ZIP64 and encrypted archives are intentionally unsupported. */
export function unpackBackup(input, limits = BACKUP_LIMITS) {
  const bytes = Buffer.from(input);
  check(bytes.length <= limits.compressed, 'ZIP backup exceeds the 256 MiB upload limit.', 413);
  check(bytes.length >= 22, 'Invalid ZIP backup.');
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { eocd = i; break; }
  }
  check(eocd >= 0, 'Invalid ZIP directory.');
  const count = bytes.readUInt16LE(eocd + 10), directorySize = bytes.readUInt32LE(eocd + 12), directoryOffset = bytes.readUInt32LE(eocd + 16);
  check(bytes.readUInt16LE(eocd + 4) === 0 && bytes.readUInt16LE(eocd + 6) === 0 && bytes.readUInt16LE(eocd + 8) === count && count !== 65535 && directoryOffset !== 0xffffffff && directorySize !== 0xffffffff, 'Multi-volume and ZIP64 backups are unsupported.');
  check(count > 0 && count <= limits.entries, 'Too many files in ZIP backup.', 413);
  check(directoryOffset + directorySize === eocd, 'Invalid ZIP directory bounds.');
  const entries = [], names = new Set(), ranges = [];
  let cursor = directoryOffset, total = 0;
  for (let i = 0; i < count; i++) {
    check(cursor + 46 <= eocd && bytes.readUInt32LE(cursor) === 0x02014b50, 'Invalid ZIP entry.');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), crc = bytes.readUInt32LE(cursor + 16), compressed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24);
    const nameSize = bytes.readUInt16LE(cursor + 28), extraSize = bytes.readUInt16LE(cursor + 30), commentSize = bytes.readUInt16LE(cursor + 32), attributes = bytes.readUInt32LE(cursor + 38), offset = bytes.readUInt32LE(cursor + 42);
    check(cursor + 46 + nameSize + extraSize + commentSize <= eocd, 'Truncated ZIP entry.');
    const path = safePath(decode(bytes.subarray(cursor + 46, cursor + 46 + nameSize)));
    check(allowed(path), `Unsupported file in backup: ${path}`);
    const key = path.normalize('NFC').toLocaleLowerCase('en-US');
    check(!names.has(key), `Duplicate or case-colliding ZIP path: ${path}`); names.add(key);
    const mode = (attributes >>> 16) & 0xf000;
    check(mode === 0 || mode === 0x8000, 'ZIP symlinks and special files are forbidden.');
    check(!(attributes & 16) && bytes.readUInt16LE(cursor + 34) === 0 && (flags & ~0x808) === 0 && [0, 8].includes(method), 'Unsupported ZIP entry type or encryption.');
    check(compressed !== 0xffffffff && size !== 0xffffffff && size <= fileLimit(path), `File exceeds backup limits: ${path}`, 413);
    total += size; check(total <= limits.expanded, 'Expanded ZIP backup exceeds 512 MiB.', 413);
    check(offset + 30 <= directoryOffset && bytes.readUInt32LE(offset) === 0x04034b50, 'Invalid ZIP local entry.');
    const localNameSize = bytes.readUInt16LE(offset + 26), localExtraSize = bytes.readUInt16LE(offset + 28), start = offset + 30 + localNameSize + localExtraSize;
    check(start + compressed <= directoryOffset && bytes.readUInt16LE(offset + 6) === flags && bytes.readUInt16LE(offset + 8) === method && decode(bytes.subarray(offset + 30, offset + 30 + localNameSize)) === path, 'ZIP directory and local entry disagree.');
    if (!(flags & 8)) check(bytes.readUInt32LE(offset + 14) === crc && bytes.readUInt32LE(offset + 18) === compressed && bytes.readUInt32LE(offset + 22) === size, 'ZIP entry sizes disagree.');
    ranges.push([offset, start + compressed]);
    entries.push({ path, size, method, crc, compressed, start });
    cursor += 46 + nameSize + extraSize + commentSize;
  }
  check(cursor === eocd, 'ZIP directory length mismatch.');
  for (const entry of entries) {
    const parts = entry.path.normalize('NFC').toLocaleLowerCase('en-US').split('/');
    for (let i = 1; i < parts.length; i++) check(!names.has(parts.slice(0, i).join('/')), 'ZIP contains conflicting file and directory paths.');
  }
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) check(ranges[i - 1][1] <= ranges[i][0], 'Overlapping ZIP entries.');
  const files = new Map();
  for (const entry of entries) {
    const compressed = bytes.subarray(entry.start, entry.start + entry.compressed);
    let data;
    try { data = entry.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size) }); }
    catch { fail(400, `Invalid or oversized compressed file: ${entry.path}`); }
    check(data.length === entry.size && crc32(data) === entry.crc, `ZIP checksum mismatch: ${entry.path}`);
    files.set(entry.path, data);
  }
  return files;
}

export async function readBackupBody(req) {
  check(['application/zip', 'application/octet-stream', 'application/x-zip-compressed'].includes(req.headers['content-type']?.split(';')[0].toLowerCase()), 'Upload the ZIP file directly.', 415);
  check(Number(req.headers['content-length'] || 0) <= BACKUP_LIMITS.compressed, 'ZIP backup exceeds 256 MiB.', 413);
  const chunks = []; let size = 0;
  try { for await (const chunk of req) { size += chunk.length; check(size <= BACKUP_LIMITS.compressed, 'ZIP backup exceeds 256 MiB.', 413); chunks.push(chunk); } }
  catch (error) { if (error.status) throw error; fail(400, 'Backup upload was interrupted.'); }
  return Buffer.concat(chunks);
}

async function safeTarget(root, path, createParents = false) {
  root = resolve(root); path = resolve(path);
  check(path.startsWith(root + sep), 'Restore target is outside its content directory.');
  let current = root;
  for (const part of ['', ...relative(root, dirname(path)).split(sep).filter(Boolean)]) {
    if (part) current = join(current, part);
    let info;
    try { info = await lstat(current); }
    catch (error) { if (error.code !== 'ENOENT') throw error; if (!createParents) continue; await mkdir(current); info = await lstat(current); }
    check(info.isDirectory() && !info.isSymbolicLink(), 'Restore cannot traverse symbolic links or non-directory paths.', 409);
  }
  try { const info = await lstat(path); check(info.isFile() && !info.isSymbolicLink(), 'Restore cannot replace a symbolic link or non-file.', 409); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return path;
}
async function readRegular(root, path, maxSize = BACKUP_LIMITS.image) {
  await safeTarget(root, path);
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); const info = await handle.stat(); check(info.isFile(), 'Backup source is not a regular file.'); check(info.size <= maxSize, 'Backup source exceeds the file size limit.', 413); const chunks = []; let size = 0; for await (const chunk of handle.createReadStream({ autoClose: false })) { size += chunk.length; check(size <= maxSize, 'Backup source exceeds the file size limit.', 413); chunks.push(chunk); } return Buffer.concat(chunks); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  finally { await handle?.close(); }
}
async function atomic(path, bytes, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = join(dirname(path), `.${randomBytes(16).toString('hex')}.tmp`);
  try { await writeFile(temp, bytes, { flag: 'wx', mode }); await rename(temp, path); }
  finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export function createBackupStore({ projectRoot, dataDir, uploadsDir, backupDir = join(projectRoot, '.admin/backups'), siteUrl, readSettings, validators, acknowledge = () => {}, beforeWrite, now = Date.now }) {
  const pending = new Map();
  async function collect() {
    const files = new Map();
    let total = 0;
    const add = (path, bytes) => { total += bytes.length; check(files.size + 1 < BACKUP_LIMITS.entries && total <= BACKUP_LIMITS.expanded, 'Current content exceeds backup limits.', 413); files.set(path, bytes); };
    for (const name of ['site.json', 'library.json', 'friends.json', 'media.json']) {
      const bytes = await readRegular(dataDir, join(dataDir, name), BACKUP_LIMITS.json);
      if (bytes !== null) add(`content/${name}`, bytes);
    }
    async function walk(directory = '') {
      const path = join(dataDir, 'blog', directory);
      let entries; try { const info = await lstat(path); check(info.isDirectory() && !info.isSymbolicLink(), 'Blog content cannot contain symbolic links.'); entries = await readdir(path, { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name.startsWith('~')) continue;
        const filename = directory ? `${directory}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(filename);
        else if (isPostFile(filename)) { check(!entry.isSymbolicLink() && entry.isFile(), 'Blog content cannot contain symbolic links.'); add(`content/blog/${filename}`, await readRegular(dataDir, join(dataDir, 'blog', filename), BACKUP_LIMITS.markdown)); }
      }
    }
    await walk();
    return files;
  }
  async function fingerprint(files = null) {
    files ??= await collect();
    const entries = [...files].map(([path, bytes]) => [path, hash(bytes)]);
    async function walk(directory = '') {
      let list; try { list = await readdir(join(uploadsDir, directory), { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const entry of list) {
        if (entry.name.startsWith('.')) continue;
        const local = directory ? `${directory}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(local);
        else if (entry.isFile()) {
          const path = join(uploadsDir, local); await safeTarget(uploadsDir, path);
          let handle;
          try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); const digest = createHash('sha256'); for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk); entries.push([`uploads/${local}`, digest.digest('hex')]); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          finally { await handle?.close(); }
        }
      }
    }
    await walk(); return hash(JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b))));
  }
  function validate(files) {
    for (const required of ['content/site.json', 'content/library.json', 'content/friends.json']) check(files.has(required), `Backup is missing ${required}.`);
    const settings = parseJson(files.get('content/site.json'), 'site.json');
    const normalizedSettings = validators.settings(settings);
    const library = parseJson(files.get('content/library.json'), 'library.json'), friends = parseJson(files.get('content/friends.json'), 'friends.json');
    for (const [name, list, validator] of [['Library', library, item => validators.library(item, normalizedSettings.libraryTypes)], ['Friends', friends, validators.friend]]) {
      check(Array.isArray(list) && list.length <= 10000, `${name} must be an array of at most 10,000 records.`);
      const ids = new Set(); for (const item of list) { const validated = validator(item); check(!ids.has(validated.id), `Duplicate ${name} ID.`); ids.add(validated.id); }
    }
    const posts = [];
    for (const [path, bytes] of files) {
      if (!path.startsWith('content/blog/')) continue;
      const filename = path.slice(13), { post } = parsePostSource(decode(bytes), { filename, defaultCategoryId: normalizedSettings.categories[0]?.id });
      validators.post(post, normalizedSettings.categories); posts.push({ ...post, sourcePath: filename });
    }
    assertUniquePosts(posts);
    const images = new Map();
    for (const [path, bytes] of files) {
      const match = imageName.exec(path); if (!match) continue;
      const detected = validateBackupImage(bytes);
      check(hash(bytes) === match[2] && detected.ext === match[3], `Image filename or content checksum is invalid: ${path}`);
      images.set(match[1], { mime: detected.mime, size: bytes.length });
    }
    const media = files.has('content/media.json') ? parseJson(files.get('content/media.json'), 'media.json') : [];
    check(Array.isArray(media) && media.length <= BACKUP_LIMITS.entries, 'Invalid backup media index.');
    const mediaIds = new Set();
    for (const item of media) {
      check(isObject(item) && images.has(item.id) && !mediaIds.has(item.id) && item.url === `/uploads/${item.id}` && item.mime === images.get(item.id).mime && item.size === images.get(item.id).size && typeof item.name === 'string' && item.name.length <= 240 && !/[\u0000-\u001f\u007f/\\]/.test(item.name) && typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)), 'Invalid backup media record.');
      mediaIds.add(item.id);
    }
    check(mediaIds.size === images.size, 'Backup media index does not match packaged images.');
    return { summary: { blog: posts.length, library: library.length, friends: friends.length, images: images.size }, media };
  }
  async function archive() {
    const files = await collect();
    if (!files.has('content/site.json')) files.set('content/site.json', jsonBytes(await readSettings()));
    for (const path of ['content/library.json', 'content/friends.json']) if (!files.has(path)) files.set(path, jsonBytes([]));
    const result = await prepareBackupImages({ files, projectRoot, dataDir, uploadsDir, siteUrl });
    const { summary } = validate(result.files);
    let size = 0; check(result.files.size + 1 <= BACKUP_LIMITS.entries, 'Too many backup entries.', 413);
    const paths = new Set();
    for (const [path, bytes] of result.files) { safePath(path); const key = path.normalize('NFC').toLocaleLowerCase('en-US'); check(!paths.has(key), `Duplicate or case-colliding backup path: ${path}`); paths.add(key); check(allowed(path) && bytes.length <= fileLimit(path), `File exceeds backup limits: ${path}`, 413); size += bytes.length; }
    for (const path of paths) { const parts = path.split('/'); for (let i = 1; i < parts.length; i++) check(!paths.has(parts.slice(0, i).join('/')), 'Backup contains conflicting file and directory paths.'); }
    check(size <= BACKUP_LIMITS.expanded, 'Backup exceeds 512 MiB expanded.', 413);
    const createdAt = new Date(now()).toISOString();
    const manifest = { format: FORMAT, version: 1, createdAt, summary, warnings: result.warnings, files: [...result.files].map(([path, bytes]) => ({ path, size: bytes.length, sha256: hash(bytes) })) };
    const entries = Object.create(null);
    for (const [path, bytes] of result.files) entries[path] = bytes;
    entries['manifest.json'] = jsonBytes(manifest);
    check(entries['manifest.json'].length <= BACKUP_LIMITS.json && size + entries['manifest.json'].length <= BACKUP_LIMITS.expanded, 'Backup manifest exceeds size limits.', 413);
    const bytes = Buffer.from(zipSync(entries, { level: 6 }));
    check(bytes.length <= BACKUP_LIMITS.compressed, 'Backup exceeds 256 MiB compressed.', 413);
    return { bytes, summary, createdAt, warnings: result.warnings, filename: `personal-blog-backup-${createdAt.replace(/[:.]/g, '-')}.zip` };
  }
  function sweep() { for (const [key, value] of pending) if (value.expiresAt <= now()) pending.delete(key); }
  return {
    export: archive,
    async inspect(bytes, sessionKey, filename = '') {
      sweep();
      const files = unpackBackup(bytes), manifestBytes = files.get('manifest.json');
      check(manifestBytes, 'ZIP is missing manifest.json.');
      const manifest = parseJson(manifestBytes, 'manifest.json'); files.delete('manifest.json');
      check(isObject(manifest) && manifest.format === FORMAT && manifest.version === 1 && typeof manifest.createdAt === 'string' && Number.isFinite(Date.parse(manifest.createdAt)) && Array.isArray(manifest.files) && manifest.files.length === files.size, 'Unsupported or invalid backup manifest.');
      const names = new Set();
      for (const item of manifest.files) { check(isObject(item) && typeof item.path === 'string' && !names.has(item.path) && files.has(item.path) && item.size === files.get(item.path).length && item.sha256 === hash(files.get(item.path)), 'Backup manifest checksum mismatch.'); names.add(item.path); }
      const validated = validate(files);
      const warnings = manifest.warnings ?? [];
      check(Array.isArray(warnings) && warnings.length <= 10000 && warnings.every(item => typeof item === 'string' && item.length <= 8000), 'Invalid backup warnings.');
      const size = [...files.values()].reduce((sum, value) => sum + value.length, 0);
      while (pending.size && (pending.size >= 3 || [...pending.values()].reduce((sum, value) => sum + value.size, 0) + size > BACKUP_LIMITS.expanded)) pending.delete(pending.keys().next().value);
      const token = randomBytes(32).toString('hex'), expiresAt = now() + TTL;
      pending.set(token, { files, ...validated, sessionKey, expiresAt, fingerprint: await fingerprint(), size });
      return { token, filename: typeof filename === 'string' ? filename.replace(/[\u0000-\u001f\u007f/\\]/g, '').slice(0, 240) : '', summary: validated.summary, warnings, createdAt: manifest.createdAt, expiresAt: new Date(expiresAt).toISOString() };
    },
    async restore(token, sessionKey, { authorize = action => action(), begin = async () => {}, end = async () => {} } = {}) {
      sweep();
      const prepared = pending.get(token);
      check(prepared && prepared.sessionKey === sessionKey, 'Backup preview expired or belongs to another session. Upload it again.', 409);
      pending.delete(token);
      const original = await collect();
      check(await fingerprint(original) === prepared.fingerprint, 'Content changed after the preview. Upload the backup again before restoring.', 409);
      const rollbackId = `before-restore-${new Date(now()).toISOString().replace(/[:.]/g, '-')}-${randomBytes(6).toString('hex')}.zip`;
      const backups = resolve(backupDir), publicRoot = resolve(projectRoot, 'public');
      check(backups !== publicRoot && !backups.startsWith(publicRoot + sep) && backups !== resolve(dataDir) && !backups.startsWith(resolve(dataDir) + sep) && backups !== resolve(uploadsDir) && !backups.startsWith(resolve(uploadsDir) + sep), 'Recovery snapshots must be outside public content.');
      const desired = new Map();
      for (const [path, bytes] of prepared.files) {
        if (path === 'content/media.json') continue;
        desired.set(path.startsWith('images/') ? join(uploadsDir, path.slice(7)) : join(dataDir, path.slice(8)), bytes);
      }
      let originalMedia = [];
      if (original.has('content/media.json')) { try { const media = JSON.parse(decode(original.get('content/media.json'))); if (Array.isArray(media)) originalMedia = media.filter(isObject); } catch {} }
      const ids = new Set(prepared.media.map(item => item.id));
      desired.set(join(dataDir, 'media.json'), jsonBytes([...prepared.media, ...originalMedia.filter(item => !ids.has(item.id))]));
      for (const path of original.keys()) if (path.startsWith('content/blog/') && !prepared.files.has(path)) desired.set(join(dataDir, path.slice(8)), null);
      const changes = [], staged = [];
      try {
        for (const [path, bytes] of desired) {
          const root = path.startsWith(resolve(uploadsDir) + sep) ? uploadsDir : dataDir;
          await safeTarget(root, path, true);
          const previous = await readRegular(root, path, root === uploadsDir ? BACKUP_LIMITS.image : path.endsWith('.md') ? BACKUP_LIMITS.markdown : BACKUP_LIMITS.json);
          if ((previous === null && bytes === null) || (previous && bytes && previous.equals(bytes))) continue;
          const temp = bytes === null ? null : join(dirname(path), `.${randomBytes(16).toString('hex')}.restore.tmp`);
          if (temp) { await writeFile(temp, bytes, { flag: 'wx', mode: path.startsWith(resolve(uploadsDir) + sep) ? 0o644 : 0o600 }); staged.push(temp); }
          changes.push({ path, root, bytes, previous, temp });
        }
        // Recovery must work even if current JSON or Markdown is broken. Preserve the
        // exact originals without parsing content or fetching any remote images.
        const recovery = Object.fromEntries(original);
        for (const change of changes) if (change.root === uploadsDir && change.previous !== null) recovery[`uploads/${relative(uploadsDir, change.path)}`] = change.previous;
        recovery['manifest.json'] = jsonBytes({ format: 'personal-blog-recovery', version: 1, createdAt: new Date(now()).toISOString(), absent: changes.filter(change => change.previous === null).map(change => change.root === uploadsDir ? `uploads/${relative(uploadsDir, change.path)}` : `content/${relative(dataDir, change.path)}`), files: Object.entries(recovery).map(([path, bytes]) => ({ path, size: bytes.length, sha256: hash(bytes) })) });
        await mkdir(backups, { recursive: true, mode: 0o700 });
        await safeTarget(backups, join(backups, rollbackId)); await atomic(join(backups, rollbackId), Buffer.from(zipSync(recovery, { level: 6 })));
        return await authorize(async () => {
          check(await fingerprint() === prepared.fingerprint, 'Content changed while preparing restore. Upload the backup again.', 409);
          await begin();
          const applied = [];
          try {
            for (const change of changes) {
              await safeTarget(change.root, change.path);
              await beforeWrite?.(change.path, applied.length);
              const current = await readRegular(change.root, change.path, change.root === uploadsDir ? BACKUP_LIMITS.image : change.path.endsWith('.md') ? BACKUP_LIMITS.markdown : BACKUP_LIMITS.json);
              check(current === null ? change.previous === null : change.previous !== null && current.equals(change.previous), 'A file changed during restore; original content will be recovered.', 409);
              if (change.temp) await rename(change.temp, change.path); else await unlink(change.path);
              applied.push(change); acknowledge(change.path, change.bytes);
            }
            return { restored: true, summary: prepared.summary, rollbackId };
          } catch (error) {
            const failures = [];
            for (const change of applied.reverse()) {
              try { if (change.previous === null) await unlink(change.path); else await atomic(change.path, change.previous, change.root === uploadsDir ? 0o644 : 0o600); acknowledge(change.path, change.previous); }
              catch (rollbackError) { failures.push(rollbackError); }
            }
            if (failures.length) throw Object.assign(new Error(`Restore and rollback failed. Recovery snapshot: ${rollbackId}`), { status: 500, cause: error });
            throw Object.assign(new Error(`Restore failed; original content was recovered. Recovery snapshot: ${rollbackId}`), { status: 500, cause: error });
          } finally { await end(); }
        });
      } finally { for (const path of staged) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    },
  };
}
