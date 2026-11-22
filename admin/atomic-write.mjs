import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function atomicWrite(path, data, { mode = 0o600, directoryMode = 0o777 } = {}) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: directoryMode });
  const temp = join(directory, `.${randomUUID()}.tmp`);
  const file = await open(temp, 'wx', mode);
  try {
    try { await file.writeFile(data); }
    finally { await file.close(); }
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
