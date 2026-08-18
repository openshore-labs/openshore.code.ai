import { z } from 'zod';
import { capContent, type ToolDef } from './index.js';
import { walkFiles } from './walk.js';
import { minimatch } from '../util/minimatch.js';

const schema = z.object({
  pattern: z.string().describe('Glob pattern, e.g. src/**/*.ts or *.json'),
  maxResults: z.number().int().min(1).max(1000).optional().describe('Default 200'),
});

export const globTool: ToolDef<typeof schema> = {
  name: 'glob',
  description: 'List workspace files matching a glob pattern.',
  schema,
  risk: 'read',
  async execute(args, ctx) {
    const max = args.maxResults ?? 200;
    const matches: string[] = [];
    for (const rel of walkFiles(ctx.cwd)) {
      if (minimatch(rel, args.pattern)) {
        matches.push(rel);
        if (matches.length >= max) break;
      }
    }
    if (!matches.length) {
      return { ok: true, content: `Nothing matches ${args.pattern}. Try a broader pattern like **/*name*.` };
    }
    matches.sort();
    return { ok: true, content: capContent(matches.join('\n')) };
  },
};
