import type { JobView, ProgressView } from '@shared/ipc';

export function progressText(p: ProgressView | null): string {
  if (!p) return 'Starting…';
  switch (p.phase) {
    case 'collecting':
      return 'Collecting points…';
    case 'calling':
      return `${p.retry ? 'Retrying' : 'Asking the model'} (batch ${p.chunk} of ${p.chunks})…`;
    case 'searching':
      return `Searching: “${p.query}”`;
    case 'writing':
      return `Writing ${p.subtopics} note(s)…`;
    case 'done':
      return 'Done';
  }
}

export function jobTitle(j: JobView): string {
  return j.kind === 'regenerate' ? `Regenerate · ${j.subtopicTitle ?? j.subtopic ?? ''}` : `Generate · ${j.folderTitle}`;
}

/** One-line status for the status bar. */
export function jobStatusText(j: JobView): string {
  switch (j.status) {
    case 'queued':
      return 'Queued';
    case 'running':
      return progressText(j.progress);
    case 'cancelled':
      return 'Cancelled';
    case 'failed':
      return 'Failed';
    case 'done': {
      const r = j.report;
      if (!r) return 'Done';
      if (j.kind === 'regenerate') return 'Rewritten';
      return `Filed ${r.filed.length}${r.unfiled.length ? `, ${r.unfiled.length} unfiled` : ''}`;
    }
  }
}

export const isActive = (j: JobView): boolean => j.status === 'queued' || j.status === 'running';
