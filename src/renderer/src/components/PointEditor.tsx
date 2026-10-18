import { useState } from 'react';

interface Props {
  initial: string;
  onSave(text: string): Promise<boolean>;
  onCancel(): void;
}

/** Inline edit of the user's own point text (FR-8). Same keys as the composer; Escape cancels. */
export function PointEditor({ initial, onSave, onCancel }: Props): React.JSX.Element {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    if (busy) return;
    if (text.trim() === initial.trim()) return onCancel();
    if (!text.trim()) return;
    setBusy(true);
    try {
      if (await onSave(text)) onCancel();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="point-editor">
      <textarea
        className="point-editor-input"
        aria-label="Edit point"
        autoFocus
        rows={Math.min(10, Math.max(2, text.split('\n').length))}
        maxLength={4000}
        value={text}
        onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          const inFence = ((text.match(/^\s*```/gm) ?? []).length % 2) === 1;
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !inFence) {
            e.preventDefault();
            void save();
          }
        }}
      />
      <div className="point-editor-actions">
        <span className="muted small">Notes show the new text; the point keeps its ID and date.</span>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void save()}>
          Save
        </button>
      </div>
    </div>
  );
}
