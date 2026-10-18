import { useEffect, useRef, useState } from 'react';
import type { JobView, PreviewView } from '@shared/ipc';
import { lode, unwrap } from '../api';
import { progressText } from '../jobs';
import { MinimizeIcon } from './Icons';

/** What the dialog shows: a preview to confirm, or an existing background job. */
export type DialogTarget =
  | { kind: 'new'; folder: string; folderTitle: string; subtopic?: string; subtopicTitle?: string }
  | { kind: 'job'; jobId: string };

interface Props {
  vaultId: string;
  target: DialogTarget;
  jobs: JobView[];
  onClose(): void;
  onOpenSubtopic(folder: string, slug: string): void;
  onOpenSettings(): void;
}

type PreviewState =
  | { s: 'loading' }
  | { s: 'preview'; preview: PreviewView; busy: boolean }
  | { s: 'error'; message: string; preview?: PreviewView };

const fmt = (n: number): string => n.toLocaleString();

/**
 * Generate / Regenerate dialog. Confirming queues the job and minimises the dialog to the
 * status bar, so work carries on; clicking the job there reopens this dialog on it.
 */
export function GenerateDialog(p: Props): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<PreviewState>({ s: 'loading' });
  const { vaultId, target } = p;
  const newFolder = target.kind === 'new' ? target.folder : null;
  const newSubtopic = target.kind === 'new' ? target.subtopic : undefined;
  const job = target.kind === 'job' ? p.jobs.find((j) => j.id === target.jobId) : undefined;
  const isRegen = target.kind === 'new' ? !!target.subtopic : job?.kind === 'regenerate';
  const heading =
    target.kind === 'new'
      ? target.subtopic
        ? `Regenerate · ${target.subtopicTitle ?? target.subtopic}`
        : `Generate notes · ${target.folderTitle}`
      : job
        ? job.kind === 'regenerate'
          ? `Regenerate · ${job.subtopicTitle ?? job.subtopic}`
          : `Generate notes · ${job.folderTitle}`
        : 'Generate';

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    if (newFolder === null) return;
    let cancelled = false;
    unwrap(lode.generate.preview(vaultId, newFolder, newSubtopic)).then(
      (preview) => !cancelled && setState({ s: 'preview', preview, busy: false }),
      (e: unknown) => !cancelled && setState({ s: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [vaultId, newFolder, newSubtopic]);

  const close = (): void => {
    ref.current?.close();
    p.onClose();
  };

  /** Close and remove a finished job from the status bar. */
  const closeFinished = (): void => {
    if (job) void lode.generate.dismiss(job.id);
    close();
  };

  const start = async (preview: PreviewView): Promise<void> => {
    if (newFolder === null) return;
    setState({ s: 'preview', preview, busy: true });
    try {
      await unwrap(lode.generate.enqueue(vaultId, newFolder, newSubtopic));
      close();
    } catch (e) {
      setState({ s: 'error', message: e instanceof Error ? e.message : String(e), preview });
    }
  };

  const queuedAhead = job ? p.jobs.filter((j) => j.status === 'running' || (j.status === 'queued' && j.queuedAt < job.queuedAt)).length : 0;

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="gen-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <h2 id="gen-title">{heading}</h2>

      {target.kind === 'new' && state.s === 'loading' && <p>Preparing preview…</p>}

      {target.kind === 'new' && state.s === 'preview' && (
        <>
          <dl className="preview-grid">
            <dt>Points</dt>
            <dd>
              {fmt(state.preview.points)} {isRegen ? 'in this note' : 'unfiled'}
            </dd>
            <dt>Provider</dt>
            <dd>
              {state.preview.provider} <span className="muted">({state.preview.baseUrl})</span>
            </dd>
            <dt>Model</dt>
            <dd>{state.preview.model || <em>not set</em>}</dd>
            <dt>Estimated tokens</dt>
            <dd>
              ~{fmt(state.preview.estimatedInputTokens)} in · ~{fmt(state.preview.estimatedOutputTokens)} out
              {state.preview.chunks > 1 && ` · ${state.preview.chunks} batches`}
            </dd>
            <dt>Web search</dt>
            <dd>
              {state.preview.useSearch ? 'On (Tavily)' : 'Off'}
              {state.preview.searchUnavailable && (
                <span className="muted"> — no Tavily key saved, so AI additions cannot be sourced</span>
              )}
            </dd>
          </dl>
          <p className="muted small">
            {isRegen
              ? "Replaces this note's AI sections; the current version is kept so you can undo. Your points are sent again and never modified."
              : 'Sends your unfiled points, short excerpts of earlier points (to spot repeats) and your subtopic names. Your backlog is never modified.'}{' '}
            It runs in the background; you can keep working.
          </p>
          {state.preview.blocker && (
            <div className="banner warn" role="status">
              {state.preview.blocker}
            </div>
          )}
          <div className="dialog-actions">
            {state.preview.blocker?.includes('Settings') && (
              <button className="btn" onClick={p.onOpenSettings}>
                Open Settings
              </button>
            )}
            <button className="btn" onClick={close}>
              Close
            </button>
            <button
              className="btn primary"
              disabled={!!state.preview.blocker || state.busy}
              onClick={() => void start(state.preview)}
              autoFocus
            >
              {isRegen ? `Regenerate from ${fmt(state.preview.points)} point(s)` : `Send ${fmt(state.preview.points)} point(s)`}
            </button>
          </div>
        </>
      )}

      {target.kind === 'new' && state.s === 'error' && (
        <>
          <div className="banner error" role="alert">
            {state.message}
          </div>
          <div className="dialog-actions">
            {state.preview && (
              <button className="btn" onClick={() => setState({ s: 'preview', preview: state.preview!, busy: false })}>
                Back
              </button>
            )}
            <button className="btn primary" onClick={close} autoFocus>
              Close
            </button>
          </div>
        </>
      )}

      {target.kind === 'job' && !job && (
        <>
          <p>This job is no longer in the list.</p>
          <div className="dialog-actions">
            <button className="btn primary" onClick={close} autoFocus>
              Close
            </button>
          </div>
        </>
      )}

      {job && (job.status === 'queued' || job.status === 'running') && (
        <>
          <p className="progress" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />{' '}
            {job.status === 'queued'
              ? `Waiting in the queue${queuedAhead ? ` (${queuedAhead} ahead)` : ''}…`
              : progressText(job.progress)}
          </p>
          <p className="muted small">Runs in the background. Nothing is written until every call has finished.</p>
          <div className="dialog-actions">
            <button className="btn" onClick={() => void lode.generate.cancel(job.id)}>
              {job.status === 'queued' ? 'Remove from queue' : 'Cancel run'}
            </button>
            <button className="btn primary" onClick={close} autoFocus>
              <MinimizeIcon size={14} /> Minimize
            </button>
          </div>
        </>
      )}

      {job?.status === 'done' && job.report && (
        <>
          <p role="status">
            {job.kind === 'regenerate'
              ? `Rewrote the AI sections for ${job.report.filed.length} point(s). The previous version can be restored with Undo regenerate.`
              : `Filed ${job.report.filed.length} point(s)${job.report.unfiled.length > 0 ? `, ${job.report.unfiled.length} left unfiled` : ''}.`}{' '}
            Used {fmt(job.report.usage.inputTokens)} in / {fmt(job.report.usage.outputTokens)} out tokens,{' '}
            {job.report.usage.searches} search(es), {job.report.sources} source(s) cited.
            {job.report.corrected.length > 0 &&
              ` ${job.report.corrected.length} point(s) got a correction note; your text is unchanged.`}
            {job.report.duplicates.length > 0 &&
              ` ${job.report.duplicates.length} point(s) repeat an earlier point and were filed next to it.`}
          </p>
          {job.report.changed.length > 0 && (
            <ul className="changed" role="list">
              {job.report.changed.map((c) => (
                <li key={c.slug}>
                  <button
                    className="chip filed"
                    onClick={() => {
                      p.onOpenSubtopic(job.folder, c.slug);
                      closeFinished();
                    }}
                  >
                    {c.title}
                    {c.isNew && ' (new)'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {job.report.warnings.length > 0 && (
            <ul className="warnings">
              {job.report.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <div className="dialog-actions">
            <button className="btn primary" onClick={closeFinished} autoFocus>
              Done
            </button>
          </div>
        </>
      )}

      {job && (job.status === 'failed' || job.status === 'cancelled') && (
        <>
          <div className={`banner ${job.status === 'failed' ? 'error' : 'warn'}`} role="alert">
            {job.status === 'failed' ? job.error : 'Cancelled. Nothing was written.'}
          </div>
          <div className="dialog-actions">
            <button className="btn primary" onClick={closeFinished} autoFocus>
              Close
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
