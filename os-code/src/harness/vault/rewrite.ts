// Link rewriting on a rename or move (Vault M3, CTO H4). Every link in a note
// that resolved to the old path, in the body and in frontmatter, is changed to
// reach the new path. Only the target portion is spliced, so a subpath
// (`#Heading`, `#^block`), an alias (`|shown`) and an embed's `!` are kept
// byte for byte, and every other byte of the note is untouched.
//
// Pure and import-free past the vault core.

import { noteFolder } from './paths.js';
import { buildPathIndex, linkTextFor, resolveMarkdownPath, resolveWikilink } from './resolve.js';
import { scanNote } from './scan.js';
import type { LinkToken, RewriteResult, VaultPathIndex } from './types.js';

function toIndex(p: readonly string[] | VaultPathIndex): VaultPathIndex {
  return Array.isArray(p) ? buildPathIndex(p as readonly string[]) : (p as VaultPathIndex);
}

/** `to` relative to the folder `from`, with `..` where it climbs. */
function relativePath(fromFolder: string, to: string): string {
  const a = fromFolder ? fromFolder.split('/') : [];
  const b = to.split('/');
  let k = 0;
  while (k < a.length && k < b.length - 1 && a[k] === b[k]) k++;
  return [...a.slice(k).map(() => '..'), ...b.slice(k)].join('/');
}

/** A markdown destination written the way Obsidian writes one: spaces and
 *  the characters that would end the link percent-encoded, `#` too, since a
 *  bare one starts a heading (`C# notes.md` is `C%23%20notes.md`), as
 *  move.ts writes it. */
function encodeDestination(path: string): string {
  return encodeURI(path).replace(/[()#]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** The new target text for one link, or undefined to leave it alone. */
function replacementFor(
  text: string,
  link: LinkToken,
  sourcePath: string,
  to: string,
  after: VaultPathIndex,
): string | undefined {
  if (link.kind === 'wiki') {
    return linkTextFor(to, sourcePath, after) ?? to.replace(/\.md$/i, '');
  }
  let rel = relativePath(noteFolder(sourcePath), to);
  if (!/\.md$/i.test(link.target)) rel = rel.replace(/\.md$/i, '');
  const angled = text[link.targetStart - 1] === '<';
  return angled ? rel : encodeDestination(rel);
}

/** Rewrite every link in `text` (a note at `sourcePath`) that resolved to
 *  `from` against `before`, so it reaches `to` against `after`. `before` and
 *  `after` are the vault's paths (or path indexes) either side of the move.
 *  `count` is how many links changed; the text is returned as is when none
 *  did. */
export function rewriteLinks(
  text: string,
  sourcePath: string,
  from: string,
  to: string,
  before: readonly string[] | VaultPathIndex,
  after: readonly string[] | VaultPathIndex,
): RewriteResult {
  const beforeIndex = toIndex(before);
  const afterIndex = toIndex(after);
  const edits: Array<{ start: number; end: number; value: string }> = [];
  for (const link of scanNote(text).links) {
    if (!link.target || link.attachment) continue;
    const resolved =
      link.kind === 'wiki'
        ? resolveWikilink(link.target, beforeIndex, sourcePath)
        : resolveMarkdownPath(link.target, sourcePath, beforeIndex);
    if (resolved !== from) continue;
    const value = replacementFor(text, link, sourcePath, to, afterIndex);
    if (value === undefined) continue;
    // A frontmatter value may sit inside YAML quotes; a quote in the new name
    // would end the string, so such a link is left for the person.
    if (link.where === 'frontmatter' && /["']/.test(value)) continue;
    if (text.slice(link.targetStart, link.targetEnd) === value) continue;
    edits.push({ start: link.targetStart, end: link.targetEnd, value });
  }
  if (!edits.length) return { text, count: 0 };
  let out = text;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.value + out.slice(e.end);
  }
  return { text: out, count: edits.length };
}
