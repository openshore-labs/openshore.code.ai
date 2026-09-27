// Vault tools: the agent's durable, on-device knowledge base. Plain markdown
// files under a single vault directory, so the same tree opens in Obsidian or
// any editor and matches the app's Vault. The agent reads and lists freely, but
// every WRITE is always-ask: it prompts the user with a diff and never lands a
// byte without approval (the founder's ruling, enforced by alwaysAsk here plus
// the permission engine honoring it before any auto-allow path).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { z } from 'zod';
import { Jail } from '../security/jail.js';
import { unifiedDiff } from '../edit/diff.js';
import { capContent, type ToolContext, type ToolDef } from './index.js';

/** The vault root for this session, ensured to exist, as a jail so a note path
 *  can never escape it (symlinks included). */
function vaultJail(ctx: ToolContext): Jail {
  if (!ctx.vaultRoot) throw new Error('The vault is not configured for this session.');
  mkdirSync(ctx.vaultRoot, { recursive: true });
  return new Jail(ctx.vaultRoot);
}

/** Normalize a note name into a vault-relative .md path, the same shape the app
 *  uses: trim, collapse separators, append .md when absent. */
function normalizeNotePath(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/');
  if (!cleaned) throw new Error('Give the note a name.');
  return /\.md$/i.test(cleaned) ? cleaned : `${cleaned}.md`;
}

/** The normalized note path for permission matching; a bad name is undefined
 *  (pathOf never throws), and execute reports the real error. */
function notePathOrUndefined(raw: string): string | undefined {
  try {
    return normalizeNotePath(raw);
  } catch {
    return undefined;
  }
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
    const rel = normalizeNotePath(args.path);
    const abs = jail.resolve(rel);
    const before = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    const after = applied(before, args.content, args.mode);
    const { text, stats } = unifiedDiff(before, after, rel);
    const verb = before ? (args.mode === 'append' ? 'Append to' : 'Update') : 'Create';
    return {
      summary: `Vault: ${verb} ${rel} (+${stats.additions} -${stats.deletions})`,
      detail: text || '(no textual change)',
    };
  },
  async execute(args, ctx) {
    const jail = vaultJail(ctx);
    const rel = normalizeNotePath(args.path);
    const abs = jail.resolve(rel);
    const before = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    const after = applied(before, args.content, args.mode);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, after);
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
    const rel = normalizeNotePath(args.path);
    const abs = jail.resolve(rel);
    if (!existsSync(abs)) return { ok: true, content: `No vault note at ${rel} yet.` };
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

/** The folders at the top of the vault, for a folder name that missed. */
async function topFolders(root: string): Promise<string> {
  try {
    const names = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
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
    const start = base ? new Jail(root).resolve(base) : root;
    if (base) {
      // A slip in the folder name, or a note passed as a folder, is not an
      // empty vault: saying so would invite notes that duplicate real ones.
      const info = await stat(start).catch(() => undefined);
      if (!info) {
        const top = await topFolders(root);
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
    const { notes, stopped, unreadable } = await walkNotes(start, base, WALK_CEILING);
    if (unreadable) {
      return { ok: false, content: `Could not read ${base || 'the vault'} (${unreadable}).` };
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
        shown
          ? `${total} note${plural}${where}. Showing ${offset + 1} to ${offset + shown}.`
          : `${total} note${plural}${where}; none after offset ${offset}.`,
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
