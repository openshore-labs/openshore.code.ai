// Vault: an Obsidian-compatible markdown knowledge base, built as the first
// consumer of the gitOS storage seam. Notes are plain .md files addressed by
// real relative paths, so the same tree opens unchanged in Obsidian the day a
// file-backed provider holds it. Wikilinks use Obsidian's own [[target]] and
// [[target|alias]] grammar; backlinks are derived from the files (scanned
// here for a small vault, or kept by the index in vaultIndexHost.ts, which is
// rebuilt from them), so the files stay the single source of truth.
import {
  buildPathIndex,
  eolOf,
  excerptAt,
  noteFolder as folderOf,
  noteTitle,
  resolveWikilink as resolveInIndex,
  scanNote,
  type VaultPathIndex,
  type VaultTreeSort,
} from 'os-code/protocol';
import type { StoredFileMeta } from './gitos/providers.js';

// The pure path and link rules are the shared core's (Vault M3, tech review H4), so
// the app, the engine's vault tools and the desktop's main process can never
// disagree about what a note name is or where a link lands. Every name this
// module exported before stays exported.
export {
  isConflictCopy,
  nonNoteExtension,
  normalizeNotePath,
  noteFolder,
  noteTitle,
  wikilinkContext,
} from 'os-code/protocol';

export interface WikiLink {
  /** The link target as written, before .md resolution (e.g. "Ideas/Vault"). */
  target: string;
  /** Display alias when written as [[target|alias]]. */
  alias?: string;
}

/** Every wikilink in a note, in the order written: body links and the ones
 *  inside frontmatter values, as Obsidian counts them. Built on the core's
 *  scanner, so a link inside a code fence, a code span, math or a comment is
 *  not a link. A link to the note itself (`[[#Heading]]`) has no target and
 *  is left out. */
export function parseWikilinks(text: string): WikiLink[] {
  const links: WikiLink[] = [];
  for (const l of scanNote(text).links) {
    if (l.kind !== 'wiki') continue;
    const target = l.target.trim();
    if (!target) continue;
    const alias = l.alias?.trim();
    links.push(alias ? { target, alias } : { target });
  }
  return links;
}

/** One path index per path array, so a render that resolves every link in a
 *  note against the same list builds the lookup once. Keyed by the array
 *  itself (a WeakMap), so a new list is a new index and an old one is let
 *  go with its array. */
const PATH_INDEXES = new WeakMap<readonly string[], VaultPathIndex>();

export function pathIndexOf(paths: readonly string[]): VaultPathIndex {
  let idx = PATH_INDEXES.get(paths);
  if (!idx) {
    idx = buildPathIndex(paths);
    PATH_INDEXES.set(paths, idx);
  }
  return idx;
}

/** Resolve a wikilink target against the vault's file list, in the core's
 *  pinned order: an exact path, then relative to `sourcePath`'s folder, then
 *  a whole-segment suffix match, then the cleaned name. Undefined when the
 *  note does not exist yet (an unresolved link, shown dashed and created on
 *  tap). The attachment rule is for creating only: [[package.json]] still
 *  resolves to an existing "package.json.md". */
export function resolveWikilink(
  target: string,
  paths: readonly string[],
  sourcePath?: string,
): string | undefined {
  return resolveInIndex(target, pathIndexOf(paths), sourcePath) ?? undefined;
}

/** Backlinks: every note whose text links to `path`, with a short excerpt
 *  around the first link that lands there. Derived on demand from bodies,
 *  nothing stored. The small-vault fallback and Project Memory's path: a
 *  vault with an index asks the index instead. Links are found by the core's
 *  scanner, so one inside code never counts, and each resolves from its own
 *  note, so a relative link is credited to the right note. */
export function backlinksTo(
  path: string,
  notes: Array<{ path: string; text: string }>,
): Array<{ path: string; excerpt: string }> {
  const paths = notes.map((n) => n.path);
  const idx = buildPathIndex(paths);
  const out: Array<{ path: string; excerpt: string }> = [];
  for (const note of notes) {
    if (note.path === path) continue;
    const hit = scanNote(note.text).links.find((l) => {
      if (l.kind !== 'wiki' || !l.target.trim()) return false;
      return resolveInIndex(l.target, idx, note.path) === path;
    });
    if (!hit) continue;
    out.push({ path: note.path, excerpt: excerptAt(note.text, hit.start).text });
  }
  return out;
}

export interface NoteHit {
  path: string;
  /** Where the query matched: the title, or the body (with a short excerpt). */
  where: 'title' | 'body';
  excerpt?: string;
}

/**
 * Search notes by title and, when a body is on hand, by text. Title hits come
 * first, then body hits, each in path order, so a note named for the query is
 * never buried under notes that merely mention it. Case-insensitive; a blank
 * query matches nothing (the list shows the tree instead).
 */
export function searchNotes(
  query: string,
  paths: string[],
  bodies: ReadonlyMap<string, string> | Record<string, string> = new Map(),
): NoteHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const bodyOf = (path: string): string | undefined =>
    bodies instanceof Map ? bodies.get(path) : (bodies as Record<string, string>)[path];
  const titles: NoteHit[] = [];
  const texts: NoteHit[] = [];
  for (const path of paths) {
    if (noteTitle(path).toLowerCase().includes(q) || path.toLowerCase().includes(q)) {
      titles.push({ path, where: 'title' });
      continue;
    }
    const body = bodyOf(path);
    if (!body) continue;
    const at = body.toLowerCase().indexOf(q);
    if (at < 0) continue;
    const start = Math.max(0, at - 40);
    const end = Math.min(body.length, at + q.length + 60);
    const excerpt = `${start > 0 ? '...' : ''}${body.slice(start, end).replace(/\s+/g, ' ').trim()}${end < body.length ? '...' : ''}`;
    texts.push({ path, where: 'body', excerpt });
  }
  return [...titles, ...texts];
}

export interface TreeEntry {
  kind: 'folder' | 'note';
  /** Folder path or note path, vault-relative. */
  path: string;
  name: string;
}

/** The text to save for a note loaded as `loaded` and edited into `edited`,
 *  with its line endings as they were (Vault M3, tech review H2). A textarea turns
 *  every CRLF into LF, so a note that was all CRLF would otherwise come back
 *  with every line changed, frontmatter included. Only an all-CRLF note has
 *  them put back; an LF or mixed note saves as edited. The store's save path
 *  wraps its text in this (one line, wave 2). */
export function restoreEol(loaded: string, edited: string): string {
  if (eolOf(loaded) !== 'crlf' || eolOf(edited) === 'crlf') return edited;
  return edited.replace(/\r?\n/g, '\r\n');
}

/** A listed note with the creation time a storage may carry. No provider on
 *  main lists one yet, so `created` is not offered there (never faked). */
export type TreeFileMeta = StoredFileMeta & { createdAt?: string };

/** Whether the tree can sort by creation time here: every listed note
 *  carries one (Vault M7, tech review L2; an empty vault offers it only when the
 *  storage says so, which none does yet). */
export function vaultTreeSortOffered(files: readonly TreeFileMeta[]): VaultTreeSort[] {
  const created = files.length > 0 && files.every((f) => Boolean(timeOf(f.createdAt)));
  return created ? ['name', 'modified', 'created'] : ['name', 'modified'];
}

function timeOf(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

/** The folder tree, computed from flat paths: top-level entries first
 *  (folders sorted before notes, both alphabetical), one level at a time so
 *  the UI can lazily disclose. `sort` orders the notes (Vault M7, the
 *  vault's `tree.sort`): `name` (the default, as before), `modified` or
 *  `created`, newest first, a note without the time after those with it, by
 *  name. Folders stay by name in every order, as Obsidian keeps them. */
export function treeAt(
  folder: string,
  files: readonly TreeFileMeta[],
  extraFolders: readonly string[] = [],
  sort: VaultTreeSort = 'name',
): TreeEntry[] {
  const prefix = folder ? `${folder}/` : '';
  const folders = new Set<string>();
  const notes: Array<TreeEntry & { at?: number }> = [];
  // Folders no note implies (an empty one on the storage, or remembered
  // here, Vault M6 K5) still show at their level.
  for (const f of extraFolders) {
    if (!f.startsWith(prefix) || f.length <= prefix.length) continue;
    folders.add(f.slice(prefix.length).split('/')[0]!);
  }
  for (const f of files) {
    if (!f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) {
      const at =
        sort === 'modified'
          ? timeOf(f.updatedAt)
          : sort === 'created'
            ? timeOf(f.createdAt)
            : undefined;
      notes.push({
        kind: 'note',
        path: f.path,
        name: noteTitle(f.path),
        ...(at !== undefined ? { at } : {}),
      });
    } else {
      folders.add(rest.slice(0, slash));
    }
  }
  const folderEntries: TreeEntry[] = [...folders]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ kind: 'folder', path: prefix + name, name }));
  notes.sort((a, b) => {
    if (sort !== 'name') {
      if (a.at !== undefined && b.at !== undefined && a.at !== b.at) return b.at - a.at;
      if ((a.at === undefined) !== (b.at === undefined)) return a.at === undefined ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });
  return [
    ...folderEntries,
    ...notes.map(({ kind, path, name }): TreeEntry => ({ kind, path, name })),
  ];
}

/** Every folder in the vault: each note's parents and the extra folders
 *  (empty or remembered), sorted, the root left out. */
export function allFolders(
  files: readonly StoredFileMeta[],
  extra: readonly string[] = [],
): string[] {
  const out = new Set<string>();
  const add = (path: string) => {
    const parts = path.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/'));
  };
  for (const f of files) add(folderOf(f.path));
  for (const f of extra) add(f);
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** How many notes of one vault wait on this device to be saved (the save
 *  chip's count, Vault M2 2.2): stash entries for that storage and resource,
 *  team text only under the account signed in now, and never the note whose
 *  choice is open (its text waits on the person, not on the storage). */
export function vaultPendingCount(
  pending: ReadonlyArray<{ providerId: string; resourceId: string; owner?: string; path: string }>,
  target: { providerId: string; resourceId: string } | undefined,
  opts: { conflictPath?: string; uid?: string } = {},
): number {
  if (!target) return 0;
  return pending.filter(
    (e) =>
      e.providerId === target.providerId &&
      e.resourceId === target.resourceId &&
      (e.providerId !== 'org' || (e.owner !== undefined && e.owner === opts.uid)) &&
      e.path !== opts.conflictPath,
  ).length;
}

/** The longest note path the team vault takes, in characters: 0015's
 *  org_vault_path_ok counts char_length, which is code points. */
export const TEAM_PATH_MAX = 512;

// The tail of a name this app makes beside a note: a keep-both copy's
// " (conflict 2026-09-27 1405).md" (with its counter) or " (restored).md".
const MADE_NAME_TAIL = / \((?:conflict \d{4}-\d{2}-\d{2} \d{4}(?: \d+)?|restored(?: \d+)?)\)\.md$/i;

/** A name this app makes beside a note, fitted to `max` characters (round 7
 *  E43): the note's own name is shortened, its folder and the tail kept
 *  whole, so the copy stays beside the note and still reads as a copy (0021's
 *  own conflict names fit 512 the same way, but trim the whole path, which
 *  can cut into a folder). Unchanged when it fits, is not such a name, or
 *  when the folder and the tail alone leave no room; the storage then says
 *  why it is refused. */
export function fitMadeName(path: string, max: number): string {
  if ([...path].length <= max) return path;
  const tail = MADE_NAME_TAIL.exec(path)?.[0];
  if (!tail) return path;
  const head = path.slice(0, path.length - tail.length);
  const slash = head.lastIndexOf('/');
  const folder = head.slice(0, slash + 1);
  const room = max - [...folder].length - [...tail].length;
  if (room < 1) return path;
  const stem = [...head.slice(slash + 1)]
    .slice(0, room)
    .join('')
    .replace(/[\s.]+$/, '');
  return stem ? `${folder}${stem}${tail}` : path;
}

/** Why the team vault would refuse a note path, before it is sent: over 512
 *  characters ('long'), or a shape 0015's org_vault_path_ok refuses (blank,
 *  a leading "/", a backslash, an empty, "." or ".." folder, 'bad'). */
export function teamPathProblem(path: string): 'long' | 'bad' | undefined {
  if (!path.trim() || path.startsWith('/') || path.includes('\\')) return 'bad';
  if (path.split('/').some((x) => x === '' || x === '.' || x === '..')) return 'bad';
  return [...path].length > TEAM_PATH_MAX ? 'long' : undefined;
}
