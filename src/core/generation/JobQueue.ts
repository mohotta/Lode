import { randomBytes } from 'node:crypto';
import type { ProgressEvent } from './GenerationService';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface JobSpec {
  vaultId: string;
  folder: string;
  folderTitle: string;
  kind: 'generate' | 'regenerate' | 'digest' | 'article';
  /** Regenerate only: the note being rewritten. */
  subtopic?: string;
  subtopicTitle?: string;
  /** Digest only: the period ID and its title. */
  digest?: string;
  digestTitle?: string;
  /** Note only: the slug of the note to edit with AI (absent for a new note), its title and the request. */
  article?: string;
  articleTitle?: string;
  instruction?: string;
  articleSubtopics?: string[];
  articleTopics?: string[];
}

export interface Job<R> extends JobSpec {
  id: string;
  status: JobStatus;
  progress: ProgressEvent | null;
  report?: R;
  error?: string;
  queuedAt: string;
  finishedAt?: string;
}

export type JobRunner<R> = (spec: JobSpec, signal: AbortSignal, onProgress: (e: ProgressEvent) => void) => Promise<R>;

const FINISHED: readonly JobStatus[] = ['done', 'failed', 'cancelled'];

/**
 * Background generation jobs, run one at a time in the order queued. Running them
 * serially means two jobs never race on the same notes or send the same unfiled points.
 * Each job reads the vault when it starts, not when it is queued.
 */
export class JobQueue<R> {
  private readonly jobs: Job<R>[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private running = false;

  constructor(
    private readonly runner: JobRunner<R>,
    private readonly onChange: (jobs: readonly Job<R>[]) => void,
    private readonly isCancel: (err: unknown) => boolean = () => false,
    private readonly newId: () => string = () => `j-${randomBytes(6).toString('hex')}`,
  ) {}

  list(): readonly Job<R>[] {
    return this.jobs.map((j) => ({ ...j }));
  }

  /** Queues a job. The same job already waiting in the queue is returned instead of a second copy. */
  enqueue(spec: JobSpec): Job<R> {
    const waiting = this.jobs.find(
      (j) =>
        j.status === 'queued' &&
        j.vaultId === spec.vaultId &&
        j.folder === spec.folder &&
        j.kind === spec.kind &&
        j.subtopic === spec.subtopic &&
        j.digest === spec.digest &&
        j.article === spec.article &&
        j.articleTitle === spec.articleTitle &&
        j.instruction === spec.instruction,
    );
    if (waiting) return { ...waiting };
    const job: Job<R> = { ...spec, id: this.newId(), status: 'queued', progress: null, queuedAt: new Date().toISOString() };
    this.jobs.push(job);
    this.emit();
    void this.pump();
    return { ...job };
  }

  /** Cancels a waiting job, or aborts a running one (which then writes nothing). */
  cancel(id: string): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    if (job.status === 'queued') {
      this.finish(job, 'cancelled');
    } else if (job.status === 'running') {
      this.controllers.get(id)?.abort();
    }
  }

  /** Removes a finished job from the list. Waiting or running jobs are left alone. */
  dismiss(id: string): void {
    const i = this.jobs.findIndex((j) => j.id === id && FINISHED.includes(j.status));
    if (i === -1) return;
    this.jobs.splice(i, 1);
    this.emit();
  }

  /** Resolves once nothing is queued or running (tests). */
  async idle(): Promise<void> {
    while (this.jobs.some((j) => !FINISHED.includes(j.status))) await new Promise((r) => setTimeout(r, 5));
  }

  private emit(): void {
    this.onChange(this.list());
  }

  private finish(job: Job<R>, status: JobStatus, extra: Partial<Job<R>> = {}): void {
    Object.assign(job, { status, finishedAt: new Date().toISOString(), ...extra });
    this.emit();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let job = this.next(); job; job = this.next()) {
        const ctrl = new AbortController();
        this.controllers.set(job.id, ctrl);
        job.status = 'running';
        this.emit();
        const current = job;
        try {
          const report = await this.runner(current, ctrl.signal, (e) => {
            current.progress = e;
            this.emit();
          });
          this.finish(current, 'done', { report });
        } catch (err) {
          if (ctrl.signal.aborted || this.isCancel(err)) this.finish(current, 'cancelled');
          else this.finish(current, 'failed', { error: err instanceof Error ? err.message : String(err) });
        } finally {
          this.controllers.delete(current.id);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private next(): Job<R> | undefined {
    return this.jobs.find((j) => j.status === 'queued');
  }
}
