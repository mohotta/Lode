/**
 * Turns an error into a message for the UI. File system errors from Node ("ENOENT: no such
 * file or directory, open '…'") become plain sentences; other messages pass through.
 */
export function friendlyError(err: unknown): string {
  if (!(err instanceof Error)) return 'Unexpected error';
  const e = err as NodeJS.ErrnoException;
  if (!e.code || !e.syscall) return e.message;
  const what = e.path ? `"${e.path}"` : 'A file';
  switch (e.code) {
    case 'ENOENT':
      return `${what} is missing. It may have been moved, renamed or deleted.`;
    case 'EACCES':
    case 'EPERM':
      return `Lode isn't allowed to access ${what}. Check the folder's permissions.`;
    case 'ENOSPC':
      return 'The disk is full, so Lode could not save.';
    case 'EROFS':
      return `${what} is on a read-only disk.`;
    case 'ENOTDIR':
    case 'EISDIR':
      return `${what} is not the kind of file or folder Lode expected.`;
    case 'EBUSY':
      return `${what} is in use by another program. Try again.`;
    default:
      return `Lode could not read or write ${what} (${e.code}).`;
  }
}
