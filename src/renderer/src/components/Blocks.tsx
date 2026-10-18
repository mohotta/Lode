import { useState } from 'react';
import type { ResolvedBlock } from '@shared/types';
import { lode } from '../api';
import { shortDate } from '../dates';
import { CopyIcon, DotsIcon, LinkIcon, PencilIcon, PersonIcon, SparkIcon, TrashIcon, UndoIcon, WarnIcon } from './Icons';
import { Markdown } from './Markdown';
import { Menu } from './Menu';
import { PointEditor } from './PointEditor';

type PointB = Extract<ResolvedBlock, { kind: 'point' }>;
type LlmB = Extract<ResolvedBlock, { kind: 'llm' }>;

interface PointActions {
  onJump(id: string): void;
  onEdit(id: string, text: string): Promise<boolean>;
  onSetDeleted(id: string, deleted: boolean): Promise<void>;
}

/**
 * The user's own point, rendered from backlog text. A callout with accent border,
 * tint, person icon and a "You" label, so it never relies on colour alone (FR-23).
 */
export function PointBlock({ block, ...a }: { block: PointB } & PointActions): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  if (block.missing || block.deleted) {
    return (
      <div className="point-block removed" role="note" aria-label="Removed point">
        <WarnIcon size={14} />
        <span>{block.missing ? 'This point is no longer in the backlog' : 'You removed this point'}</span>
        {block.deleted && (
          <button className="btn small-btn" onClick={() => void a.onSetDeleted(block.id, false)}>
            <UndoIcon size={13} /> Restore
          </button>
        )}
      </div>
    );
  }
  if (block.duplicateOf) {
    const of = block.duplicateOf;
    return (
      <article className="point-block repeat" aria-label={`Your point from ${shortDate(block.date)}, a repeat`}>
        <header className="point-head">
          <span className="badge you">
            <PersonIcon size={12} /> You
          </span>
          <span className="badge repeat-badge">
            <CopyIcon size={12} /> Repeat of {of.date ? shortDate(of.date) : 'an earlier point'}
          </span>
          <button className="point-date" onClick={() => a.onJump(block.id)} title="Show in backlog">
            {shortDate(block.date)}
          </button>
        </header>
        <div className="point-body user-md">
          <Markdown text={block.text} keepBreaks />
        </div>
      </article>
    );
  }
  return (
    <article
      className={`point-block ${block.corrected ? 'has-fix' : ''}`}
      aria-label={`Your point from ${shortDate(block.date)}`}
    >
      <header className="point-head">
        <span className="badge you">
          <PersonIcon size={12} /> You
        </span>
        {block.corrected && (
          <span className="badge needs-fix" title="An AI correction note follows this point">
            <WarnIcon size={12} /> Needs a fix
          </span>
        )}
        <button className="point-date" onClick={() => a.onJump(block.id)} title="Show in backlog">
          {shortDate(block.date)}
        </button>
        {!editing && (
          <span className="point-block-actions">
            <Menu
              label="Point actions"
              trigger={<DotsIcon size={14} />}
              align="end"
              items={[
                { label: 'Edit', icon: <PencilIcon size={14} />, onSelect: () => setEditing(true) },
                'separator',
                {
                  label: 'Delete',
                  icon: <TrashIcon size={14} />,
                  danger: true,
                  onSelect: () => void a.onSetDeleted(block.id, true),
                },
              ]}
            />
          </span>
        )}
      </header>
      {editing ? (
        <PointEditor initial={block.text} onSave={(t) => a.onEdit(block.id, t)} onCancel={() => setEditing(false)} />
      ) : (
        /* Exactly the backlog text; markdown is only how it is displayed. */
        <div className="point-body user-md">
          <Markdown text={block.text} keepBreaks />
        </div>
      )}
    </article>
  );
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** AI note that the point above contains a mistake. Warning icon + label + dashed rule, not colour alone. */
function CorrectionBlock({ block }: { block: LlmB }): React.JSX.Element {
  return (
    <aside className="correction-block" aria-label="AI correction for your point above">
      <header className="llm-head">
        <span className="badge fix">
          <WarnIcon size={12} /> Correction
        </span>
        <span className="llm-meta">AI · about your point above</span>
      </header>
      <div className="prose">
        <Markdown text={block.body} />
      </div>
      <Sources block={block} />
    </aside>
  );
}

function Sources({ block }: { block: LlmB }): React.JSX.Element | null {
  if (block.sources.length === 0) return null;
  return (
    <footer className="sources" aria-label="Sources">
      {block.sources.map((s) => (
        <button key={s.url} className="source" title={s.url} onClick={() => void lode.link.open(s.url)}>
          <LinkIcon size={12} /> {host(s.url)}
        </button>
      ))}
    </footer>
  );
}

/** Generated content: reads as quiet body text, with an AI badge, dotted rule and source pills. */
export function LlmBlock({ block }: { block: LlmB }): React.JSX.Element | null {
  if (block.correctionFor) return <CorrectionBlock block={block} />;
  // A repeat marker carries no prose; the point above already shows "Repeat of …".
  if (block.duplicate) return null;
  return (
    <article className="llm-block" aria-label="AI-generated explanation">
      <header className="llm-head">
        <span className="badge ai">
          <SparkIcon size={12} /> AI
        </span>
        <span className="llm-meta">
          {block.model.replace(/^openai-compatible\//, '')}
          {block.at && ` · ${new Date(block.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
        </span>
      </header>
      <div className="llm-body prose">
        <Markdown text={block.body} />
      </div>
      <Sources block={block} />
    </article>
  );
}

export function RawBlock({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="raw-block prose" aria-label="Text added outside Lode">
      <Markdown text={text} />
    </div>
  );
}
