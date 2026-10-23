import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveInside, VaultMissingError } from '@core/fs/safePath';
import { Vault } from '@core/repos/Vault';
import { VaultService } from '@core/repos/VaultService';
import { tempDir, removeDir } from '../helpers';
import { friendlyError } from '../../src/main/errors';

const fsError = (code: string, path?: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`${code}: raw node message`), { code, syscall: 'open', ...(path ? { path } : {}) });

describe('friendlyError', () => {
  it('rewrites file system errors as plain sentences', () => {
    expect(friendlyError(fsError('ENOENT', '/v/notes/a.md'))).toBe(
      '"/v/notes/a.md" is missing. It may have been moved, renamed or deleted.',
    );
    expect(friendlyError(fsError('EACCES', '/v'))).toMatch(/isn't allowed to access "\/v"/);
    expect(friendlyError(fsError('ENOSPC'))).toBe('The disk is full, so Lode could not save.');
    expect(friendlyError(fsError('EWHATEVER', '/v'))).toBe('Lode could not read or write "/v" (EWHATEVER).');
  });

  it('keeps ordinary messages and handles non-errors', () => {
    expect(friendlyError(new Error('Point not found'))).toBe('Point not found');
    expect(friendlyError('nope')).toBe('Unexpected error');
  });

  it('reports a missing vault folder by name', async () => {
    const err = await resolveInside('/no/such/vault-root', 'notes').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VaultMissingError);
    expect(friendlyError(err)).toBe('The vault folder "/no/such/vault-root" is missing. It may have been moved, renamed or deleted.');
  });

  it('opening a vault whose folder is gone fails without recreating it', async () => {
    const parent = await tempDir();
    const root = join(parent, 'gone');
    try {
      await expect(new VaultService(new Vault(root)).init()).rejects.toBeInstanceOf(VaultMissingError);
      expect(existsSync(root)).toBe(false);
    } finally {
      await removeDir(parent);
    }
  });
});
