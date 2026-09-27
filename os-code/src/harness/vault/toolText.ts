// The vault tools' descriptions (Vault M5, CTO J10), pure, so the engine's
// tools (core/tools/vaultFind.ts) and the app's seats (app/src/lib/vaultTool.ts)
// teach the same order: search, then read one section, then follow links.
//
// WAVE 0 CONTRACT. The read tools' text is the engine's current wording,
// verbatim, so switching vaultFind.ts to import it changes nothing a model
// sees; stream A owns any rewording. `vaultPropose` is the app's always-ask
// write (J10, D4).

/** The vault tools whose text is shared across hosts. */
export type VaultToolName =
  'vaultSearch' | 'vaultRead' | 'vaultBacklinks' | 'vaultLookup' | 'vaultPropose';

/** Every shared vault tool's description, by name. */
export const VAULT_TOOL_TEXT: Readonly<Record<VaultToolName, string>> = {
  vaultSearch:
    "Search the user's vault first, before reading or writing notes. Returns ranked notes, each with the heading where the words fall and a short snippet. Then read the best one with vaultRead, only the section you need, and follow its links.",
  vaultRead:
    "Read a note from the user's vault. Takes a path, a bare note name (resolved the way [[wikilinks]] are, into any folder), or an alias. Opens with a header (properties, tags, and the note's links, resolved or not), so you can follow a link by reading its target. A long note returns its outline; then read one section. If you do not know the name, use vaultSearch first.",
  vaultBacklinks:
    "The notes in the user's vault that link to a note, each with the passage around its link. Use it to find what builds on a note, decisions that cite it, and older notes that disagree with it.",
  vaultLookup:
    "Find and read the user's vault notes. First search with query to get ranked notes and snippets; then read one with path (add section for one part). A note's header lists its links: read a link's target the same way.",
  vaultPropose:
    "Propose a note for the user's vault: create a new note at path, or append to an existing one. Nothing is written yet: every proposal is queued and shown to the user, who approves or declines them together at the end of your reply. Search first, so you add to a note rather than duplicate it.",
};

/** One shared tool's description. */
export function vaultToolText(name: VaultToolName): string {
  return VAULT_TOOL_TEXT[name];
}
