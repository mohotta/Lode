import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

export async function tempDir(prefix = 'lode-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

/** sha256 of every file under each `<folder>/backlog/` directory, keyed by vault-relative path. */
export async function hashBacklogs(vaultRoot: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const file of await walk(vaultRoot)) {
    const rel = relative(vaultRoot, file);
    if (!rel.split(/[\\/]/).includes('backlog')) continue;
    out[rel] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
  return out;
}
