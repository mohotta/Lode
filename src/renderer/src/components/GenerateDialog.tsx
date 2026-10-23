import { useEffect, useRef, useState } from 'react';
import type { JobView, PreviewView } from '@shared/ipc';
import { lode, unwrap } from '../api';
import { progressText } from '../jobs';
import { ArrowUpRightIcon, DigestIcon, InfoIcon, MinimizeIcon, RefreshIcon, SparkIcon } from './Icons';

/** What the dialog shows: a preview to confirm, or an existing background job. */
export type DialogTarget =
  | {
      kind: 'new';
      folder: string;
      folderTitle: string;
      subtopic?: string;
      subtopicTitle?: string;
      /** A digest period ID instead of a Generate or Regenerate. */
      digest?: string;
      digestTitle?: string;
    }
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
/** Compact token count for the stat tiles: 6200 → "6.2k". */
const kfmt = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

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
  const newDigest = target.kind === 'new' ? target.digest : undefined;
  const job = target.kind === 'job' ? p.jobs.find((j) => j.id === target.jobId) : undefined;
  const isRegen = target.kind === 'new' ? !!target.subtopic : job?.kind === 'regenerate';
  const isDigest = target.kind === 'new' ? !!target.digest : job?.kind === 'digest';
  const title = isDigest ? 'Write digest' : isRegen ? 'Regenerate notes' : 'Generate notes';
  const subtitle =
    target.kind === 'new'
      ? target.digest
        ? `${target.folderTitle} · ${target.digestTitle ?? target.digest}`
        : target.subtopic
          ? (target.subtopicTitle ?? target.subtopic)
          : `${target.folderTitle} · files your unfiled points into subtopics`
      : job
        ? job.kind === 'digest'
          ? `${job.folderTitle} · ${job.digestTitle ?? job.digest}`
          : job.kind === 'regenerate'
            ? (job.subtopicTitle ?? job.subtopic ?? '')
            : job.folderTitle
        : '';
  const jobTarget = newDigest ? { digest: newDigest } : newSubtopic ? { subtopic: newSubtopic } : {};

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    if (newFolder === null) return;
    let cancelled = false;
    unwrap(lode.generate.preview(vaultId, newFolder, newDigest ? { digest: newDigest } : newSubtopic ? { subtopic: newSubtopic } : {})).then(
      (preview) => !cancelled && setState({ s: 'preview', preview, busy: false }),
      (e: unknown) => !cancelled && setState({ s: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [vaultId, newFolder, newSubtopic, newDigest]);

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
      await unwrap(lode.generate.enqueue(vaultId, newFolder, jobTarget));
      close();
    } catch (e) {
      setState({ s: 'error', message: e instanceof Error ? e.message : String(e), preview });
    }
  };

  const queuedAhead = job ? p.jobs.filter((j) => j.status === 'running' || (j.status === 'queued' && j.queuedAt < job.queuedAt)).length : 0;

  return (
    <dialog
      ref={ref}
      className="dialog v2"
      aria-labelledby="gen-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="dlg-head">
        <span className="dlg-icon" aria-hidden="true">
          {isDigest ? <DigestIcon size={15} /> : isRegen ? <RefreshIcon size={15} /> : <SparkIcon size={15} />}
        </span>
        <div>
          <h2 id="gen-title">{title}</h2>
          {subtitle && <p className="dlg-sub">{subtitle}</p>}
        </div>
      </div>

      {target.kind === 'new' && state.s === 'loading' && (
        <div className="dlg-body">
          <p className="progress">
            <span className="spinner" aria-hidden="true" /> Preparing preview…
          </p>
        </div>
      )}

      {target.kind === 'new' && state.s === 'preview' && (
        <>
          <div className="dlg-body">
            <div className="stat-tiles">
              <div className="stat-tile">
                <div className="stat-num">{fmt(state.preview.points)}</div>
                <div className="stat-cap">{isDigest ? 'points in period' : isRegen ? 'points' : 'unfiled points'}</div>
              </div>
              <div className="stat-tile">
                <div className="stat-num">~{kfmt(state.preview.estimatedInputTokens)}</div>
                <div className="stat-cap">tokens in</div>
              </div>
              <div className="stat-tile">
                <div className="stat-num">~{kfmt(state.preview.estimatedOutputTokens)}</div>
                <div className="stat-cap">tokens out{state.preview.chunks > 1 ? ` · ${state.preview.chunks} batches` : ''}</div>
              </div>
            </div>
            <div className="model-line" title={state.preview.baseUrl}>
              <span className="mono strong">{state.preview.model || 'no model set'}</span>
              <span className="dot-sep">·</span>
              <span>{state.preview.provider}</span>
              <span className="dot-sep">·</span>
              <span>{isDigest ? 'No web search' : state.preview.useSearch ? 'Web search on' : 'Web search off'}</span>
              <button className="link-btn push" onClick={p.onOpenSettings}>
                Change
              </button>
            </div>
            {!isDigest && state.preview.searchUnavailable && (
              <p className="dlg-note">No Tavily key is saved, so AI additions can't cite sources this run.</p>
            )}
            {isRegen || isDigest ? (
              <div className="dlg-callout">
                <InfoIcon size={15} />
                <span>
                  {isDigest
                    ? 'Sends the points from this period (no web search) and writes a recap with your points highlighted. An earlier digest for this period is replaced and kept in history.'
                    : "Replaces this note's AI sections. The current version is kept, so you can undo. Your points are sent but never changed."}
                </span>
              </div>
            ) : (
              <>
                <div className="dlg-cap">What gets sent</div>
                <ul className="sent-list">
                  <li>
                    <ArrowUpRightIcon size={13} />
                    Your {fmt(state.preview.points)} unfiled {state.preview.points === 1 ? 'point' : 'points'}
                  </li>
                  <li>
                    <ArrowUpRightIcon size={13} />
                    Short excerpts of earlier points, to spot repeats
                  </li>
                  <li>
                    <ArrowUpRightIcon size={13} />
                    Your subtopic names
                  </li>
                </ul>
              </>
            )}
            {state.preview.blocker && (
              <div className="banner warn" role="status">
                {state.preview.blocker}
              </div>
            )}
          </div>
          <div className="dlg-foot">
            <span className="dlg-foot-note">
              Runs in the background{isRegen || isDigest ? '' : " · your backlog isn't changed"}
            </span>
            {state.preview.blocker?.includes('Settings') && (
              <button className="btn" onClick={p.onOpenSettings}>
                Open Settings
              </button>
            )}
            <button className="btn" onClick={close}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={!!state.preview.blocker || state.busy}
              onClick={() => void start(state.preview)}
              autoFocus
            >
              {isDigest ? 'Write digest' : isRegen ? 'Regenerate' : 'Generate'}
            </button>
          </div>
        </>
      )}

      {target.kind === 'new' && state.s === 'error' && (
        <>
          <div className="dlg-body">
            <div className="banner error" role="alert">
              {state.message}
            </div>
          </div>
          <div className="dlg-foot">
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
          <div className="dlg-body">
            <p>This job is no longer in the list.</p>
          </div>
          <div className="dlg-foot">
            <button className="btn primary" onClick={close} autoFocus>
              Close
            </button>
          </div>
        </>
      )}

      {job && (job.status === 'queued' || job.status === 'running') && (
        <>
          <div className="dlg-body">
            <p className="progress" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />{' '}
              {job.status === 'queued'
                ? `Waiting in the queue${queuedAhead ? ` (${queuedAhead} ahead)` : ''}…`
                : progressText(job.progress)}
            </p>
          </div>
          <div className="dlg-foot">
            <span className="dlg-foot-note">Nothing is written until every call has finished</span>
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
          <div className="dlg-body">
            <p role="status">
              {job.kind === 'digest'
                ? `Wrote the digest from ${job.report.filed.length} point(s).`
                : job.kind === 'regenerate'
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
                        p.onOpenSubtopic(job.folder, job.kind === 'digest' ? `digest:${c.slug}` : c.slug);
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
          </div>
          <div className="dlg-foot">
            <button className="btn primary" onClick={closeFinished} autoFocus>
              Done
            </button>
          </div>
        </>
      )}

      {job && (job.status === 'failed' || job.status === 'cancelled') && (
        <>
          <div className="dlg-body">
            <div className={`banner ${job.status === 'failed' ? 'error' : 'warn'}`} role="alert">
              {job.status === 'failed' ? job.error : 'Cancelled. Nothing was written.'}
            </div>
          </div>
          <div className="dlg-foot">
            <button className="btn primary" onClick={closeFinished} autoFocus>
              Close
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
