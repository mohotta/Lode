import type { BacklogDay, SubtopicInfo } from '@shared/types';
import { dayLabel } from '../dates';
import { WarnIcon } from './Icons';
import { Markdown } from './Markdown';

interface Props {
  days: BacklogDay[];
  subtopics: SubtopicInfo[];
  highlightId: string | null;
  onOpenSubtopic(slug: string): void;
}

export function BacklogView({ days, subtopics, highlightId, onOpenSubtopic }: Props): React.JSX.Element {
  const titleOf = (slug: string): string => subtopics.find((s) => s.slug === slug)?.title ?? slug;
  if (days.length === 0) {
    return (
      <div className="empty-state small-pad">
        <p className="empty-title">Nothing captured yet</p>
        <p>Write one thing you learned today and press Enter.</p>
      </div>
    );
  }
  return (
    <div className="backlog" aria-label="Backlog">
      {days.map((day) => (
        <section key={day.date} className="day" aria-labelledby={`day-${day.date}`}>
          <h3 id={`day-${day.date}`} className="day-heading">
            {dayLabel(day.date)}
            <span className="day-count">{day.points.length}</span>
          </h3>
          <ul className="points" role="list">
            {day.points.map((p) => {
              const filed = p.filedUnder.length > 0;
              return (
                <li
                  key={p.id}
                  id={`point-${p.id}`}
                  className={`point-row ${p.deleted ? 'deleted' : ''} ${highlightId === p.id ? 'flash' : ''}`}
                >
                  <span className={`status-dot ${filed ? 'filed' : 'unfiled'}`} aria-hidden="true" />
                  <div className="point-main">
                    <div className="point-text user-md">
                      <Markdown text={p.text} keepBreaks />
                    </div>
                    <div className="point-meta">
                      {filed ? (
                        p.filedUnder.map((s) => (
                          <button key={s} className="tag" onClick={() => onOpenSubtopic(s)} title={`Open ${titleOf(s)}`}>
                            {titleOf(s)}
                          </button>
                        ))
                      ) : (
                        <span className="tag muted-tag">unfiled</span>
                      )}
                      {p.corrected && (
                        <span className="tag fix-tag" title="An AI correction note was added for this point">
                          <WarnIcon size={11} /> needs a fix
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
