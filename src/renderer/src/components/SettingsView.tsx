import { useEffect, useRef, useState } from 'react';
import type { KeyIdName, SettingsView as SV } from '@shared/ipc';
import { lode, unwrap } from '../api';
import { ACCENTS, type Accent, type ThemePref } from '../theme';
import { LockIcon, ShieldIcon, WarnIcon } from './Icons';
import { PageHeader } from './PageShell';

interface Props {
  onClose(): void;
  accent: Accent;
  onAccent(a: Accent): void;
  theme: ThemePref;
  onTheme(t: ThemePref): void;
}

const SECTIONS = [
  ['appearance', 'Appearance'],
  ['ai', 'AI provider'],
  ['search', 'Web search'],
  ['generation', 'Generation'],
  ['privacy', 'Privacy'],
] as const;

/** Common OpenAI-compatible endpoints; picking one fills in the base URL. */
const PRESETS = [
  ['OpenRouter', 'https://openrouter.ai/api/v1'],
  ['OpenAI', 'https://api.openai.com/v1'],
  ['Groq', 'https://api.groq.com/openai/v1'],
  ['Ollama', 'http://localhost:11434/v1'],
] as const;

const THEMES: [ThemePref, string][] = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

/** A write-only key field: paste, Save, Test, Remove. The renderer can never read a key back. */
function KeyRow({ id, label, saved, onChange }: {
  id: KeyIdName;
  label: string;
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
  const save = (): void =>
    void act(async () => {
      await unwrap(lode.keys.set(id, value));
      setValue('');
      return 'Saved to secure storage';
    });

  return (
    <div className="key-field" role="group" aria-label={label}>
      <div className="key-row">
        <div className="key-input">
          <LockIcon size={14} />
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={`${label} API key`}
            placeholder={saved ? 'Stored in your OS keychain · paste to replace' : 'Paste API key'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && value.trim() && save()}
          />
        </div>
        {value.trim() ? (
          <button className="btn primary tall" disabled={busy} onClick={save}>
            Save
          </button>
        ) : (
          <button className="btn tall" disabled={!saved || busy} onClick={() => void act(() => unwrap(lode.keys.test(id)))}>
            Test connection
          </button>
        )}
        <button
          className="btn quiet-danger tall"
          disabled={!saved || busy}
          onClick={() =>
            void act(async () => {
              await unwrap(lode.keys.clear(id));
              return 'Key removed';
            })
          }
        >
          Remove key
        </button>
      </div>
      <p className={`key-status ${status ? (status.ok ? 'ok' : 'err') : saved ? 'ok' : ''}`} role="status" aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        {busy ? 'Working…' : status ? status.text : saved ? 'Key saved' : 'No key saved'}
      </p>
    </div>
  );
}

export function SettingsView(p: Props): React.JSX.Element {
  const { onClose } = p;
  const [s, setS] = useState<SV | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [current, setCurrent] = useState<string>('appearance');
  const root = useRef<HTMLDivElement>(null);

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

  // Section list: the section nearest the top is marked as current.
  const loaded = !!s;
  useEffect(() => {
    const el = root.current;
    if (!el || !loaded) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((x) => x.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setCurrent(top.target.id.replace(/^set-/, ''));
      },
      { rootMargin: '0px 0px -60% 0px' },
    );
    el.querySelectorAll('.set-section').forEach((x) => io.observe(x));
    return () => io.disconnect();
  }, [loaded]);

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
  // Provider fields save when they lose focus (or a preset is picked), like every other setting here.
  const saveProvider = (url = baseUrl, m = model): void => {
    if (url.trim() === s.llm.baseUrl && m.trim() === s.llm.model) return;
    void patch({ llm: { baseUrl: url.trim(), model: m.trim() } });
  };
  const preset = PRESETS.find(([, url]) => url === baseUrl.trim())?.[0] ?? 'Custom';

  return (
    <div className="settings-v2" ref={root}>
      <PageHeader title="Settings" note="changes save automatically" closeLabel="Close settings" onClose={onClose} />

      <div className="set-body">
        <nav className="set-nav" aria-label="Settings sections">
          {SECTIONS.map(([id, label]) => (
            <button
              key={id}
              className={current === id ? 'on' : ''}
              aria-current={current === id ? 'true' : undefined}
              onClick={() => {
                setCurrent(id);
                document.getElementById(`set-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
              }}
            >
              {label}
            </button>
          ))}
        </nav>

        <main className="set-main">
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

          <section id="set-appearance" className="set-section" aria-labelledby="h-appearance">
            <h2 id="h-appearance">Appearance</h2>
            <p className="set-sub">Zoom with Ctrl = / Ctrl − / Ctrl 0.</p>
            <div className="set-card">
              <div className="set-row">
                <div className="set-label">
                  <div className="set-name">Theme</div>
                  <div className="set-help">Follows your OS when set to System.</div>
                </div>
                <div className="seg" role="group" aria-label="Theme">
                  {THEMES.map(([id, label]) => (
                    <button key={id} aria-pressed={p.theme === id} className={p.theme === id ? 'on' : ''} onClick={() => p.onTheme(id)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="set-row">
                <div className="set-label">
                  <div className="set-name">Accent</div>
                  <div className="set-help">
                    Used for your points, the open note and the review count. <span className="set-strong">{ACCENTS[p.accent].label}</span>
                  </div>
                </div>
                <div className="swatches round" role="radiogroup" aria-label="Accent colour">
                  {(Object.keys(ACCENTS) as Accent[]).map((a) => (
                    <button
                      key={a}
                      role="radio"
                      aria-checked={p.accent === a}
                      aria-label={ACCENTS[a].label}
                      title={ACCENTS[a].label}
                      className={`swatch ${p.accent === a ? 'on' : ''}`}
                      style={{ '--sw-l': ACCENTS[a].light, '--sw-d': ACCENTS[a].dark } as React.CSSProperties}
                      onClick={() => p.onAccent(a)}
                    >
                      <span className="swatch-dot" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section id="set-ai" className="set-section" aria-labelledby="h-ai">
            <h2 id="h-ai">AI provider</h2>
            <p className="set-sub">Any OpenAI-compatible endpoint with function calling.</p>
            <div className="set-card padded">
              <div className="set-field">
                <span className="set-cap" id="preset-cap">
                  Preset
                </span>
                <div className="set-chips" role="group" aria-labelledby="preset-cap">
                  {[...PRESETS, ['Custom', ''] as const].map(([label, url]) => (
                    <button
                      key={label}
                      aria-pressed={preset === label}
                      className={`set-chip ${preset === label ? 'on' : ''}`}
                      onClick={() => {
                        if (!url) return document.getElementById('set-base-url')?.focus();
                        setBaseUrl(url);
                        saveProvider(url, model);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="set-grid two">
                <label className="set-field">
                  <span className="set-cap">Base URL</span>
                  <input
                    id="set-base-url"
                    className="set-input mono"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    onBlur={() => saveProvider()}
                    placeholder="https://api.openai.com/v1"
                  />
                </label>
                <label className="set-field">
                  <span className="set-cap">Model</span>
                  <input
                    className="set-input mono"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    onBlur={() => saveProvider()}
                    placeholder="e.g. gpt-5.6-terra, or llama3.3 on Ollama"
                  />
                </label>
              </div>
              <div className="set-field">
                <span className="set-cap">
                  API key <span className="muted">— optional for local servers</span>
                </span>
                <KeyRow id="llm" label="LLM API key" saved={s.keys.llm} onChange={() => void load()} />
              </div>
            </div>
          </section>

          <section id="set-search" className="set-section" aria-labelledby="h-search">
            <h2 id="h-search">Web search</h2>
            <p className="set-sub">Lets AI additions cite real sources. Uses Tavily.</p>
            <div className="set-card">
              <div className="set-row">
                <div className="set-label">
                  <div className="set-name" id="search-name">
                    Search the web when generating
                  </div>
                  <div className="set-help">Without it, additions have no sources.</div>
                </div>
                <button
                  role="switch"
                  aria-checked={g.useSearch}
                  aria-labelledby="search-name"
                  className={`switch ${g.useSearch ? 'on' : ''}`}
                  onClick={() => void patch({ generation: { useSearch: !g.useSearch } })}
                >
                  <span aria-hidden="true" />
                </button>
              </div>
              <div className="set-row stack">
                <span className="set-cap">Tavily API key</span>
                <KeyRow id="tavily" label="Tavily search key" saved={s.keys.tavily} onChange={() => void load()} />
              </div>
            </div>
          </section>

          <section id="set-generation" className="set-section" aria-labelledby="h-generation">
            <h2 id="h-generation">Generation</h2>
            <p className="set-sub">Limits for each Generate run.</p>
            <div className="set-card">
              <div className="set-row">
                <div className="set-label">
                  <label className="set-name" htmlFor="set-unsourced">
                    Unsourced additions
                  </label>
                  <div className="set-help">When the AI can't find a source to back a claim.</div>
                </div>
                <select
                  id="set-unsourced"
                  className="set-input"
                  value={g.unsourced}
                  onChange={(e) => void patch({ generation: { unsourced: e.target.value as 'drop' | 'mark' } })}
                >
                  <option value="drop">Drop them</option>
                  <option value="mark">Keep, marked unsourced</option>
                </select>
              </div>
              <div className="set-row">
                <div className="set-grid three">
                  <label className="set-field">
                    <span className="set-cap">Points per request</span>
                    <input
                      className="set-input mono"
                      type="number"
                      min={1}
                      max={50}
                      value={g.batchSize}
                      onChange={(e) => void patch({ generation: { batchSize: Number(e.target.value) } })}
                    />
                  </label>
                  <label className="set-field">
                    <span className="set-cap">Searches per request</span>
                    <input
                      className="set-input mono"
                      type="number"
                      min={0}
                      max={10}
                      value={g.maxSearchesPerChunk}
                      onChange={(e) => void patch({ generation: { maxSearchesPerChunk: Number(e.target.value) } })}
                    />
                  </label>
                  <label className="set-field">
                    <span className="set-cap">Input token limit</span>
                    <input
                      className="set-input mono"
                      type="number"
                      min={1000}
                      step={1000}
                      value={g.maxInputTokens}
                      onChange={(e) => void patch({ generation: { maxInputTokens: Number(e.target.value) } })}
                    />
                  </label>
                </div>
              </div>
            </div>
          </section>

          <section id="set-privacy" className="set-section set-privacy" aria-labelledby="h-privacy">
            <ShieldIcon size={16} />
            <div>
              <h2 id="h-privacy">No telemetry, no backend</h2>
              <p>
                Only Generate runs leave this machine: your points go to the AI provider above, and search queries go to
                Tavily when web search is on. To keep everything on this machine, use a locally hosted model (for
                example Ollama) and turn web search off.
              </p>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
