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
import { isValidElement, memo } from 'react';
import { CodeBlock, extractText } from './CodeBlock.js';
import { AppActionCard } from './AppActionCard.js';
import { appActionKeyFromClass, type AppActionKey } from '../lib/appActions.js';
import { hasCodeFence, useHighlighter } from '../lib/lazyHighlight.js';
import { rehypeFadeWords } from '../lib/fadeWords.js';
import { rehypeInk, type InkStamp } from '../lib/inkSwell.js';
import { closeOpenMarks, splitBlocks } from '../lib/markdownBlocks.js';

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
  const cls = ink ? ` md-ink md-ink-${ink.kind}` : fade ? ' md-live' : '';
  // A live reply renders block by block: the finished blocks are memoized and
  // never parsed again, and only the last one grows (lib/markdownBlocks.ts).
  if (fade && !ink) {
    const blocks = splitBlocks(text);
    return (
      <div className={`md${cls}`}>
        {blocks.map((block, i) => {
          const last = i === blocks.length - 1;
          return (
            <MarkdownPart
              key={i}
              text={last && streaming ? closeOpenFence(closeOpenMarks(block), true) : block}
              streaming={last && streaming}
              fade
              highlight={highlight}
              actions={actions}
            />
          );
        })}
      </div>
    );
  }
  return (
    <div className={`md${cls}`}>
      <MarkdownPart
        text={closeOpenFence(text, streaming)}
        streaming={streaming}
        fade={fade}
        ink={ink}
        highlight={highlight}
        actions={actions}
      />
    </div>
  );
}

type Highlighter = ReturnType<typeof useHighlighter>;

/** One run of markdown, rendered once per change of its own props, so a
 *  finished block of a live reply is never parsed again while the reply
 *  grows. The chat rebuilds its action list each render, so the list is
 *  compared by what it holds. */
interface PartProps {
  text: string;
  streaming: boolean;
  fade: boolean;
  ink?: { stamp: InkStamp; kind: 'greeting' | 'walk' };
  highlight: Highlighter;
  actions: readonly AppActionKey[];
}

const MarkdownPart = memo(function MarkdownPart({
  text,
  streaming,
  fade,
  ink,
  highlight,
  actions,
}: PartProps) {
  const plugins: NonNullable<Options['rehypePlugins']> = [
    ...(highlight ? [highlight] : []),
    ...(ink ? [rehypeInk(ink.stamp)] : fade ? [rehypeFadeWords] : []),
  ];
  return (
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
      {text}
    </ReactMarkdown>
  );
}, samePart);

function samePart(a: PartProps, b: PartProps): boolean {
  return (
    a.text === b.text &&
    a.streaming === b.streaming &&
    a.fade === b.fade &&
    a.ink === b.ink &&
    a.highlight === b.highlight &&
    a.actions.join() === b.actions.join()
  );
}
