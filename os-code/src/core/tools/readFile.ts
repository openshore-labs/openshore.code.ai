import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';
import { capContent, type ToolDef } from './index.js';

const schema = z.object({
  path: z.string().describe('File path, relative to the workspace root'),
  startLine: z.number().int().min(1).optional().describe('First line to read (1-based)'),
  endLine: z.number().int().min(1).optional().describe('Last line to read, inclusive'),
});

export const readFileTool: ToolDef<typeof schema> = {
  name: 'readFile',
  description:
    'Read a file from the workspace. Returns numbered lines. Use startLine/endLine for a slice of a large file.',
  schema,
  risk: 'read',
  pathOf: (args) => args.path,
  async execute(args, ctx) {
    const abs = ctx.jail.resolve(args.path);
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      return {
        ok: false,
        content: `No file at ${args.path}. Check the path with glob or gitStatus.`,
      };
    }
    if (stat.isDirectory()) {
      return {
        ok: false,
        content: `${args.path} is a directory. Use glob to list what is inside it.`,
      };
    }
    if (stat.size > 2_000_000) {
      return {
        ok: false,
        content: `${args.path} is ${(stat.size / 1_000_000).toFixed(1)} MB, too large to read whole. Use grep to find the region, then read a slice with startLine/endLine.`,
      };
    }
    const raw = readFileSync(abs, 'utf8');
    if (raw.includes('\u0000')) {
      return { ok: false, content: `${args.path} looks binary; not printing it.` };
    }
    const lines = raw.split('\n');
    const start = Math.max(1, args.startLine ?? 1);
    const end = Math.min(lines.length, args.endLine ?? lines.length);
    const slice = lines.slice(start - 1, end);
    const width = String(end).length;
    const rows = slice.map((l, i) => `${String(start + i).padStart(width)}| ${l}`);
    const header = `${args.path} (lines ${start}-${end} of ${lines.length})`;
    const whole = `${header}\n${rows.join('\n')}`;
    // The seat's share of its window (set by the loop per class), else the
    // fixed cap every tool had before the window was known.
    const cap = ctx.observationCapChars?.() ?? DEFAULT_READ_CAP_CHARS;
    if (whole.length <= cap) return { ok: true, content: whole };
    return {
      ok: true,
      content: cutAtLine(args.path, rows, start, end, lines.length, cap) || capContent(whole, cap),
    };
  },
};

/** The most a read returns when the loop has set no cap for the seat. */
const DEFAULT_READ_CAP_CHARS = 24_000;

/**
 * A read too long for the cap, kept to whole lines from the top, with a plain
 * note of where it stopped and how to read on: a small seat that is told the
 * next startLine reads on, where one handed a middle cut out of the file
 * guesses at what it missed. '' when not even one line fits (a minified
 * file), for the caller to cut by characters instead.
 */
function cutAtLine(
  path: string,
  rows: string[],
  start: number,
  end: number,
  total: number,
  cap: number,
): string {
  // Room for the header and the note, which both name the path.
  const budget = cap - path.length * 2 - 300;
  let used = 0;
  let shown = 0;
  for (const row of rows) {
    if (used + row.length + 1 > budget) break;
    used += row.length + 1;
    shown += 1;
  }
  if (shown === 0) return '';
  const last = start + shown - 1;
  return [
    `${path} (lines ${start}-${last} of ${total})`,
    ...rows.slice(0, shown),
    `[Cut here to fit this model's window: lines ${last + 1}-${end} of ${path} were not shown. Read on with startLine ${last + 1}, or read a smaller slice with startLine and endLine.]`,
  ].join('\n');
}
