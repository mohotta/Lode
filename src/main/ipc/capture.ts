import { BrowserWindow, dialog, shell } from 'electron';
import { resolveNote } from '@core/repos/resolveNote';
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

  // The only backlog write path in M1 (invariant 1).
  handle('backlog:add', async ({ vaultId, folder, text, date }) =>
    (await registry.get(vaultId)).backlog.add(folder, text, date),
  );

  handle('backlog:listDays', async ({ vaultId, folder }) => {
    const v = await registry.get(vaultId);
    const [filing, corrected] = await Promise.all([v.notes.filing(folder), v.notes.correctedIds(folder)]);
    return v.backlog.listDays(folder, filing, corrected);
  });

  handle('notes:list', async ({ vaultId, folder }) => (await registry.get(vaultId)).notes.listSubtopics(folder));

  handle('notes:read', async ({ vaultId, folder, subtopic }) => {
    const v = await registry.get(vaultId);
    const note = await v.notes.read(folder, subtopic);
    if (!note) throw new Error('Note not found');
    return resolveNote(folder, subtopic, note, await v.backlog.listPoints(folder));
  });

  // Title-only rename; the note's slug, path and blocks are unchanged.
  handle('notes:rename', async ({ vaultId, folder, subtopic, title }) =>
    (await registry.get(vaultId)).notes.rename(folder, subtopic, title),
  );

  handle('link:open', async ({ url }) => {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https links can be opened');
    await shell.openExternal(u.toString());
  });
}
