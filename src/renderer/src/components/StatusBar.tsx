import type { JobView } from '@shared/ipc';
import { isActive, jobStatusText, jobTitle } from '../jobs';
import { CheckIcon, CloseIcon, WarnIcon } from './Icons';

interface Props {
  jobs: JobView[];
  onOpen(jobId: string): void;
  onCancel(jobId: string): void;
  onDismiss(jobId: string): void;
}

/** Background generation jobs, out of the way at the bottom of the window. Click one for details. */
export function StatusBar({ jobs, onOpen, onCancel, onDismiss }: Props): React.JSX.Element | null {
  if (jobs.length === 0) return null;
  const active = jobs.filter(isActive).length;
  return (
    <footer className="status-bar" aria-label="Background jobs">
      <span className="status-summary" role="status" aria-live="polite">
        {active > 0 ? `${active} running or queued` : 'All jobs finished'}
      </span>
      <ul className="jobs" role="list">
        {jobs.map((j) => (
          <li key={j.id} className={`job ${j.status}`}>
            <button className="job-main" onClick={() => onOpen(j.id)} title="Show details">
              {j.status === 'running' ? (
                <span className="spinner small" aria-hidden="true" />
              ) : j.status === 'done' ? (
                <CheckIcon size={13} className="job-icon ok" />
              ) : j.status === 'failed' ? (
                <WarnIcon size={13} className="job-icon err" />
              ) : (
                <span className="job-dot" aria-hidden="true" />
              )}
              <span className="job-title">{jobTitle(j)}</span>
              <span className="job-status">{jobStatusText(j)}</span>
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
    </footer>
  );
}
