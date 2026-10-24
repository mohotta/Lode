import type { AddResult, JobView, KeyIdName, PreviewView, Result, SettingsView } from '@shared/ipc';
import type {
  ArticleInfo,
  BacklogDay,
  DigestInfo,
  DigestPeriod,
  FolderInfo,
  Point,
  ResolvedArticle,
  ResolvedNote,
  ReviewItem,
  ReviewStage,
  SearchHit,
  SubtopicInfo,
  TrashItem,
  VaultInfo,
} from '@shared/types';

/** A note (article) job: a new note from subtopics and topics, or (with `slug`) an AI edit. */
export interface ArticleJob {
  slug?: string;
  title?: string;
  subtopics?: string[];
  topics?: string[];
  instruction?: string;
}

/** What a Generate-family job works on: unfiled points (empty), one note, one digest period or a composed note. */
export type JobTarget = { subtopic?: string; digest?: string; article?: ArticleJob };

/** One block of a hand-edited note. Text without `body` is kept unchanged. */
export type ArticleEditBlock = { kind: 'point'; id: string } | { kind: 'text'; id?: string; body?: string };

type R<T> = Promise<Result<T>>;

/** The full surface exposed to the renderer as `window.lode`. */
export interface LodeApi {
  vault: {
    list(): R<{ vaults: VaultInfo[]; lastVaultId: string | null }>;
    open(): R<VaultInfo | null>;
    forget(vaultId: string): R<void>;
    /** Creates a missing vault's folder again, empty, at the same path. */
    recreate(vaultId: string): R<VaultInfo>;
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
    /** Permanently removes a disabled point from its day file. Refused for a live point. */
    purge(vaultId: string, folder: string, id: string): R<void>;
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
  review: {
    /** Points due for review today, across the vault's folders. */
    list(vaultId: string): R<ReviewItem[]>;
    mark(vaultId: string, items: { id: string; stage: ReviewStage }[]): R<void>;
  };
  search: {
    query(vaultId: string, q: string, limit?: number): R<SearchHit[]>;
  };
  digest: {
    /** Recent weeks and months that have points, newest first. */
    periods(vaultId: string, folder: string): R<DigestPeriod[]>;
    list(vaultId: string, folder: string): R<DigestInfo[]>;
    read(vaultId: string, folder: string, digest: string): R<ResolvedNote>;
    delete(vaultId: string, folder: string, digest: string): R<void>;
  };
  /** Notes: composed articles in `<folder>/articles/`. */
  article: {
    list(vaultId: string, folder: string): R<ArticleInfo[]>;
    read(vaultId: string, folder: string, article: string): R<ResolvedArticle>;
    save(
      vaultId: string,
      folder: string,
      article: string,
      edit: { expected: string; title?: string; blocks: ArticleEditBlock[] },
    ): R<ResolvedArticle>;
    /** Restores the version before the last AI edit or hand edit. */
    undo(vaultId: string, folder: string, article: string): R<void>;
    delete(vaultId: string, folder: string, article: string): R<void>;
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
    /** With a target, previews a Regenerate of that note, a digest for that period or a note job. */
    preview(vaultId: string, folder: string, target?: JobTarget): R<PreviewView>;
    /** Queues a background Generate, Regenerate, digest or note job and returns at once. */
    enqueue(vaultId: string, folder: string, target?: JobTarget): R<JobView>;
    jobs(): R<JobView[]>;
    cancel(jobId: string): R<void>;
    /** Removes a finished job from the status bar. */
    dismiss(jobId: string): R<void>;
    /** Called with the full job list on every change. Returns an unsubscribe function. */
    onJobs(cb: (jobs: JobView[]) => void): () => void;
  };
}
