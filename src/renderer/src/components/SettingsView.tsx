import { useEffect, useRef, useState } from 'react';
import type { KeyIdName, SettingsView as SV } from '@shared/ipc';
import { lode, unwrap } from '../api';
import { ACCENTS, type Accent } from '../theme';
import { WarnIcon } from './Icons';

interface Props {
  onClose(): void;
  accent: Accent;
  onAccent(a: Accent): void;
}

function KeyRow({ id, label, help, saved, onChange }: {
  id: KeyIdName;
  label: string;
  help: string;
  saved: boolean;
  onChange(): void;
}): React.JSX.Element {
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<string>): Promise<void> => {
    setBusy(true);
    setStatus(null);
    try {
      setStatus({ ok: true, text: await fn() });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      onChange();
    }
  };

  return (
    <fieldset className="field-group">
      <legend>{label}</legend>
      <p className="muted small">{help}</p>
      <div className="key-row">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-label={`${label} API key`}
          placeholder={saved ? '•••••••• saved (enter a new key to replace)' : 'Paste API key'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          className="btn"
          disabled={!value.trim() || busy}
          onClick={() =>
            void act(async () => {
              await unwrap(lode.keys.set(id, value));
              setValue('');
              return 'Saved to secure storage';
            })
          }
        >
          Save
        </button>
        <button className="btn" disabled={!saved || busy} onClick={() => void act(() => unwrap(lode.keys.test(id)))}>
          Test connection
        </button>
        <button
          className="btn danger"
          disabled={!saved || busy}
          onClick={() =>
            void act(async () => {
              await unwrap(lode.keys.clear(id));
              return 'Key removed';
            })
          }
        >
          Clear
        </button>
      </div>
      <p className="small" role="status" aria-live="polite">
        {busy ? 'Working…' : status ? <span className={status.ok ? 'ok' : 'err'}>{status.text}</span> : saved ? 'A key is saved.' : 'No key saved.'}
      </p>
    </fieldset>
  );
}

export function SettingsView(p: Props): React.JSX.Element {
  const { onClose } = p;
  const [s, setS] = useState<SV | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [saved, setSaved] = useState(false);

  // Reloads and saves can overlap (a key save reloads settings while the user toggles one);
  // only the most recent request may update the view, so a stale reply never undoes a change.
  const seq = useRef(0);

  const load = async (): Promise<void> => {
    const n = ++seq.current;
    try {
      const v = await unwrap(lode.settings.get());
      if (n !== seq.current) return;
      setS(v);
      return void 0;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    let cancelled = false;
    unwrap(lode.settings.get()).then(
      (v) => {
        if (cancelled) return;
        setS(v);
        setBaseUrl(v.llm.baseUrl);
        setModel(v.llm.model);
      },
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = async (p: Parameters<typeof lode.settings.set>[0]): Promise<void> => {
    const n = ++seq.current;
    try {
      setError(null);
      const v = await unwrap(lode.settings.set(p));
      if (n === seq.current) setS(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!s) return <div className="settings">{error ? <div className="banner error">{error}</div> : 'Loading…'}</div>;
  const g = s.generation;

  return (
    <div className="settings prefs">
      <header className="center-header">
        <h1>Settings</h1>
        <button className="btn" onClick={onClose}>
          Back
        </button>
      </header>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {s.keyBackend === 'basic_text' && (
        <div className="banner warn" role="status">
          <div>
            <p className="banner-text">
              <WarnIcon /> No system keyring was found (GNOME Keyring or KWallet). Without one, keys can only be
              obfuscated on disk, not encrypted. Install or unlock a keyring for proper protection.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={s.allowWeakKeyStorage}
                onChange={(e) => void patch({ allowWeakKeyStorage: e.target.checked })}
              />
              Store keys anyway with basic obfuscation
            </label>
          </div>
        </div>
      )}

      <fieldset className="field-group">
        <legend>Appearance</legend>
        <p>Accent colour for your points, the open note and the review count. Zoom with Ctrl =, Ctrl − and Ctrl 0.</p>
        <div className="swatches" role="radiogroup" aria-label="Accent colour">
          {(Object.keys(ACCENTS) as Accent[]).map((a) => (
            <button
              key={a}
              role="radio"
              aria-checked={p.accent === a}
              className={`swatch ${p.accent === a ? 'on' : ''}`}
              style={{ '--sw-l': ACCENTS[a].light, '--sw-d': ACCENTS[a].dark } as React.CSSProperties}
              onClick={() => p.onAccent(a)}
            >
              <span className="swatch-dot" aria-hidden="true" />
              {ACCENTS[a].label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field-group">
        <legend>LLM provider (OpenAI-compatible)</legend>
        <p className="muted small">
          Any endpoint that speaks the Chat Completions API with function calling: OpenAI, OpenRouter, Groq, Together,
          a local Ollama or vLLM server, and others.
        </p>
        <label className="field">
          <span>Base URL</span>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
        </label>
        <label className="field">
          <span>Model</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. gpt-5.6-terra, or llama3.3 on Ollama" />
        </label>
        <div className="dialog-actions left">
          <button
            className="btn primary"
            onClick={() =>
              void patch({ llm: { baseUrl: baseUrl.trim(), model: model.trim() } }).then(() => {
                setSaved(true);
                setTimeout(() => setSaved(false), 1500);
              })
            }
          >
            Save provider
          </button>
          {saved && <span className="ok small" role="status">Saved</span>}
        </div>
      </fieldset>

      <KeyRow
        id="llm"
        label="LLM API key"
        help="Leave empty for local servers that need no key. Stored with the OS keychain; Lode never shows it again."
        saved={s.keys.llm}
        onChange={() => void load()}
      />
      <KeyRow
        id="tavily"
        label="Tavily search key"
        help="Used for web search so AI additions can cite real sources. Without it, additions are unsourced."
        saved={s.keys.tavily}
        onChange={() => void load()}
      />

      <fieldset className="field-group">
        <legend>Generation</legend>
        <label className="check">
          <input type="checkbox" checked={g.useSearch} onChange={(e) => void patch({ generation: { useSearch: e.target.checked } })} />
          Use web search (needs a Tavily key)
        </label>
        <label className="field">
          <span>AI additions without a verifiable source</span>
          <select
            value={g.unsourced}
            onChange={(e) => void patch({ generation: { unsourced: e.target.value as 'drop' | 'mark' } })}
          >
            <option value="drop">Drop them</option>
            <option value="mark">Keep them, marked “unsourced”</option>
          </select>
        </label>
        <label className="field">
          <span>Points per request</span>
          <input
            type="number"
            min={1}
            max={50}
            value={g.batchSize}
            onChange={(e) => void patch({ generation: { batchSize: Number(e.target.value) } })}
          />
        </label>
        <label className="field">
          <span>Max searches per request</span>
          <input
            type="number"
            min={0}
            max={10}
            value={g.maxSearchesPerChunk}
            onChange={(e) => void patch({ generation: { maxSearchesPerChunk: Number(e.target.value) } })}
          />
        </label>
        <label className="field">
          <span>Token ceiling per run (estimated input)</span>
          <input
            type="number"
            min={1000}
            step={1000}
            value={g.maxInputTokens}
            onChange={(e) => void patch({ generation: { maxInputTokens: Number(e.target.value) } })}
          />
        </label>
      </fieldset>
      <p className="muted small">
        Lode has no telemetry and no backend. Your points leave this device only when you confirm a Generate run, and
        only to the provider and search service above.
      </p>
    </div>
  );
}
