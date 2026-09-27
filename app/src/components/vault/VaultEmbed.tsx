// `![[Note]]`, `![[Note#Heading]]` and `![[Note#^id]]` in reading view (Vault
// M6 6.5, CTO K11, CX X14): a card with a quiet `From "{title}"` header that
// opens the note, then the note's body, one level deep. The body renders
// through the same reader at depth 1, where a further embed is a link chip,
// so an embed can never recurse. A body over 256 KB is a chip too.
//
// The bytes come from the host's `readBody` (the store's `vaultReadBody`,
// body cache first), never a new read path. A heading or block subpath cuts
// the body to that section with the core's `sectionOf` and `blockAnchorAt`.
import { useEffect, useState, type ReactNode } from 'react';
import { blockAnchorAt, readFrontmatter, sectionOf } from 'os-code/protocol';
import { vaultReaderCopy } from '../../lib/vaultCopy.js';

/** The largest body an embed renders inline (K11). */
export const VAULT_EMBED_MAX_CHARS = 256 * 1024;

export interface VaultEmbedProps {
  path: string;
  /** A heading, or a block id with its `^`. */
  subpath?: string;
  title: string;
  readBody?: (path: string) => Promise<string | undefined>;
  onOpen: () => void;
  /** Renders the cut body through the reader, one level down. */
  renderBody: (text: string) => ReactNode;
}

/** The part of a note an embed shows: the section or block its subpath
 *  names, else the body under the frontmatter. */
export function embedSlice(text: string, subpath?: string): string {
  const sub = subpath?.trim();
  if (sub) {
    const range = sub.startsWith('^')
      ? blockAnchorAt(text, sub.slice(1))
      : sectionOf(text, sub.split('#').filter(Boolean).pop() ?? sub);
    if (range) return text.slice(range.start, range.end);
  }
  const fm = readFrontmatter(text);
  return fm.end > 0 ? text.slice(fm.end) : text;
}

type EmbedState = { status: 'loading' } | { status: 'ready'; text: string } | { status: 'unread' };

/** A link chip: the second level, the cap, or a body that could not be read.
 *  A tap opens the note. */
export function VaultEmbedChip({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="vault-chip vault-chip--button vault-chip--link press-fb"
      onClick={onOpen}
    >
      <span className="vault-chip-text">
        <span className="vault-chip-name">{vaultReaderCopy.embedNested(title)}</span>
      </span>
    </button>
  );
}

export function VaultEmbed({
  path,
  subpath,
  title,
  readBody,
  onOpen,
  renderBody,
}: VaultEmbedProps) {
  const [state, setState] = useState<EmbedState>(
    readBody ? { status: 'loading' } : { status: 'unread' },
  );

  useEffect(() => {
    if (!readBody) {
      setState({ status: 'unread' });
      return;
    }
    let live = true;
    setState({ status: 'loading' });
    readBody(path).then(
      (text) => {
        if (!live) return;
        if (text === undefined || text.length > VAULT_EMBED_MAX_CHARS)
          setState({ status: 'unread' });
        else setState({ status: 'ready', text: embedSlice(text, subpath) });
      },
      () => {
        if (live) setState({ status: 'unread' });
      },
    );
    return () => {
      live = false;
    };
  }, [path, subpath, readBody]);

  if (state.status === 'unread') return <VaultEmbedChip title={title} onOpen={onOpen} />;
  return (
    <section className="vault-embed" aria-label={vaultReaderCopy.embedFrom(title)}>
      <button type="button" className="vault-embed-head press-fb" onClick={onOpen}>
        {vaultReaderCopy.embedFrom(title)}
      </button>
      {state.status === 'loading' ? (
        <div className="vault-embed-skeleton" aria-busy="true">
          <span className="vault-embed-skeleton-line" />
          <span className="vault-embed-skeleton-line" />
          <span className="visually-hidden">{vaultReaderCopy.loading(title)}</span>
        </div>
      ) : (
        <div className="vault-embed-body">{renderBody(state.text)}</div>
      )}
    </section>
  );
}
