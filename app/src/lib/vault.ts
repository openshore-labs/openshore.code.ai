// Vault: an Obsidian-compatible markdown knowledge base, built as the first
// consumer of the gitOS storage seam. Notes are plain .md files addressed by
// real relative paths, so the same tree opens unchanged in Obsidian the day a
// file-backed provider holds it. Wikilinks use Obsidian's own [[target]] and
// [[target|alias]] grammar; backlinks are derived by scanning, never stored,
// so the files stay the single source of truth.
import type { StoredFileMeta } from './gitos/providers.js';

export interface WikiLink {
  /** The link target as written, before .md resolution (e.g. "Ideas/Vault"). */
  target: string;
  /** Display alias when written as [[target|alias]]. */
  alias?: string;
}

/** Obsidian's wikilink grammar: [[target]] or [[target|alias]]. Embeds
 *  (![[...]]) and heading/block refs (#, ^) are tolerated by stripping the
 *  suffix so a link to [[Note#Heading]] still resolves to the note. */
const WIKILINK = /\[\[([^\][|#^\n]+)(?:[#^][^\][|\n]*)?(?:\|([^\][\n]+))?\]\]/g;

export function parseWikilinks(text: string): WikiLink[] {
  const links: WikiLink[] = [];
  for (const m of text.matchAll(WIKILINK)) {
    const target = m[1]!.trim();
    if (!target) continue;
    links.push({ target, alias: m[2]?.trim() || undefined });
  }
  return links;
}

/** Autocomplete context for a "[[" being typed: given the editor text and the
 *  caret offset, return the index of the "[[" and the raw query typed since it,
 *  or null when the caret is not inside an open, single-line, pre-alias
 *  wikilink. The editor offers note matches for the query and, on a pick,
 *  replaces from `start`. Cancels once the pair is closed (]]), a new line
 *  starts, or the alias half begins (|), matching Obsidian, which suggests the
 *  target and leaves the alias alone. */
export function wikilinkContext(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, Math.max(0, caret));
  const open = before.lastIndexOf('[[');
  if (open === -1) return null;
  const between = before.slice(open + 2);
  if (/[\]\n|]/.test(between)) return null;
  return { start: open, query: between };
}

/** A note's display title: its filename without the .md extension, exactly
 *  how Obsidian titles a note. */
export function noteTitle(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.md$/i, '');
}

/** The folder a note lives in, '' at the vault root. */
export function noteFolder(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** Normalize a user-typed note name or path into a vault-relative .md path:
 *  strips leading/trailing slashes and whitespace, collapses separators, and
 *  appends .md when absent. Returns undefined for an empty result. Dot and
 *  dot-dot segments are dropped so a typed name or a wikilink can never climb
 *  out of the vault root and clobber a sibling resource (SEC: path jail). */
export function normalizeNotePath(raw: string): string | undefined {
  const cleaned = raw
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
  if (!cleaned) return undefined;
  return /\.md$/i.test(cleaned) ? cleaned : `${cleaned}.md`;
}

/** Resolve a wikilink target against the vault's file list, the way Obsidian
 *  does: an exact path match first, then a unique filename match anywhere in
 *  the vault. Returns the matched path, or undefined when the note does not
 *  exist yet (an unresolved link, shown dashed and created on tap). */
export function resolveWikilink(target: string, paths: string[]): string | undefined {
  const want = normalizeNotePath(target);
  if (!want) return undefined;
  const lower = want.toLowerCase();
  const exact = paths.find((p) => p.toLowerCase() === lower);
  if (exact) return exact;
  // Obsidian resolves a bare name to the note of that name anywhere in the
  // vault; on ambiguity it prefers the shortest path, so we do too.
  const base = lower.split('/').pop()!;
  const byName = paths
    .filter((p) => p.toLowerCase().split('/').pop() === base)
    .sort((a, b) => a.length - b.length);
  return byName[0];
}

/** Backlinks: every note whose body links to `path`, with a one-line excerpt
 *  around the first mention. Derived on demand from bodies; nothing stored. */
export function backlinksTo(
  path: string,
  notes: Array<{ path: string; text: string }>,
): Array<{ path: string; excerpt: string }> {
  const title = noteTitle(path).toLowerCase();
  const full = path.replace(/\.md$/i, '').toLowerCase();
  const out: Array<{ path: string; excerpt: string }> = [];
  for (const note of notes) {
    if (note.path === path) continue;
    const links = parseWikilinks(note.text);
    const hit = links.find((l) => {
      const t = l.target.replace(/\.md$/i, '').toLowerCase();
      return t === full || t === title || t.split('/').pop() === title;
    });
    if (!hit) continue;
    const idx = note.text.toLowerCase().indexOf('[[');
    const start = Math.max(0, idx - 40);
    const excerpt = note.text
      .slice(start, idx + 80)
      .replace(/\n+/g, ' ')
      .trim();
    out.push({ path: note.path, excerpt });
  }
  return out;
}

/** Rewrite wikilinks into standard markdown links carrying a vault: scheme,
 *  so the existing react-markdown renderer emits real anchors the Vault
 *  screen intercepts. Unresolved targets still get a link (they open as a
 *  fresh note), flagged with a query so the UI can style them dashed. */
export function wikilinksToMarkdown(text: string, paths: string[]): string {
  return text.replace(WIKILINK, (_m, rawTarget: string, rawAlias?: string) => {
    const target = rawTarget.trim();
    const alias = rawAlias?.trim();
    const resolved = resolveWikilink(target, paths);
    const dest = resolved ?? normalizeNotePath(target) ?? target;
    const flag = resolved ? '' : '?new';
    return `[${alias || target}](vault:${encodeURIComponent(dest)}${flag})`;
  });
}

/** The folder tree, computed from flat paths: top-level entries first
 *  (folders sorted before notes, both alphabetical), one level at a time so
 *  the UI can lazily disclose. */
export interface TreeEntry {
  kind: 'folder' | 'note';
  /** Folder path or note path, vault-relative. */
  path: string;
  name: string;
}

export function treeAt(folder: string, files: StoredFileMeta[]): TreeEntry[] {
  const prefix = folder ? `${folder}/` : '';
  const folders = new Set<string>();
  const notes: TreeEntry[] = [];
  for (const f of files) {
    if (!f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) {
      notes.push({ kind: 'note', path: f.path, name: noteTitle(f.path) });
    } else {
      folders.add(rest.slice(0, slash));
    }
  }
  const folderEntries: TreeEntry[] = [...folders]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ kind: 'folder', path: prefix + name, name }));
  notes.sort((a, b) => a.name.localeCompare(b.name));
  return [...folderEntries, ...notes];
}
