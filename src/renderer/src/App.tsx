import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobView } from '@shared/ipc';
import type { BacklogDay, FolderInfo, SubtopicInfo, TrashItem, VaultInfo } from '@shared/types';
import { lode, unwrap } from './api';
import { BacklogView } from './components/BacklogView';
import { GenerateDialog, type DialogTarget } from './components/GenerateDialog';
import { SettingsView } from './components/SettingsView';
import { Scratchpad, type DuplicateInfo } from './components/Scratchpad';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { TrashView } from './components/TrashView';
import { CloseIcon, SparkIcon, VaultIcon } from './components/Icons';
import { NotePane } from './components/NotePane';
import { isActive } from './jobs';
import { useTheme } from './theme';

type Page = 'main' | 'settings' | 'trash';

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
  const [vaultId, setVaultId] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const [data, setData] = useState<{ key: string; days: BacklogDay[]; subtopics: SubtopicInfo[] }>({
    key: '',
    days: [],
    subtopics: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [noteVersion, setNoteVersion] = useState(0);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [page, setPage] = useState<Page>('main');
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const scratchRef = useRef<HTMLTextAreaElement>(null);
  const [theme, setTheme] = useTheme();

  const place = history.items[history.i];
  const folder = place?.folder ?? null;
  const subtopic = place?.subtopic ?? null;
  const dataKey = vaultId && folder ? `${vaultId}/${folder}` : '';
  const days = data.key === dataKey ? data.days : [];
  const subtopics = data.key === dataKey ? data.subtopics : [];

  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      setError(null);
      return await fn();
    } catch (e) {
      setError(message(e));
      return undefined;
    }
  }, []);

  const load = useCallback(async (vid: string, slug: string): Promise<void> => {
    const [d, s] = await Promise.all([unwrap(lode.backlog.listDays(vid, slug)), unwrap(lode.notes.list(vid, slug))]);
    setData({ key: `${vid}/${slug}`, days: d, subtopics: s });
    setNoteVersion((v) => v + 1);
  }, []);

  // Load the folder whenever navigation lands on a different one.
  useEffect(() => {
    if (!vaultId || !folder) return;
    let cancelled = false;
    Promise.all([unwrap(lode.backlog.listDays(vaultId, folder)), unwrap(lode.notes.list(vaultId, folder))]).then(
      ([d, s]) => {
        if (cancelled) return;
        setData({ key: `${vaultId}/${folder}`, days: d, subtopics: s });
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

  const loadTrash = useCallback(async (vid: string) => {
    try {
      setTrash(await unwrap(lode.trash.list(vid)));
    } catch {
      setTrash([]);
    }
  }, []);

  const selectVault = useCallback(
    async (id: string) => {
      await guard(async () => {
        const fs = await unwrap(lode.folder.list(id));
        setVaultId(id);
        setFolders(fs);
        setHistory(EMPTY_HISTORY);
        await loadTrash(id);
      });
    },
    [guard, loadTrash],
  );

  useEffect(() => {
    let cancelled = false;
    unwrap(lode.vault.list()).then(
      ({ vaults: vs, lastVaultId }) => {
        if (cancelled) return;
        setVaults(vs);
        const last = vs.find((v) => v.id === lastVaultId) ?? vs.at(-1);
        if (last) void selectVault(last.id);
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

  const deleteNote = async (slug: string, title: string): Promise<void> => {
    if (!vaultId || !folder) return;
    if (!confirm(`Move "${title}" to the trash? Its points become unfiled again. You can restore it from Trash.`)) return;
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
  const allPoints = days.flatMap((d) => d.points).filter((pt) => !pt.deleted);
  const unfiled = allPoints.filter((pt) => pt.filedUnder.length === 0).length;
  const vaultJobs = jobs.filter((j) => j.vaultId === vaultId);
  const genJob = vaultJobs.find((j) => isActive(j) && j.kind === 'generate' && j.folder === folder);
  const regenJob = vaultJobs.find(
    (j) => isActive(j) && j.kind === 'regenerate' && j.folder === folder && j.subtopic === subtopic,
  );

  const jumpToPoint = (id: string): void => {
    setPage('main');
    setFlashId(null);
    requestAnimationFrame(() => {
      setFlashId(id);
      document.getElementById(`point-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
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
    <div className={`app ${page !== 'main' ? 'with-settings' : ''}`}>
      <Sidebar
        vaults={vaults}
        activeVaultId={vaultId}
        folders={folders}
        activeFolder={folder}
        subtopics={subtopics}
        activeSubtopic={subtopic}
        settingsOpen={page === 'settings'}
        trashOpen={page === 'trash'}
        trashCount={trash.length}
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
          <span>{error}</span>
          <button className="icon-btn" aria-label="Dismiss error" onClick={() => setError(null)}>
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      {page === 'settings' ? (
        <main className="settings-page" aria-label="Settings">
          <SettingsView onClose={() => setPage('main')} />
        </main>
      ) : page === 'trash' ? (
        <main className="settings-page" aria-label="Trash">
          <TrashView
            items={trash}
            folders={folders}
            onClose={() => setPage('main')}
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
            {vaultId && folder && folderInfo ? (
              <>
                <header className="pane-bar">
                  <div className="pane-title">
                    <h1>{folderInfo.title}</h1>
                    <span className="pane-sub">
                      {allPoints.length} {allPoints.length === 1 ? 'point' : 'points'}
                      {unfiled > 0 && ` · ${unfiled} unfiled`}
                    </span>
                  </div>
                  {genJob ? (
                    <button className="btn accent" onClick={() => setDialog({ kind: 'job', jobId: genJob.id })}>
                      <span className="spinner small" aria-hidden="true" />
                      {genJob.status === 'queued' ? 'Queued' : 'Generating…'}
                    </button>
                  ) : (
                    <button
                      className="btn accent"
                      onClick={() => setDialog({ kind: 'new', folder, folderTitle: folderInfo.title })}
                      disabled={unfiled === 0}
                      title={unfiled ? 'Organise unfiled points into subtopic notes' : 'Every point is filed'}
                    >
                      <SparkIcon size={14} />
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
                  />
                </div>
              </>
            ) : (
              <div className="welcome">
                <div className="welcome-mark" aria-hidden="true">
                  <VaultIcon size={22} />
                </div>
                <h1>Lode</h1>
                <p>
                  {vaults.length === 0
                    ? 'Capture what you learn, one line at a time. Open or create a vault to begin.'
                    : 'Pick a folder, or create one, and add what you learned today.'}
                </p>
                {vaults.length === 0 && (
                  <button className="btn primary" onClick={() => void openVault()}>
                    Open or create a vault
                  </button>
                )}
              </div>
            )}
          </main>

          <NotePane
            vaultId={vaultId}
            folder={folder}
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
          />
        </>
      )}

      <StatusBar
        jobs={jobs}
        onOpen={(id) => setDialog({ kind: 'job', jobId: id })}
        onCancel={(id) => void lode.generate.cancel(id)}
        onDismiss={(id) => void lode.generate.dismiss(id)}
      />

      {dialog && vaultId && (
        <GenerateDialog
          key={dialog.kind === 'job' ? dialog.jobId : `new-${dialog.folder}-${dialog.subtopic ?? ''}`}
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
