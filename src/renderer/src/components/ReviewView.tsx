import type { ReviewItem, ReviewStage } from '@shared/types';
import { dayMonth, shortDate } from '../dates';
import { CheckIcon, InfoIcon, ReviewIcon } from './Icons';
import { Markdown } from './Markdown';
import { PageHeader } from './PageShell';

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
    <div className="settings-v2">
      <PageHeader icon={<ReviewIcon size={16} />} title="Review" closeLabel="Close review" onClose={onClose} />
      <div className="page-body">
        <div className="page-intro">
          <div>
            <h2>{items.length === 0 ? 'Nothing to review' : items.length === 1 ? '1 point to review' : `${items.length} points to review`}</h2>
            <p className="set-sub">What you learned comes back about a day, a week and a month later.</p>
          </div>
          {items.length > 1 && (
            <button className="btn" onClick={() => void onMark(items)}>
              <CheckIcon size={13} /> Mark all reviewed
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="page-empty">
            <ReviewIcon size={22} />
            <p className="empty-title">You're all caught up</p>
            <p>Nothing is due for review today.</p>
          </div>
        ) : (
          <>
            {stages.map((stage) => {
              const group = items.filter((i) => i.stage === stage);
              return (
                <section key={stage} className="page-group" aria-labelledby={`review-${stage}`}>
                  <h3 id={`review-${stage}`} className="page-group-head">
                    {STAGE_LABEL[stage]} <span className="mono-count">{group.length}</span>
                  </h3>
                  <ul className="row-card" role="list">
                    {group.map((it) => (
                      <li key={`${it.id}-${it.stage}`}>
                        <article className="review-item-row" aria-label={`Your point from ${shortDate(it.date)}`}>
                          <button
                            className="point-date"
                            onClick={() => onShowPoint(it.folder, it.id)}
                            title={`${shortDate(it.date)} · show in backlog`}
                          >
                            {dayMonth(it.date)}
                          </button>
                          <div className="row-main">
                            <div className="review-folder">{it.folderTitle}</div>
                            <div className="point-body user-md">
                              <Markdown text={it.text} keepBreaks />
                            </div>
                            <div className="review-foot">
                              {it.filedUnder.map((s) => (
                                <button key={s.slug} className="topic-link" onClick={() => onOpenNote(it.folder, s.slug)}>
                                  {s.title}
                                </button>
                              ))}
                              <button className="btn review-done" onClick={() => void onMark([it])}>
                                <CheckIcon size={13} /> Reviewed
                              </button>
                            </div>
                          </div>
                        </article>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            <p className="page-foot">
              <InfoIcon size={14} />
              Marking a point reviewed hides it until its next step (a week, then a month).
            </p>
          </>
        )}
      </div>
    </div>
  );
}
