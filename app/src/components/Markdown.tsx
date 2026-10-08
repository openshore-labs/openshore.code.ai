// Assistant prose rendering: markdown with GFM tables and in-palette code
// highlighting, exactly the reading experience the best chat apps set. Fenced
// code blocks are components/CodeBlock.tsx (Copy, and Run for a shell command
// when the chat is desktop-backed; a ```diff fence renders as a real diff),
// and a fence still open mid-stream renders as code rather than flashing as
// prose until its closing line arrives. The highlighter loads the first time
// a message holds a fence (lib/lazyHighlight.ts), so a launch never carries
// it; until it lands, the block reads as plain code in the same box.
import ReactMarkdown, { type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isValidElement } from 'react';
import { CodeBlock, extractText } from './CodeBlock.js';
import { AppActionCard } from './AppActionCard.js';
import { appActionKeyFromClass, type AppActionKey } from '../lib/appActions.js';
import { hasCodeFence, useHighlighter } from '../lib/lazyHighlight.js';
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
  actions = [],
}: {
  text: string;
  /** A chat reply: a fence tagged `openshore-set:<key>`, for a key listed
   *  here, renders as the app action card (lib/appActions.ts) instead of
   *  code. The chat lists only the keys its own turns asked for (the
   *  contract's gate, appActionsAsked), and nothing anywhere else, so a note
   *  in the vault, a plan, or a reply in a chat that never asked never
   *  offers to change a setting. */
  actions?: readonly AppActionKey[];
  streaming?: boolean;
  /** A live reply: split prose into word spans so each new word fades in
   *  (lib/fadeWords.ts, `.md-live .w`). Off renders plain text. */
  fade?: boolean;
  /** A scripted line rolling in on the swell (lib/inkSwell.ts): every
   *  character stamped with its start. Undefined renders plain text. */
  ink?: { stamp: InkStamp; kind: 'greeting' | 'walk' };
}) {
  const highlight = useHighlighter(hasCodeFence(text));
  const plugins: NonNullable<Options['rehypePlugins']> = [
    ...(highlight ? [highlight] : []),
    ...(ink ? [rehypeInk(ink.stamp)] : fade ? [rehypeFadeWords] : []),
  ];
  const cls = ink ? ` md-ink md-ink-${ink.kind}` : fade ? ' md-live' : '';
  return (
    <div className={`md${cls}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={plugins}
        components={{
          pre: ({ children }) => {
            const key =
              actions.length && isValidElement(children)
                ? appActionKeyFromClass((children.props as { className?: string }).className)
                : undefined;
            if (key && actions.includes(key)) {
              const value = extractText(children).replace(/\n$/, '');
              // A finished proposal with nothing in it is a small model's
              // misfire, not an offer: show nothing rather than an empty box.
              if (!streaming && !value.trim()) return null;
              return <AppActionCard actionKey={key} value={value} streaming={streaming} />;
            }
            return <CodeBlock>{children}</CodeBlock>;
          },
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
