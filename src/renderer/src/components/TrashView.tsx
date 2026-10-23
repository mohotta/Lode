import type { FolderInfo, TrashItem } from '@shared/types';
import { ask } from '../api';
import { FolderIcon, InfoIcon, NoteIcon, TrashIcon, UndoIcon } from './Icons';
import { PageHeader } from './PageShell';

interface Props {
  items: TrashItem[];
  folders: FolderInfo[];
  onRestore(item: TrashItem): Promise<void>;
  onPurge(item?: TrashItem): Promise<void>;
  onClose(): void;
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** The vault trash: deleted folders and notes, restorable until the trash is emptied. */
export function TrashView({ items, folders, onRestore, onPurge, onClose }: Props): React.JSX.Element {
  const folderTitle = (slug: string): string => folders.find((f) => f.slug === slug)?.title ?? slug;
  return (
    <div className="settings-v2">
      <PageHeader icon={<TrashIcon size={16} />} title="Trash" closeLabel="Close trash" onClose={onClose} />
      <div className="page-body">
        <div className="page-intro">
          <div>
            <h2>{items.length === 1 ? '1 item in trash' : `${items.length} items in trash`}</h2>
            <p className="set-sub">
              Kept in <code>.lode/trash</code> inside your vault until you empty it.
            </p>
          </div>
          {items.length > 0 && (
            <button
              className="btn outline-danger"
              onClick={() => {
                void ask({
                  message: `Permanently delete ${items.length} item(s)?`,
                  detail: 'This cannot be undone.',
                  confirmLabel: 'Delete permanently',
                  danger: true,
                }).then((ok) => {
                  if (ok) void onPurge();
                });
              }}
            >
              Empty trash…
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="page-empty">
            <TrashIcon size={22} />
            <p className="empty-title">Trash is empty</p>
            <p>Deleted folders and notes show up here.</p>
          </div>
        ) : (
          <>
            <ul className="row-card" role="list" aria-label="Deleted items">
              {items.map((it) => (
                <li key={it.id} className="row-item">
                  <span className="row-tile" aria-hidden="true">
                    {it.kind === 'folder' ? <FolderIcon size={16} /> : <NoteIcon size={16} />}
                  </span>
                  <div className="row-main">
                    <div className="row-title">{it.title}</div>
                    <div className="row-sub">
                      {it.kind === 'folder' ? 'Folder' : `Note in ${folderTitle(it.folder)}`} · deleted{' '}
                      <time dateTime={it.deletedAt}>{when(it.deletedAt)}</time>
                    </div>
                  </div>
                  <div className="row-actions-inline">
                    <button className="btn" onClick={() => void onRestore(it)} aria-label={`Restore ${it.title}`}>
                      <UndoIcon size={13} /> Restore
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={`Delete ${it.title} forever`}
                      title="Delete forever"
                      onClick={() => {
                        void ask({
                          message: `Permanently delete "${it.title}"?`,
                          detail: 'This cannot be undone.',
                          confirmLabel: 'Delete permanently',
                          danger: true,
                        }).then((ok) => {
                          if (ok) void onPurge(it);
                        });
                      }}
                    >
                      <TrashIcon size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="page-foot">
              <InfoIcon size={14} />
              Restoring a note files its points back where they were. Deleting forever can’t be undone.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
