// A short passage around an offset (Vault M3, CTO H4), for Linked mentions and
// search: the index stores link offsets, never excerpts, and the host reads
// the linking note's body and cuts one here. Frontmatter never leaks into a
// body excerpt; an offset inside the frontmatter excerpts its own line.
//
// Pure and import-free past the vault core.

import { findFrontmatter } from './scan.js';
import type { VaultExcerpt } from './types.js';

/** Characters kept before and after the offset. */
export const EXCERPT_BEFORE = 40;
export const EXCERPT_AFTER = 80;

/** Step off the low half of a surrogate pair so a cut never splits one. */
function onBoundary(text: string, i: number, back: boolean): number {
  const c = text.charCodeAt(i);
  if (c >= 0xdc00 && c <= 0xdfff && i > 0) {
    const p = text.charCodeAt(i - 1);
    if (p >= 0xd800 && p <= 0xdbff) return back ? i - 1 : i + 1;
  }
  return i;
}

function lineAt(text: string, at: number): number {
  let n = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < at; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

/** The passage around `at`: about 40 characters before and 80 after, never
 *  reaching into the frontmatter, line breaks folded to spaces. */
export function excerptAt(text: string, at: number): VaultExcerpt {
  const pos = Math.max(0, Math.min(at, text.length));
  const fm = findFrontmatter(text);
  let lo: number;
  let hi: number;
  if (fm && pos < fm.end) {
    // A frontmatter link: its own line of the block.
    lo = text.lastIndexOf('\n', pos - 1) + 1;
    const nl = text.indexOf('\n', pos);
    hi = nl === -1 ? text.length : nl;
  } else {
    const floor = fm ? fm.end : text.charCodeAt(0) === 0xfeff ? 1 : 0;
    lo = Math.max(floor, pos - EXCERPT_BEFORE);
    hi = Math.min(text.length, pos + EXCERPT_AFTER);
  }
  const start = onBoundary(text, lo, false);
  const end = onBoundary(text, hi, true);
  return {
    start,
    end,
    text: text.slice(start, end).replace(/\s+/g, ' ').trim(),
    line: lineAt(text, pos),
  };
}
