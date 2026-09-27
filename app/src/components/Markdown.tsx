// Assistant prose rendering: markdown with GFM tables and in-palette code
// highlighting, exactly the reading experience the best chat apps set. Fenced
// code blocks are components/CodeBlock.tsx (Copy, and Run for a shell command
// when the chat is desktop-backed; a ```diff fence renders as a real diff),
// and a fence still open mid-stream renders as code rather than flashing as
// prose until its closing line arrives.
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { CodeBlock } from './CodeBlock.js';
import { rehypeFadeWords } from '../lib/fadeWords.js';
import { rehypeInk, type InkStamp } from '../lib/inkSwell.js';

/** While streaming, an odd number of fences means one is still open: close it
 *  so the half-written block renders as code instead of flashing as prose. */
export function closeOpenFence(text: string, streaming: boolean): string {
  if (!streaming) return text;
  const fences = (text.match(/^```/gm) ?? []).length;
  return fences % 2 === 1 ? `${text}\n\`\`\`` : text;
}

export function Markdown({
  text,
  streaming = false,
  fade = false,
  ink,
}: {
  text: string;
  streaming?: boolean;
  /** A live reply: split prose into word spans so each new word fades in
   *  (lib/fadeWords.ts, `.md-live .w`). Off renders plain text. */
  fade?: boolean;
  /** A scripted line rolling in on the swell (lib/inkSwell.ts): every
   *  character stamped with its start. Undefined renders plain text. */
  ink?: { stamp: InkStamp; kind: 'greeting' | 'walk' };
}) {
  const plugins = ink
    ? [rehypeHighlight, rehypeInk(ink.stamp)]
    : fade
      ? [rehypeHighlight, rehypeFadeWords]
      : [rehypeHighlight];
  const cls = ink ? ` md-ink md-ink-${ink.kind}` : fade ? ' md-live' : '';
  return (
    <div className={`md${cls}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={plugins}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          // Links leave the app rather than navigating the WebView away from it.
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {closeOpenFence(text, streaming)}
      </ReactMarkdown>
    </div>
  );
}
