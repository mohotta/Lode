import type { AddResult, JobView, KeyIdName, PreviewView, Result, SettingsView } from '@shared/ipc';
import type {
  BacklogDay,
  FolderInfo,
  Point,
  ResolvedNote,
  SubtopicInfo,
  TrashItem,
  VaultInfo,
} from '@shared/types';

type R<T> = Promise<Result<T>>;

/** The full surface exposed to the renderer as `window.lode`. */
export interface LodeApi {
  vault: {
    list(): R<{ vaults: VaultInfo[]; lastVaultId: string | null }>;
    open(): R<VaultInfo | null>;
    forget(vaultId: string): R<void>;
  };
  folder: {
    list(vaultId: string): R<FolderInfo[]>;
    create(vaultId: string, title: string): R<FolderInfo>;
    rename(vaultId: string, folder: string, title: string): R<FolderInfo>;
    delete(vaultId: string, folder: string): R<void>;
  };
  backlog: {
    /**
     * `date` is an optional local day (YYYY-MM-DD), today or earlier; omitted means today.
     * A likely repeat of an earlier point is reported instead of added unless `force` is set.
     */
    add(vaultId: string, folder: string, text: string, opts?: { date?: string; force?: boolean }): R<AddResult>;
    edit(vaultId: string, folder: string, id: string, text: string): R<Point>;
    /** Soft delete (tombstone) or restore. The text is kept either way. */
    softDelete(vaultId: string, folder: string, id: string, deleted: boolean): R<void>;
    listDays(vaultId: string, folder: string): R<BacklogDay[]>;
  };
  notes: {
    list(vaultId: string, folder: string): R<SubtopicInfo[]>;
    read(vaultId: string, folder: string, subtopic: string): R<ResolvedNote>;
    rename(vaultId: string, folder: string, subtopic: string, title: string): R<SubtopicInfo>;
    /** Moves the note to the vault trash. */
    delete(vaultId: string, folder: string, subtopic: string): R<void>;
    undoRegenerate(vaultId: string, folder: string, subtopic: string): R<void>;
  };
  trash: {
    list(vaultId: string): R<TrashItem[]>;
    restore(vaultId: string, id: string): R<TrashItem>;
    /** Permanently deletes one item, or everything when `id` is omitted. */
    purge(vaultId: string, id?: string): R<void>;
  };
  link: {
    open(url: string): R<void>;
  };
  settings: {
    get(): R<SettingsView>;
    set(patch: {
      allowWeakKeyStorage?: boolean;
      llm?: Partial<SettingsView['llm']>;
      generation?: Partial<SettingsView['generation']>;
    }): R<SettingsView>;
  };
  /** Write-only from the renderer's side: there is no way to read a stored key back. */
  keys: {
    set(id: KeyIdName, key: string): R<boolean>;
    has(id: KeyIdName): R<boolean>;
    test(id: KeyIdName): R<string>;
    clear(id: KeyIdName): R<boolean>;
  };
  generate: {
    /** With `subtopic`, previews a Regenerate of that note. */
    preview(vaultId: string, folder: string, subtopic?: string): R<PreviewView>;
    /** Queues a background Generate (or a Regenerate with `subtopic`) and returns at once. */
    enqueue(vaultId: string, folder: string, subtopic?: string): R<JobView>;
    jobs(): R<JobView[]>;
    cancel(jobId: string): R<void>;
    /** Removes a finished job from the status bar. */
    dismiss(jobId: string): R<void>;
    /** Called with the full job list on every change. Returns an unsubscribe function. */
    onJobs(cb: (jobs: JobView[]) => void): () => void;
  };
}
