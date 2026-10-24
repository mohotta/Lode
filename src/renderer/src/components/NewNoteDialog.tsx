import { useEffect, useRef, useState } from 'react';
import type { SubtopicInfo } from '@shared/types';
import { CloseIcon, NoteIcon } from './Icons';

export interface NewNoteRequest {
  title: string;
  subtopics: string[];
  topics: string[];
}

interface Props {
  folderTitle: string;
  subtopics: SubtopicInfo[];
  onPick(req: NewNoteRequest): void;
  onClose(): void;
}

const MAX_TOPICS = 20;

/** Choose what a new note is written from: subtopics in this folder plus any extra topics. */
export function NewNoteDialog({ folderTitle, subtopics, onPick, onClose }: Props): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [topics, setTopics] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const close = (): void => {
    ref.current?.close();
    onClose();
  };
  const toggle = (slug: string): void =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  const allOn = subtopics.length > 0 && chosen.size === subtopics.length;
  const addTopic = (raw: string): void => {
    const t = raw.replace(/\s+/g, ' ').trim().slice(0, 120);
    setDraft('');
    if (!t || topics.length >= MAX_TOPICS || topics.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    setTopics([...topics, t]);
  };
  // A topic still in the input counts, so nobody loses it by pressing Continue straight away.
  const allTopics = draft.trim() ? [...topics, draft.trim()] : topics;
  const ready = !!title.trim() && (chosen.size > 0 || allTopics.length > 0);

  return (
    <dialog
      ref={ref}
      className="dialog v2 new-note"
      aria-labelledby="nn-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="dlg-head">
        <span className="dlg-icon" aria-hidden="true">
          <NoteIcon size={15} />
        </span>
        <div>
          <h2 id="nn-title">New note</h2>
          <p className="dlg-sub">{folderTitle} · AI writes one note from the subtopics you choose</p>
        </div>
      </div>
      <form
        className="dlg-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onPick({ title: title.trim(), subtopics: subtopics.filter((s) => chosen.has(s.slug)).map((s) => s.slug), topics: allTopics });
        }}
      >
        <div className="dlg-body">
          <label className="field">
            <span className="field-label">Title</span>
            <input
              className="text-input"
              value={title}
              maxLength={120}
              placeholder="e.g. React rendering, end to end"
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </label>

          <div className="dlg-cap row">
            <span id="nn-subs">Subtopics</span>
            {subtopics.length > 0 && (
              <button type="button" className="link-btn push" onClick={() => setChosen(allOn ? new Set() : new Set(subtopics.map((s) => s.slug)))}>
                {allOn ? 'Clear' : 'Select all'}
              </button>
            )}
          </div>
          {subtopics.length === 0 ? (
            <p className="muted small">This folder has no subtopics yet. Add topics below, or generate first.</p>
          ) : (
            <ul className="pick-list" role="group" aria-labelledby="nn-subs">
              {subtopics.map((s) => (
                <li key={s.slug}>
                  <label className={`pick-opt ${chosen.has(s.slug) ? 'on' : ''}`}>
                    <input type="checkbox" checked={chosen.has(s.slug)} onChange={() => toggle(s.slug)} />
                    <span className="row-title">{s.title}</span>
                    <span className="pick-note">
                      {s.pointCount} {s.pointCount === 1 ? 'point' : 'points'}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <label className="field">
            <span className="field-label">Extra topics</span>
            <div className="chip-input">
              {topics.map((t) => (
                <span key={t} className="topic-chip">
                  {t}
                  <button type="button" aria-label={`Remove ${t}`} onClick={() => setTopics(topics.filter((x) => x !== t))}>
                    <CloseIcon size={10} />
                  </button>
                </span>
              ))}
              <input
                value={draft}
                maxLength={120}
                placeholder={topics.length ? 'Add another…' : 'Type a topic and press Enter'}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    if (!draft.trim()) return;
                    e.preventDefault();
                    addTopic(draft);
                  } else if (e.key === 'Backspace' && !draft && topics.length) {
                    setTopics(topics.slice(0, -1));
                  }
                }}
              />
            </div>
          </label>
          <p className="dlg-note">Topics without a subtopic are researched with web search (when it's on) and cited.</p>
        </div>
        <div className="dlg-foot">
          <span className="dlg-foot-note">
            {chosen.size} {chosen.size === 1 ? 'subtopic' : 'subtopics'} · {allTopics.length} {allTopics.length === 1 ? 'topic' : 'topics'}
          </span>
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!ready}>
            Continue
          </button>
        </div>
      </form>
    </dialog>
  );
}
