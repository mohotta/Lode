import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { lode } from '../api';

function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
}

const components: Components = {
  // Links never navigate the app window; they open in the system browser via main.
  a: ({ href, children }) => {
    const url = href ? safeUrl(href) : '';
    if (!url) return <span>{children}</span>;
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

/**
 * Code is highlighted on the hast tree (spans with hljs classes, no HTML strings). Unlabelled
 * fences are auto-detected; a wrong guess only changes colours.
 */
const rehypePlugins: Options['rehypePlugins'] = [[rehypeHighlight, { detect: true }]];

/**
 * Markdown rendered from the mdast/hast AST. Raw HTML is skipped; only http/https URLs survive.
 * `keepBreaks` is for user-written text, where a newline should look like a newline.
 */
export function Markdown({ text, keepBreaks = false }: { text: string; keepBreaks?: boolean }): React.JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={keepBreaks ? [remarkGfm, remarkKeepBreaks] : [remarkGfm]}
      rehypePlugins={rehypePlugins}
      skipHtml
      urlTransform={safeUrl}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
}
