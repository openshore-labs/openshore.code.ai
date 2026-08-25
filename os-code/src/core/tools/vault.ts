// Vault tools: the agent's durable, on-device knowledge base. Plain markdown
// files under a single vault directory, so the same tree opens in Obsidian or
// any editor and matches the app's Vault. The agent reads and lists freely, but
// every WRITE is always-ask: it prompts the user with a diff and never lands a
// byte without approval (the founder's ruling, enforced by alwaysAsk here plus
// the permission engine honoring it before any auto-allow path).
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
  pathOf: (args) => args.path,
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

export const vaultReadTool: ToolDef<typeof readSchema> = {
  name: 'vaultRead',
  description:
    "Read a note from the user's vault by path. Returns its markdown, or a note that it does not exist yet (you may then propose creating it with vaultWrite).",
  schema: readSchema,
  risk: 'read',
  pathOf: (args) => args.path,
  async execute(args, ctx) {
    const jail = vaultJail(ctx);
    const rel = normalizeNotePath(args.path);
    const abs = jail.resolve(rel);
    if (!existsSync(abs)) return { ok: true, content: `No vault note at ${rel} yet.` };
    return { ok: true, content: capContent(readFileSync(abs, 'utf8')) };
  },
};

const listSchema = z.object({
  folder: z
    .string()
    .optional()
    .describe('Optional subfolder to list; omit for the whole vault.'),
});

function walk(dir: string, root: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, root, out);
    else if (entry.isFile() && /\.md$/i.test(entry.name)) {
      const rel = relative(root, abs).split(sep).join('/');
      out.push(`${rel} (${statSync(abs).size}b)`);
    }
  }
}

export const vaultListTool: ToolDef<typeof listSchema> = {
  name: 'vaultList',
  description:
    "List the notes in the user's vault (paths and sizes), so you can find and build on existing notes before writing new ones.",
  schema: listSchema,
  risk: 'read',
  async execute(args, ctx) {
    const root = ctx.vaultRoot;
    if (!root || !existsSync(root)) return { ok: true, content: 'The vault is empty.' };
    const start = args.folder ? new Jail(root).resolve(normalizeFolder(args.folder)) : root;
    if (!existsSync(start)) return { ok: true, content: 'The vault is empty.' };
    const notes: string[] = [];
    walk(start, root, notes);
    if (!notes.length) return { ok: true, content: 'The vault is empty.' };
    notes.sort();
    return { ok: true, content: notes.join('\n') };
  },
};
