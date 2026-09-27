// Vault reading mode: the chat renderer's exact markdown treatment, plus
// Obsidian wikilinks. Bodies are pre-processed so [[Target]] becomes a real
// anchor carrying a vault: href, then the anchor override below intercepts
// the tap and navigates inside the vault instead of leaving the app. External
// http(s) links keep their normal behavior.
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { wikilinksToMarkdown } from '../lib/vault.js';
import { ErrorBoundary } from './ErrorBoundary.js';

// react-markdown 10 strips any href whose protocol is not in its allowlist,
// which drops our vault: wikilinks (they would render with an empty href and
// never navigate). Allow vault: through, and keep the default transform for
// every other protocol so javascript: and other hostile schemes stay blocked.
export const vaultUrlTransform = (url: string): string =>
  url.startsWith('vault:') ? url : defaultUrlTransform(url);

/** The note path a vault: href names. A hand-written or pasted link can carry
 *  a broken percent-escape ("vault:%E0%A4%A"), which decodeURIComponent throws
 *  on during render (ui-9); the raw text is used instead, so the link still
 *  names something and the note still renders. */
export function vaultHrefPath(href: string): string {
  const raw = href.slice('vault:'.length).replace(/\?new$/, '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

type Props = {
  text: string;
  paths: string[];
  onOpenNote: (path: string, isNew: boolean) => void;
};

/** A note, read. Anything in the body that still trips the renderer falls
 *  back to the plain text inside this block, never a blank app (0.10). */
export function VaultMarkdown(props: Props) {
  return (
    <ErrorBoundary
      resetKey={props.text}
      fallback={() => (
        <div className="vault-md">
          <p className="hint">
            This note could not be shown formatted, so here it is as plain text.
          </p>
          <pre className="vault-raw">{props.text}</pre>
        </div>
      )}
    >
      <VaultMarkdownBody {...props} />
    </ErrorBoundary>
  );
}

function VaultMarkdownBody({ text, paths, onOpenNote }: Props) {
  return (
    <div className="md vault-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        urlTransform={vaultUrlTransform}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('vault:')) {
              const isNew = href.endsWith('?new');
              const path = vaultHrefPath(href);
              return (
                <a
                  href={href}
                  className={`wikilink${isNew ? ' unresolved' : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenNote(path, isNew);
                  }}
                >
                  {children}
                </a>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
        }}
      >
        {wikilinksToMarkdown(text, paths)}
      </ReactMarkdown>
    </div>
  );
}
