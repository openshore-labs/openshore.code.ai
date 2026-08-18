import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { ToolDef } from './index.js';
import { unifiedDiff } from '../edit/diff.js';
import { verifyWritten } from '../edit/verify.js';

const schema = z.object({
  path: z.string().describe('File path, relative to the workspace root'),
  content: z.string().describe('The complete new file content'),
});

export const writeFileTool: ToolDef<typeof schema> = {
  name: 'writeFile',
  description:
    'Create a file or fully replace its content. For changes inside an existing file, prefer editFile.',
  schema,
  risk: 'write',
  pathOf: (args) => args.path,
  async preview(args, ctx) {
    const abs = ctx.jail.resolve(args.path);
    const before = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    const { text, stats } = unifiedDiff(before, args.content, args.path);
    const verb = before ? 'Replace' : 'Create';
    return {
      summary: `${verb} ${args.path} (+${stats.additions} -${stats.deletions})`,
      detail: text || '(no textual change)',
    };
  },
  async execute(args, ctx) {
    const abs = ctx.jail.resolve(args.path);
    const before = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, args.content);
    const verify = verifyWritten(abs, args.content);
    if (!verify.ok) return { ok: false, content: verify.detail };
    const { text, stats } = unifiedDiff(before, args.content, args.path);
    return {
      ok: true,
      content: `Wrote ${args.path} (+${stats.additions} -${stats.deletions}).`,
      diffText: text,
    };
  },
};
