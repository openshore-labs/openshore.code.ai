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
    const numbered = slice.map((l, i) => `${String(start + i).padStart(width)}| ${l}`).join('\n');
    const header = `${args.path} (lines ${start}-${end} of ${lines.length})`;
    return { ok: true, content: capContent(`${header}\n${numbered}`) };
  },
};
