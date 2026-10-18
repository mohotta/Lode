import type { KeyIdName, PreviewView, ProgressView, Result, RunReportView, SettingsView } from '@shared/ipc';
import type {
  BacklogDay,
  FolderInfo,
  Point,
  ResolvedNote,
  SubtopicInfo,
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
    /** `date` is an optional local day (YYYY-MM-DD), today or earlier; omitted means today. */
    add(vaultId: string, folder: string, text: string, date?: string): R<Point>;
    listDays(vaultId: string, folder: string): R<BacklogDay[]>;
  };
  notes: {
    list(vaultId: string, folder: string): R<SubtopicInfo[]>;
    read(vaultId: string, folder: string, subtopic: string): R<ResolvedNote>;
    rename(vaultId: string, folder: string, subtopic: string, title: string): R<SubtopicInfo>;
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
    preview(vaultId: string, folder: string): R<PreviewView>;
    run(vaultId: string, folder: string): R<RunReportView>;
    cancel(vaultId: string, folder: string): R<void>;
    /** Returns an unsubscribe function. */
    onProgress(cb: (p: { vaultId: string; folder: string; event: ProgressView }) => void): () => void;
  };
}
