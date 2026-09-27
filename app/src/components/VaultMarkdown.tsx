// Vault reading mode: the chat renderer's exact markdown treatment, plus
// Obsidian wikilinks and properties (Vault M3, CTO H2). The frontmatter is
// found by the shared core and shown by VaultProperties; the renderer only
// ever sees `text.slice(fm.end)`, so the core and the renderer can never
// disagree about where frontmatter ends (no remark-frontmatter, and YAML is
// never read as a heading). Wikilinks are made by a remark plugin that splits
// text nodes (lib/remarkWikilinks.ts), so code is never touched; the anchor
// override below intercepts the tap and navigates inside the vault instead of
// leaving the app. A markdown link to a note ([Plan](Plan.md)) opens the note
// too. External http(s) links keep their normal behavior.
import { useMemo } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { readFrontmatter, resolveMarkdownLink } from 'os-code/protocol';
import { remarkWikilinks } from '../lib/remarkWikilinks.js';
import { pathIndexOf } from '../lib/vault.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { VaultProperties } from './VaultProperties.js';

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
  paths: readonly string[];
  /** The note being read, so relative links and `[[#Heading]]` resolve from
   *  it. Optional: without it, links resolve from the vault root. */
  sourcePath?: string;
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

function VaultMarkdownBody({ text, paths, sourcePath, onOpenNote }: Props) {
  const fm = useMemo(() => readFrontmatter(text), [text]);
  const body = fm.end > 0 ? text.slice(fm.end) : text;
  const plugins = useMemo<Options['remarkPlugins']>(
    () => [remarkGfm, [remarkWikilinks, { paths, sourcePath }]],
    [paths, sourcePath],
  );
  const open = (path: string, isNew: boolean) => onOpenNote(path, isNew);
  return (
    <div className="md vault-md">
      <VaultProperties fm={fm} paths={paths} sourcePath={sourcePath} onOpenNote={open} />
      <ReactMarkdown
        remarkPlugins={plugins}
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
                    open(path, isNew);
                  }}
                >
                  {children}
                </a>
              );
            }
            // A markdown link to a note in this vault opens it here.
            const note = href
              ? resolveMarkdownLink(href, sourcePath ?? '', pathIndexOf(paths))
              : undefined;
            if (note) {
              return (
                <a
                  href={href}
                  className="wikilink"
                  onClick={(e) => {
                    e.preventDefault();
                    open(note, false);
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
        {body}
      </ReactMarkdown>
    </div>
  );
}
