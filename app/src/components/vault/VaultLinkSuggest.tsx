// Live [[wikilink]] suggestions under the Vault editor (moved out of
// VaultScreen in Vault M6 wave 0, no behavior change; stream H owns what it
// becomes: a listbox with keys, heading completion, folder sub-labels, CTO
// K14 and CX X15). Prop-driven: the screen owns the draft, the caret and the
// insert.
import { noteTitle } from '../../lib/vault.js';

export interface VaultLinkSuggestProps {
  /** Every note path in the vault. */
  paths: readonly string[];
  /** The open note, never offered as its own link. */
  sourcePath: string;
  /** What has been typed since the open `[[`, or null when none is open. */
  query: string | null;
  /** Insert `[[name]]` over the open link. */
  onPick: (name: string) => void;
}

/** Notes whose title or path matches, best-prefix first; a non-matching,
 *  non-empty query also offers to link a brand new note of that name
 *  (created on first open, like a tap on a dashed link). */
export function VaultLinkSuggest({ paths, sourcePath, query, onPick }: VaultLinkSuggestProps) {
  const q = (query ?? '').trim().toLowerCase();
  const linkMatches =
    query === null
      ? []
      : paths
          .filter((p) => p !== sourcePath)
          .map((p) => ({ p, t: noteTitle(p) }))
          .filter(({ p, t }) => !q || t.toLowerCase().includes(q) || p.toLowerCase().includes(q))
          .sort((a, b) => {
            const ap = a.t.toLowerCase().startsWith(q) ? 0 : 1;
            const bp = b.t.toLowerCase().startsWith(q) ? 0 : 1;
            return ap - bp || a.t.length - b.t.length;
          })
          .slice(0, 6);
  const canCreate =
    query !== null && q.length > 0 && !paths.some((p) => noteTitle(p).toLowerCase() === q);

  if (query === null || (linkMatches.length === 0 && !canCreate)) return null;
  return (
    <div className="vault-link-suggest" role="listbox" aria-label="Link a note">
      {linkMatches.map(({ p, t }) => (
        <button
          key={p}
          className="vault-link-chip"
          // onMouseDown, not onClick, so the pick lands before the
          // textarea's blur clears the autocomplete context.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(t);
          }}
        >
          {t}
        </button>
      ))}
      {canCreate ? (
        <button
          className="vault-link-chip vault-link-new"
          onMouseDown={(e) => {
            e.preventDefault();
            onPick((query ?? '').trim());
          }}
        >
          New: {(query ?? '').trim()}
        </button>
      ) : null}
    </div>
  );
}
