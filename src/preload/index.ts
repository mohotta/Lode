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
    recreate: (vaultId) => call('vault:recreate')({ vaultId }),
  },
  folder: {
    list: (vaultId) => call('folder:list')({ vaultId }),
    create: (vaultId, title) => call('folder:create')({ vaultId, title }),
    rename: (vaultId, folder, title) => call('folder:rename')({ vaultId, folder, title }),
    delete: (vaultId, folder) => call('folder:delete')({ vaultId, folder }),
  },
  backlog: {
    add: (vaultId, folder, text, opts = {}) =>
      call('backlog:add')({
        vaultId,
        folder,
        text,
        ...(opts.date ? { date: opts.date } : {}),
        ...(opts.force ? { force: true } : {}),
      }),
    edit: (vaultId, folder, id, text) => call('backlog:edit')({ vaultId, folder, id, text }),
    softDelete: (vaultId, folder, id, deleted) => call('backlog:softDelete')({ vaultId, folder, id, deleted }),
    purge: (vaultId, folder, id) => call('backlog:purge')({ vaultId, folder, id }),
    listDays: (vaultId, folder) => call('backlog:listDays')({ vaultId, folder }),
  },
  notes: {
    list: (vaultId, folder) => call('notes:list')({ vaultId, folder }),
    read: (vaultId, folder, subtopic) => call('notes:read')({ vaultId, folder, subtopic }),
    rename: (vaultId, folder, subtopic, title) => call('notes:rename')({ vaultId, folder, subtopic, title }),
    delete: (vaultId, folder, subtopic) => call('notes:delete')({ vaultId, folder, subtopic }),
    undoRegenerate: (vaultId, folder, subtopic) => call('notes:undoRegenerate')({ vaultId, folder, subtopic }),
  },
  trash: {
    list: (vaultId) => call('trash:list')({ vaultId }),
    restore: (vaultId, id) => call('trash:restore')({ vaultId, id }),
    purge: (vaultId, id) => call('trash:purge')({ vaultId, ...(id ? { id } : {}) }),
  },
  review: {
    list: (vaultId) => call('review:list')({ vaultId }),
    mark: (vaultId, items) => call('review:mark')({ vaultId, items }),
  },
  search: {
    query: (vaultId, q, limit) => call('search:query')({ vaultId, q, ...(limit ? { limit } : {}) }),
  },
  digest: {
    periods: (vaultId, folder) => call('digest:periods')({ vaultId, folder }),
    list: (vaultId, folder) => call('digest:list')({ vaultId, folder }),
    read: (vaultId, folder, digest) => call('digest:read')({ vaultId, folder, digest }),
    delete: (vaultId, folder, digest) => call('digest:delete')({ vaultId, folder, digest }),
  },
  article: {
    list: (vaultId, folder) => call('article:list')({ vaultId, folder }),
    read: (vaultId, folder, article) => call('article:read')({ vaultId, folder, article }),
    save: (vaultId, folder, article, edit) => call('article:save')({ vaultId, folder, article, ...edit }),
    undo: (vaultId, folder, article) => call('article:undo')({ vaultId, folder, article }),
    delete: (vaultId, folder, article) => call('article:delete')({ vaultId, folder, article }),
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
    preview: (vaultId, folder, target = {}) => call('generate:preview')({ vaultId, folder, ...target }),
    enqueue: (vaultId, folder, target = {}) => call('generate:enqueue')({ vaultId, folder, ...target }),
    jobs: () => call('generate:jobs')(),
    cancel: (jobId) => call('generate:cancel')({ jobId }),
    dismiss: (jobId) => call('generate:dismiss')({ jobId }),
    onJobs: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, jobs: Parameters<typeof cb>[0]): void => cb(jobs);
      ipcRenderer.on('generate:jobs', listener);
      return () => ipcRenderer.removeListener('generate:jobs', listener);
    },
  },
};

contextBridge.exposeInMainWorld('lode', api);
