import type { FolderInfo, TrashItem } from '@shared/types';
import { FolderIcon, NoteIcon, TrashIcon, UndoIcon } from './Icons';

interface Props {
  items: TrashItem[];
  folders: FolderInfo[];
  onRestore(item: TrashItem): Promise<void>;
  onPurge(item?: TrashItem): Promise<void>;
  onClose(): void;
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** The vault trash: deleted folders and notes, restorable until the trash is emptied. */
export function TrashView({ items, folders, onRestore, onPurge, onClose }: Props): React.JSX.Element {
  const folderTitle = (slug: string): string => folders.find((f) => f.slug === slug)?.title ?? slug;
  return (
    <div className="settings trash">
      <header className="center-header">
        <h1>Trash</h1>
        <div className="header-actions">
          <button
            className="btn danger"
            disabled={items.length === 0}
            onClick={() => {
              if (confirm(`Permanently delete ${items.length} item(s)? This cannot be undone.`)) void onPurge();
            }}
          >
            Empty trash
          </button>
          <button className="btn" onClick={onClose}>
            Back
          </button>
        </div>
      </header>
      <p className="muted small">
        Deleted folders and notes are kept in <code>.lode/trash</code> inside the vault until you empty the trash. Restoring a
        note files its points again.
      </p>
      {items.length === 0 ? (
        <div className="empty-state">
          <TrashIcon size={28} className="empty-icon" />
          <p className="empty-title">Trash is empty</p>
        </div>
      ) : (
        <ul className="trash-list" role="list" aria-label="Deleted items">
          {items.map((it) => (
            <li key={it.id} className="trash-row">
              {it.kind === 'folder' ? (
                <FolderIcon size={16} className="trash-icon" />
              ) : (
                <NoteIcon size={16} className="trash-icon" />
              )}
              <div className="trash-main">
                <span className="trash-title">{it.title}</span>
                <span className="trash-sub">
                  {it.kind === 'folder' ? 'Folder' : `Note in ${folderTitle(it.folder)}`} · deleted {when(it.deletedAt)}
                </span>
              </div>
              <button className="btn" onClick={() => void onRestore(it)} aria-label={`Restore ${it.title}`}>
                <UndoIcon size={13} /> Restore
              </button>
              <button
                className="icon-btn"
                aria-label={`Delete ${it.title} forever`}
                title="Delete forever"
                onClick={() => {
                  if (confirm(`Permanently delete "${it.title}"? This cannot be undone.`)) void onPurge(it);
                }}
              >
                <TrashIcon size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
