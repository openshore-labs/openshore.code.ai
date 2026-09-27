// Vault privacy, decided once for every reader (Vault M4, CTO I3 to I5). The
// vault tools, the context pack and the loop all ask the same compiled rules
// which notes are hidden and which stay on this computer, so a rule cannot
// hold in one place and leak in another. Pure: no glob package (the purity
// guard allows none), no Node built-in, no clock.
//
import type { ChatMessage } from '../../providers/types.js';
import { foldPath } from './paths.js';
import type {
  Frontmatter,
  FmValue,
  OscodeMark,
  VaultPrivacy,
  VaultPrivacyConfig,
  VaultPrivacyNarrowing,
  VaultVisibility,
  VaultVisibilityInput,
} from './types.js';

const MARKS: ReadonlySet<string> = new Set<OscodeMark>(['pin', 'exclude', 'local-only']);

/**
 * A note's own `oscode:` marks from its frontmatter: the prop as a string (a
 * comma string too) or a list of strings, lowercased and trimmed, unknown
 * words dropped, each mark once in the order written.
 */
export function oscodeMarks(fm: Pick<Frontmatter, 'props'>): OscodeMark[] {
  const out: OscodeMark[] = [];
  const add = (v: FmValue): void => {
    if (typeof v !== 'string') return;
    for (const part of v.split(',')) {
      const word = part.trim().toLowerCase();
      if (MARKS.has(word) && !out.includes(word as OscodeMark)) out.push(word as OscodeMark);
    }
  };
  for (const prop of fm.props) {
    if (prop.key.toLowerCase() !== 'oscode') continue;
    if (Array.isArray(prop.value)) prop.value.forEach(add);
    else add(prop.value);
  }
  return out;
}

/**
 * Compile the machine's privacy config (plus, from M7, the vault's own
 * union-only narrowing) into one `visibility` judge. An exclude glob or an
 * `exclude` mark hides a note; otherwise a localOnly glob, a tag equal to or
 * under a listed one, or a `local-only` mark keeps it on this computer. A pin
 * never lifts either. Globs (`*`, `**`, `?`, a trailing `/`) match on the
 * folded path (`foldPath`), so `Private/` matches on any disk case.
 *
 * The narrowing is a union: it can add globs and tags, never take one away.
 */
export function compileVaultPrivacy(
  cfg: VaultPrivacyConfig,
  narrowing?: VaultPrivacyNarrowing,
): VaultPrivacy {
  const exclude = [...cfg.exclude, ...(narrowing?.exclude ?? [])]
    .map(compileVaultGlob)
    .filter(isMatcher);
  const localPaths = [...cfg.localOnly.paths, ...(narrowing?.localOnly?.paths ?? [])]
    .map(compileVaultGlob)
    .filter(isMatcher);
  const localTags = [...cfg.localOnly.tags, ...(narrowing?.localOnly?.tags ?? [])]
    .map(foldTag)
    .filter((t) => t !== '');
  return {
    visibility(note: VaultVisibilityInput): VaultVisibility {
      const path = foldNotePath(note.path);
      const marks = note.oscode ?? [];
      if (marks.includes('exclude') || exclude.some((m) => m(path))) return 'hidden';
      if (marks.includes('local-only') || localPaths.some((m) => m(path))) return 'local-only';
      for (const raw of note.tags ?? []) {
        const tag = foldTag(raw);
        if (tag && localTags.some((t) => tagIsUnder(tag, t))) return 'local-only';
      }
      return 'open';
    },
  };
}

/** May a seat see this note's text? A hidden note never; a local-only note
 *  only when the seat's requests stay on this network (judged by address,
 *  `leavesThisNetwork`, never by a label). */
export function visibleToSeat(visibility: VaultVisibility, leavesNetwork: boolean): boolean {
  if (visibility === 'hidden') return false;
  if (visibility === 'local-only') return !leavesNetwork;
  return true;
}

/** A compiled glob: true when it names the (folded) path or a folder above it. */
export type VaultGlobMatcher = (foldedPath: string) => boolean;

/**
 * One privacy glob, compiled. `*` matches within a segment, `**` across
 * segments (`a/**` and `**` + `/b` also match zero folders), `?` one
 * character within a segment. A pattern names a note or a folder: `Private`,
 * `Private/` and `Private/**` all cover every note under `Private`, and a
 * trailing `/` names a folder only. A leading `/` or `./` anchors at the vault
 * root, which every pattern already is. Matching folds case (NFC, lowercase),
 * so a pattern covers its folder on any disk. An empty pattern matches
 * nothing (null).
 */
export function compileVaultGlob(pattern: string): VaultGlobMatcher | null {
  let p = foldPath(pattern.trim()).replace(/\\/g, '/');
  p = p.replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  const folderOnly = p.endsWith('/');
  p = p.replace(/\/+$/, '').replace(/\/{2,}/g, '/');
  if (p === '') return null;
  const re = new RegExp(`^${globSource(p)}$`, 'u');
  return (path: string): boolean => {
    if (!folderOnly && re.test(path)) return true;
    // A folder above the note: every proper prefix that ends at a slash.
    for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) {
      if (re.test(path.slice(0, i))) return true;
    }
    return false;
  };
}

/** Does `glob` cover this vault path (either spelling, any case)? */
export function matchesVaultGlob(glob: string, path: string): boolean {
  const m = compileVaultGlob(glob);
  return m ? m(foldNotePath(path)) : false;
}

function isMatcher(m: VaultGlobMatcher | null): m is VaultGlobMatcher {
  return m !== null;
}

/** A glob (already folded, no leading or trailing slash) as regex source. */
function globSource(p: string): string {
  let out = '';
  let i = 0;
  while (i < p.length) {
    const c = p[i]!;
    if (c === '*' && p[i + 1] === '*') {
      let j = i + 2;
      while (p[j] === '*') j++;
      const before = i === 0 || p[i - 1] === '/';
      const after = j === p.length || p[j] === '/';
      if (before && after) {
        if (j === p.length) {
          // `a/**`: everything under a (the folder itself is its prefix).
          out += '.*';
          i = j;
        } else {
          // `**/`: zero or more whole folders.
          out += '(?:[^/]*/)*';
          i = j + 1;
        }
      } else {
        out += '.*';
        i = j;
      }
      continue;
    }
    if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    i++;
  }
  return out;
}

/** A note path as the judge compares it: folded, forward slashes, no leading
 *  slash. */
function foldNotePath(path: string): string {
  return foldPath(path).replace(/\\/g, '/').replace(/^\/+/, '');
}

/** A tag as the judge compares it: folded, no `#`, no stray slashes. */
function foldTag(tag: string): string {
  return tag
    .trim()
    .replace(/^#+/, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '');
}

/** `private` covers `private` and `private/diary`, never `privateer`. */
function tagIsUnder(tag: string, listed: string): boolean {
  return tag === listed || tag.startsWith(`${listed}/`);
}

/** What a seat that leaves this network sees in place of a local-only note's
 *  text already in the conversation. */
export const LOCAL_ONLY_STUB =
  '[A note from a folder that stays on this computer was read here. Its text is not sent to this model.]';

/**
 * The messages to send on a turn whose seat leaves this network: every
 * message marked `localOnly` has its content swapped for `LOCAL_ONLY_STUB`.
 * Returns new objects for the swapped messages and leaves the input (the kept
 * history) untouched, so a later local turn still has the note.
 */
export function withholdLocalOnly(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((m) => (m.localOnly ? { ...m, content: LOCAL_ONLY_STUB } : m));
}
