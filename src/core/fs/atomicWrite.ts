import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export const TEMP_PREFIX = '.lode-tmp-';

/** Writes via a temp file in the same directory, fsyncs, then renames over the target. */
export async function atomicWrite(target: string, content: string): Promise<void> {
  const dir = dirname(target);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `${TEMP_PREFIX}${basename(target)}-${randomBytes(6).toString('hex')}`);
  const handle = await open(tmp, 'wx');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
