// The card under a note (Vault M6, 6.8 and 6.9; CTO K15, CX X16, X17): three
// quiet sections in one card, in this order. `Linked mentions` (the notes
// that link here, as before), `Links from this note` (from the index's
// outlinks; one to a note that does not exist yet is muted and creates it on
// tap), and `Unlinked mentions` (notes that name this one in plain text,
// found on request, each with a `Link` button that is the person's own
// compare-and-swap write).
//
// While Linked mentions load, three skeleton rows shimmer on the house loop
// (killed under reduced motion) with `aria-busy` and a visually hidden line;
// the screen resets the card on every path change (ui-18) by passing
// `loading` again.
//
// Prop-driven: the screen asks the index and hands the lists in. The pure
// helpers below (outgoing links from outlinks, the unlinked-mentions pass
// with its 50-read budget, the text a Link writes) are what the screen and
// its operations call, so they are testable without a DOM.
import {
  excerptAt,
  findUnlinkedMentions,
  foldPath,
  noteTitle,
  type UnlinkedMention,
} from 'os-code/protocol';
import {
  VAULT_BACKLINKS_LOADING,
  VAULT_FIND_UNLINKED,
  VAULT_LINKED_MENTIONS,
  VAULT_LINK_BUTTON,
  VAULT_OUTGOING_LINKS,
  VAULT_OUTGOING_MISSING,
  VAULT_UNLINKED_MENTIONS,
  vaultLinkMentionAria,
  vaultUnlinkedBusy,
  vaultUnlinkedNone,
} from '../../lib/vaultCopy.js';

/** One link out of the note: where it resolved, or null for a note not
 *  created yet (`target` is then the name as written). */
export interface VaultOutgoingLink {
  target: string;
  path: string | null;
}

/** A plain-text mention of this note in another. */
export interface VaultUnlinkedRow {
  path: string;
  excerpt: string;
  mention: UnlinkedMention;
}

export type VaultUnlinkedState =
  | { status: 'idle' }
  | { status: 'busy'; reading: number }
  | { status: 'done'; rows: readonly VaultUnlinkedRow[]; error?: string };

/** How many notes the unlinked pass reads at most (K15, K16). */
export const UNLINKED_MAX_READS = 50;

const ATTACHMENT_EXT = /\.(?!md$)[a-z0-9]{1,5}$/i;

/** The note's links out, from `index.outlinks(path)`: one row per note,
 *  in the order they first appear, self-links and attachments left out. */
export function outgoingLinks(
  outlinks: ReadonlyArray<{ link: { target: string }; resolved: string | null }>,
  sourcePath: string,
): VaultOutgoingLink[] {
  const seen = new Set<string>();
  const out: VaultOutgoingLink[] = [];
  for (const { link, resolved } of outlinks) {
    const target = link.target.trim();
    if (resolved === sourcePath) continue;
    if (!resolved && (!target || ATTACHMENT_EXT.test(target))) continue;
    const key = resolved ? `p:${resolved}` : `t:${foldPath(target)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ target, path: resolved });
  }
  return out;
}

export interface UnlinkedPassDeps {
  /** The note asked about. */
  path: string;
  /** Its aliases (frontmatter), matched too. */
  aliases?: readonly string[];
  /** Candidate notes for a name: the index's search, best first. */
  search: (query: string) => Promise<ReadonlyArray<{ path: string }>>;
  /** A note's text through the store's body cache, or undefined. */
  readBody: (path: string) => Promise<string | undefined>;
  /** Told how many notes the pass is about to read, for the busy line. */
  onReading?: (n: number) => void;
  /** The matcher (the core's by default; tests inject). */
  find?: (text: string, names: readonly string[]) => UnlinkedMention[];
  max?: number;
}

/** Unlinked mentions of a note, on request (K15): candidates from a search
 *  of its title and aliases, at most 50 bodies read, each matched whole-word
 *  and case-insensitive outside links, code and frontmatter by the core's
 *  `findUnlinkedMentions`. The first mention per note is the row. */
export async function findUnlinkedRows(deps: UnlinkedPassDeps): Promise<VaultUnlinkedRow[]> {
  const title = noteTitle(deps.path);
  const names = [title, ...(deps.aliases ?? [])].map((n) => n.trim()).filter(Boolean);
  const find = deps.find ?? findUnlinkedMentions;
  const max = deps.max ?? UNLINKED_MAX_READS;
  const candidates: string[] = [];
  const seen = new Set<string>([deps.path]);
  for (const name of names) {
    const hits = await deps.search(name);
    for (const h of hits) {
      if (seen.has(h.path)) continue;
      seen.add(h.path);
      candidates.push(h.path);
    }
  }
  const take = candidates.slice(0, max);
  deps.onReading?.(take.length);
  const rows: VaultUnlinkedRow[] = [];
  for (const p of take) {
    let text: string | undefined;
    try {
      text = await deps.readBody(p);
    } catch {
      text = undefined;
    }
    if (text === undefined) continue;
    const first = find(text, names)[0];
    if (!first) continue;
    rows.push({ path: p, excerpt: excerptAt(text, first.start).text, mention: first });
  }
  return rows;
}

/** The text a `Link` writes: the mention wrapped as `[[link]]`, or
 *  `[[link|as written]]` when the words differ from the link text, so the
 *  sentence reads exactly as before. Undefined when the mention moved. */
export function linkMentionText(
  text: string,
  mention: Pick<UnlinkedMention, 'start' | 'end' | 'name'>,
  linkText: string,
): string | undefined {
  const written = text.slice(mention.start, mention.end);
  if (!written || foldPath(written) !== foldPath(mention.name)) return undefined;
  const link = written === linkText ? `[[${linkText}]]` : `[[${linkText}|${written}]]`;
  return text.slice(0, mention.start) + link + text.slice(mention.end);
}

export interface VaultBacklinksProps {
  /** The notes that link here, each with an excerpt around its link. */
  mentions: ReadonlyArray<{ path: string; excerpt: string }>;
  /** Why the list may be incomplete, or undefined when every note read. */
  error?: string;
  onOpen: (path: string) => void;
  /** Linked mentions are still being read: three skeleton rows. */
  loading?: boolean;
  /** The note's links out (`outgoingLinks`). */
  outgoing?: readonly VaultOutgoingLink[];
  /** Tap on a link to a note not created yet. */
  onCreate?: (name: string) => void;
  /** The note's title, for the unlinked lines. */
  title?: string;
  /** Unlinked mentions; left out, the section is not offered. */
  unlinked?: VaultUnlinkedState;
  onFindUnlinked?: () => void;
  /** Link one mention (the person's own write). */
  onLink?: (row: VaultUnlinkedRow) => void;
  /** Paths whose Link is running. */
  linking?: ReadonlySet<string>;
}

function Section({ title, count }: { title: string; count?: number }) {
  return (
    <div className="card-row vault-context-head">
      <h3 style={{ marginBottom: 0 }}>{title}</h3>
      {count ? <span className="pill local">{count}</span> : null}
    </div>
  );
}

/** The card under a note, or nothing when there is nothing to say. */
export function VaultBacklinks({
  mentions,
  error,
  onOpen,
  loading = false,
  outgoing = [],
  onCreate,
  title,
  unlinked,
  onFindUnlinked,
  onLink,
  linking,
}: VaultBacklinksProps) {
  const hasLinked = loading || mentions.length > 0 || Boolean(error);
  const hasOutgoing = outgoing.length > 0;
  const hasUnlinked = Boolean(unlinked) && (unlinked!.status !== 'idle' || Boolean(onFindUnlinked));
  if (!hasLinked && !hasOutgoing && !hasUnlinked) return null;
  return (
    <div className="card vault-context" style={{ marginTop: 18 }}>
      {hasLinked ? (
        <section className="vault-context-section" aria-busy={loading || undefined}>
          <Section title={VAULT_LINKED_MENTIONS} count={loading ? 0 : mentions.length} />
          {loading ? (
            <div className="vault-skel">
              <span className="visually-hidden" role="status">
                {VAULT_BACKLINKS_LOADING}
              </span>
              {[0, 1, 2].map((i) => (
                <div key={i} className="vault-skel-row" aria-hidden="true">
                  <span className="vault-skel-line vault-skel-title" />
                  <span className="vault-skel-line" />
                </div>
              ))}
            </div>
          ) : (
            <>
              {error ? (
                <p
                  className="hint"
                  role="status"
                  style={{ margin: '6px 0 0', color: 'var(--warn)' }}
                >
                  {error}
                </p>
              ) : null}
              {mentions.map((b, i) => (
                <button
                  key={b.path}
                  type="button"
                  className="vault-mention vault-context-row press-fb press-fb--row"
                  style={{ ['--i' as string]: Math.min(i, 12) }}
                  onClick={() => onOpen(b.path)}
                >
                  <span className="vault-mention-title">{noteTitle(b.path)}</span>
                  <span className="vault-mention-excerpt">{b.excerpt}</span>
                </button>
              ))}
            </>
          )}
        </section>
      ) : null}

      {hasOutgoing ? (
        <section className="vault-context-section">
          <Section title={VAULT_OUTGOING_LINKS} count={outgoing.length} />
          {outgoing.map((o, i) =>
            o.path ? (
              <button
                key={`p:${o.path}`}
                type="button"
                className="vault-mention vault-context-row press-fb press-fb--row"
                style={{ ['--i' as string]: Math.min(i, 12) }}
                onClick={() => onOpen(o.path!)}
              >
                <span className="vault-mention-title">{noteTitle(o.path)}</span>
              </button>
            ) : (
              <button
                key={`t:${o.target}`}
                type="button"
                className="vault-mention vault-context-row vault-outgoing-missing press-fb press-fb--row"
                style={{ ['--i' as string]: Math.min(i, 12) }}
                disabled={!onCreate}
                onClick={() => onCreate?.(o.target)}
              >
                <span className="vault-mention-title">{o.target}</span>
                <span className="vault-mention-excerpt">{VAULT_OUTGOING_MISSING}</span>
              </button>
            ),
          )}
        </section>
      ) : null}

      {hasUnlinked && unlinked ? (
        <section
          className="vault-context-section"
          aria-busy={unlinked.status === 'busy' || undefined}
        >
          <Section
            title={VAULT_UNLINKED_MENTIONS}
            count={unlinked.status === 'done' ? unlinked.rows.length : 0}
          />
          {unlinked.status === 'idle' ? (
            <button
              type="button"
              className="btn quiet press-fb vault-unlinked-find"
              onClick={onFindUnlinked}
            >
              {VAULT_FIND_UNLINKED}
            </button>
          ) : unlinked.status === 'busy' ? (
            <p className="hint" role="status" style={{ margin: '6px 0 0' }}>
              {vaultUnlinkedBusy(unlinked.reading)}
            </p>
          ) : (
            <>
              {unlinked.error ? (
                <p
                  className="hint"
                  role="status"
                  style={{ margin: '6px 0 0', color: 'var(--warn)' }}
                >
                  {unlinked.error}
                </p>
              ) : null}
              {unlinked.rows.length === 0 && !unlinked.error ? (
                <p className="hint" role="status" style={{ margin: '6px 0 0' }}>
                  {vaultUnlinkedNone(title ?? '')}
                </p>
              ) : null}
              {unlinked.rows.map((r, i) => (
                <div
                  key={r.path}
                  className="vault-unlinked-row vault-context-row"
                  style={{ ['--i' as string]: Math.min(i, 12) }}
                >
                  <button
                    type="button"
                    className="vault-mention vault-unlinked-open press-fb press-fb--row"
                    onClick={() => onOpen(r.path)}
                  >
                    <span className="vault-mention-title">{noteTitle(r.path)}</span>
                    <span className="vault-mention-excerpt">{r.excerpt}</span>
                  </button>
                  {onLink ? (
                    <button
                      type="button"
                      className="btn quiet press-fb vault-unlinked-link"
                      aria-label={vaultLinkMentionAria(title ?? '', noteTitle(r.path))}
                      disabled={linking?.has(r.path)}
                      onClick={() => onLink(r)}
                    >
                      {VAULT_LINK_BUTTON}
                    </button>
                  ) : null}
                </div>
              ))}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
