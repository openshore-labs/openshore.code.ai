// Link rewrites for a set of moves (Vault M6, CTO K4 with R1): a pure plan the
// host applies one compare-and-swap write at a time. For each link, the note
// it should reach is where its target went (`moves`), or where it already was.
// A link is spliced only when its resolution from the source's new path
// against `after` would differ from that note, so every other byte stays
// (aliases, `#Heading`, `#^block`, the `!` kept, as H4). That one rule covers
// the three cases the host reads sources for: links to a moved note, a moved
// note's own relative links, and collateral links whose resolution a moved
// note's new name would steal. Attachments are in `moves` for a folder move,
// so `![](img.png)` and `![[img.png]]` from outside the folder follow too.
// `rewriteLinks` (rewrite.ts) stays as the one-move wrapper.
//
// Pure and import-free past the vault core.

import { attachmentLinkText, attachmentMime, resolveAttachment } from './attachments.js';
import { noteFolder } from './paths.js';
import { linkTextFor, resolveMarkdownPath, resolveWikilink } from './resolve.js';
import { scanNote } from './scan.js';
import type {
  AttachmentFolderSetting,
  LinkRewriteLeftReason,
  LinkRewritePlan,
  LinkRewriteSource,
  LinkToken,
  MoveSourcePaths,
  RewriteResult,
  VaultPathIndex,
} from './types.js';

/** The exact paths of an index, as a set, built once per index. */
const PATH_SETS = new WeakMap<VaultPathIndex, Set<string>>();

function hasPath(index: VaultPathIndex, path: string): boolean {
  let set = PATH_SETS.get(index);
  if (!set) {
    set = new Set(index.paths);
    PATH_SETS.set(index, set);
  }
  return set.has(path);
}

/** `to` relative to the folder `fromFolder`, with `..` where it climbs. */
function relativePath(fromFolder: string, to: string): string {
  const a = fromFolder ? fromFolder.split('/') : [];
  const b = to.split('/');
  let k = 0;
  while (k < a.length && k < b.length - 1 && a[k] === b[k]) k++;
  return [...a.slice(k).map(() => '..'), ...b.slice(k)].join('/');
}

/** A markdown destination written the way Obsidian writes one: spaces and
 *  the characters that would end the link or start a subpath
 *  percent-encoded. */
function encodeDestination(path: string): string {
  return encodeURI(path).replace(/[()#]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Does this link name an attachment rather than a note? */
function isAttachmentLink(link: LinkToken): boolean {
  return link.kind === 'md' ? !!link.attachment : attachmentMime(link.target) !== undefined;
}

/** Where `link`, written in a note at `source`, resolves against `index`. */
function resolveLink(
  link: LinkToken,
  source: string,
  index: VaultPathIndex,
  setting: AttachmentFolderSetting | undefined,
): string | undefined {
  if (isAttachmentLink(link)) return resolveAttachment(link.target, source, index, setting);
  return link.kind === 'wiki'
    ? resolveWikilink(link.target, index, source)
    : resolveMarkdownPath(link.target, source, index);
}

/** The new target text that makes `link` reach `want` from `source`, or
 *  undefined when none does. */
function replacementFor(
  text: string,
  link: LinkToken,
  source: string,
  want: string,
  after: VaultPathIndex,
  setting: AttachmentFolderSetting | undefined,
): string | undefined {
  const attachment = isAttachmentLink(link);
  if (link.kind === 'wiki') {
    if (attachment) return attachmentLinkText(want, source, after, setting);
    const short = linkTextFor(want, source, after);
    if (short === undefined) return undefined;
    // Keep a written `.md` when it still reaches the note.
    if (/\.md$/i.test(link.target) && resolveWikilink(`${short}.md`, after, source) === want) {
      return `${short}.md`;
    }
    return short;
  }
  const angled = text[link.targetStart - 1] === '<';
  const keepMd = attachment || /\.md$/i.test(link.target);
  const tries = [relativePath(noteFolder(source), want), want];
  for (const raw of tries) {
    const path = keepMd ? raw : raw.replace(/\.md$/i, '');
    const lands = attachment
      ? resolveAttachment(path, source, after, setting)
      : resolveMarkdownPath(path, source, after);
    if (lands !== want) continue;
    if (angled) return /[<>\n\r]/.test(path) ? undefined : path;
    return encodeDestination(path);
  }
  return undefined;
}

interface Rewritten extends RewriteResult {
  left: LinkRewriteLeftReason[];
}

function rewriteOne(
  text: string,
  source: MoveSourcePaths,
  moves: ReadonlyMap<string, string>,
  before: VaultPathIndex,
  after: VaultPathIndex,
  setting: AttachmentFolderSetting | undefined,
): Rewritten {
  const edits: Array<{ start: number; end: number; value: string }> = [];
  const left: LinkRewriteLeftReason[] = [];
  for (const link of scanNote(text).links) {
    if (!link.target) continue; // `[[#Heading]]` names the note itself
    const was = resolveLink(link, source.before, before, setting);
    if (was === undefined) continue; // unresolved before: nothing to keep
    const want = moves.get(was) ?? was;
    if (!hasPath(after, want)) continue; // gone, not moved: nothing to aim at
    if (resolveLink(link, source.after, after, setting) === want) continue;
    const value = replacementFor(text, link, source.after, want, after, setting);
    if (value === undefined) {
      left.push('ambiguous');
      continue;
    }
    // A frontmatter value may sit inside YAML quotes; a quote in the new name
    // would end the string, so such a link is left for the person.
    if (link.where === 'frontmatter' && /["']/.test(value)) {
      left.push('frontmatter-quote');
      continue;
    }
    if (text.slice(link.targetStart, link.targetEnd) === value) continue;
    edits.push({ start: link.targetStart, end: link.targetEnd, value });
  }
  if (!edits.length) return { text, count: 0, left };
  let out = text;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.value + out.slice(e.end);
  }
  return { text: out, count: edits.length, left };
}

/** Rewrite one note's links for every move in `moves` (old path to new).
 *  `source` is the note's own path before and after (the same when it did not
 *  move). `before` and `after` index the vault's notes and attachments either
 *  side of the moves; `attachmentFolder` is Obsidian's `attachmentFolderPath`
 *  when the host has it. The text comes back as is when nothing changed. */
export function rewriteForMoves(
  text: string,
  source: MoveSourcePaths,
  moves: ReadonlyMap<string, string>,
  before: VaultPathIndex,
  after: VaultPathIndex,
  attachmentFolder?: AttachmentFolderSetting,
): RewriteResult {
  const r = rewriteOne(text, source, moves, before, after, attachmentFolder);
  return { text: r.text, count: r.count };
}

/** Plan every rewrite the moves need over the sources the host read (from
 *  the index only: backlinks of every moved path, the moved notes, and
 *  backlinks of notes sharing a moved note's new basename key). A source may
 *  be named by its path before or after the moves; each edit names the path
 *  after them. A source listed twice is planned once. `links` and `notes`
 *  count what the edits change; `left` names each note with a link that
 *  could not be rewritten, once per reason. */
export function planLinkRewrites(
  moves: ReadonlyMap<string, string>,
  before: VaultPathIndex,
  after: VaultPathIndex,
  sources: ReadonlyArray<LinkRewriteSource>,
  attachmentFolder?: AttachmentFolderSetting,
): LinkRewritePlan {
  const inverse = new Map<string, string>();
  for (const [from, to] of moves) inverse.set(to, from);
  const plan: LinkRewritePlan = { edits: [], links: 0, notes: 0, left: [] };
  const done = new Set<string>();
  for (const src of sources) {
    const moved = moves.get(src.path);
    const paths: MoveSourcePaths =
      moved !== undefined
        ? { before: src.path, after: moved }
        : { before: inverse.get(src.path) ?? src.path, after: src.path };
    if (done.has(paths.after)) continue;
    done.add(paths.after);
    const r = rewriteOne(src.text, paths, moves, before, after, attachmentFolder);
    for (const reason of new Set(r.left)) plan.left.push({ path: paths.after, reason });
    if (!r.count) continue;
    plan.edits.push({ path: paths.after, base: src.version, text: r.text, count: r.count });
    plan.links += r.count;
    plan.notes += 1;
  }
  return plan;
}
