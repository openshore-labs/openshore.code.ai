// Obsidian markdown helpers for the reading view and the editor (Vault M6,
// CTO K10, K11, K15): callout heads, hidden `%%comments%%` (masked with
// spaces, every line break kept, so offsets and line numbers hold), a
// heading's section and a block anchor's range for embeds and scroll-to, GFM
// tasks and their write-back toggle (skipped ranges respected), and unlinked
// mentions. All on text, so code is never touched.
//
// Wave 0 stub: the signatures are the contract; stream A2 builds the bodies.
// Pure and import-free past the vault core.

import type {
  CalloutHead,
  TaskToggleResult,
  TextRange,
  UnlinkedMention,
  VaultTask,
} from './types.js';

function notBuilt(name: string): never {
  throw new Error(`not built: ${name} (Vault M6, stream A2)`);
}

/** The callout head on a blockquote's first line, or null. */
export function parseCallout(_line: string): CalloutHead | null {
  return notBuilt('parseCallout');
}

/** `text` with every `%%comment%%` replaced by spaces, line breaks kept, so
 *  the result is the same length. */
export function maskComments(_text: string): string {
  return notBuilt('maskComments');
}

/** The range of the section under the first heading whose text is `heading`
 *  (to the next heading of the same or a higher level), or null. */
export function sectionOf(_text: string, _heading: string): TextRange | null {
  return notBuilt('sectionOf');
}

/** The range of the block that carries `^id`, or null. */
export function blockAnchorAt(_text: string, _id: string): TextRange | null {
  return notBuilt('blockAnchorAt');
}

/** Every GFM task in the note, frontmatter lines counted, skipped ranges
 *  (code, math, comments) left out. */
export function listTasks(_text: string): VaultTask[] {
  return notBuilt('listTasks');
}

/** Tick or untick the task whose status sits at `at`, only while it is still
 *  `expected`: `[ ]` to `[x]`, `[x]` or `[X]` to `[ ]`. */
export function toggleTaskAt(_text: string, _at: number, _expected: string): TaskToggleResult {
  return notBuilt('toggleTaskAt');
}

/** Whole-word, case-insensitive matches of `names` outside links, code and
 *  frontmatter. */
export function findUnlinkedMentions(_text: string, _names: readonly string[]): UnlinkedMention[] {
  return notBuilt('findUnlinkedMentions');
}
