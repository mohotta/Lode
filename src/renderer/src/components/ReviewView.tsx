import type { ReviewItem, ReviewStage } from '@shared/types';
import { shortDate } from '../dates';
import { CheckIcon, ReviewIcon } from './Icons';
import { Markdown } from './Markdown';

interface Props {
  items: ReviewItem[];
  onMark(items: ReviewItem[]): Promise<void>;
  onOpenNote(folder: string, subtopic: string): void;
  onShowPoint(folder: string, id: string): void;
  onClose(): void;
}

const STAGE_LABEL: Record<ReviewStage, string> = {
  30: 'About a month ago',
  7: 'About a week ago',
  1: 'In the last few days',
};

/** FR-27: points resurface about 1, 7 and 30 days after capture until marked reviewed. */
export function ReviewView({ items, onMark, onOpenNote, onShowPoint, onClose }: Props): React.JSX.Element {
  const stages = ([30, 7, 1] as const).filter((s) => items.some((i) => i.stage === s));
  return (
    <div className="settings review">
      <header className="center-header">
        <h1>Review</h1>
        <div className="header-actions">
          <button className="btn" onClick={onClose}>
            Back
          </button>
        </div>
      </header>
      <p className="muted small">
        What you learned resurfaces about a day, a week and a month later. Read it again, then mark it reviewed.
      </p>
      {items.length === 0 ? (
        <div className="empty-state">
          <ReviewIcon size={28} className="empty-icon" />
          <p className="empty-title">You're all caught up</p>
          <p>Nothing is due for review today.</p>
        </div>
      ) : (
        stages.map((stage) => {
          const group = items.filter((i) => i.stage === stage);
          return (
            <section key={stage} className="review-group" aria-labelledby={`review-${stage}`}>
              <div className="review-group-head">
                <h2 id={`review-${stage}`}>
                  {STAGE_LABEL[stage]} <span className="count">{group.length}</span>
                </h2>
                {group.length > 1 && (
                  <button className="btn" onClick={() => void onMark(group)}>
                    <CheckIcon size={13} /> Mark all reviewed
                  </button>
                )}
              </div>
              <ul className="review-list" role="list">
                {group.map((it) => (
                  <li key={`${it.id}-${it.stage}`}>
                    <article className="point-block review-card" aria-label={`Your point from ${shortDate(it.date)}`}>
                      <header className="point-head">
                        <span className="review-folder">{it.folderTitle}</span>
                        <button className="point-date" onClick={() => onShowPoint(it.folder, it.id)} title="Show in backlog">
                          {shortDate(it.date)}
                        </button>
                      </header>
                      <div className="point-body user-md">
                        <Markdown text={it.text} keepBreaks />
                      </div>
                      <footer className="review-foot">
                        {it.filedUnder.map((s) => (
                          <button key={s.slug} className="topic-link" onClick={() => onOpenNote(it.folder, s.slug)}>
                            {s.title}
                          </button>
                        ))}
                        <button className="btn review-done" onClick={() => void onMark([it])}>
                          <CheckIcon size={13} /> Reviewed
                        </button>
                      </footer>
                    </article>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
