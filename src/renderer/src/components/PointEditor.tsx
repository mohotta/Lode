import { useState } from 'react';
import { RichEditor } from './RichEditor';

interface Props {
  initial: string;
  onSave(text: string): Promise<boolean>;
  onCancel(): void;
}

/** Inline edit of the user's own point text (FR-8). Same keys as the composer; Escape cancels. */
export function PointEditor({ initial, onSave, onCancel }: Props): React.JSX.Element {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);

  const save = async (value = text): Promise<void> => {
    if (busy) return;
    // Unchanged content keeps the original spelling of its markdown.
    if (value.trim() === initial.trim()) return onCancel();
    if (!value.trim()) return;
    setBusy(true);
    try {
      if (await onSave(value)) onCancel();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="point-editor">
      <div className="composer editing">
        <RichEditor label="Edit point" initial={initial} autoFocus onChange={setText} onSubmit={(md) => void save(md)} onEscape={onCancel} />
      </div>
      <div className="point-editor-actions">
        <span className="muted small">Keeps its ID and date.</span>
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
