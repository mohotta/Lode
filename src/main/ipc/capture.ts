import { BrowserWindow, dialog, shell } from 'electron';
import { resolveNote } from '@core/repos/resolveNote';
import type { AddResult } from '@shared/ipc';
import type { PointId } from '@shared/types';
import type { VaultRegistry } from '../VaultRegistry';
import { handle } from './handle';

export function registerCaptureHandlers(registry: VaultRegistry): void {
  handle('vault:list', async () => ({
    vaults: await registry.list(),
    lastVaultId: await registry.lastVaultId(),
  }));

  handle('vault:open', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const opts: Electron.OpenDialogOptions = {
      title: 'Open or create a Lode vault',
      buttonLabel: 'Use as vault',
      properties: ['openDirectory', 'createDirectory'],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const path = res.filePaths[0];
    if (res.canceled || !path) return null;
    return registry.add(path);
  });

  handle('vault:forget', async ({ vaultId }) => registry.forget(vaultId));

  handle('folder:list', async ({ vaultId }) => (await registry.get(vaultId)).service.listFolders());
  handle('folder:create', async ({ vaultId, title }) => (await registry.get(vaultId)).service.createFolder(title));
  handle('folder:rename', async ({ vaultId, folder, title }) =>
    (await registry.get(vaultId)).service.renameFolder(folder, title),
  );
  handle('folder:delete', async ({ vaultId, folder }) => (await registry.get(vaultId)).service.deleteFolder(folder));

  // The only backlog write paths (invariant 1): add, edit and soft delete, all user-initiated.
  handle('backlog:add', async ({ vaultId, folder, text, date, force }): Promise<AddResult> => {
    const v = await registry.get(vaultId);
    // Local check only (no network, invariant 8). Exact repeats are refused even when forced.
    const dup = await v.backlog.findDuplicate(folder, text);
    if (dup && (dup.exact || !force)) {
      return { duplicate: { id: dup.point.id, text: dup.point.text, date: dup.point.date, exact: dup.exact } };
    }
    return { added: await v.backlog.add(folder, text, date) };
  });
  handle('backlog:edit', async ({ vaultId, folder, id, text }) =>
    (await registry.get(vaultId)).backlog.edit(folder, id as PointId, text),
  );
  handle('backlog:softDelete', async ({ vaultId, folder, id, deleted }) =>
    (await registry.get(vaultId)).backlog.setDeleted(folder, id as PointId, deleted),
  );

  handle('backlog:listDays', async ({ vaultId, folder }) => {
    const v = await registry.get(vaultId);
    const [filing, corrected, duplicates] = await Promise.all([
      v.notes.filing(folder),
      v.notes.correctedIds(folder),
      v.notes.duplicates(folder),
    ]);
    return v.backlog.listDays(folder, filing, corrected, duplicates);
  });

  handle('notes:list', async ({ vaultId, folder }) => (await registry.get(vaultId)).notes.listSubtopics(folder));

  handle('notes:read', async ({ vaultId, folder, subtopic }) => {
    const v = await registry.get(vaultId);
    const note = await v.notes.read(folder, subtopic);
    if (!note) throw new Error('Note not found');
    return resolveNote(folder, subtopic, note, await v.backlog.listPoints(folder), await v.notes.canUndo(folder, subtopic, note));
  });

  // Title-only rename; the note's slug, path and blocks are unchanged.
  handle('notes:rename', async ({ vaultId, folder, subtopic, title }) =>
    (await registry.get(vaultId)).notes.rename(folder, subtopic, title),
  );

  // Moves the note to the vault trash; its points become unfiled again.
  handle('notes:delete', async ({ vaultId, folder, subtopic }) => (await registry.get(vaultId)).notes.trash(folder, subtopic));
  handle('notes:undoRegenerate', async ({ vaultId, folder, subtopic }) =>
    (await registry.get(vaultId)).notes.undoRegenerate(folder, subtopic),
  );

  handle('trash:list', async ({ vaultId }) => (await registry.get(vaultId)).trash.list());
  handle('trash:restore', async ({ vaultId, id }) => (await registry.get(vaultId)).trash.restore(id));
  handle('trash:purge', async ({ vaultId, id }) => (await registry.get(vaultId)).trash.purge(id));

  handle('review:list', async ({ vaultId }) => {
    const v = await registry.get(vaultId);
    return v.review.listDue({
      folders: await v.service.listFolders(),
      points: (folder) => v.backlog.listPoints(folder),
      filing: (folder) => v.notes.filing(folder),
      subtopics: (folder) => v.notes.listSubtopics(folder),
    });
  });
  handle('review:mark', async ({ vaultId, items }) =>
    (await registry.get(vaultId)).review.mark(items.map((i) => ({ id: i.id as PointId, stage: i.stage }))),
  );

  handle('digest:periods', async ({ vaultId, folder }) => {
    const v = await registry.get(vaultId);
    return v.digests.periods(folder, await v.backlog.listPoints(folder));
  });
  handle('digest:list', async ({ vaultId, folder }) => (await registry.get(vaultId)).digests.list(folder));
  handle('digest:read', async ({ vaultId, folder, digest }) => {
    const v = await registry.get(vaultId);
    const note = await v.digests.read(folder, digest);
    if (!note) throw new Error('Digest not found');
    return resolveNote(folder, digest, note, await v.backlog.listPoints(folder));
  });
  handle('digest:delete', async ({ vaultId, folder, digest }) => (await registry.get(vaultId)).digests.delete(folder, digest));

  // Local only: the index is built from the vault's own files (invariant 8).
  handle('search:query', async ({ vaultId, q, limit }) => (await registry.get(vaultId)).index.query(q, limit));

  handle('link:open', async ({ url }) => {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https links can be opened');
    await shell.openExternal(u.toString());
  });
}
