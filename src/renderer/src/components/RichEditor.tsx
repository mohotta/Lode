import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import { tidyMarkdown } from '@shared/markdown';

export interface RichEditorHandle {
  focus(): void;
  clear(): void;
}

interface Props {
  /** Markdown to start with. */
  initial?: string;
  label: string;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  /** Enter (outside code blocks and lists) or Ctrl+Enter. Receives markdown. */
  onSubmit(markdown: string): void;
  onEscape?(): void;
  /** Markdown after every change. */
  onChange?(markdown: string): void;
}

const read = (e: Editor): string => (e.isEmpty ? '' : tidyMarkdown(e.getMarkdown()));

/** WYSIWYG markdown editor for the user's own points (composer and inline edit). */
export const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(p, ref) {
  // Keep the latest callbacks without rebuilding the editor.
  const cb = useRef(p);
  useEffect(() => {
    cb.current = p;
  });

  const editorRef = useRef<Editor | null>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [3, 4] },
        // Markdown has no underline; links open in the browser from the rendered point instead.
        underline: false,
        link: { openOnClick: false, autolink: true, protocols: ['http', 'https'] },
      }),
      Placeholder.configure({ placeholder: () => cb.current.placeholder ?? '' }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
    ],
    content: p.initial ?? '',
    contentType: 'markdown',
    autofocus: p.autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': p.label,
        class: `rich-input ${p.className ?? ''}`,
        spellcheck: 'true',
      },
      handleKeyDown: (view, event) => {
        if (event.isComposing) return false;
        if (event.key === 'Escape' && cb.current.onEscape) {
          cb.current.onEscape();
          return true;
        }
        if (event.key !== 'Enter' || event.shiftKey || event.altKey) return false;
        const { $from } = view.state.selection;
        let nested = false;
        for (let d = $from.depth; d > 0; d--) {
          const name = $from.node(d).type.name;
          if (name === 'codeBlock' || name === 'listItem') nested = true;
        }
        if (nested && !(event.ctrlKey || event.metaKey)) return false;
        event.preventDefault();
        if (editorRef.current) cb.current.onSubmit(read(editorRef.current));
        return true;
      },
      handlePaste: (view, event) => {
        // Plain text is parsed as markdown so pasted notes keep their code and lists.
        const text = event.clipboardData?.getData('text/plain');
        if (!text || event.clipboardData?.getData('text/html') || !text.includes('\n')) return false;
        if (view.state.selection.$from.parent.type.name === 'codeBlock') return false;
        editorRef.current?.commands.insertContent(text, { contentType: 'markdown' });
        return true;
      },
    },
    onUpdate: ({ editor: e }) => cb.current.onChange?.(read(e)),
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editor?.commands.focus('end'),
      clear: () => editor?.commands.clearContent(true),
    }),
    [editor],
  );

  const marks = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            code: e.isActive('code'),
            codeBlock: e.isActive('codeBlock'),
            bullet: e.isActive('bulletList'),
            ordered: e.isActive('orderedList'),
          }
        : null,
  });

  const tool = (label: string, key: string, on: boolean | undefined, run: (e: Editor) => void, glyph: React.ReactNode) => (
    <button
      type="button"
      className={`rt-btn ${on ? 'on' : ''}`}
      aria-label={label}
      aria-pressed={!!on}
      title={`${label} (${key})`}
      // Keep focus (and the selection) in the editor.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => editor && run(editor)}
    >
      {glyph}
    </button>
  );

  return (
    <div className="rich-editor">
      <EditorContent editor={editor} />
      <div className="rt-tools" role="toolbar" aria-label="Formatting">
        {tool('Bold', 'Ctrl+B', marks?.bold, (e) => e.chain().focus().toggleBold().run(), <b>B</b>)}
        {tool('Italic', 'Ctrl+I', marks?.italic, (e) => e.chain().focus().toggleItalic().run(), <i>I</i>)}
        {tool('Inline code', 'Ctrl+E', marks?.code, (e) => e.chain().focus().toggleCode().run(), <code>{'`'}</code>)}
        {tool('Code block', 'Ctrl+Alt+C', marks?.codeBlock, (e) => e.chain().focus().toggleCodeBlock().run(), <code>{'{}'}</code>)}
        {tool('Bullet list', 'Ctrl+Shift+8', marks?.bullet, (e) => e.chain().focus().toggleBulletList().run(), <span>•</span>)}
        {tool('Numbered list', 'Ctrl+Shift+7', marks?.ordered, (e) => e.chain().focus().toggleOrderedList().run(), <span>1.</span>)}
      </div>
    </div>
  );
});
