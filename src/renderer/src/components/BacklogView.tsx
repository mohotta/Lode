import { useState } from 'react';
import type { BacklogDay, SubtopicInfo } from '@shared/types';
import { dayLabel, shortDate } from '../dates';
import { BanIcon, CopyIcon, DotsIcon, PencilIcon, TrashIcon, UndoIcon, WarnIcon } from './Icons';
import { EmptyState } from './EmptyState';
import { Markdown } from './Markdown';
import { Menu } from './Menu';
import { PointEditor } from './PointEditor';

interface Props {
  days: BacklogDay[];
  subtopics: SubtopicInfo[];
  highlightId: string | null;
  onOpenSubtopic(slug: string): void;
  onJumpToPoint(id: string): void;
  onEdit(id: string, text: string): Promise<boolean>;
  onSetDeleted(id: string, deleted: boolean): Promise<void>;
  /** Permanently removes a disabled point (asks first). */
  onPurge(id: string): Promise<void>;
}

export function BacklogView(p: Props): React.JSX.Element {
  const { days, subtopics, highlightId, onOpenSubtopic } = p;
  const [editing, setEditing] = useState<string | null>(null);
  const titleOf = (slug: string): string => subtopics.find((s) => s.slug === slug)?.title ?? slug;
  const dateOf = (id: string): string => days.flatMap((d) => d.points).find((pt) => pt.id === id)?.date ?? '';
  if (days.length === 0) {
    return (
      <EmptyState compact icon={<PencilIcon size={18} />} title="Nothing captured yet">
        Write one thing you learned today in the box above and press Enter.
      </EmptyState>
    );
  }
  return (
    <div className="backlog" aria-label="Backlog">
      {days.map((day) => (
        <section key={day.date} className="day" aria-labelledby={`day-${day.date}`}>
          <h3 id={`day-${day.date}`} className="day-heading">
            {dayLabel(day.date)}
          </h3>
          <ul className="points" role="list">
            {day.points.map((pt) => {
              const filed = pt.filedUnder.length > 0;
              return (
                <li
                  key={pt.id}
                  id={`point-${pt.id}`}
                  // Focusable for j/k navigation.
                  tabIndex={-1}
                  className={`point-row ${pt.deleted ? 'deleted' : ''} ${highlightId === pt.id ? 'flash' : ''}`}
                >
                  <div className="point-main">
                    {editing === pt.id ? (
                      <PointEditor
                        initial={pt.text}
                        onSave={(text) => p.onEdit(pt.id, text)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <>
                        <div className="point-text user-md">
                          <Markdown text={pt.text} keepBreaks />
                        </div>
                        <div className="point-meta">
                          {pt.deleted ? (
                            <span className="meta-note">disabled</span>
                          ) : filed ? (
                            pt.filedUnder.map((s) => (
                              <button key={s} className="topic-link" onClick={() => onOpenSubtopic(s)} title={`Open ${titleOf(s)}`}>
                                {titleOf(s)}
                              </button>
                            ))
                          ) : (
                            <span className="meta-note">unfiled</span>
                          )}
                          {pt.corrected && !pt.deleted && (
                            <span className="meta-note fix" title="An AI correction note was added for this point">
                              <WarnIcon size={11} /> needs a fix
                            </span>
                          )}
                          {pt.duplicateOf && !pt.deleted && (
                            <button
                              className="meta-note link-btn"
                              title="Generate found this repeats an earlier point. Show it."
                              onClick={() => pt.duplicateOf && p.onJumpToPoint(pt.duplicateOf)}
                            >
                              <CopyIcon size={11} /> repeat of {shortDate(dateOf(pt.duplicateOf)) || 'an earlier point'}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  {editing !== pt.id && (
                    <span className="row-actions point-actions">
                      <Menu
                        label="Point actions"
                        trigger={<DotsIcon size={15} />}
                        align="end"
                        items={
                          pt.deleted
                            ? [
                                { label: 'Restore', icon: <UndoIcon size={14} />, onSelect: () => void p.onSetDeleted(pt.id, false) },
                                'separator',
                                {
                                  label: 'Delete permanently…',
                                  icon: <TrashIcon size={14} />,
                                  danger: true,
                                  onSelect: () => void p.onPurge(pt.id),
                                },
                              ]
                            : [
                                { label: 'Edit', icon: <PencilIcon size={14} />, onSelect: () => setEditing(pt.id) },
                                'separator',
                                {
                                  label: 'Disable',
                                  icon: <BanIcon size={14} />,
                                  onSelect: () => void p.onSetDeleted(pt.id, true),
                                },
                              ]
                        }
                      />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
