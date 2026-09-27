// Linked mentions under a note (moved out of VaultScreen in Vault M6 wave 0,
// no behavior change; stream H owns what it becomes: outgoing links, unlinked
// mentions and a skeleton, CTO K15 and CX X16, X17). Prop-driven: the screen
// asks the index and hands the list in.
import { noteTitle } from '../../lib/vault.js';

export interface VaultBacklinksProps {
  /** The notes that link here, each with an excerpt around its link. */
  mentions: ReadonlyArray<{ path: string; excerpt: string }>;
  /** Why the list may be incomplete, or undefined when every note read. */
  error?: string;
  onOpen: (path: string) => void;
}

/** The Linked mentions card, or nothing when there is nothing to say. */
export function VaultBacklinks({ mentions, error, onOpen }: VaultBacklinksProps) {
  if (mentions.length === 0 && !error) return null;
  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-row">
        <h3 style={{ marginBottom: 0 }}>Linked mentions</h3>
        {mentions.length > 0 ? <span className="pill local">{mentions.length}</span> : null}
      </div>
      {error ? (
        <p className="hint" role="status" style={{ margin: '6px 0 0', color: 'var(--warn)' }}>
          {error}
        </p>
      ) : null}
      {mentions.map((b) => (
        <button key={b.path} className="vault-mention" onClick={() => onOpen(b.path)}>
          <span className="vault-mention-title">{noteTitle(b.path)}</span>
          <span className="vault-mention-excerpt">{b.excerpt}</span>
        </button>
      ))}
    </div>
  );
}
