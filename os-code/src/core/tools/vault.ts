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
import { existsSync, readFileSync, statSync } from 'node:fs';
import { lstat, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { z } from 'zod';
import { Jail } from '../security/jail.js';
import { ensureVaultRoot } from '../../config/load.js';
import {
  checkNewNoteName,
  foldPath,
  isNotePath,
  normalizeNotePath,
} from '../../harness/vault/paths.js';
import { unifiedDiff } from '../edit/diff.js';
import { NotANoteError, readNoteBytes, writeNote } from '../vault/noteFile.js';
import { capContent, type ToolContext, type ToolDef } from './index.js';

/** The vault root for this session, as a jail so a note path can never escape
 *  it (symlinks included). The default folder is made on first use; a
 *  configured one that went missing is never recreated (ensureVaultRoot). */
function vaultJail(ctx: ToolContext): Jail {
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
function plainNotePath(raw: string): string {
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
 *  (pathOf never throws), and execute reports the real error. */
function notePathOrUndefined(raw: string): string | undefined {
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
async function foldTwin(root: string, rel: string): Promise<string | undefined> {
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

/** The path a vaultWrite lands on. An existing exact path always updates,
 *  whatever its name holds. A new note must pass the vault's one new-name
 *  rule (Vault M3, H4), and is refused with the clean name to use instead; a
 *  new name that folds onto an existing note is refused with that note's
 *  name, so the model updates it rather than making a twin. */
async function writeTarget(jail: Jail, raw: string): Promise<string> {
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

/** The refusal when the note moved under an approval: the model reads it
 *  again and proposes a fresh write, which the person sees as a fresh diff. */
const CHANGED_SINCE_APPROVAL =
  'The note changed since you approved it. Read it again with vaultRead, then propose the write again.';

export const vaultWriteTool: ToolDef<typeof writeSchema> = {
  name: 'vaultWrite',
  description:
    "Save a note into the user's on-device knowledge vault (plain markdown files). Use it to record decisions, findings, plans, and reference notes that you or the user will want later, and to build on notes you saved before. Connect notes with [[wikilinks]]. Every write is shown to the user as a diff and requires their approval; it never happens silently.",
  schema: writeSchema,
  risk: 'write',
  // Never silent: always prompt with a diff, before any auto-allow path.
  alwaysAsk: true,
  // The vault has its own root, so the workspace jail must not resolve this.
  pathJail: 'own',
  pathOf: (args) => notePathOrUndefined(args.path),
  async preview(args, ctx) {
    const jail = vaultJail(ctx);
    const rel = await writeTarget(jail, args.path);
    const abs = jail.resolve(rel);
    // One read of the raw bytes: the diff is built from them, and their hash
    // travels to execute as the basis the person approved against.
    const current = await readNoteBytes(abs);
    const before = current ? current.bytes.toString('utf8') : '';
    const after = applied(before, args.content, args.mode);
    const { text, stats } = unifiedDiff(before, after, rel);
    const verb = before ? (args.mode === 'append' ? 'Append to' : 'Update') : 'Create';
    return {
      summary: `Vault: ${verb} ${rel} (+${stats.additions} -${stats.deletions})`,
      detail: text || '(no textual change)',
      basis: basisOf(current?.bytes),
    };
  },
  async execute(args, ctx, approved) {
    const jail = vaultJail(ctx);
    const rel = await writeTarget(jail, args.path);
    const abs = jail.resolve(rel);
    let current;
    try {
      // The bytes and the version token of exactly those bytes, together.
      current = await readNoteBytes(abs);
    } catch (err) {
      if (err instanceof NotANoteError) return { ok: false, content: err.message };
      throw err;
    }
    // The note must still be what the person saw the diff against. Without a
    // basis (the preview failed) the execute-time guard below still holds.
    if (approved?.basis !== undefined && approved.basis !== basisOf(current?.bytes)) {
      return { ok: false, content: CHANGED_SINCE_APPROVAL };
    }
    const before = current ? current.bytes.toString('utf8') : '';
    const after = applied(before, args.content, args.mode);
    // The write carries the version read above, so an edit landing between
    // that read and the save is refused too, never overwritten; a new note is
    // created only while the name is still free.
    const saved = await writeNote(
      abs,
      after,
      current ? { ifMatch: current.version } : { ifAbsent: true },
    );
    if (!saved.ok) return { ok: false, content: CHANGED_SINCE_APPROVAL };
    const { text, stats } = unifiedDiff(before, after, rel);
    return {
      ok: true,
      content: `Saved ${rel} to the vault (+${stats.additions} -${stats.deletions}).`,
      diffText: text,
    };
  },
};

const readSchema = z.object({
  path: z.string().describe('Note path under the vault, e.g. "decisions/auth.md".'),
});

/** The largest note vaultRead takes whole, the same bound readFile holds. */
const MAX_NOTE_BYTES = 2_000_000;

export const vaultReadTool: ToolDef<typeof readSchema> = {
  name: 'vaultRead',
  description:
    "Read a note from the user's vault by path. Returns its markdown, or a note that it does not exist yet (you may then propose creating it with vaultWrite).",
  schema: readSchema,
  risk: 'read',
  pathJail: 'own',
  pathOf: (args) => notePathOrUndefined(args.path),
  async execute(args, ctx) {
    const jail = vaultJail(ctx);
    const rel = plainNotePath(args.path);
    const abs = jail.resolve(rel);
    if (!existsSync(abs)) {
      // A note spelled another way (case, or NFD against NFC) is named back,
      // never read in its place, so a rule on the typed path still holds.
      const twin = await foldTwin(jail.root, rel);
      return {
        ok: true,
        content: twin
          ? `No vault note at ${rel}. The vault has "${twin}"; read that path.`
          : `No vault note at ${rel} yet.`,
      };
    }
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
    const bytes = readFileSync(abs);
    if (bytes.includes(0)) {
      return { ok: false, content: `${rel} looks binary; not printing it.` };
    }
    return { ok: true, content: capContent(bytes.toString('utf8')) };
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

/** Whether the person's permission rules close a vault path to the agent: a
 *  deny on reading it or on listing it. A folder is asked as "folder/", so a
 *  "Private/**" rule covers the folder itself (Vault v1, 1.6). */
function closed(ctx: ToolContext, path: string): boolean {
  return Boolean(ctx.denies?.('vaultRead', path) || ctx.denies?.('vaultList', path));
}

/** The folders at the top of the vault, for a folder name that missed. */
async function topFolders(root: string, ctx: ToolContext): Promise<string> {
  try {
    const names = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !closed(ctx, `${e.name}/`))
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
  description: `List the notes in the user's vault (paths and sizes), so you can find and build on existing notes before writing new ones. Returns up to ${LIST_PAGE} notes with a count; narrow with folder, or page on with offset.`,
  schema: listSchema,
  risk: 'read',
  async execute(args, ctx) {
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
