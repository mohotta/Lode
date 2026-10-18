import { useEffect, useRef, useState } from 'react';
import type { PreviewView, ProgressView, RunReportView } from '@shared/ipc';
import { lode, unwrap } from '../api';

interface Props {
  vaultId: string;
  folder: string;
  folderTitle: string;
  onClose(changed: boolean): void;
  onOpenSubtopic(slug: string): void;
  onOpenSettings(): void;
}

type State =
  | { s: 'loading' }
  | { s: 'preview'; preview: PreviewView }
  | { s: 'running'; preview: PreviewView; progress: ProgressView | null }
  | { s: 'done'; report: RunReportView }
  | { s: 'error'; message: string; preview?: PreviewView };

function progressText(p: ProgressView | null): string {
  if (!p) return 'Starting…';
  switch (p.phase) {
    case 'collecting':
      return 'Collecting unfiled points…';
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

const fmt = (n: number): string => n.toLocaleString();

export function GenerateDialog(p: Props): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<State>({ s: 'loading' });
  const { vaultId, folder } = p;

  useEffect(() => {
    ref.current?.showModal();
    let cancelled = false;
    unwrap(lode.generate.preview(vaultId, folder)).then(
      (preview) => !cancelled && setState({ s: 'preview', preview }),
      (e: unknown) => !cancelled && setState({ s: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
    const off = lode.generate.onProgress((m) => {
      if (m.vaultId !== vaultId || m.folder !== folder) return;
      setState((st) => (st.s === 'running' ? { ...st, progress: m.event } : st));
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [vaultId, folder]);

  const run = async (preview: PreviewView): Promise<void> => {
    setState({ s: 'running', preview, progress: null });
    try {
      const report = await unwrap(lode.generate.run(vaultId, folder));
      setState({ s: 'done', report });
    } catch (e) {
      setState({ s: 'error', message: e instanceof Error ? e.message : String(e), preview });
    }
  };

  const close = (): void => {
    if (state.s === 'running') return;
    ref.current?.close();
    p.onClose(state.s === 'done');
  };

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
      <h2 id="gen-title">Generate notes · {p.folderTitle}</h2>

      {state.s === 'loading' && <p>Preparing preview…</p>}

      {(state.s === 'preview' || state.s === 'running') && (
        <>
          <dl className="preview-grid">
            <dt>Points</dt>
            <dd>{fmt(state.preview.points)} unfiled</dd>
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
            Only the point text above and your subtopic names are sent to the provider. Your backlog is never modified.
          </p>
          {state.s === 'preview' && state.preview.blocker && (
            <div className="banner warn" role="status">
              {state.preview.blocker}
            </div>
          )}
          {state.s === 'running' && (
            <p className="progress" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" /> {progressText(state.progress)}
            </p>
          )}
          <div className="dialog-actions">
            {state.s === 'running' ? (
              <button className="btn" onClick={() => void lode.generate.cancel(vaultId, folder)}>
                Cancel run
              </button>
            ) : (
              <>
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
                  disabled={!!state.preview.blocker}
                  onClick={() => void run(state.preview)}
                  autoFocus
                >
                  Send {fmt(state.preview.points)} point(s)
                </button>
              </>
            )}
          </div>
        </>
      )}

      {state.s === 'done' && (
        <>
          <p role="status">
            Filed {state.report.filed.length} point(s)
            {state.report.unfiled.length > 0 && `, ${state.report.unfiled.length} left unfiled`}. Used{' '}
            {fmt(state.report.usage.inputTokens)} in / {fmt(state.report.usage.outputTokens)} out tokens,{' '}
            {state.report.usage.searches} search(es), {state.report.sources} source(s) cited.
            {state.report.corrected.length > 0 &&
              ` ${state.report.corrected.length} point(s) got a correction note; your text is unchanged.`}
          </p>
          {state.report.changed.length > 0 && (
            <ul className="changed" role="list">
              {state.report.changed.map((c) => (
                <li key={c.slug}>
                  <button
                    className="chip filed"
                    onClick={() => {
                      p.onOpenSubtopic(c.slug);
                      close();
                    }}
                  >
                    {c.title}
                    {c.isNew && ' (new)'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {state.report.warnings.length > 0 && (
            <ul className="warnings">
              {state.report.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <div className="dialog-actions">
            <button className="btn primary" onClick={close} autoFocus>
              Done
            </button>
          </div>
        </>
      )}

      {state.s === 'error' && (
        <>
          <div className="banner error" role="alert">
            {state.message}
          </div>
          <div className="dialog-actions">
            {state.preview && (
              <button className="btn" onClick={() => setState({ s: 'preview', preview: state.preview! })}>
                Back
              </button>
            )}
            <button className="btn primary" onClick={close} autoFocus>
              Close
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
