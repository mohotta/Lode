import { useRef, useState } from 'react';
import type { FolderInfo, SubtopicInfo, VaultInfo } from '@shared/types';
import { ask } from '../api';
import type { ThemePref } from '../theme';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  DotsIcon,
  GearIcon,
  MonitorIcon,
  MoonIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  ReviewIcon,
  SearchIcon,
  SunIcon,
  TrashIcon,
} from './Icons';
import { Menu } from './Menu';

interface Props {
  vaults: VaultInfo[];
  activeVaultId: string | null;
  folders: FolderInfo[];
  activeFolder: string | null;
  subtopics: SubtopicInfo[];
  activeSubtopic: string | null;
  settingsOpen: boolean;
  trashOpen: boolean;
  trashCount: number;
  reviewOpen: boolean;
  reviewCount: number;
  searchOpen: boolean;
  theme: ThemePref;
  onTheme(t: ThemePref): void;
  onSelectVault(id: string): void;
  onOpenVault(): void;
  onSelectFolder(slug: string): void;
  onSelectSubtopic(slug: string): void;
  onCreateFolder(title: string): Promise<void>;
  onRenameFolder(slug: string, title: string): Promise<void>;
  onRenameSubtopic(slug: string, title: string): Promise<void>;
  onDeleteFolder(slug: string): Promise<void>;
  onRegenerateSubtopic(slug: string, title: string): void;
  onDeleteSubtopic(slug: string, title: string): void;
  onOpenSettings(): void;
  onOpenTrash(): void;
  onOpenReview(): void;
  onOpenSearch(): void;
  /** Drag handle on the right edge (see Resizer). */
  resizer?: React.ReactNode;
}

const NEXT_THEME: Record<ThemePref, ThemePref> = { system: 'dark', dark: 'light', light: 'system' };

export function Sidebar(p: Props): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [renamingSub, setRenamingSub] = useState<string | null>(null);
  const submitting = useRef(false);
  const vault = p.vaults.find((v) => v.id === p.activeVaultId);

  // Enter then blur would both fire; the ref makes the create happen once.
  const submitNew = async (): Promise<void> => {
    if (submitting.current) return;
    if (!newTitle.trim()) return setAdding(false);
    submitting.current = true;
    try {
      await p.onCreateFolder(newTitle);
      setNewTitle('');
      setAdding(false);
    } finally {
      submitting.current = false;
    }
  };

  return (
    <nav className="sidebar" aria-label="Vaults and folders">
      {p.resizer}
      <div className="sidebar-top">
        <Menu
          label="Switch vault"
          triggerClassName="vault-switch"
          trigger={
            <>
              <span className="vault-name">{vault?.name ?? 'No vault'}</span>
              <ChevronDownIcon size={14} className="vault-chevron" />
            </>
          }
          items={[
            ...p.vaults.map((v) => ({
              label: v.name,
              checked: v.id === p.activeVaultId,
              onSelect: () => p.onSelectVault(v.id),
            })),
            ...(p.vaults.length ? (['separator'] as const) : []),
            { label: 'Open or create a vault…', icon: <PlusIcon size={14} />, onSelect: p.onOpenVault },
          ]}
        />
        {vault && (
          <button
            className={`icon-btn ${p.searchOpen ? 'selected' : ''}`}
            aria-label="Search"
            title="Search points and notes (Ctrl+K)"
            onClick={p.onOpenSearch}
          >
            <SearchIcon size={15} />
          </button>
        )}
      </div>

      <div className="sidebar-scroll">
        {vault ? (
          <>
            <div className="nav-items">
              <button className={`tree-item ${p.reviewOpen ? 'selected' : ''}`} onClick={p.onOpenReview}>
                <ReviewIcon size={15} className="tree-icon" />
                <span className="tree-label">Review</span>
                {p.reviewCount > 0 && (
                  <span className="tree-count due" aria-label={`${p.reviewCount} due`}>
                    {p.reviewCount}
                  </span>
                )}
              </button>
            </div>
            <div className="section-head">
              <span>Folders</span>
              <button className="icon-btn" aria-label="New folder" title="New folder" onClick={() => setAdding(true)}>
                <PlusIcon size={14} />
              </button>
            </div>
            <ul className="tree" role="list" aria-label={`Folders in ${vault.name}`}>
              {p.folders.map((f) => {
                const active = f.slug === p.activeFolder;
                if (renaming === f.slug) {
                  return (
                    <li key={f.slug}>
                      <input
                        className="tree-input"
                        autoFocus
                        aria-label="New folder name"
                        value={renameTitle}
                        onChange={(e) => setRenameTitle(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            await p.onRenameFolder(f.slug, renameTitle);
                            setRenaming(null);
                          } else if (e.key === 'Escape') setRenaming(null);
                        }}
                        onBlur={() => setRenaming(null)}
                      />
                    </li>
                  );
                }
                return (
                  <li key={f.slug}>
                    <div className={`tree-row ${active && !p.activeSubtopic && !p.settingsOpen && !p.trashOpen && !p.reviewOpen && !p.searchOpen ? 'selected' : ''}`}>
                      <button
                        className="tree-item"
                        aria-current={active ? 'page' : undefined}
                        onClick={() => p.onSelectFolder(f.slug)}
                      >
                        {active ? (
                          <ChevronDownIcon size={13} className="tree-icon" />
                        ) : (
                          <ChevronRightIcon size={13} className="tree-icon" />
                        )}
                        <span className="tree-label">{f.title}</span>
                      </button>
                      <span className="row-actions">
                        <Menu
                          label={`Actions for ${f.title}`}
                          trigger={<DotsIcon size={15} />}
                          align="end"
                          items={[
                            {
                              label: 'Rename',
                              icon: <PencilIcon size={14} />,
                              onSelect: () => {
                                setRenaming(f.slug);
                                setRenameTitle(f.title);
                              },
                            },
                            'separator',
                            {
                              label: 'Move to trash',
                              icon: <TrashIcon size={14} />,
                              danger: true,
                              onSelect: () => {
                                void ask({
                                  message: `Move "${f.title}" to the trash?`,
                                  detail: 'You can restore it from Trash.',
                                  confirmLabel: 'Move to trash',
                                }).then((ok) => {
                                  if (ok) void p.onDeleteFolder(f.slug);
                                });
                              },
                            },
                          ]}
                        />
                      </span>
                    </div>
                    {active && p.subtopics.length > 0 && (
                      <ul className="tree nested" role="list" aria-label={`Subtopics in ${f.title}`}>
                        {p.subtopics.map((s) =>
                          renamingSub === s.slug ? (
                            <li key={s.slug}>
                              <input
                                className="tree-input"
                                autoFocus
                                aria-label="New subtopic name"
                                value={renameTitle}
                                onChange={(e) => setRenameTitle(e.target.value)}
                                onKeyDown={async (e) => {
                                  if (e.key === 'Enter') {
                                    await p.onRenameSubtopic(s.slug, renameTitle);
                                    setRenamingSub(null);
                                  } else if (e.key === 'Escape') setRenamingSub(null);
                                }}
                                onBlur={() => setRenamingSub(null)}
                              />
                            </li>
                          ) : (
                            <li key={s.slug}>
                              <div className={`tree-row ${s.slug === p.activeSubtopic && !p.settingsOpen && !p.trashOpen && !p.reviewOpen && !p.searchOpen ? 'selected' : ''}`}>
                                <button
                                  className="tree-item"
                                  aria-current={s.slug === p.activeSubtopic ? 'true' : undefined}
                                  onClick={() => p.onSelectSubtopic(s.slug)}
                                  title={s.title}
                                >
                                  <span className="tree-label">{s.title}</span>
                                  <span className="tree-count" aria-label={`${s.pointCount} points`}>
                                    {s.pointCount}
                                  </span>
                                </button>
                                <span className="row-actions">
                                  <Menu
                                    label={`Actions for ${s.title}`}
                                    trigger={<DotsIcon size={15} />}
                                    align="end"
                                    items={[
                                      {
                                        label: 'Rename',
                                        icon: <PencilIcon size={14} />,
                                        onSelect: () => {
                                          setRenamingSub(s.slug);
                                          setRenameTitle(s.title);
                                        },
                                      },
                                      {
                                        label: 'Rewrite from points…',
                                        icon: <RefreshIcon size={14} />,
                                        onSelect: () => p.onRegenerateSubtopic(s.slug, s.title),
                                      },
                                      'separator',
                                      {
                                        label: 'Move to trash',
                                        icon: <TrashIcon size={14} />,
                                        danger: true,
                                        onSelect: () => p.onDeleteSubtopic(s.slug, s.title),
                                      },
                                    ]}
                                  />
                                </span>
                              </div>
                            </li>
                          ),
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
              <li>
                {adding ? (
                  <input
                    className="tree-input"
                    autoFocus
                    placeholder="Folder name"
                    aria-label="New folder name"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submitNew();
                      else if (e.key === 'Escape') setAdding(false);
                    }}
                    onBlur={() => void submitNew()}
                  />
                ) : (
                  <button className="tree-item ghost" onClick={() => setAdding(true)}>
                    <PlusIcon size={14} className="tree-icon" />
                    <span className="tree-label">New folder</span>
                  </button>
                )}
              </li>
            </ul>
          </>
        ) : (
          <div className="sidebar-empty">
            <p>A vault is a folder of plain markdown files on your disk.</p>
            <button className="btn primary block" onClick={p.onOpenVault}>
              Open or create a vault
            </button>
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button className={`tree-item ${p.settingsOpen ? 'selected' : ''}`} onClick={p.onOpenSettings}>
          <GearIcon size={15} className="tree-icon" />
          <span className="tree-label">Settings</span>
        </button>
        {vault && (
          <button
            className={`icon-btn trash-btn ${p.trashOpen ? 'selected' : ''}`}
            aria-label={`Trash, ${p.trashCount} item(s)`}
            title="Trash"
            onClick={p.onOpenTrash}
          >
            <TrashIcon size={15} />
            {p.trashCount > 0 && <span className="trash-count">{p.trashCount}</span>}
          </button>
        )}
        <button
          className="icon-btn"
          aria-label={`Theme: ${p.theme}. Switch to ${NEXT_THEME[p.theme]}`}
          title={`Theme: ${p.theme}`}
          onClick={() => p.onTheme(NEXT_THEME[p.theme])}
        >
          {p.theme === 'dark' ? <MoonIcon size={15} /> : p.theme === 'light' ? <SunIcon size={15} /> : <MonitorIcon size={15} />}
        </button>
      </div>
    </nav>
  );
}
