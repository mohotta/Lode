import { useState } from 'react';
import type { ResolvedArticle, ResolvedBlock } from '@shared/types';
import type { lode } from '../api';
import { dayMonth } from '../dates';
import { ArrowLeftIcon, CloseIcon, PlusIcon } from './Icons';
import { Markdown } from './Markdown';
import { RichEditor } from './RichEditor';

type ArticleEdit = Parameters<typeof lode.article.save>[3];
type ArticleEditBlock = ArticleEdit['blocks'][number];
type PointItem = Extract<ResolvedBlock, { kind: 'point' }>;
type Item =
  | { key: string; kind: 'point'; point: PointItem }
  /** `original` is the stored body; text is sent only when it differs. */
  | { key: string; kind: 'text'; id?: string; original?: string; body: string };

interface Props {
  article: ResolvedArticle;
  onSave(edit: ArticleEdit): Promise<boolean>;
  onCancel(): void;
}

let seq = 0;
const nextKey = (): string => `e${++seq}`;

function itemsOf(article: ResolvedArticle): Item[] {
  return article.blocks.flatMap((b): Item[] => {
    if (b.kind === 'point') return [{ key: nextKey(), kind: 'point', point: b }];
    // Lode's fixed repeat markers and correction notes are not prose to edit.
    if (b.kind === 'llm') return b.duplicate || b.correctionFor ? [] : [{ key: nextKey(), kind: 'text', id: b.id, original: b.body, body: b.body }];
    return [{ key: nextKey(), kind: 'text', body: b.text }];
  });
}

/**
 * Hand edit of a note. Text is edited in place; the user's points stay locked (their text
 * lives in the backlog) and can only be moved or taken out of the note.
 */
export function ArticleEditor({ article, onSave, onCancel }: Props): React.JSX.Element {
  const [title, setTitle] = useState(article.title);
  const [items, setItems] = useState<Item[]>(() => itemsOf(article));
  const [busy, setBusy] = useState(false);

  const move = (i: number, by: -1 | 1): void =>
    setItems((xs) => {
      const j = i + by;
      if (j < 0 || j >= xs.length) return xs;
      const next = [...xs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const remove = (i: number): void => setItems((xs) => xs.filter((_, k) => k !== i));
  const insertText = (at: number): void =>
    setItems((xs) => [...xs.slice(0, at), { key: nextKey(), kind: 'text', body: '' }, ...xs.slice(at)]);
  const setBody = (key: string, body: string): void =>
    setItems((xs) => xs.map((x) => (x.key === key && x.kind === 'text' ? { ...x, body } : x)));

  const save = async (): Promise<void> => {
    if (busy) return;
    const blocks: ArticleEditBlock[] = items.flatMap((x): ArticleEditBlock[] => {
      if (x.kind === 'point') return [{ kind: 'point', id: x.point.id }];
      if (x.id && x.original !== undefined && x.body.trim() === x.original.trim()) return [{ kind: 'text', id: x.id }];
      return x.body.trim() ? [{ kind: 'text', ...(x.id ? { id: x.id } : {}), body: x.body }] : [];
    });
    const t = title.trim();
    setBusy(true);
    try {
      if (await onSave({ expected: article.updated, ...(t && t !== article.title ? { title: t } : {}), blocks })) onCancel();
    } finally {
      setBusy(false);
    }
  };

  const adder = (at: number): React.JSX.Element => (
    <button type="button" className="add-text" onClick={() => insertText(at)}>
      <PlusIcon size={12} /> Add text here
    </button>
  );

  const tools = (i: number, what: string): React.JSX.Element => (
    <div className="edit-tools">
      <button type="button" className="icon-btn" aria-label={`Move ${what} up`} title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
        <ArrowLeftIcon size={13} className="rot90" />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Move ${what} down`}
        title="Move down"
        disabled={i === items.length - 1}
        onClick={() => move(i, 1)}
      >
        <ArrowLeftIcon size={13} className="rot270" />
      </button>
      <button type="button" className="icon-btn" aria-label={`Remove ${what}`} title="Remove from this note" onClick={() => remove(i)}>
        <CloseIcon size={12} />
      </button>
    </div>
  );

  return (
    <section className="article-editor" aria-label="Edit note">
      <label className="field">
        <span className="field-label">Title</span>
        <input className="text-input title-input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="edit-list">
        {adder(0)}
        {items.map((x, i) => (
          <div key={x.key} className="edit-item-wrap">
            {x.kind === 'point' ? (
              <div className="edit-item point">
                <div className="edit-head">
                  <span className="mark-you">Your point</span>
                  <span className="mono muted small">{x.point.missing ? 'missing' : dayMonth(x.point.date)}</span>
                  {tools(i, 'point')}
                </div>
                <div className="prose locked" title="Edit your point's text from the backlog">
                  {x.point.missing ? <p className="muted">This point is no longer in the backlog.</p> : <Markdown text={x.point.text} />}
                </div>
              </div>
            ) : (
              <div className="edit-item text">
                <div className="edit-head">
                  <span className="mark-ai">{x.id ? 'Text' : 'New text'}</span>
                  {tools(i, 'text')}
                </div>
                <div className="composer editing">
                  <RichEditor
                    label="Note text"
                    initial={x.body}
                    multiline
                    placeholder="Write here…"
                    autoFocus={!x.id && !x.body}
                    onChange={(md) => setBody(x.key, md)}
                    onSubmit={() => void save()}
                    onEscape={onCancel}
                  />
                </div>
              </div>
            )}
            {adder(i + 1)}
          </div>
        ))}
      </div>
      <div className="editor-foot">
        <span className="muted small">Your points stay as you wrote them. Ctrl+Enter saves.</span>
        <button className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => void save()} disabled={busy || !title.trim()}>
          Save note
        </button>
      </div>
    </section>
  );
}
