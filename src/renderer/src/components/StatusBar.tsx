import type { JobView } from '@shared/ipc';
import { isActive, jobStatusText, jobTitle } from '../jobs';
import { CheckIcon, CloseIcon, WarnIcon } from './Icons';

interface Props {
  jobs: JobView[];
  onOpen(jobId: string): void;
  onCancel(jobId: string): void;
  onDismiss(jobId: string): void;
}

/** Background generation jobs, as cards at the foot of the sidebar. Click one for details. */
export function StatusBar({ jobs, onOpen, onCancel, onDismiss }: Props): React.JSX.Element | null {
  if (jobs.length === 0) return null;
  const active = jobs.filter(isActive).length;
  return (
    <section className="job-cards" aria-label="Background jobs">
      <span className="visually-hidden" role="status" aria-live="polite">
        {active > 0 ? `${active} running or queued` : 'All jobs finished'}
      </span>
      <ul className="jobs" role="list">
        {jobs.map((j) => (
          <li key={j.id} className={`job ${j.status}`}>
            <button className="job-main" onClick={() => onOpen(j.id)} title="Show details">
              <span className={`job-badge ${j.status}`} aria-hidden="true">
                {j.status === 'running' ? (
                  <span className="spinner small" />
                ) : j.status === 'done' ? (
                  <CheckIcon size={11} />
                ) : j.status === 'failed' ? (
                  <WarnIcon size={11} />
                ) : (
                  <span className="job-dot" />
                )}
              </span>
              <span className="job-text">
                <span className="job-title">{jobTitle(j)}</span>
                <span className="job-status">{jobStatusText(j)}</span>
              </span>
            </button>
            <button
              className="icon-btn job-x"
              aria-label={isActive(j) ? `Cancel ${jobTitle(j)}` : `Dismiss ${jobTitle(j)}`}
              title={isActive(j) ? (j.status === 'queued' ? 'Remove from queue' : 'Cancel run') : 'Dismiss'}
              onClick={() => (isActive(j) ? onCancel(j.id) : onDismiss(j.id))}
            >
              <CloseIcon size={12} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
