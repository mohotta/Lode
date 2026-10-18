import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { atomicWrite } from '@core/fs/atomicWrite';
import { KeyedMutex } from '@core/fs/mutex';
import { PathEscapeError, resolveInside } from '@core/fs/safePath';
import { removeDir, tempDir } from '../helpers';

let dir: string;
beforeEach(async () => {
  dir = await tempDir();
});
afterEach(async () => {
  await removeDir(dir);
});

describe('resolveInside', () => {
  it('allows paths inside the root', async () => {
    expect(await resolveInside(dir, 'a', 'b.md')).toBe(join(dir, 'a', 'b.md'));
  });

  it('rejects traversal and absolute escapes', async () => {
    await expect(resolveInside(dir, '..', 'x')).rejects.toBeInstanceOf(PathEscapeError);
    await expect(resolveInside(dir, 'a/../../x')).rejects.toBeInstanceOf(PathEscapeError);
    await expect(resolveInside(dir, '/etc/passwd')).rejects.toBeInstanceOf(PathEscapeError);
  });

  it('rejects symlinks that point outside', async () => {
    const outside = await tempDir('lode-outside-');
    try {
      await symlink(outside, join(dir, 'link'));
      await expect(resolveInside(dir, 'link', 'file.md')).rejects.toBeInstanceOf(PathEscapeError);
    } finally {
      await removeDir(outside);
    }
  });
});

describe('atomicWrite', () => {
  it('writes content and leaves no temp files', async () => {
    const target = join(dir, 'sub', 'f.md');
    await atomicWrite(target, 'one');
    await atomicWrite(target, 'two');
    expect(await readFile(target, 'utf8')).toBe('two');
    expect(await readdir(join(dir, 'sub'))).toEqual(['f.md']);
  });

  it('does not touch the target if the rename fails', async () => {
    const target = join(dir, 'isdir');
    await mkdir(target);
    await writeFile(join(target, 'keep'), 'x');
    await expect(atomicWrite(target, 'boom')).rejects.toThrow();
    expect(await readdir(dir)).toEqual(['isdir']);
  });
});

describe('KeyedMutex', () => {
  it('serialises work per key', async () => {
    const m = new KeyedMutex();
    const order: string[] = [];
    const slow = m.run('k', async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('first');
    });
    const fast = m.run('k', async () => {
      order.push('second');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['first', 'second']);
  });

  it('keeps going after a failure', async () => {
    const m = new KeyedMutex();
    await expect(m.run('k', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(m.run('k', async () => 1)).resolves.toBe(1);
  });
});
