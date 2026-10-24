import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JobView } from '@shared/ipc';
import type {
  ArticleInfo,
  BacklogDay,
  DigestInfo,
  DigestPeriod,
  FolderInfo,
  ReviewItem,
  SubtopicInfo,
  TrashItem,
  VaultInfo,
} from '@shared/types';
import { ask, lode, unwrap } from './api';
import { BacklogView } from './components/BacklogView';
import { ConfirmHost } from './components/ConfirmHost';
import { MissingVault } from './components/MissingVault';
import { DigestPicker } from './components/DigestPicker';
import { NewNoteDialog } from './components/NewNoteDialog';
import { GenerateDialog, type DialogTarget } from './components/GenerateDialog';
import { SettingsView } from './components/SettingsView';
import { Scratchpad, type DuplicateInfo } from './components/Scratchpad';
import type { RichEditorHandle } from './components/RichEditor';
import { Sidebar } from './components/Sidebar';
import { ReviewView } from './components/ReviewView';
import { SearchView } from './components/SearchView';
import { StatusBar } from './components/StatusBar';
import { TrashView } from './components/TrashView';
import { CloseIcon, FolderIcon, WarnIcon } from './components/Icons';
import { EmptyState } from './components/EmptyState';
import appIcon from '../../../build/icon.svg';
import { ARTICLE_PREFIX, DIGEST_PREFIX, NotePane } from './components/NotePane';
import { isActive } from './jobs';
import { Resizer } from './components/Resizer';
import { BACKLOG, NOTE_MIN, SIDEBAR, usePaneWidths } from './layout';
import { useAccent, useTheme } from './theme';

type Page = 'main' | 'settings' | 'trash' | 'review';

/** One place the user has been: a folder, and optionally a note in it. Back/forward walk these. */
interface Place {
  folder: string;
  subtopic: string | null;
}

interface History {
  items: Place[];
  i: number;
}

const EMPTY_HISTORY: History = { items: [], i: -1 };
const NO_DAYS: BacklogDay[] = [];
const NO_SUBTOPICS: SubtopicInfo[] = [];
const NO_DIGESTS: DigestInfo[] = [];
const NO_ARTICLES: ArticleInfo[] = [];
const samePlace = (a: Place | undefined, b: Place | undefined): boolean =>
  !!a && !!b && a.folder === b.folder && a.subtopic === b.subtopic;

/** Rewrites history after a delete: `map` returns the replacement place, or null to drop it. */
function rewrite(h: History, map: (p: Place) => Place | null): History {
  const items: Place[] = [];
  let i = -1;
  h.items.forEach((p, idx) => {
    const next = map(p);
    if (next && !samePlace(items.at(-1), next)) items.push(next);
    if (idx <= h.i) i = items.length - 1;
  });
  return { items, i };
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function App(): React.JSX.Element {
  const [vaults, setVaults] = useState<VaultInfo[]>([]);
  const vaultsRef = useRef(vaults);
  useEffect(() => {
    vaultsRef.current = vaults;
  }, [vaults]);
  const [vaultId, setVaultId] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const [data, setData] = useState<{
    key: string;
    days: BacklogDay[];
    subtopics: SubtopicInfo[];
    digests: DigestInfo[];
    articles: ArticleInfo[];
  }>({
    key: '',
    days: [],
    subtopics: [],
    digests: [],
    articles: [],
  });
  const [pickingDigest, setPickingDigest] = useState(false);
  const [pickingNote, setPickingNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [noteVersion, setNoteVersion] = useState(0);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [page, setPage] = useState<Page>('main');
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [query, setQuery] = useState('');
  // Search is an overlay above whatever page is open.
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  /** A point to scroll to once its folder has loaded (set by handlers, consumed after load). */
  const pendingJump = useRef<string | null>(null);
  const scratchRef = useRef<RichEditorHandle>(null);
  const [theme, setTheme] = useTheme();
  // Stable, so the pages' Escape listener isn't re-registered on every render.
  const closePage = useCallback(() => setPage('main'), []);
  const [accent, setAccent] = useAccent();
  const [widths, setWidths] = usePaneWidths();

  const place = history.items[history.i];
  const folder = place?.folder ?? null;
  const subtopic = place?.subtopic ?? null;
  const dataKey = vaultId && folder ? `${vaultId}/${folder}` : '';
  const days = data.key === dataKey ? data.days : NO_DAYS;
  const subtopics = data.key === dataKey ? data.subtopics : NO_SUBTOPICS;
  const digests = data.key === dataKey ? data.digests : NO_DIGESTS;
  const articles = data.key === dataKey ? data.articles : NO_ARTICLES;

  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      setError(null);
      return await fn();
    } catch (e) {
      setError(message(e));
      // The vault folder may have gone away underneath us; refresh so the panel can say so.
      void lode.vault.list().then((r) => r.ok && setVaults(r.value.vaults));
      return undefined;
    }
  }, []);

  // Re-checks which vault folders exist (read-only). Run on focus and after a failed action,
  // so a vault or folder deleted outside Lode shows the missing-vault panel instead of errors.
  const refreshVaults = useCallback(async (): Promise<VaultInfo[] | null> => {
    try {
      const { vaults: vs } = await unwrap(lode.vault.list());
      setVaults(vs);
      return vs;
    } catch {
      return null;
    }
  }, []);

  const load = useCallback(async (vid: string, slug: string): Promise<void> => {
    const [d, s, g, a] = await Promise.all([
      unwrap(lode.backlog.listDays(vid, slug)),
      unwrap(lode.notes.list(vid, slug)),
      unwrap(lode.digest.list(vid, slug)),
      unwrap(lode.article.list(vid, slug)),
    ]);
    setData({ key: `${vid}/${slug}`, days: d, subtopics: s, digests: g, articles: a });
    setNoteVersion((v) => v + 1);
  }, []);

  // Load the folder whenever navigation lands on a different one.
  useEffect(() => {
    if (!vaultId || !folder) return;
    let cancelled = false;
    Promise.all([
      unwrap(lode.backlog.listDays(vaultId, folder)),
      unwrap(lode.notes.list(vaultId, folder)),
      unwrap(lode.digest.list(vaultId, folder)),
      unwrap(lode.article.list(vaultId, folder)),
    ]).then(
      ([d, s, g, a]) => {
        if (cancelled) return;
        setData({ key: `${vaultId}/${folder}`, days: d, subtopics: s, digests: g, articles: a });
        setNoteVersion((v) => v + 1);
      },
      (e: unknown) => !cancelled && setError(message(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [vaultId, folder]);

  const refreshFolder = useCallback(async (): Promise<void> => {
    if (vaultId && folder) await guard(() => load(vaultId, folder));
  }, [vaultId, folder, guard, load]);

  // Coming back to the window: pick up vaults, folders and notes changed or deleted outside Lode.
  useEffect(() => {
    const onFocus = (): void => {
      void (async () => {
        const vs = await refreshVaults();
        const v = vs?.find((x) => x.id === vaultId);
        if (!vaultId || !v || v.missing) return;
        try {
          const fs = await unwrap(lode.folder.list(vaultId));
          setFolders(fs);
          if (folder && fs.some((f) => f.slug === folder)) await refreshFolder();
        } catch {
          // Reported by the next action that needs it.
        }
      })();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [vaultId, folder, refreshVaults, refreshFolder]);

  // Scroll to a point requested from another page once its folder's backlog is on screen.
  useEffect(() => {
    const id = pendingJump.current;
    if (!id || !days.some((d) => d.points.some((pt) => pt.id === id))) return;
    pendingJump.current = null;
    requestAnimationFrame(() => document.getElementById(`point-${id}`)?.scrollIntoView({ block: 'center' }));
  }, [days]);

  const loadTrash = useCallback(async (vid: string) => {
    try {
      setTrash(await unwrap(lode.trash.list(vid)));
    } catch {
      setTrash([]);
    }
  }, []);

  const loadReview = useCallback(async (vid: string) => {
    try {
      setReview(await unwrap(lode.review.list(vid)));
    } catch {
      setReview([]);
    }
  }, []);

  const selectVault = useCallback(
    async (id: string, known?: VaultInfo[]) => {
      if ((known ?? vaultsRef.current).find((v) => v.id === id)?.missing) {
        setVaultId(id);
        setFolders([]);
        setHistory(EMPTY_HISTORY);
        setTrash([]);
        setReview([]);
        return;
      }
      await guard(async () => {
        const fs = await unwrap(lode.folder.list(id));
        setVaultId(id);
        setFolders(fs);
        setHistory(EMPTY_HISTORY);
        await Promise.all([loadTrash(id), loadReview(id)]);
      });
    },
    [guard, loadTrash, loadReview],
  );

  useEffect(() => {
    let cancelled = false;
    unwrap(lode.vault.list()).then(
      ({ vaults: vs, lastVaultId }) => {
        if (cancelled) return;
        setVaults(vs);
        const last = vs.find((v) => v.id === lastVaultId) ?? vs.at(-1);
        if (last) void selectVault(last.id, vs);
      },
      (e: unknown) => !cancelled && setError(message(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [selectVault]);

  // --- Navigation (breadcrumb, back/forward) ---
  const navigate = (to: Place): void => {
    setPage('main');
    setHistory((h) =>
      samePlace(h.items[h.i], to) ? h : { items: [...h.items.slice(0, h.i + 1), to], i: h.i + 1 },
    );
  };
  const step = useCallback((delta: number) => {
    setPage('main');
    setHistory((h) => {
      const i = h.i + delta;
      return i >= 0 && i < h.items.length ? { ...h, i } : h;
    });
  }, []);
  const openSubtopic = (slug: string | null): void => {
    if (folder) navigate({ folder, subtopic: slug });
  };

  // Alt+Left/Right and the mouse's back/forward buttons, like a browser.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      // Single-key shortcuts, only when no field or menu has focus: n new point, j/k move through points.
      const t = e.target as HTMLElement | null;
      const typing = !!t?.closest('input, textarea, select, [contenteditable="true"], [role="menu"], dialog');
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'n') {
          e.preventDefault();
          scratchRef.current?.focus();
          return;
        }
        if (e.key === 'j' || e.key === 'k') {
          const rows = [...document.querySelectorAll<HTMLElement>('.point-row')];
          if (rows.length === 0) return;
          const at = rows.indexOf(document.activeElement as HTMLElement);
          const next = rows[Math.min(rows.length - 1, Math.max(0, at === -1 ? 0 : at + (e.key === 'j' ? 1 : -1)))];
          e.preventDefault();
          next?.focus();
          next?.scrollIntoView({ block: 'nearest' });
          return;
        }
      }
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else return;
      e.preventDefault();
    };
    const onMouse = (e: MouseEvent): void => {
      if (e.button === 3) step(-1);
      else if (e.button === 4) step(1);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onMouse);
    };
  }, [step]);

  useEffect(() => {
    if (folder) scratchRef.current?.focus();
  }, [folder, vaultId]);

  // --- Background jobs ---
  const onJobDone = useRef<(j: JobView) => void>(() => {});
  useEffect(() => {
    onJobDone.current = (j) => {
      if (j.vaultId === vaultId && j.folder === folder) void refreshFolder();
    };
  });
  useEffect(() => {
    const seen = new Map<string, string>();
    const apply = (js: JobView[]): void => {
      for (const j of js) {
        if (j.status === 'done' && seen.get(j.id) !== 'done') onJobDone.current(j);
        seen.set(j.id, j.status);
      }
      setJobs(js);
    };
    const off = lode.generate.onJobs(apply);
    unwrap(lode.generate.jobs()).then(
      (js) => {
        for (const j of js) seen.set(j.id, j.status);
        setJobs(js);
      },
      () => undefined,
    );
    return off;
  }, []);

  const openVault = async (): Promise<void> => {
    await guard(async () => {
      const v = await unwrap(lode.vault.open());
      if (!v) return;
      const { vaults: vs } = await unwrap(lode.vault.list());
      setVaults(vs);
      await selectVault(v.id);
    });
  };

  const addPoint = async (text: string, date?: string, force?: boolean): Promise<DuplicateInfo | null> => {
    if (!vaultId || !folder) return null;
    const res = await guard(() => unwrap(lode.backlog.add(vaultId, folder, text, { ...(date ? { date } : {}), ...(force ? { force } : {}) })));
    if (!res) throw new Error('not added');
    if ('duplicate' in res) return res.duplicate;
    setFlashId(res.added.id);
    await refreshFolder();
    // A backdated point lands further down; bring it into view.
    if (date) {
      requestAnimationFrame(() => document.getElementById(`point-${res.added.id}`)?.scrollIntoView({ block: 'nearest' }));
    }
    return null;
  };

  const editPoint = async (id: string, text: string): Promise<boolean> => {
    if (!vaultId || !folder) return false;
    const ok = await guard(async () => {
      await unwrap(lode.backlog.edit(vaultId, folder, id, text));
      return true;
    });
    if (ok) await refreshFolder();
    return ok === true;
  };

  const setPointDeleted = async (id: string, deleted: boolean): Promise<void> => {
    if (!vaultId || !folder) return;
    await guard(() => unwrap(lode.backlog.softDelete(vaultId, folder, id, deleted)));
    await refreshFolder();
  };

  const purgePoint = async (id: string): Promise<void> => {
    if (!vaultId || !folder) return;
    const ok = await ask({
      message: 'Delete this point permanently?',
      detail: 'It is removed from your backlog file and cannot be restored. Notes that cite it will show it as missing.',
      confirmLabel: 'Delete permanently',
      danger: true,
    });
    if (!ok) return;
    await guard(() => unwrap(lode.backlog.purge(vaultId, folder, id)));
    await refreshFolder();
  };

  const deleteNote = async (slug: string, title: string): Promise<void> => {
    if (!vaultId || !folder) return;
    const ok = await ask({
      message: `Move "${title}" to the trash?`,
      detail: 'Its points become unfiled again. You can restore it from Trash.',
      confirmLabel: 'Move to trash',
    });
    if (!ok) return;
    await guard(async () => {
      await unwrap(lode.notes.delete(vaultId, folder, slug));
      setHistory((h) => rewrite(h, (p) => (p.folder === folder && p.subtopic === slug ? { folder, subtopic: null } : p)));
      await refreshFolder();
      await loadTrash(vaultId);
    });
  };

  const undoRegenerate = async (slug: string): Promise<void> => {
    if (!vaultId || !folder) return;
    await guard(() => unwrap(lode.notes.undoRegenerate(vaultId, folder, slug)));
    await refreshFolder();
  };

  const folderInfo = folders.find((f) => f.slug === folder);
  const activeVault = vaults.find((v) => v.id === vaultId);
  const activeMissing = !!activeVault?.missing;
  /** Point ID → the notes it is filed in, for the reader's "Also in" links. */
  const filedIn = useMemo(
    () => new Map(days.flatMap((d) => d.points).map((pt) => [pt.id, pt.filedUnder] as const)),
    [days],
  );
  const allPoints = days.flatMap((d) => d.points).filter((pt) => !pt.deleted);
  const unfiled = allPoints.filter((pt) => pt.filedUnder.length === 0).length;
  const vaultJobs = jobs.filter((j) => j.vaultId === vaultId);
  const genJob = vaultJobs.find((j) => isActive(j) && j.kind === 'generate' && j.folder === folder);
  const regenJob = vaultJobs.find(
    (j) =>
      isActive(j) &&
      j.folder === folder &&
      (subtopic?.startsWith(DIGEST_PREFIX)
        ? j.kind === 'digest' && j.digest === subtopic.slice(DIGEST_PREFIX.length)
        : subtopic?.startsWith(ARTICLE_PREFIX)
          ? j.kind === 'article' && j.article === subtopic.slice(ARTICLE_PREFIX.length)
          : j.kind === 'regenerate' && j.subtopic === subtopic),
  );

  const reviseArticle = (slug: string, title: string, instruction: string): void => {
    if (!folder || !folderInfo) return;
    setDialog({ kind: 'new', folder, folderTitle: folderInfo.title, article: { slug, title, subtopics: [], topics: [], instruction } });
  };

  const saveArticle = async (slug: string, edit: Parameters<typeof lode.article.save>[3]): Promise<boolean> => {
    if (!vaultId || !folder) return false;
    const ok = await guard(() => unwrap(lode.article.save(vaultId, folder, slug, edit)));
    await refreshFolder();
    return ok !== undefined;
  };

  const undoArticle = async (slug: string): Promise<void> => {
    if (!vaultId || !folder) return;
    await guard(() => unwrap(lode.article.undo(vaultId, folder, slug)));
    await refreshFolder();
  };

  const deleteArticle = async (slug: string, title: string): Promise<void> => {
    if (!vaultId || !folder) return;
    const ok = await ask({
      message: `Delete the note "${title}"?`,
      detail: 'Your points and subtopics are not affected. A copy is kept in the vault history folder.',
      confirmLabel: 'Delete note',
      danger: true,
    });
    if (!ok) return;
    await guard(async () => {
      await unwrap(lode.article.delete(vaultId, folder, slug));
      const key = `${ARTICLE_PREFIX}${slug}`;
      setHistory((h) => rewrite(h, (pl) => (pl.folder === folder && pl.subtopic === key ? { folder, subtopic: null } : pl)));
      await refreshFolder();
    });
  };

  const openDigestDialog = (id: string, title: string): void => {
    if (!folder || !folderInfo) return;
    const running = vaultJobs.find((j) => isActive(j) && j.kind === 'digest' && j.folder === folder && j.digest === id);
    setDialog(
      running ? { kind: 'job', jobId: running.id } : { kind: 'new', folder, folderTitle: folderInfo.title, digest: id, digestTitle: title },
    );
  };

  const deleteDigest = async (id: string, title: string): Promise<void> => {
    if (!vaultId || !folder) return;
    const ok = await ask({
      message: `Delete the digest "${title}"?`,
      detail: 'Your points are not affected; you can write it again.',
      confirmLabel: 'Delete digest',
      danger: true,
    });
    if (!ok) return;
    await guard(async () => {
      await unwrap(lode.digest.delete(vaultId, folder, id));
      const key = `${DIGEST_PREFIX}${id}`;
      setHistory((h) => rewrite(h, (pl) => (pl.folder === folder && pl.subtopic === key ? { folder, subtopic: null } : pl)));
      await refreshFolder();
    });
  };

  const jumpToPoint = (id: string): void => {
    setPage('main');
    setFlashId(null);
    requestAnimationFrame(() => {
      setFlashId(id);
      document.getElementById(`point-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  /** Opens a point's folder (from Review or Search) and highlights the point in the backlog. */
  const showPoint = (f: string, id: string): void => {
    if (f === folder) {
      navigate({ folder: f, subtopic });
      jumpToPoint(id);
      return;
    }
    pendingJump.current = id;
    setFlashId(id);
    navigate({ folder: f, subtopic: null });
  };

  const regenerate = (slug: string, title: string): void => {
    if (!folder || !folderInfo) return;
    const running = vaultJobs.find((j) => isActive(j) && j.kind === 'regenerate' && j.folder === folder && j.subtopic === slug);
    setDialog(
      running
        ? { kind: 'job', jobId: running.id }
        : { kind: 'new', folder, folderTitle: folderInfo.title, subtopic: slug, subtopicTitle: title },
    );
  };

  return (
    <div
      className={`app ${page !== 'main' || activeMissing ? 'with-settings' : ''}`}
      style={
        {
          '--side-w': `${widths.sidebar}px`,
          '--list-w': `${widths.backlog}px`,
          '--note-min': `${NOTE_MIN}px`,
        } as React.CSSProperties
      }
    >
      <Sidebar
        vaults={vaults}
        activeVaultId={vaultId}
        folders={activeMissing ? [] : folders}
        activeFolder={folder}
        subtopics={subtopics}
        activeSubtopic={subtopic}
        settingsOpen={page === 'settings'}
        trashOpen={page === 'trash'}
        trashCount={activeMissing ? 0 : trash.length}
        reviewOpen={page === 'review'}
        reviewCount={activeMissing ? 0 : review.length}
        searchOpen={searchOpen}
        activity={
          <StatusBar
            jobs={jobs}
            onOpen={(id) => setDialog({ kind: 'job', jobId: id })}
            onCancel={(id) => void lode.generate.cancel(id)}
            onDismiss={(id) => void lode.generate.dismiss(id)}
          />
        }
        resizer={
          <Resizer
            label="Resize sidebar"
            width={widths.sidebar}
            min={SIDEBAR.min}
            max={SIDEBAR.max}
            initial={SIDEBAR.initial}
            onResize={(w) => setWidths({ sidebar: w })}
          />
        }
        onOpenReview={() => {
          setPage('review');
          if (vaultId) void loadReview(vaultId);
        }}
        onOpenSearch={() => setSearchOpen(true)}
        theme={theme}
        onTheme={setTheme}
        onSelectVault={(id) => {
          setPage('main');
          void selectVault(id);
        }}
        onOpenSettings={() => setPage('settings')}
        onOpenTrash={() => {
          setPage('trash');
          if (vaultId) void loadTrash(vaultId);
        }}
        onOpenVault={() => void openVault()}
        onSelectFolder={(s) => navigate({ folder: s, subtopic: null })}
        onSelectSubtopic={(s) => openSubtopic(s)}
        onCreateFolder={async (title) => {
          if (!vaultId) return;
          await guard(async () => {
            const f = await unwrap(lode.folder.create(vaultId, title));
            setFolders(await unwrap(lode.folder.list(vaultId)));
            navigate({ folder: f.slug, subtopic: null });
          });
        }}
        onRenameFolder={async (slug, title) => {
          if (!vaultId) return;
          await guard(async () => {
            await unwrap(lode.folder.rename(vaultId, slug, title));
            setFolders(await unwrap(lode.folder.list(vaultId)));
          });
        }}
        onRenameSubtopic={async (slug, title) => {
          if (!vaultId || !folder) return;
          await guard(async () => {
            await unwrap(lode.notes.rename(vaultId, folder, slug, title));
            await refreshFolder();
          });
        }}
        onRegenerateSubtopic={regenerate}
        onDeleteSubtopic={(slug, title) => void deleteNote(slug, title)}
        onDeleteFolder={async (slug) => {
          if (!vaultId) return;
          await guard(async () => {
            await unwrap(lode.folder.delete(vaultId, slug));
            setFolders(await unwrap(lode.folder.list(vaultId)));
            setHistory((h) => rewrite(h, (p) => (p.folder === slug ? null : p)));
            await loadTrash(vaultId);
          });
        }}
      />

      {error && (
        <div className="toast error" role="alert">
          <span className="toast-icon" aria-hidden="true">
            <WarnIcon size={14} />
          </span>
          <span className="toast-text">{error}</span>
          <button className="icon-btn" aria-label="Dismiss error" onClick={() => setError(null)}>
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      {activeMissing && activeVault && page === 'main' ? (
        <main className="settings-page" aria-label="Missing vault">
          <MissingVault
            vault={activeVault}
            onOpenOther={() => void openVault()}
            onRetry={() =>
              void guard(async () => {
                const vs = await refreshVaults();
                if (vs && !vs.find((v) => v.id === activeVault.id)?.missing) await selectVault(activeVault.id, vs);
              })
            }
            onLocate={() =>
              void guard(async () => {
                // The picked folder becomes the vault; the stale entry is dropped (no files touched).
                const v = await unwrap(lode.vault.open());
                if (!v) return;
                if (v.id !== activeVault.id) await unwrap(lode.vault.forget(activeVault.id));
                const vs = await refreshVaults();
                await selectVault(v.id, vs ?? undefined);
              })
            }
            onRecreate={() =>
              void guard(async () => {
                await unwrap(lode.vault.recreate(activeVault.id));
                const vs = await refreshVaults();
                await selectVault(activeVault.id, vs ?? undefined);
              })
            }
            onForget={() =>
              void ask({
                message: `Remove “${activeVault.name}” from the list?`,
                detail: 'No files are deleted. You can open the folder again later.',
                confirmLabel: 'Remove from list',
              }).then(async (ok) => {
                if (!ok) return;
                await guard(async () => {
                  await unwrap(lode.vault.forget(activeVault.id));
                  const vs = (await refreshVaults()) ?? [];
                  const next = vs.find((v) => !v.missing) ?? vs[0];
                  if (next) await selectVault(next.id, vs);
                  else setVaultId(null);
                });
              })
            }
          />
        </main>
      ) : page === 'settings' ? (
        <main className="settings-page" aria-label="Settings">
          <SettingsView
            onClose={closePage}
            accent={accent}
            onAccent={setAccent}
            theme={theme}
            onTheme={setTheme}
          />
        </main>
      ) : page === 'review' && vaultId ? (
        <main className="settings-page" aria-label="Review">
          <ReviewView
            items={review}
            onClose={closePage}
            onShowPoint={showPoint}
            onOpenNote={(f, s) => navigate({ folder: f, subtopic: s })}
            onMark={async (items) => {
              await guard(() => unwrap(lode.review.mark(vaultId, items.map((i) => ({ id: i.id, stage: i.stage })))));
              await loadReview(vaultId);
            }}
          />
        </main>
      ) : page === 'trash' ? (
        <main className="settings-page" aria-label="Trash">
          <TrashView
            items={trash}
            folders={folders}
            onClose={closePage}
            onRestore={async (item) => {
              if (!vaultId) return;
              await guard(async () => {
                await unwrap(lode.trash.restore(vaultId, item.id));
                setFolders(await unwrap(lode.folder.list(vaultId)));
                await loadTrash(vaultId);
                await refreshFolder();
              });
            }}
            onPurge={async (item) => {
              if (!vaultId) return;
              await guard(() => unwrap(lode.trash.purge(vaultId, item?.id)));
              await loadTrash(vaultId);
            }}
          />
        </main>
      ) : (
        <>
          <main className="backlog-pane" aria-label="Scratchpad and backlog">
            <Resizer
              label="Resize backlog"
              width={widths.backlog}
              min={BACKLOG.min}
              max={BACKLOG.max}
              initial={BACKLOG.initial}
              onResize={(w) => setWidths({ backlog: w })}
            />
            {vaultId && folder && folderInfo ? (
              <>
                <header className="pane-bar">
                  <div className="pane-title">
                    <h1>{folderInfo.title}</h1>
                    {unfiled > 0 && <span className="pane-sub">{unfiled} unfiled</span>}
                  </div>
                  {genJob ? (
                    <button className="btn" onClick={() => setDialog({ kind: 'job', jobId: genJob.id })}>
                      <span className="spinner small" aria-hidden="true" />
                      {genJob.status === 'queued' ? 'Queued' : 'Generating…'}
                    </button>
                  ) : (
                    <button
                      className="btn"
                      onClick={() => setDialog({ kind: 'new', folder, folderTitle: folderInfo.title })}
                      disabled={unfiled === 0}
                      title={unfiled ? 'Organise unfiled points into subtopic notes' : 'Every point is filed'}
                    >
                      Generate
                    </button>
                  )}
                </header>
                <div className="backlog-scroll">
                  <Scratchpad
                    key={folder}
                    ref={scratchRef}
                    folderTitle={folderInfo.title}
                    onAdd={addPoint}
                    onShowPoint={jumpToPoint}
                  />
                  <BacklogView
                    days={days}
                    subtopics={subtopics}
                    highlightId={flashId}
                    onOpenSubtopic={(s) => openSubtopic(s)}
                    onJumpToPoint={jumpToPoint}
                    onEdit={editPoint}
                    onSetDeleted={setPointDeleted}
                    onPurge={purgePoint}
                  />
                </div>
              </>
            ) : (
              vaults.length === 0 ? (
                <EmptyState
                  icon={<img src={appIcon} alt="" width={30} height={30} />}
                  title="Welcome to Lode"
                  actions={
                    <button className="btn primary tall" onClick={() => void openVault()}>
                      Open or create a vault
                    </button>
                  }
                >
                  Capture what you learn, one line at a time. A vault is a folder of plain markdown files on your disk.
                </EmptyState>
              ) : (
                <EmptyState icon={<FolderIcon size={18} />} title="Pick a folder">
                  Choose a folder in the sidebar, or create one with +, then add what you learned today.
                </EmptyState>
              )
            )}
          </main>

          <NotePane
            vaultId={vaultId}
            folder={folderInfo ? folder : null}
            folderTitle={folderInfo?.title ?? null}
            subtopics={subtopics}
            active={subtopic}
            version={noteVersion}
            onSelect={openSubtopic}
            onError={setError}
            onJumpToPoint={jumpToPoint}
            canBack={history.i > 0}
            canForward={history.i < history.items.length - 1}
            onBack={() => step(-1)}
            onForward={() => step(1)}
            regenJob={regenJob}
            onRegenerate={regenerate}
            onOpenJob={(id) => setDialog({ kind: 'job', jobId: id })}
            onUndoRegenerate={undoRegenerate}
            onDelete={(slug, title) => void deleteNote(slug, title)}
            onEditPoint={editPoint}
            onSetPointDeleted={setPointDeleted}
            digests={digests}
            days={days}
            filedIn={filedIn}
            onNewDigest={() => setPickingDigest(true)}
            onRegenerateDigest={openDigestDialog}
            onDeleteDigest={(id, title) => void deleteDigest(id, title)}
            articles={articles}
            onNewArticle={() => setPickingNote(true)}
            onReviseArticle={reviseArticle}
            onSaveArticle={saveArticle}
            onUndoArticle={undoArticle}
            onDeleteArticle={(slug, title) => void deleteArticle(slug, title)}
          />
        </>
      )}


      <ConfirmHost />

      {searchOpen && vaultId && (
        <SearchView
          vaultId={vaultId}
          query={query}
          onQuery={setQuery}
          onClose={closeSearch}
          onOpenPoint={(f, id) => {
            setSearchOpen(false);
            showPoint(f, id);
          }}
          onOpenNote={(f, note, digest) => {
            setSearchOpen(false);
            navigate({ folder: f, subtopic: digest ? `digest:${note}` : note });
          }}
        />
      )}

      {pickingDigest && vaultId && folder && folderInfo && (
        <DigestPicker
          vaultId={vaultId}
          folder={folder}
          folderTitle={folderInfo.title}
          onClose={() => setPickingDigest(false)}
          onPick={(period: DigestPeriod) => {
            setPickingDigest(false);
            openDigestDialog(period.id, period.title);
          }}
          onOpen={(period: DigestPeriod) => {
            setPickingDigest(false);
            if (folder) navigate({ folder, subtopic: `${DIGEST_PREFIX}${period.id}` });
          }}
        />
      )}

      {pickingNote && folder && folderInfo && (
        <NewNoteDialog
          folderTitle={folderInfo.title}
          subtopics={subtopics}
          onClose={() => setPickingNote(false)}
          onPick={(req) => {
            setPickingNote(false);
            setDialog({ kind: 'new', folder, folderTitle: folderInfo.title, article: req });
          }}
        />
      )}

      {dialog && vaultId && (
        <GenerateDialog
          key={
            dialog.kind === 'job'
              ? dialog.jobId
              : `new-${dialog.folder}-${dialog.subtopic ?? ''}-${dialog.digest ?? ''}-${dialog.article ? JSON.stringify(dialog.article) : ''}`
          }
          vaultId={vaultId}
          target={dialog}
          jobs={jobs}
          onOpenSubtopic={(f, slug) => {
            if (folders.some((x) => x.slug === f)) navigate({ folder: f, subtopic: slug });
          }}
          onOpenSettings={() => {
            setDialog(null);
            setPage('settings');
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
