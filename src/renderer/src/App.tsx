import { useCallback, useEffect, useRef, useState } from 'react';
import type { BacklogDay, FolderInfo, SubtopicInfo, VaultInfo } from '@shared/types';
import { lode, unwrap } from './api';
import { BacklogView } from './components/BacklogView';
import { GenerateDialog } from './components/GenerateDialog';
import { SettingsView } from './components/SettingsView';
import { Scratchpad } from './components/Scratchpad';
import { Sidebar } from './components/Sidebar';
import { CloseIcon, SparkIcon, VaultIcon } from './components/Icons';
import { NotePane } from './components/NotePane';
import { useTheme } from './theme';

export function App(): React.JSX.Element {
  const [vaults, setVaults] = useState<VaultInfo[]>([]);
  const [vaultId, setVaultId] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [days, setDays] = useState<BacklogDay[]>([]);
  const [subtopics, setSubtopics] = useState<SubtopicInfo[]>([]);
  const [subtopic, setSubtopic] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [noteVersion, setNoteVersion] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const scratchRef = useRef<HTMLTextAreaElement>(null);
  const [theme, setTheme] = useTheme();

  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      setError(null);
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    }
  }, []);

  const refreshFolder = useCallback(
    async (vid: string, slug: string) => {
      await guard(async () => {
        const [d, s] = await Promise.all([
          unwrap(lode.backlog.listDays(vid, slug)),
          unwrap(lode.notes.list(vid, slug)),
        ]);
        setDays(d);
        setSubtopics(s);
        setNoteVersion((v) => v + 1);
      });
    },
    [guard],
  );

  const selectVault = useCallback(
    async (id: string) => {
      await guard(async () => {
        const fs = await unwrap(lode.folder.list(id));
        setVaultId(id);
        setFolders(fs);
        setFolder(null);
        setDays([]);
        setSubtopics([]);
        setSubtopic(null);
      });
    },
    [guard],
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
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [selectVault]);

  const selectFolder = async (slug: string): Promise<void> => {
    if (!vaultId) return;
    setFolder(slug);
    setSubtopic(null);
    await refreshFolder(vaultId, slug);
  };

  useEffect(() => {
    if (folder) scratchRef.current?.focus();
  }, [folder, vaultId]);

  const openVault = async (): Promise<void> => {
    await guard(async () => {
      const v = await unwrap(lode.vault.open());
      if (!v) return;
      const { vaults: vs } = await unwrap(lode.vault.list());
      setVaults(vs);
      await selectVault(v.id);
    });
  };

  const addPoint = async (text: string, date?: string): Promise<void> => {
    if (!vaultId || !folder) return;
    const p = await guard(() => unwrap(lode.backlog.add(vaultId, folder, text, date)));
    if (!p) throw new Error('not added');
    setFlashId(p.id);
    await refreshFolder(vaultId, folder);
    // A backdated point lands further down; bring it into view.
    if (date) requestAnimationFrame(() => document.getElementById(`point-${p.id}`)?.scrollIntoView({ block: 'nearest' }));
  };

  const folderInfo = folders.find((f) => f.slug === folder);
  const allPoints = days.flatMap((d) => d.points).filter((pt) => !pt.deleted);
  const unfiled = allPoints.filter((pt) => pt.filedUnder.length === 0).length;

  const jumpToPoint = (id: string): void => {
    setShowSettings(false);
    setFlashId(null);
    requestAnimationFrame(() => {
      setFlashId(id);
      document.getElementById(`point-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  return (
    <div className={`app ${showSettings ? 'with-settings' : ''}`}>
      <Sidebar
        vaults={vaults}
        activeVaultId={vaultId}
        folders={folders}
        activeFolder={folder}
        subtopics={subtopics}
        activeSubtopic={subtopic}
        settingsOpen={showSettings}
        theme={theme}
        onTheme={setTheme}
        onSelectVault={(id) => {
          setShowSettings(false);
          void selectVault(id);
        }}
        onOpenSettings={() => setShowSettings(true)}
        onOpenVault={() => void openVault()}
        onSelectFolder={(s) => {
          setShowSettings(false);
          if (s === folder) setSubtopic(null);
          else void selectFolder(s);
        }}
        onSelectSubtopic={(s) => {
          setShowSettings(false);
          setSubtopic(s);
        }}
        onCreateFolder={async (title) => {
          if (!vaultId) return;
          await guard(async () => {
            const f = await unwrap(lode.folder.create(vaultId, title));
            setFolders(await unwrap(lode.folder.list(vaultId)));
            await selectFolder(f.slug);
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
            await refreshFolder(vaultId, folder);
          });
        }}
        onDeleteFolder={async (slug) => {
          if (!vaultId) return;
          await guard(async () => {
            await unwrap(lode.folder.delete(vaultId, slug));
            setFolders(await unwrap(lode.folder.list(vaultId)));
            if (folder === slug) {
              setFolder(null);
              setDays([]);
              setSubtopics([]);
            }
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

      {showSettings ? (
        <main className="settings-page" aria-label="Settings">
          <SettingsView onClose={() => setShowSettings(false)} />
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
                  <button
                    className="btn accent"
                    onClick={() => setGenerating(true)}
                    disabled={unfiled === 0}
                    title={unfiled ? 'Organise unfiled points into subtopic notes' : 'Every point is filed'}
                  >
                    <SparkIcon size={14} />
                    Generate
                  </button>
                </header>
                <div className="backlog-scroll">
                  <Scratchpad key={folder} ref={scratchRef} folderTitle={folderInfo.title} onAdd={addPoint} />
                  <BacklogView
                    days={days}
                    subtopics={subtopics}
                    highlightId={flashId}
                    onOpenSubtopic={(s) => setSubtopic(s)}
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
            onSelect={setSubtopic}
            onError={setError}
            onJumpToPoint={jumpToPoint}
          />
        </>
      )}

      {generating && vaultId && folder && folderInfo && (
        <GenerateDialog
          vaultId={vaultId}
          folder={folder}
          folderTitle={folderInfo.title}
          onOpenSubtopic={setSubtopic}
          onOpenSettings={() => {
            setGenerating(false);
            setShowSettings(true);
          }}
          onClose={(changed) => {
            setGenerating(false);
            if (changed) void refreshFolder(vaultId, folder);
          }}
        />
      )}
    </div>
  );
}
