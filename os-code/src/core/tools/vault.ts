// Vault tools: the agent's durable, on-device knowledge base. Plain markdown
// files under a single vault directory, so the same tree opens in Obsidian or
// any editor and matches the app's Vault. The agent reads and lists freely, but
// every WRITE is always-ask: it prompts the user with a diff and never lands a
// byte without approval (the founder's ruling, enforced by alwaysAsk here plus
// the permission engine honoring it before any auto-allow path). A write lands
// exactly as approved or not at all: execute re-checks the bytes the preview
// showed, and saves through the same writeNote the app uses on this folder
// (core/vault/noteFile.ts), atomic and guarded by the note's version.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { z } from 'zod';
import { Jail } from '../security/jail.js';
import { checkNewNoteName, foldPath, isAgentWritablePath } from '../../harness/vault/paths.js';
import { readFrontmatter } from '../../harness/vault/frontmatter.js';
import { mergeProvenance, readProvenance } from '../../harness/vault/provenance.js';
import type { ProvenanceFields } from '../../harness/vault/types.js';
import { unifiedDiff } from '../edit/diff.js';
import { engineVaultIndex, openEngineVaultIndex } from '../vault/engineIndex.js';
import { resolvedAgentWritable } from '../vault/folderFs.js';
import { NotANoteError, readNoteBytes, writeNote } from '../vault/noteFile.js';
import { VAULT_SETTINGS_DENY } from '../vault/settingsFile.js';
import type { ToolContext, ToolDef } from './index.js';
import {
  closed,
  foldTwin,
  knownFromText,
  notePathOrUndefined,
  plainNotePath,
  refreshVault,
  seatLeaves,
  vaultJail,
  visibilityOf,
} from './vaultFind.js';

// vaultRead lives with the tools that find (vaultFind.ts), since it resolves
// names the way search and backlinks do; it is exported here too so every
// caller keeps one import for the vault's tools.
export { vaultReadTool } from './vaultFind.js';

/** The path a vaultWrite lands on. An existing exact path always updates,
 *  whatever its name holds. A new note must pass the vault's one new-name
 *  rule (Vault M3, H4), and is refused with the clean name to use instead; a
 *  new name that folds onto an existing note is refused with that note's
 *  name, so the model updates it rather than making a twin. */
async function writeTarget(jail: Jail, raw: string, ctx?: ToolContext): Promise<string> {
  // The vault's settings folder is the person's alone (Vault M7, CTO L8),
  // said plainly before any note-name rule speaks.
  if (namesSettingsDir(raw)) throw new WriteRefused(VAULT_SETTINGS_DENY);
  const rel = await noteTarget(jail, raw);
  if (!isAgentWritablePath(rel)) throw new WriteRefused(VAULT_SETTINGS_DENY);
  const folder = ctx ? agentFolder(ctx) : undefined;
  if (folder && !underFolder(rel, folder)) {
    throw new WriteRefused(
      `This vault's settings keep the agent's notes in "${folder}". Write under "${folder}/" instead.`,
    );
  }
  return rel;
}

/** A write the vault's rules refuse (L8, the agent folder): execute answers
 *  it as a plain refusal, the preview throws it as the card's reason. */
class WriteRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WriteRefused';
  }
}

/** Whether a typed path names `.oscode` as any of its segments. */
function namesSettingsDir(raw: string): boolean {
  return raw
    .replace(/\\/g, '/')
    .split('/')
    .some((seg) => foldPath(seg).trim() === '.oscode');
}

/** The one folder the vault's settings let the agent write in (L2), or
 *  undefined for anywhere. */
function agentFolder(ctx: ToolContext): string | undefined {
  const folder = ctx.vaultSettings?.()?.agent.folder?.replace(/^\/+|\/+$/g, '');
  return folder ? folder : undefined;
}

function underFolder(rel: string, folder: string): boolean {
  return foldPath(rel).startsWith(`${foldPath(folder)}/`);
}

/** The written path, checked once more on where it RESOLVES (L8): a note that
 *  is a link into `.oscode/` (or any dot folder) is never written through. */
function assertResolvedWritable(jail: Jail, abs: string): void {
  if (!resolvedAgentWritable(jail.root, abs)) throw new WriteRefused(VAULT_SETTINGS_DENY);
}

async function noteTarget(jail: Jail, raw: string): Promise<string> {
  const plain = plainNotePath(raw);
  if (await exists(jail, plain)) return plain;
  const check = checkNewNoteName(plain);
  if (!check.ok) throw new Error(check.error);
  const rel = check.path;
  if (rel !== plain && (await exists(jail, rel))) return rel;
  const twin = await foldTwin(jail.root, rel);
  if (twin) {
    throw new Error(`The vault already has this note as "${twin}". Write to "${twin}" instead.`);
  }
  return rel;
}

/** Whether anything sits at `rel` in the vault (a folder named like a note
 *  counts, so the write reports it plainly). */
async function exists(jail: Jail, rel: string): Promise<boolean> {
  return (await lstat(jail.resolve(rel)).catch(() => undefined)) !== undefined;
}

/** Normalize a folder argument: same cleaning, no .md suffix. */
function normalizeFolder(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/');
}

/** The refusal for a note the person's vault settings exclude (CTO I5): the
 *  agent may not write where it may not read. */
function hiddenRefusal(rel: string): string {
  const slash = rel.lastIndexOf('/');
  const where = slash === -1 ? rel : `${rel.slice(0, slash)}/`;
  return `${where} is closed to the agent by the person's vault settings. Write somewhere else.`;
}

/** Whether the person's privacy rules hide this note, judged by its path and,
 *  when it exists, by its own tags and marks. */
function hiddenNote(ctx: ToolContext, rel: string, current: Buffer | undefined): boolean {
  if (visibilityOf(ctx, rel) === 'hidden') return true;
  return (
    current !== undefined &&
    visibilityOf(ctx, rel, knownFromText(current.toString('utf8'))) === 'hidden'
  );
}

/** The body after applying the write mode. */
function applied(before: string, content: string, mode: 'replace' | 'append'): string {
  if (mode === 'append' && before) {
    return `${before}${before.endsWith('\n') ? '' : '\n'}${content}`;
  }
  return content;
}

const writeSchema = z.object({
  path: z
    .string()
    .describe('Note path under the vault, e.g. "decisions/auth.md". Folders with "/" are allowed.'),
  content: z.string().describe('The markdown to save.'),
  mode: z
    .enum(['replace', 'append'])
    .default('replace')
    .describe('replace the whole note, or append to the end of an existing one'),
});

/** What an approval was given against: a hash of the note's raw bytes, or
 *  "absent" when there was no note. Byte equality is the question an approval
 *  asks, so a touch or a sync client's identical rewrite never refuses a write
 *  the person approved, and any real edit does. */
function basisOf(bytes: Buffer | undefined): string {
  return bytes ? `sha256:${createHash('sha256').update(bytes).digest('hex')}` : 'absent';
}

/** The provenance lines for this write (Vault M7, CTO L9), or undefined when
 *  `vault.provenance` is off (or the context carries no config). A new note
 *  is the agent's (`agent`, created now); a note the agent made keeps
 *  `agent`; any other note it changes is `agent-edit`, and an edit clears
 *  `oscode-reviewed`, since the person has not read these words yet. Where
 *  the seat runs is judged by address (`seatLeavesNetwork`). */
function provenanceFields(
  ctx: ToolContext,
  before: string | undefined,
  created: string,
): ProvenanceFields | undefined {
  if (ctx.config?.vault?.provenance !== 'on') return undefined;
  const seat = ctx.vaultSeat?.() ?? {};
  const where = seatLeaves(ctx) ? 'cloud' : 'local';
  const fields: ProvenanceFields = {};
  if (before === undefined) {
    fields['oscode-source'] = 'agent';
  } else {
    let prior: string | undefined;
    try {
      prior = readProvenance(readFrontmatter(before)).source;
    } catch {
      prior = undefined;
    }
    fields['oscode-source'] = prior === 'agent' ? 'agent' : 'agent-edit';
    fields['oscode-reviewed'] = null;
  }
  if (seat.model) fields['oscode-model'] = seat.model;
  fields['oscode-where'] = where;
  if (seat.size) fields['oscode-size'] = seat.size;
  fields['oscode-provider'] = where === 'cloud' && seat.provider ? seat.provider : null;
  if (before === undefined) fields['oscode-created'] = created;
  return fields;
}

/** The text with its provenance merged in, byte for byte (L10), BEFORE the
 *  diff, so the person approves exactly what lands. A merge that skips (or
 *  fails) leaves the text as the model wrote it. */
function stamped(text: string, fields: ProvenanceFields | undefined): string {
  if (!fields) return text;
  try {
    const merged = mergeProvenance(text, fields);
    return 'text' in merged ? merged.text : text;
  } catch {
    return text;
  }
}

/** A new note's creation time rides on the approval's basis, so execute
 *  writes the very bytes the preview showed. */
const CREATED_MARK = '#created=';

function splitBasis(basis: string | undefined): { hash?: string; created?: string } {
  if (basis === undefined) return {};
  const at = basis.indexOf(CREATED_MARK);
  return at === -1
    ? { hash: basis }
    : { hash: basis.slice(0, at), created: basis.slice(at + CREATED_MARK.length) };
}

/** The refusal when the note moved under an approval: the model reads it
 *  again and proposes a fresh write, which the person sees as a fresh diff. */
const CHANGED_SINCE_APPROVAL =
  'The note changed since you approved it. Read it again with vaultRead, then propose the write again.';

export const vaultWriteTool: ToolDef<typeof writeSchema> = {
  name: 'vaultWrite',
  description:
    "Save a note into the user's on-device knowledge vault (plain markdown files). Use it to record decisions, findings, plans, and reference notes that you or the user will want later, and to build on notes you saved before (search first, so you update a note rather than duplicate it). Connect notes with [[wikilinks]]. Every write is shown to the user as a diff and requires their approval; it never happens silently.",
  schema: writeSchema,
  risk: 'write',
  // Never silent: always prompt with a diff, before any auto-allow path.
  alwaysAsk: true,
  // The vault has its own root, so the workspace jail must not resolve this.
  pathJail: 'own',
  pathOf: (args) => notePathOrUndefined(args.path),
  async preview(args, ctx) {
    await refreshVault(ctx);
    const jail = vaultJail(ctx);
    const rel = await writeTarget(jail, args.path, ctx);
    const abs = jail.resolve(rel);
    assertResolvedWritable(jail, abs);
    // One read of the raw bytes: the diff is built from them, and their hash
    // travels to execute as the basis the person approved against.
    const current = await readNoteBytes(abs);
    if (hiddenNote(ctx, rel, current?.bytes)) throw new Error(hiddenRefusal(rel));
    const before = current ? current.bytes.toString('utf8') : '';
    const created = new Date().toISOString();
    const fields = provenanceFields(ctx, current ? before : undefined, created);
    const after = stamped(applied(before, args.content, args.mode), fields);
    const { text, stats } = unifiedDiff(before, after, rel);
    const verb = before ? (args.mode === 'append' ? 'Append to' : 'Update') : 'Create';
    return {
      summary: `Vault: ${verb} ${rel} (+${stats.additions} -${stats.deletions})`,
      detail: text || '(no textual change)',
      basis: `${basisOf(current?.bytes)}${fields?.['oscode-created'] ? `${CREATED_MARK}${created}` : ''}`,
    };
  },
  async execute(args, ctx, approved) {
    await refreshVault(ctx);
    const jail = vaultJail(ctx);
    let rel: string;
    let abs: string;
    try {
      rel = await writeTarget(jail, args.path, ctx);
      abs = jail.resolve(rel);
      assertResolvedWritable(jail, abs);
    } catch (err) {
      if (err instanceof WriteRefused) return { ok: false, content: err.message };
      throw err;
    }
    let current;
    try {
      // The bytes and the version token of exactly those bytes, together.
      current = await readNoteBytes(abs);
    } catch (err) {
      if (err instanceof NotANoteError) return { ok: false, content: err.message };
      throw err;
    }
    if (hiddenNote(ctx, rel, current?.bytes)) return { ok: false, content: hiddenRefusal(rel) };
    // The note must still be what the person saw the diff against. Without a
    // basis (the preview failed) the execute-time guard below still holds.
    const basis = splitBasis(approved?.basis);
    if (basis.hash !== undefined && basis.hash !== basisOf(current?.bytes)) {
      return { ok: false, content: CHANGED_SINCE_APPROVAL };
    }
    const before = current ? current.bytes.toString('utf8') : '';
    const created = basis.created ?? new Date().toISOString();
    const fields = provenanceFields(ctx, current ? before : undefined, created);
    const after = stamped(applied(before, args.content, args.mode), fields);
    // The write carries the version read above, so an edit landing between
    // that read and the save is refused too, never overwritten; a new note is
    // created only while the name is still free.
    const saved = await writeNote(
      abs,
      after,
      current ? { ifMatch: current.version } : { ifAbsent: true },
    );
    if (!saved.ok) return { ok: false, content: CHANGED_SINCE_APPROVAL };
    // The engine's index takes the text in hand (CTO I7), so a search right
    // after the write finds it without a read.
    const handle = await openEngineVaultIndex(jail.root).catch(() => undefined);
    handle?.noteWrite(
      {
        path: rel,
        version: saved.version,
        updatedAt: saved.updatedAt,
        size: Buffer.byteLength(after, 'utf8'),
      },
      after,
    );
    const { text, stats } = unifiedDiff(before, after, rel);
    return {
      ok: true,
      content: `Saved ${rel} to the vault (+${stats.additions} -${stats.deletions}).`,
      diffText: text,
    };
  },
};

const listSchema = z.object({
  folder: z.string().optional().describe('Optional subfolder to list; omit for the whole vault.'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Skip this many notes, to page through a long list. Omit to start at the first.'),
});

/** Notes one vaultList call returns. A real Obsidian vault holds thousands,
 *  and one uncapped list would flood a seat's context in a single call. */
const LIST_PAGE = 200;
/** The most one vaultList answer holds, in characters: the cap every tool
 *  observation is trimmed to (capContent). Deep folders and long titles fill
 *  that before 200 notes, so a page also stops at this many characters and
 *  comes back whole. A page trimmed in the middle, with a footer that paged on
 *  past the trimmed notes, skipped them for good. */
const LIST_CHARS = 24_000;
/** Room a page leaves for its count line and its footer. */
const LIST_FRAME_CHARS = 2_000;
/** Folder entries the walk visits before it stops counting, so a vault on a
 *  huge or network-mounted folder cannot hold the call (or the daemon) for long. */
const WALK_CEILING = 20_000;
/** Folders named in the "narrow with folder" line, and the room they get. */
const FOLDER_HINTS = 8;
const FOLDER_HINT_CHARS = 1_000;

/** Walk the vault for notes (dot entries skipped), asynchronously so a large
 *  folder never blocks the daemon's other sessions, and stopping once it has
 *  visited `ceiling` entries. Paths are vault-relative ("base/..." when a
 *  folder was asked for), "/"-separated. A subfolder that cannot be read is
 *  skipped so the rest still lists; the folder asked for failing is reported
 *  (`unreadable`, its error code), never passed off as an empty vault. */
async function walkNotes(
  start: string,
  base: string,
  ceiling: number,
): Promise<{ notes: string[]; stopped: boolean; unreadable?: string }> {
  const notes: string[] = [];
  const pending = [start];
  let visited = 0;
  while (pending.length) {
    const dir = pending.shift()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (dir === start) {
        return {
          notes,
          stopped: false,
          unreadable: (err as NodeJS.ErrnoException).code ?? 'unreadable',
        };
      }
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (++visited > ceiling) return { notes, stopped: true };
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) pending.push(abs);
      else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        const rel = relative(start, abs).split(sep).join('/');
        notes.push(base ? `${base}/${rel}` : rel);
      }
    }
  }
  return { notes, stopped: false };
}

/** Note counts per folder one level below `level`. Every note sits under
 *  `level` (the listed folder, or a folder that holds all of them). */
function subfolderCounts(notes: string[], level: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    const rest = level ? note.slice(level.length + 1) : note;
    const slash = rest.indexOf('/');
    if (slash === -1) continue;
    const folder = level ? `${level}/${rest.slice(0, slash)}` : rest.slice(0, slash);
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return counts;
}

/** Folders under the listed one with their note counts, largest first, so the
 *  model can narrow a long list to the part it needs. When one folder holds
 *  every note, the folders inside it are named instead, since narrowing to it
 *  would return the same list; when nothing narrows, there are no hints. */
function folderHints(notes: string[], base: string): string {
  let counts = subfolderCounts(notes, base);
  for (;;) {
    const [only] = counts.size === 1 ? [...counts.entries()] : [];
    if (!only || only[1] !== notes.length) break;
    counts = subfolderCounts(notes, only[0]);
  }
  const hints: string[] = [];
  let used = 0;
  for (const [folder, n] of [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
  )) {
    const hint = `"${folder}" (${n})`;
    if (hints.length >= FOLDER_HINTS || used + hint.length + 2 > FOLDER_HINT_CHARS) break;
    hints.push(hint);
    used += hint.length + 2;
  }
  return hints.join(', ');
}

/** The folders at the top of the vault, for a folder name that missed. */
async function topFolders(root: string, ctx: ToolContext): Promise<string> {
  try {
    const names = (await readdir(root, { withFileTypes: true }))
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith('.') &&
          !closed(ctx, `${e.name}/`) &&
          visibilityOf(ctx, `${e.name}/`) !== 'hidden',
      )
      .map((e) => e.name)
      .sort();
    const shown = names.slice(0, FOLDER_HINTS).map((name) => `"${name}"`);
    if (names.length > shown.length) shown.push(`and ${names.length - shown.length} more`);
    return shown.join(', ');
  } catch {
    return '';
  }
}

export const vaultListTool: ToolDef<typeof listSchema> = {
  name: 'vaultList',
  description: `List the notes in the user's vault (paths and sizes), so you can find and build on existing notes before writing new ones. Returns up to ${LIST_PAGE} notes with a count; narrow with folder, or page on with offset. To find notes by what they say, use vaultSearch instead.`,
  schema: listSchema,
  risk: 'read',
  async execute(args, ctx) {
    await refreshVault(ctx);
    const root = ctx.vaultRoot;
    if (!root || !existsSync(root)) return { ok: true, content: 'The vault is empty.' };
    const base = args.folder ? normalizeFolder(args.folder) : '';
    // A folder the person fenced off is said to be closed, before anything
    // about what is inside it (or whether it exists) is looked at.
    if (base && closed(ctx, `${base}/`)) {
      return {
        ok: false,
        content: `${base} is closed to the agent by the person's permission rules.`,
      };
    }
    const start = base ? new Jail(root).resolve(base) : root;
    if (base) {
      // A slip in the folder name, or a note passed as a folder, is not an
      // empty vault: saying so would invite notes that duplicate real ones.
      const info = await stat(start).catch(() => undefined);
      if (!info) {
        const top = await topFolders(root, ctx);
        return {
          ok: false,
          content: `There is no folder named "${base}" in the vault.${top ? ` Its top folders: ${top}.` : ''}`,
        };
      }
      if (!info.isDirectory()) {
        return {
          ok: false,
          content: /\.md$/i.test(base)
            ? `${base} is a note, not a folder. Read it with vaultRead.`
            : `${base} is a file, not a folder.`,
        };
      }
    }
    const walked = await walkNotes(start, base, WALK_CEILING);
    const { stopped, unreadable } = walked;
    if (unreadable) {
      return { ok: false, content: `Could not read ${base || 'the vault'} (${unreadable}).` };
    }
    // Notes the person's vault settings exclude are absent, not counted and
    // not named (CTO I5): by glob always, and by a note's own tags and marks
    // once the engine's index has loaded. Asking opens the index in the
    // background, so later searches find it warm.
    const handle = await engineVaultIndex(new Jail(root).root).catch(() => undefined);
    const index = handle?.isLoaded ? handle.index : undefined;
    walked.notes = walked.notes.filter(
      (rel) => visibilityOf(ctx, rel, index?.entry(rel)) !== 'hidden',
    );
    // Notes a deny rule closes stay out of the list, its count, and the folder
    // hints, so the model never sees names it may not read.
    const notes = walked.notes.filter((rel) => !closed(ctx, rel));
    const hidden = walked.notes.length - notes.length;
    const hiddenLine = hidden
      ? ` ${hidden} more ${hidden === 1 ? 'is' : 'are'} hidden by the person's permission rules.`
      : '';
    if (!notes.length && hidden) {
      return {
        ok: true,
        content: `No notes${base ? ` under ${base}` : ''} are open to the agent; the person's permission rules hide ${hidden}.`,
      };
    }
    if (!notes.length) {
      return {
        ok: true,
        content: stopped
          ? `No notes in the first ${WALK_CEILING} entries of ${base || 'the vault'}. Narrow with folder.`
          : base
            ? `No notes under ${base}.`
            : 'The vault is empty.',
      };
    }
    notes.sort();
    const offset = Math.min(args.offset ?? 0, notes.length);
    const where = base ? ` under ${base}` : '';
    const total = stopped ? `At least ${notes.length}` : `${notes.length}`;
    const plural = notes.length === 1 ? '' : 's';
    const hints = folderHints(notes, base);
    // A page holds up to LIST_PAGE notes and stops early once it is full by
    // characters. Never fewer than one, so paging on always moves.
    const rows: string[] = [];
    let used = 0;
    for (const rel of notes.slice(offset, offset + LIST_PAGE)) {
      let size = '';
      try {
        size = ` (${(await stat(join(root, rel))).size}b)`;
      } catch {
        // Gone since the walk; list it without a size.
      }
      const row = `${rel}${size}`;
      if (rows.length && used + row.length + 1 > LIST_CHARS - LIST_FRAME_CHARS) break;
      rows.push(row);
      used += row.length + 1;
    }
    // The count line and the footer name how many rows the page shows, and
    // the footer's offset is exactly where the next page starts.
    const render = (): string => {
      const shown = rows.length;
      const lines = [
        (shown
          ? `${total} note${plural}${where}. Showing ${offset + 1} to ${offset + shown}.`
          : `${total} note${plural}${where}; none after offset ${offset}.`) + hiddenLine,
        ...rows,
      ];
      const after = notes.length - offset - shown;
      if (after > 0 || stopped) {
        const tail: string[] = [];
        if (after > 0) tail.push(`${stopped ? 'At least ' : ''}${after} more.`);
        if (stopped) tail.push(`Stopped counting after ${WALK_CEILING} entries.`);
        const narrow = hints
          ? `Narrow with folder: ${hints}.`
          : stopped
            ? 'Narrow with folder.'
            : '';
        if (narrow) tail.push(narrow);
        if (after > 0) {
          tail.push(`${narrow ? 'Or page' : 'Page'} on with offset ${offset + shown}.`);
        }
        lines.push(tail.join(' '));
      }
      return lines.join('\n');
    };
    let content = render();
    // A very long folder name in the count line or the hints can still push
    // past the cap: drop rows from the end, which the next page then starts at.
    while (content.length > LIST_CHARS && rows.length > 1) {
      rows.pop();
      content = render();
    }
    return { ok: true, content };
  },
};
