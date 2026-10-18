import { contextBridge, ipcRenderer } from 'electron';
import type { LodeApi } from './api';

// One named method per channel. There is deliberately no generic invoke().
const call =
  (channel: string) =>
  (payload: object = {}) =>
    ipcRenderer.invoke(channel, payload);

const api: LodeApi = {
  vault: {
    list: () => call('vault:list')(),
    open: () => call('vault:open')(),
    forget: (vaultId) => call('vault:forget')({ vaultId }),
  },
  folder: {
    list: (vaultId) => call('folder:list')({ vaultId }),
    create: (vaultId, title) => call('folder:create')({ vaultId, title }),
    rename: (vaultId, folder, title) => call('folder:rename')({ vaultId, folder, title }),
    delete: (vaultId, folder) => call('folder:delete')({ vaultId, folder }),
  },
  backlog: {
    add: (vaultId, folder, text, date) => call('backlog:add')({ vaultId, folder, text, ...(date ? { date } : {}) }),
    listDays: (vaultId, folder) => call('backlog:listDays')({ vaultId, folder }),
  },
  notes: {
    list: (vaultId, folder) => call('notes:list')({ vaultId, folder }),
    read: (vaultId, folder, subtopic) => call('notes:read')({ vaultId, folder, subtopic }),
    rename: (vaultId, folder, subtopic, title) => call('notes:rename')({ vaultId, folder, subtopic, title }),
  },
  link: {
    open: (url) => call('link:open')({ url }),
  },
  settings: {
    get: () => call('settings:get')(),
    set: (patch) => call('settings:set')(patch),
  },
  keys: {
    set: (id, key) => call('keys:set')({ id, key }),
    has: (id) => call('keys:has')({ id }),
    test: (id) => call('keys:test')({ id }),
    clear: (id) => call('keys:clear')({ id }),
  },
  generate: {
    preview: (vaultId, folder) => call('generate:preview')({ vaultId, folder }),
    run: (vaultId, folder) => call('generate:run')({ vaultId, folder }),
    cancel: (vaultId, folder) => call('generate:cancel')({ vaultId, folder }),
    onProgress: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, payload: Parameters<typeof cb>[0]): void => cb(payload);
      ipcRenderer.on('generate:progress', listener);
      return () => ipcRenderer.removeListener('generate:progress', listener);
    },
  },
};

contextBridge.exposeInMainWorld('lode', api);
