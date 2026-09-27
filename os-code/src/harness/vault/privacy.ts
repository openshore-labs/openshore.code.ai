// Vault privacy, decided once for every reader (Vault M4, CTO I3 to I5). The
// vault tools, the context pack and the loop all ask the same compiled rules
// which notes are hidden and which stay on this computer, so a rule cannot
// hold in one place and leak in another. Pure: no glob package (the purity
// guard allows none), no Node built-in, no clock.
//
// WAVE 0: the contracts. `oscodeMarks` and `withholdLocalOnly` are built (the
// index and the loop code against them); `compileVaultPrivacy` is a typed stub
// that stream A builds. It throws rather than answer "open", so nothing can
// ship on a stub that lets a private note through.
import type { ChatMessage } from '../../providers/types.js';
import type {
  Frontmatter,
  FmValue,
  OscodeMark,
  VaultPrivacy,
  VaultPrivacyConfig,
  VaultPrivacyNarrowing,
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
 * NOT BUILT (wave 0 stub; stream A builds it). Throws.
 */
export function compileVaultPrivacy(
  cfg: VaultPrivacyConfig,
  narrowing?: VaultPrivacyNarrowing,
): VaultPrivacy {
  void cfg;
  void narrowing;
  throw new Error('compileVaultPrivacy: not built');
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
