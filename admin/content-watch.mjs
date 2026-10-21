import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const digest = value => createHash('sha256').update(value).digest('hex');
const ignored = name => name.startsWith('.') || name.startsWith('~') || /(?:~|\.tmp|\.temp|\.swp|\.swx|\.part|\.partial)$/i.test(name);
const signature = info => [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
const equal = (a, b) => a.size === b.size && [...a].every(([path, hash]) => b.get(path) === hash);
const difference = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter(path => a.get(path) !== b.get(path));

/**
 * Poll rather than fs.watch: Docker bind mounts do not reliably forward native events.
 * Only stable content changes publish; timestamps alone and CMS-acknowledged writes do not.
 */
export function createContentWatch({ contentDir, uploadsDir, onChange, enabled = true, intervalMs = 1000, debounceMs = 1500 }) {
  if (!Number.isFinite(intervalMs) || intervalMs < 10 || !Number.isFinite(debounceMs) || debounceMs < 0) throw new Error('Invalid content watch interval.');
  const roots = [
    { path: resolve(contentDir), accepts: path => ['.md', '.json'].includes(extname(path).toLowerCase()) },
    { path: resolve(uploadsDir), accepts: () => true },
  ];
  const status = {
    enabled, mode: 'poll', state: enabled ? 'starting' : 'stopped', intervalMs, debounceMs,
    lastCheckedAt: null, lastChangeAt: null, error: null,
  };
  let baseline = new Map();
  let candidate = null;
  let stableSince = 0;
  let initialized = false;
  let stopped = !enabled;
  let paused = false;
  let timer;
  let generation = 0;
  let fileCache = new Map();
  let inFlight = Promise.resolve();

  async function snapshot() {
    const files = new Map();
    const nextCache = new Map();
    async function walk(path, accepts) {
      let info;
      try { info = await lstat(path, { bigint: true }); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      if (info.isSymbolicLink()) return;
      if (info.isDirectory()) {
        let entries;
        try { entries = await readdir(path, { withFileTypes: true }); }
        catch (error) { if (error.code === 'ENOENT') return; throw error; }
        for (const entry of entries) {
          if (ignored(entry.name) || entry.isSymbolicLink()) continue;
          if (entry.isDirectory() || (entry.isFile() && accepts(entry.name))) await walk(join(path, entry.name), accepts);
        }
        return;
      }
      if (!info.isFile() || !accepts(path)) return;
      const key = signature(info);
      const cached = fileCache.get(path);
      if (cached?.signature === key) {
        files.set(path, cached.hash); nextCache.set(path, cached); return;
      }
      let handle;
      try {
        // A symlink replacing a file between lstat and open must not be followed.
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const before = await handle.stat({ bigint: true });
        if (!before.isFile()) return;
        const hash = createHash('sha256');
        for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
        const after = await handle.stat({ bigint: true });
        if (signature(before) !== signature(after)) throw Object.assign(new Error('文件仍在写入，等待保存完成。'), { code: 'WRITING' });
        const value = { signature: signature(after), hash: hash.digest('hex') };
        files.set(path, value.hash); nextCache.set(path, value);
      } catch (error) {
        if (!['ENOENT', 'ELOOP'].includes(error.code)) throw error;
      } finally { await handle?.close(); }
    }
    for (const root of roots) await walk(root.path, root.accepts);
    fileCache = nextCache;
    return files;
  }

  async function poll() {
    if (stopped || paused) return;
    const observedGeneration = generation;
    try {
      const current = await snapshot();
      if (stopped || paused || observedGeneration !== generation) return;
      const now = Date.now();
      status.lastCheckedAt = new Date(now).toISOString();
      status.error = null;
      if (!initialized) {
        baseline = current; initialized = true; status.state = 'watching';
      } else if (equal(current, baseline)) {
        candidate = null; status.state = 'watching';
      } else if (!candidate || !equal(current, candidate)) {
        candidate = current; stableSince = now;
        status.lastChangeAt = new Date(now).toISOString(); status.state = 'settling';
      } else if (now - stableSince >= debounceMs) {
        const paths = difference(current, baseline);
        baseline = current; candidate = null; status.state = 'watching';
        await onChange({ paths });
      }
    } catch (error) {
      if (stopped) return;
      candidate = null;
      status.state = error.code === 'WRITING' ? 'settling' : 'error';
      status.error = error.code === 'WRITING' ? null : error.message;
    } finally {
      if (!stopped && !paused) {
        timer = setTimeout(() => { inFlight = poll(); }, intervalMs);
        timer.unref();
      }
    }
  }

  inFlight = poll();
  const ready = inFlight;
  return {
    status, ready,
    async pause() {
      if (stopped) return;
      paused = true; generation += 1; clearTimeout(timer);
      await inFlight;
      status.state = 'paused';
    },
    resume() {
      if (stopped || !paused) return;
      paused = false; status.state = 'watching';
      // Keep the acknowledged baseline so an unrelated external edit is still noticed.
      timer = setTimeout(() => { inFlight = poll(); }, intervalMs); timer.unref();
    },
    /** Use the bytes actually written, not a reread that could consume a concurrent external edit. */
    acknowledge(path, bytes) {
      if (stopped) return;
      path = resolve(path);
      generation += 1;
      if (bytes === null) { baseline.delete(path); candidate?.delete(path); }
      else { const hash = digest(bytes); baseline.set(path, hash); candidate?.set(path, hash); }
      if (candidate && equal(candidate, baseline)) { candidate = null; status.state = 'watching'; }
    },
    async close() {
      stopped = true; clearTimeout(timer); status.state = 'stopped';
      await inFlight;
    },
  };
}
