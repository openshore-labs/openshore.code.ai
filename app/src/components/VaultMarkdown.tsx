// Vault reading mode: the chat renderer's exact markdown treatment, plus
// Obsidian wikilinks. Bodies are pre-processed so [[Target]] becomes a real
// anchor carrying a vault: href, then the anchor override below intercepts
// the tap and navigates inside the vault instead of leaving the app. External
// http(s) links keep their normal behavior.
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { wikilinksToMarkdown } from '../lib/vault.js';

// react-markdown 10 strips any href whose protocol is not in its allowlist,
// which drops our vault: wikilinks (they would render with an empty href and
// never navigate). Allow vault: through, and keep the default transform for
// every other protocol so javascript: and other hostile schemes stay blocked.
export const vaultUrlTransform = (url: string): string =>
  url.startsWith('vault:') ? url : defaultUrlTransform(url);

export function VaultMarkdown({
  text,
  paths,
  onOpenNote,
}: {
  text: string;
  paths: string[];
  onOpenNote: (path: string, isNew: boolean) => void;
}) {
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
              const raw = href.slice('vault:'.length).replace(/\?new$/, '');
              const path = decodeURIComponent(raw);
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
