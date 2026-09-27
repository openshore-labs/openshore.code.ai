// Vault tools that find before they read (Vault M4, CTO I11; plan 4.5): search
// the vault by keyword, read a note by name, alias or heading and only the
// section that matters, and follow the links into a note. They run on the
// engine's per-root index (core/vault/engineIndex.ts), so a session reaches
// only its own vault root, and every answer honors the person's privacy
// rules (CTO I5): an excluded note is absent, and a local-only note's text
// reaches only a seat whose requests stay on this network, carrying the
// `localOnly` flag so a later cloud turn sends a stub in its place.
//
// The descriptions come from the pure harness/vault/toolText.ts (Vault M5, CTO
// J10), so the app's seats teach the same order: search, a section, links.
//
// This file also holds the note-path helpers vault.ts shares, so the two never
// import each other.
import { existsSync, statSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ensureVaultRoot } from '../../config/load.js';
import { excerptAt } from '../../harness/vault/excerpt.js';
import { VAULT_TOOL_TEXT } from '../../harness/vault/toolText.js';
import { readFrontmatter } from '../../harness/vault/frontmatter.js';
import { compareCodePoints, type VaultIndex } from '../../harness/vault/index.js';
import { foldPath, isNotePath, normalizeNotePath } from '../../harness/vault/paths.js';
import { oscodeMarks } from '../../harness/vault/privacy.js';
import {
  buildPathIndex,
  resolveMarkdownLink,
  resolveWikilink,
} from '../../harness/vault/resolve.js';
import { scanNote } from '../../harness/vault/scan.js';
import { queryTerms } from '../../harness/vault/tokenize.js';
import type {
  NoteScan,
  OscodeMark,
  VaultPathIndex,
  VaultVisibility,
} from '../../harness/vault/types.js';
import { Jail } from '../security/jail.js';
import { engineVaultIndex } from '../vault/engineIndex.js';
import { capContent, type ToolContext, type ToolDef, type ToolOutput } from './index.js';

// ---------------------------------------------------------------------------
// Note paths (shared with vault.ts)

/** The vault root for this session, as a jail so a note path can never escape
 *  it (symlinks included). The default folder is made on first use; a
 *  configured one that went missing is never recreated (ensureVaultRoot). */
export function vaultJail(ctx: ToolContext): Jail {
  if (!ctx.vaultRoot) throw new Error('The vault is not configured for this session.');
  return new Jail(ensureVaultRoot(ctx.vaultRoot));
}

/** A typed note name in its plain spelling: trimmed, backslashes and runs of
 *  "/" collapsed to one separator, .md appended when absent. Nothing is
 *  stripped, so an existing note keeps any name the file system gave it
 *  ("Decision: auth?.md" still reads and updates). A dot-led segment is
 *  refused, the seam's own note rule (isNotePath): the vault and Obsidian hide
 *  dot names, so a ".NET migration.md" would land where no surface lists it,
 *  and vaultRead, sharing this helper, stays out of .obsidian/ (0.6). */
export function plainNotePath(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/');
  if (!cleaned) throw new Error('Give the note a name.');
  const rel = /\.md$/i.test(cleaned) ? cleaned : `${cleaned}.md`;
  if (!isNotePath(rel)) {
    const use = normalizeNotePath(rel);
    throw new Error(
      `Note names cannot start with a dot; the vault and Obsidian hide them.${use ? ` Use "${use}".` : ''}`,
    );
  }
  return rel;
}

/** The normalized note path for permission matching; a bad name is undefined
 *  (pathOf never throws), and execute reports the real error. A `#heading`
 *  on the name is left off, so a rule on the note still matches. */
export function notePathOrUndefined(raw: string): string | undefined {
  try {
    return plainNotePath(raw);
  } catch {
    return undefined;
  }
}

/** The note in the vault that `rel` names by fold (NFC, then lowercase) but
 *  not byte for byte, walking segment by segment, or undefined. A case-
 *  sensitive disk would otherwise hold "plan.md" beside "Plan.md", two files
 *  the app and Obsidian treat as one note. It is only ever named back to the
 *  model, never written or read in the typed path's place, so a permission
 *  rule on the typed path cannot be stepped around. */
export async function foldTwin(root: string, rel: string): Promise<string | undefined> {
  const out: string[] = [];
  let dir = root;
  for (const want of rel.split('/')) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return undefined;
    }
    const folded = foldPath(want);
    const hit = names.includes(want)
      ? want
      : names
          .filter((n) => !n.startsWith('.') && foldPath(n) === folded)
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];
    if (hit === undefined) return undefined;
    out.push(hit);
    dir = join(dir, hit);
  }
  const twin = out.join('/');
  if (twin === rel) return undefined;
  const info = await stat(dir).catch(() => undefined);
  return info?.isFile() ? twin : undefined;
}

/** Whether the person's permission rules close a vault path to the agent: a
 *  deny on reading it or on listing it. A folder is asked as "folder/", so a
 *  "Private/**" rule covers the folder itself (Vault v1, 1.6). */
export function closed(ctx: ToolContext, path: string): boolean {
  return Boolean(ctx.denies?.('vaultRead', path) || ctx.denies?.('vaultList', path));
}

// ---------------------------------------------------------------------------
// Privacy (CTO I4, I5)

/** Read the vault's own settings again before a vault tool runs (Vault M7,
 *  CTO L5): the privacy the call is judged by then holds the union with the
 *  vault's file. Kept 2 s by the holder, so a burst of calls reads once. */
export async function refreshVault(ctx: ToolContext): Promise<void> {
  try {
    await ctx.vaultRefresh?.();
  } catch {
    // The holder keeps its last good settings.
  }
}

/** Whether the seat answering now sends its requests off this network.
 *  Unset reads as leaving, the safe reading. */
export function seatLeaves(ctx: ToolContext): boolean {
  return ctx.seatLeavesNetwork ? ctx.seatLeavesNetwork() : true;
}

/** A note's visibility from what is known of it (its path always; its tags
 *  and marks when the index or its text has them). No rules: open. */
export function visibilityOf(
  ctx: ToolContext,
  path: string,
  known?: { tags?: readonly string[]; oscode?: readonly OscodeMark[] },
): VaultVisibility {
  if (!ctx.vaultPrivacy) return 'open';
  return ctx.vaultPrivacy.visibility({
    path,
    ...(known?.tags ? { tags: known.tags } : {}),
    ...(known?.oscode ? { oscode: known.oscode } : {}),
  });
}

/** A note's tags and marks from its own text, the way the index builds them
 *  (frontmatter tags and inline tags, lowercased once each). */
export function knownFromText(
  text: string,
  scan: NoteScan = scanNote(text),
): { tags: string[]; oscode: OscodeMark[] } {
  const fm = readFrontmatter(text);
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const t of [...fm.tags, ...scan.tags.map((x) => x.tag)]) {
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    tags.push(t);
  }
  return { tags, oscode: oscodeMarks(fm) };
}

/** The visibility of a note judged by its own text, and by the index entry
 *  too when there is one (the stricter of the two wins). */
function visibilityOfText(
  ctx: ToolContext,
  path: string,
  text: string,
  scan: NoteScan,
  index: VaultIndex | null,
): VaultVisibility {
  const fromText = visibilityOf(ctx, path, knownFromText(text, scan));
  const e = index?.entry(path);
  const fromIndex = e ? visibilityOf(ctx, path, e) : 'open';
  return stricter(fromText, fromIndex);
}

const RANK: Record<VaultVisibility, number> = { open: 0, 'local-only': 1, hidden: 2 };
function stricter(a: VaultVisibility, b: VaultVisibility): VaultVisibility {
  return RANK[a] >= RANK[b] ? a : b;
}

/** How one note may be shown to the seat answering now: `absent` (hidden, or
 *  closed by a deny rule), `withheld` (local-only on a seat that leaves), or
 *  shown, flagged when it is local-only. */
type Showing = 'absent' | 'withheld' | 'shown' | 'shown-local';

function showing(ctx: ToolContext, path: string, vis: VaultVisibility): Showing {
  if (vis === 'hidden' || closed(ctx, path)) return 'absent';
  if (vis === 'local-only') return seatLeaves(ctx) ? 'withheld' : 'shown-local';
  return 'shown';
}

/** Mark an output that carries a local-only note's text. */
function withFlag(out: ToolOutput, local: boolean): ToolOutput {
  return local ? { ...out, localOnly: true } : out;
}

// ---------------------------------------------------------------------------
// The index

/** How long a vault tool waits for the index's first reconcile. A vault of a
 *  few thousand notes builds well inside it on the reference box; past it the
 *  tool answers from what is indexed so far. */
export const VAULT_TOOL_INDEX_WAIT_MS = 15_000;

/** The session's vault index, reconciled once; null with no vault folder. */
async function indexFor(
  ctx: ToolContext,
  opts: { terms?: boolean; fresh?: boolean; waitMs?: number } = {},
): Promise<VaultIndex | null> {
  if (!ctx.vaultRoot || !existsSync(ctx.vaultRoot)) return null;
  const handle = await engineVaultIndex(vaultJail(ctx).root);
  if (opts.fresh) await handle.reconcile();
  else handle.refresh();
  const ready = await handle.whenReconciled(opts.waitMs ?? VAULT_TOOL_INDEX_WAIT_MS, ctx.signal);
  if (!ready && !handle.isLoaded) return null;
  if (opts.terms) await handle.ensureTerms(ctx.signal);
  return handle.index;
}

/** The index's paths a tool may resolve to: hidden and closed notes left
 *  out, so no link or name ever lands on one. */
function visiblePathIndex(ctx: ToolContext, index: VaultIndex): VaultPathIndex {
  const paths = index.paths().filter((p) => {
    const e = index.entry(p);
    return visibilityOf(ctx, p, e) !== 'hidden' && !closed(ctx, p);
  });
  return buildPathIndex(paths);
}

// ---------------------------------------------------------------------------
// Reading a note

/** The largest note read whole, the same bound readFile holds. */
const MAX_NOTE_BYTES = 2_000_000;
/** The read cap when the loop has not set one for the seat (capContent's). */
export const DEFAULT_VAULT_READ_CAP_CHARS = 24_000;
/** How long a read waits for the index to resolve its header's links. */
const HEADER_INDEX_WAIT_MS = 1_000;
/** Outgoing links named in a read's header at most. */
const HEADER_LINKS_MAX = 30;

function readCap(ctx: ToolContext): number {
  const n = ctx.vaultReadCapChars?.();
  return typeof n === 'number' && n > 0 ? n : DEFAULT_VAULT_READ_CAP_CHARS;
}

function stripMd(s: string): string {
  return s.replace(/\.md$/i, '');
}

/** Split "Note#Heading" or "Note#^block" into the note and the part, unless
 *  the whole string is a note that exists. */
function splitSubpath(raw: string): { target: string; sub?: string } {
  const hash = raw.indexOf('#');
  if (hash <= 0) return { target: raw };
  const sub = raw.slice(hash + 1).trim();
  return { target: raw.slice(0, hash), ...(sub ? { sub } : {}) };
}

type Resolved =
  | { kind: 'note'; path: string }
  | { kind: 'twin'; typed: string; twin: string }
  | { kind: 'miss'; typed: string; suggestions: string[] };

/** Resolve a name the model typed to one note: the exact path, then a case
 *  twin (named back, never read in its place), then the vault's wikilink
 *  rules (so a bare `Ideas` finds `Projects/Ideas.md`), then a unique alias. A
 *  miss offers the top three search titles. Hidden and closed notes never
 *  resolve. */
async function resolveNote(ctx: ToolContext, raw: string): Promise<Resolved> {
  const jail = vaultJail(ctx);
  const rel = plainNotePath(raw);
  if (existsSync(jail.resolve(rel))) return { kind: 'note', path: rel };
  const twin = await foldTwin(jail.root, rel);
  if (twin) return { kind: 'twin', typed: rel, twin };
  const target = raw.trim().replace(/\\/g, '/');
  for (const fresh of [false, true]) {
    const index = await indexFor(ctx, { fresh });
    if (!index) break;
    const pathIndex = visiblePathIndex(ctx, index);
    const hit = resolveWikilink(target, pathIndex);
    if (hit) return { kind: 'note', path: hit };
    const want = foldPath(stripMd(target));
    const byAlias = new Set<string>();
    for (const e of index.entries()) {
      if (e.aliases.some((a) => foldPath(a) === want)) byAlias.add(e.path);
    }
    const visible = new Set(pathIndex.paths);
    const aliased = [...byAlias].filter((p) => visible.has(p));
    if (aliased.length === 1) return { kind: 'note', path: aliased[0]! };
    // A miss against an index that may be up to a minute old: list the
    // folder once more before saying there is no such note.
  }
  const suggestions = await suggest(ctx, stripMd(target));
  return { kind: 'miss', typed: rel, suggestions };
}

/** The top three notes a search for `query` would show this seat. */
async function suggest(ctx: ToolContext, query: string): Promise<string[]> {
  const index = await indexFor(ctx, { terms: true });
  if (!index) return [];
  const out: string[] = [];
  for (const hit of index.search(query, 50)) {
    const e = index.entry(hit.path);
    const s = showing(ctx, hit.path, visibilityOf(ctx, hit.path, e));
    if (s === 'absent' || s === 'withheld') continue;
    out.push(hit.path);
    if (out.length >= 3) break;
  }
  return out;
}

/** The note's outline: one line per heading, indented by level. */
function outlineOf(scan: NoteScan, maxChars: number): string {
  const lines: string[] = [];
  let used = 0;
  for (const h of scan.headings) {
    const line = `${'  '.repeat(Math.max(0, h.level - 1))}${'#'.repeat(h.level)} ${h.text}`;
    if (used + line.length + 1 > maxChars) {
      lines.push(`... and ${scan.headings.length - lines.length} more headings`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

/** One part of a note: `^id` for a block (its paragraph), else a heading
 *  (matched by text, exact fold first, then containing), from the heading to
 *  the next one at its level or above. Undefined when nothing matches. */
function sectionOf(
  text: string,
  scan: NoteScan,
  section: string,
): { label: string; body: string } | undefined {
  const lines = text.split('\n');
  const want = section.trim();
  if (want.startsWith('^')) {
    const id = want.slice(1).toLowerCase();
    const block = scan.blockIds.find((b) => b.id.toLowerCase() === id);
    if (!block) return undefined;
    let from = block.line;
    while (from > 0 && lines[from - 1]!.trim() !== '' && !/^#{1,6}\s/.test(lines[from]!)) from--;
    return { label: `^${block.id}`, body: lines.slice(from, block.line + 1).join('\n') };
  }
  const folded = foldPath(want.replace(/^#+\s*/, ''));
  const heading =
    scan.headings.find((h) => foldPath(h.text) === folded) ??
    scan.headings.find((h) => foldPath(h.text).includes(folded));
  if (!heading || !folded) return undefined;
  const next = scan.headings.find((h) => h.line > heading.line && h.level <= heading.level);
  const end = next ? next.line : lines.length;
  return { label: heading.text, body: lines.slice(heading.line, end).join('\n').trimEnd() };
}

/** The header a read opens with: the path, its size, its property keys, its
 *  tags, and its outgoing links resolved or not. */
function headerOf(
  path: string,
  text: string,
  scan: NoteScan,
  known: { tags: string[] },
  pathIndex: VaultPathIndex | null,
): string {
  const fm = readFrontmatter(text);
  const bytes = Buffer.byteLength(text, 'utf8');
  const lines = [`Note: ${path} (about ${Math.ceil(bytes / 4)} tokens, ${bytes} bytes)`];
  if (fm.keys.length) lines.push(`Properties: ${fm.keys.join(', ')}`);
  if (known.tags.length) lines.push(`Tags: ${known.tags.map((t) => `#${t}`).join(', ')}`);
  const seen = new Set<number>();
  const links = [...scan.links, ...fm.links]
    .filter((l) => {
      if (l.attachment || seen.has(l.start)) return false;
      seen.add(l.start);
      return true;
    })
    .sort((a, b) => a.start - b.start);
  if (links.length) {
    const named = new Map<string, string>();
    for (const l of links) {
      const written = l.target || '#';
      if (named.has(written)) continue;
      let to: string | null | undefined = null;
      if (pathIndex) {
        to =
          l.kind === 'wiki'
            ? resolveWikilink(l.target, pathIndex, path)
            : resolveMarkdownLink(l.target, path, pathIndex);
      }
      named.set(
        written,
        !l.target ? '(this note)' : to ? `-> ${to}` : pathIndex ? '(unresolved)' : '',
      );
      if (named.size >= HEADER_LINKS_MAX) break;
    }
    const parts = [...named].map(([t, r]) => `[[${t}]]${r ? ` ${r}` : ''}`);
    const more = links.length > named.size ? ` and more` : '';
    lines.push(`Links: ${parts.join('; ')}${more}`);
  }
  return lines.join('\n');
}

/** What a local-only note says to a seat that leaves this network. */
function stayHere(path: string): string {
  return `${path} is a note that stays on this computer. This model's requests leave this network, so its text is not sent here. A local model can read it.`;
}

/** Read a note for the model: resolved, judged, headed, and capped for the
 *  seat. Shared by vaultRead and vaultLookup. */
export async function readVaultNote(
  ctx: ToolContext,
  rawPath: string,
  section?: string,
): Promise<ToolOutput> {
  const jail = vaultJail(ctx);
  let raw = rawPath;
  let part = section?.trim() || undefined;
  if (!existsSync(jail.resolve(plainNotePath(raw)))) {
    const split = splitSubpath(raw);
    if (split.sub !== undefined) {
      raw = split.target;
      part ??= split.sub;
    }
  }
  const resolved = await resolveNote(ctx, raw);
  if (resolved.kind === 'twin') {
    return {
      ok: true,
      content: `No vault note at ${resolved.typed}. The vault has "${resolved.twin}"; read that path.`,
    };
  }
  if (resolved.kind === 'miss') {
    const tail = resolved.suggestions.length
      ? ` Closest by search: ${resolved.suggestions.map((s) => `"${s}"`).join(', ')}.`
      : '';
    return { ok: true, content: `No vault note at ${resolved.typed} yet.${tail}` };
  }
  const rel = resolved.path;
  const absent = { ok: true, content: `No vault note at ${rel} yet.` };
  // A rule that closes the resolved note holds even when the typed name was
  // another one (a bare name, an alias).
  if (closed(ctx, rel)) return absent;
  if (visibilityOf(ctx, rel) === 'hidden') return absent;
  const abs = jail.resolve(rel);
  // Look before reading: a folder named like a note, a note too large to
  // take whole, or a binary file each get a plain answer the model can act
  // on, never a raw error, and nothing large is read into memory first.
  const info = statSync(abs);
  if (!info.isFile()) {
    return {
      ok: false,
      content: `${rel} is a folder, not a note. List what is inside it with vaultList and folder "${rel}".`,
    };
  }
  if (info.size > MAX_NOTE_BYTES) {
    return {
      ok: false,
      content: `${rel} is ${(info.size / 1_000_000).toFixed(1)} MB, too large to read whole. Ask the person which part of it matters.`,
    };
  }
  const bytes = await readFile(abs);
  if (bytes.includes(0)) {
    return { ok: false, content: `${rel} looks binary; not printing it.` };
  }
  const text = bytes.toString('utf8');
  const scan = scanNote(text);
  // The header's links resolve against the index when it is at hand; a read
  // never waits long for it.
  const index = await indexFor(ctx, { waitMs: HEADER_INDEX_WAIT_MS }).catch(() => null);
  const vis = visibilityOfText(ctx, rel, text, scan, index);
  const show = showing(ctx, rel, vis);
  if (show === 'absent') return absent;
  if (show === 'withheld') return { ok: true, content: stayHere(rel) };
  const local = show === 'shown-local';
  const pathIndex = index ? visiblePathIndex(ctx, index) : null;
  const header = headerOf(rel, text, scan, knownFromText(text, scan), pathIndex);
  const cap = readCap(ctx);
  if (part !== undefined) {
    const found = sectionOf(text, scan, part);
    if (!found) {
      const outline = outlineOf(scan, cap);
      return withFlag(
        {
          ok: true,
          content: `${header}\nNo section "${part}" in ${rel}.${outline ? ` Its outline:\n${outline}` : ' It has no headings.'}`,
        },
        local,
      );
    }
    return withFlag(
      {
        ok: true,
        content: `${header}\nSection: ${found.label}\n---\n${capContent(found.body, cap)}`,
      },
      local,
    );
  }
  if (text.length > cap && scan.headings.length > 0) {
    return withFlag(
      {
        ok: true,
        content: `${header}\nThis note is ${text.length} characters, more than this model reads at once (${cap}). Its outline:\n${outlineOf(scan, cap)}\nRead one part with section set to a heading's text (or "^id" for a block).`,
      },
      local,
    );
  }
  return withFlag({ ok: true, content: `${header}\n---\n${capContent(text, cap)}` }, local);
}

const readSchema = z.object({
  path: z
    .string()
    .describe(
      'The note: a path ("decisions/auth.md"), a bare name as a [[wikilink]] would write it ("auth"), or an alias. Add "#Heading" or "#^block" to read one part.',
    ),
  section: z
    .string()
    .optional()
    .describe('Read only this part: a heading\'s text, or "^id" for a block.'),
});

export const vaultReadTool: ToolDef<typeof readSchema> = {
  name: 'vaultRead',
  description: VAULT_TOOL_TEXT.vaultRead,
  schema: readSchema,
  risk: 'read',
  pathJail: 'own',
  pathOf: (args) => notePathOrUndefined(splitSubpath(args.path).target),
  execute: async (args, ctx) => {
    await refreshVault(ctx);
    return readVaultNote(ctx, args.path, args.section);
  },
};

// ---------------------------------------------------------------------------
// Search

/** Search results one call returns by default, and at most. */
export const VAULT_SEARCH_K = 8;
export const VAULT_SEARCH_MAX_K = 20;
/** Index hits looked at before filters (folder, tag, privacy) thin them. */
const SEARCH_POOL = 500;

/** The heading of the section where the query's terms fall most, and a
 *  snippet at the first of them there. */
function bestPassage(
  text: string,
  scan: NoteScan,
  terms: readonly string[],
): { heading?: string; snippet: string } {
  const lower = text.toLowerCase();
  const bodyFrom = scan.frontmatter?.end ?? 0;
  const hits: number[] = [];
  for (const t of terms) {
    for (let i = lower.indexOf(t, bodyFrom); i !== -1; i = lower.indexOf(t, i + t.length)) {
      hits.push(i);
      if (hits.length > 2000) break;
    }
  }
  hits.sort((a, b) => a - b);
  if (hits.length === 0) return { snippet: excerptAt(text, bodyFrom).text };
  // Sections by heading start offset; the part before the first heading is
  // its own section.
  const starts = [bodyFrom, ...scan.headings.map((h) => h.start).filter((s) => s >= bodyFrom)];
  const count = new Array<number>(starts.length).fill(0);
  const first = new Array<number>(starts.length).fill(-1);
  for (const at of hits) {
    let s = 0;
    while (s + 1 < starts.length && starts[s + 1]! <= at) s++;
    count[s]!++;
    if (first[s] === -1) first[s] = at;
  }
  let best = 0;
  for (let s = 1; s < starts.length; s++) if (count[s]! > count[best]!) best = s;
  const heading = best > 0 ? scan.headings.filter((h) => h.start >= bodyFrom)[best - 1] : undefined;
  return {
    ...(heading ? { heading: heading.text } : {}),
    snippet: excerptAt(text, first[best]!).text,
  };
}

function tagMatches(tags: readonly string[], want: string): boolean {
  const w = want.replace(/^#/, '').toLowerCase();
  return tags.some((t) => {
    const x = t.toLowerCase();
    return x === w || x.startsWith(`${w}/`);
  });
}

function folderPrefix(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/');
}

/** Search for the model: ranked notes with the best heading and a snippet,
 *  reading only the bodies it shows. */
export async function searchVault(
  ctx: ToolContext,
  args: { query: string; folder?: string; tag?: string; k?: number },
): Promise<ToolOutput> {
  const index = await indexFor(ctx, { terms: true });
  if (!index || index.size === 0) return { ok: true, content: 'The vault is empty.' };
  const k = Math.max(1, Math.min(VAULT_SEARCH_MAX_K, Math.floor(args.k ?? VAULT_SEARCH_K)));
  const folder = args.folder ? folderPrefix(args.folder) : '';
  const inFolder = folder ? `${foldPath(folder)}/` : '';
  const picked: { path: string; local: boolean }[] = [];
  for (const hit of index.search(args.query, SEARCH_POOL)) {
    const e = index.entry(hit.path);
    if (!e) continue;
    if (inFolder && !foldPath(hit.path).startsWith(inFolder)) continue;
    if (args.tag && !tagMatches(e.tags, args.tag)) continue;
    const s = showing(ctx, hit.path, visibilityOf(ctx, hit.path, e));
    if (s === 'absent' || s === 'withheld') continue;
    picked.push({ path: hit.path, local: s === 'shown-local' });
    if (picked.length >= k) break;
  }
  const scope = [
    folder ? ` under ${folder}` : '',
    args.tag ? ` tagged #${args.tag.replace(/^#/, '')}` : '',
  ].join('');
  if (picked.length === 0) {
    return {
      ok: true,
      content: `No notes${scope} match "${args.query}". Try other words, or list notes with vaultList.`,
    };
  }
  const jail = vaultJail(ctx);
  const terms = queryTerms(args.query);
  const rows: string[] = [];
  let local = false;
  for (const [i, p] of picked.entries()) {
    let text: string | undefined;
    try {
      text = await readFile(jail.resolve(p.path), 'utf8');
    } catch {
      text = undefined;
    }
    let line = `${i + 1}. ${p.path}`;
    let snippet = '';
    if (text !== undefined) {
      const scan = scanNote(text);
      // The note's own text has the last word on its privacy (a mark added
      // since the index saw it).
      const s = showing(ctx, p.path, visibilityOfText(ctx, p.path, text, scan, index));
      if (s === 'absent' || s === 'withheld') continue;
      if (s === 'shown-local') local = true;
      const passage = bestPassage(text, scan, terms);
      if (passage.heading) line += ` > ${passage.heading}`;
      snippet = passage.snippet;
    } else if (p.local) local = true;
    rows.push(snippet ? `${line}\n   ${snippet}` : line);
  }
  if (rows.length === 0) {
    return { ok: true, content: `No notes${scope} match "${args.query}".` };
  }
  const head = `${rows.length} note${rows.length === 1 ? '' : 's'}${scope} match "${args.query}", best first:`;
  const tail =
    'Read one with vaultRead (add section to read only the part that matters), and follow its links from the header.';
  return withFlag({ ok: true, content: [head, ...rows, tail].join('\n') }, local);
}

const searchSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe('Words to look for in note titles, aliases, headings, tags and text.'),
  folder: z.string().optional().describe('Only notes under this folder.'),
  tag: z
    .string()
    .optional()
    .describe('Only notes with this tag (or one under it, e.g. "project" covers "project/x").'),
  k: z
    .number()
    .int()
    .min(1)
    .max(VAULT_SEARCH_MAX_K)
    .optional()
    .describe(`How many results (default ${VAULT_SEARCH_K}, at most ${VAULT_SEARCH_MAX_K}).`),
});

export const vaultSearchTool: ToolDef<typeof searchSchema> = {
  name: 'vaultSearch',
  description: VAULT_TOOL_TEXT.vaultSearch,
  schema: searchSchema,
  risk: 'read',
  execute: async (args, ctx) => {
    await refreshVault(ctx);
    return searchVault(ctx, args);
  },
};

// ---------------------------------------------------------------------------
// Backlinks

/** Linking notes one call names at most. */
export const VAULT_BACKLINKS_MAX = 20;

export async function vaultBacklinksFor(ctx: ToolContext, rawPath: string): Promise<ToolOutput> {
  const resolved = await resolveNote(ctx, splitSubpath(rawPath).target);
  if (resolved.kind === 'twin') {
    return {
      ok: true,
      content: `No vault note at ${resolved.typed}. The vault has "${resolved.twin}"; ask for that path.`,
    };
  }
  if (resolved.kind === 'miss') return { ok: true, content: `No vault note at ${resolved.typed}.` };
  const target = resolved.path;
  const index = await indexFor(ctx);
  const e = index?.entry(target);
  if (!index || showing(ctx, target, visibilityOf(ctx, target, e)) === 'absent') {
    return { ok: true, content: `No vault note at ${target}.` };
  }
  const jail = vaultJail(ctx);
  const rows: string[] = [];
  let local = false;
  let more = 0;
  for (const b of index.backlinks(target)) {
    const src = index.entry(b.source);
    const s = showing(ctx, b.source, visibilityOf(ctx, b.source, src));
    if (s === 'absent' || s === 'withheld') continue;
    if (rows.length >= VAULT_BACKLINKS_MAX) {
      more++;
      continue;
    }
    let excerpt = '';
    try {
      const text = await readFile(jail.resolve(b.source), 'utf8');
      const scan = scanNote(text);
      const now = showing(ctx, b.source, visibilityOfText(ctx, b.source, text, scan, index));
      if (now === 'absent' || now === 'withheld') continue;
      if (now === 'shown-local') local = true;
      excerpt = excerptAt(text, b.at[0] ?? 0).text;
    } catch {
      // Gone since the index saw it: named without a passage.
    }
    rows.push(excerpt ? `- ${b.source}: ${excerpt}` : `- ${b.source}`);
  }
  if (rows.length === 0) return { ok: true, content: `No notes link to ${target}.` };
  const head = `${rows.length}${more ? '+' : ''} note${rows.length === 1 ? '' : 's'} link to ${target}:`;
  const tail = more ? [`And ${more} more.`] : [];
  return withFlag({ ok: true, content: [head, ...rows, ...tail].join('\n') }, local);
}

const backlinksSchema = z.object({
  path: z.string().describe('The note whose linking notes you want (a path, bare name, or alias).'),
});

export const vaultBacklinksTool: ToolDef<typeof backlinksSchema> = {
  name: 'vaultBacklinks',
  description: VAULT_TOOL_TEXT.vaultBacklinks,
  schema: backlinksSchema,
  risk: 'read',
  pathJail: 'own',
  pathOf: (args) => notePathOrUndefined(splitSubpath(args.path).target),
  execute: async (args, ctx) => {
    await refreshVault(ctx);
    return vaultBacklinksFor(ctx, args.path);
  },
};

// ---------------------------------------------------------------------------
// The merged tool for lean seats

const lookupSchema = z
  .object({
    query: z.string().optional().describe('Search the vault for these words.'),
    path: z
      .string()
      .optional()
      .describe('Read this note (a path, bare name, or alias; "#Heading" reads one part).'),
    section: z.string().optional().describe('With path: read only this heading or "^id" block.'),
  })
  .refine((a) => (a.query === undefined) !== (a.path === undefined), {
    message: 'Give exactly one of query or path.',
  });

export const vaultLookupTool: ToolDef<typeof lookupSchema> = {
  name: 'vaultLookup',
  description: VAULT_TOOL_TEXT.vaultLookup,
  schema: lookupSchema,
  risk: 'read',
  pathJail: 'own',
  pathOf: (args) =>
    args.path !== undefined ? notePathOrUndefined(splitSubpath(args.path).target) : undefined,
  execute: async (args, ctx) => {
    await refreshVault(ctx);
    return args.path !== undefined
      ? readVaultNote(ctx, args.path, args.section)
      : searchVault(ctx, { query: args.query ?? '' });
  },
};

/** The separate vault read tools the merged vaultLookup stands in for on a
 *  lean seat (CTO I11). vaultWrite is never merged. */
export const SEPARATE_VAULT_READ_TOOLS: readonly string[] = [
  'vaultSearch',
  'vaultRead',
  'vaultBacklinks',
  'vaultList',
];

/** Code-point order, re-exported for vault.ts. */
export { compareCodePoints };
