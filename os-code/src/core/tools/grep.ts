// grep: ripgrep when the machine has it (fast), a pure-JS walk when it does
// not (correct). Same output shape either way.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { capContent, type ToolDef } from './index.js';
import { walkFiles } from './walk.js';
import { minimatch } from '../util/minimatch.js';

const schema = z.object({
  pattern: z.string().describe('Regular expression to search for'),
  glob: z.string().optional().describe('Only search files matching this glob, e.g. src/**/*.ts'),
  caseSensitive: z.boolean().optional().describe('Default false'),
  maxResults: z.number().int().min(1).max(500).optional().describe('Default 50'),
});

let rgAvailable: boolean | undefined;
function hasRipgrep(): boolean {
  if (rgAvailable === undefined) {
    rgAvailable = spawnSync('rg', ['--version'], { stdio: 'ignore' }).status === 0;
  }
  return rgAvailable;
}

/** Test seam. */
export function _setRipgrep(v: boolean | undefined): void {
  rgAvailable = v;
}

export const grepTool: ToolDef<typeof schema> = {
  name: 'grep',
  description:
    'Search file contents across the workspace with a regex. Returns file:line: matches.',
  schema,
  risk: 'read',
  async execute(args, ctx) {
    const max = args.maxResults ?? 50;
    if (hasRipgrep()) {
      const rgArgs = ['--line-number', '--no-heading', '--color', 'never', '-m', String(max)];
      if (!args.caseSensitive) rgArgs.push('-i');
      if (args.glob) rgArgs.push('-g', args.glob);
      rgArgs.push('--', args.pattern, '.');
      const res = spawnSync('rg', rgArgs, { cwd: ctx.cwd, encoding: 'utf8', timeout: 20_000 });
      if (res.status === 0) {
        const lines = res.stdout.trim().split('\n').slice(0, max);
        return { ok: true, content: capContent(lines.join('\n')) };
      }
      if (res.status === 1) return { ok: true, content: `No matches for /${args.pattern}/.` };
      return {
        ok: false,
        content: `Search failed: ${res.stderr?.trim() || 'ripgrep error'}. Check the regex.`,
      };
    }

    // Pure-JS fallback.
    let re: RegExp;
    try {
      re = new RegExp(args.pattern, args.caseSensitive ? '' : 'i');
    } catch (err) {
      return { ok: false, content: `That is not a valid regex: ${(err as Error).message}` };
    }
    const hits: string[] = [];
    for (const rel of walkFiles(ctx.cwd)) {
      if (args.glob && !minimatch(rel, args.glob)) continue;
      let text: string;
      try {
        text = readFileSync(`${ctx.cwd}/${rel}`, 'utf8');
      } catch {
        continue;
      }
      if (text.includes('\u0000')) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]!)) {
          hits.push(`${rel}:${i + 1}:${lines[i]!.trim().slice(0, 200)}`);
          if (hits.length >= max) {
            return { ok: true, content: capContent(hits.join('\n')) };
          }
        }
      }
    }
    return {
      ok: true,
      content: hits.length ? capContent(hits.join('\n')) : `No matches for /${args.pattern}/.`,
    };
  },
};
