import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export class PathEscapeError extends Error {
  constructor(target: string) {
    super(`Refusing to access a path outside the vault: ${target}`);
    this.name = 'PathEscapeError';
  }
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..'));
}

async function realpathOfNearestExisting(p: string): Promise<string> {
  let current = p;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(current);
      return tail.length ? resolve(real, ...tail.reverse()) : real;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      const parent = dirname(current);
      if (parent === current) return p;
      tail.push(current.slice(parent.length).replace(/^[\\/]/, ''));
      current = parent;
    }
  }
}

/** The vault's own folder is gone (moved, renamed or deleted outside Lode). */
export class VaultMissingError extends Error {
  constructor(readonly root: string) {
    super(`The vault folder "${root}" is missing. It may have been moved, renamed or deleted.`);
    this.name = 'VaultMissingError';
  }
}

/**
 * Resolves `segments` under `root` and verifies the result stays inside it,
 * both lexically and after following symlinks.
 */
export async function resolveInside(root: string, ...segments: string[]): Promise<string> {
  const absRoot = resolve(root);
  const target = resolve(absRoot, ...segments);
  if (!isInside(absRoot, target)) throw new PathEscapeError(target);
  const [realRoot, realTarget] = await Promise.all([
    realpath(absRoot).catch((err: unknown) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new VaultMissingError(absRoot);
      throw err;
    }),
    realpathOfNearestExisting(target),
  ]);
  if (!isInside(realRoot, realTarget)) throw new PathEscapeError(target);
  return target;
}
