import { createContext, useContext, useState } from 'react';
import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { lode } from '../api';
import { CheckIcon, CopyIcon } from './Icons';

function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
}

/** Source URL → its number in the page's source list, for numbered citations. */
export const CiteContext = createContext<Map<string, number>>(new Map());

interface HastNode {
  type: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const textOf = (n: HastNode | undefined): string =>
  !n ? '' : n.type === 'text' ? (n.value ?? '') : (n.children ?? []).map(textOf).join('');

/** Copies via the async API, falling back to execCommand (the renderer is denied all permissions). */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

/** A fenced block: language (when the fence names one) and a copy button above the code. */
function CodeBlock({ node, children }: { node?: HastNode; children?: React.ReactNode }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const cls = node?.children?.find((c) => c.type === 'element')?.properties?.className;
  const lang = Array.isArray(cls) ? cls.map(String).find((c) => c.startsWith('language-'))?.slice(9) : undefined;
  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">{lang ?? ''}</span>
        <button
          type="button"
          className="icon-btn code-copy"
          aria-label={copied ? 'Copied' : 'Copy code'}
          title={copied ? 'Copied' : 'Copy code'}
          onClick={() =>
            void copyText(textOf(node).replace(/\n$/, '')).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function Cite({ url, label }: { url: string; label: string }): React.JSX.Element {
  const n = useContext(CiteContext).get(url);
  return (
    <a
      href={url}
      className="cite"
      title={label ? `${label} · ${url}` : url}
      aria-label={n ? `Source ${n}${label ? `: ${label}` : ''}` : `Source: ${label || url}`}
      onClick={(e) => {
        e.preventDefault();
        void lode.link.open(url);
      }}
    >
      {n ?? '↗'}
    </a>
  );
}

const components: Components = {
  // Links never navigate the app window; they open in the system browser via main.
  a: ({ href, children, node }) => {
    const url = href ? safeUrl(href) : '';
    if (!url) return <span>{children}</span>;
    if (node?.properties?.dataCite) return <Cite url={url} label={textOf(node as HastNode)} />;
    return (
      <a
        href={url}
        className="md-link"
        title={url}
        onClick={(e) => {
          e.preventDefault();
          void lode.link.open(url);
        }}
      >
        {children}
      </a>
    );
  },
  img: ({ alt }) => <span className="muted">[image: {alt}]</span>,
  pre: ({ node, children }) => <CodeBlock node={node as HastNode}>{children}</CodeBlock>,
};

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

/**
 * remark plugin: keep the user's single line breaks as hard breaks (like they typed them)
 * by splitting text nodes on newlines. Code blocks are separate nodes and are untouched.
 */
function remarkKeepBreaks() {
  const walk = (node: MdNode): void => {
    if (!node.children) return;
    const next: MdNode[] = [];
    for (const child of node.children) {
      if (child.type === 'text' && child.value?.includes('\n')) {
        child.value.split('\n').forEach((part, i) => {
          if (i > 0) next.push({ type: 'break' });
          if (part) next.push({ type: 'text', value: part });
        });
      } else {
        walk(child);
        next.push(child);
      }
    }
    node.children = next;
  };
  return (tree: MdNode): void => walk(tree);
}

interface MdLink extends MdNode {
  data?: { hProperties?: Record<string, unknown> };
}

/**
 * remark plugin: links that end a paragraph (after some text, separated only by spaces) are
 * citations, as generation writes them, and render as numbers. Links inside a sentence stay.
 */
function remarkCites() {
  const walk = (node: MdNode): void => {
    if (node.type === 'paragraph' && node.children) {
      const kids = node.children as MdLink[];
      let i = kids.length - 1;
      while (i >= 0 && (kids[i]!.type === 'link' || (kids[i]!.type === 'text' && !kids[i]!.value?.trim()))) i--;
      if (i >= 0 && i < kids.length - 1) {
        // Numbers sit right after the sentence: drop the spaces before and between them.
        const last = kids[i]!;
        if (last.type === 'text' && last.value) last.value = last.value.trimEnd();
        const cites = kids.slice(i + 1).filter((k) => k.type === 'link');
        for (const k of cites) k.data = { ...k.data, hProperties: { ...k.data?.hProperties, dataCite: true } };
        node.children = [...kids.slice(0, i + 1), ...cites];
      }
    }
    node.children?.forEach(walk);
  };
  return (tree: MdNode): void => walk(tree);
}

/**
 * Code is highlighted on the hast tree (spans with hljs classes, no HTML strings). Unlabelled
 * fences are auto-detected; a wrong guess only changes colours.
 */
const rehypePlugins: Options['rehypePlugins'] = [[rehypeHighlight, { detect: true }]];

/**
 * Markdown rendered from the mdast/hast AST. Raw HTML is skipped; only http/https URLs survive.
 * `keepBreaks` is for user-written text, where a newline should look like a newline; `cite`
 * is for AI text, whose trailing source links become numbered citations.
 */
export function Markdown({
  text,
  keepBreaks = false,
  cite = false,
}: {
  text: string;
  keepBreaks?: boolean;
  cite?: boolean;
}): React.JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, ...(keepBreaks ? [remarkKeepBreaks] : []), ...(cite ? [remarkCites] : [])]}
      rehypePlugins={rehypePlugins}
      skipHtml
      urlTransform={safeUrl}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
}
