// grep: ripgrep when the machine has it (fast), a pure-JS walk when it does
// not (correct). Same output shape either way.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { capContent, type ToolDef } from './index.js';
import { walkFiles } from './walk.js';
import { minimatch } from '../util/minimatch.js';
import { markedLocal, workspaceNotes, type NoteShowing } from './workspaceNotes.js';

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
    // A match inside a vault note is judged as vaultSearch judges one (D5):
    // an excluded note's lines are left out on every seat, a local-only
    // note's on a seat that leaves this network, and a seat that stays gets
    // them marked, so they never travel on.
    const notes = workspaceNotes(ctx);
    const none = { ok: true, content: `No matches for /${args.pattern}/.` };
    if (hasRipgrep()) {
      const rgArgs = ['--line-number', '--no-heading', '--color', 'never', '-m', String(max)];
      if (!args.caseSensitive) rgArgs.push('-i');
      if (args.glob) rgArgs.push('-g', args.glob);
      // With a vault on this computer each path ends in a NUL, so the file a
      // line came from is read exactly whatever its name holds.
      if (notes) rgArgs.push('--null');
      rgArgs.push('--', args.pattern, '.');
      const res = spawnSync('rg', rgArgs, { cwd: ctx.cwd, encoding: 'utf8', timeout: 20_000 });
      if (res.status === 0) {
        let lines = res.stdout.trim().split('\n');
        let local = false;
        if (notes) {
          const verdicts = new Map<string, NoteShowing>();
          const kept: string[] = [];
          for (const line of lines) {
            const nul = line.indexOf('\u0000');
            if (nul === -1) continue;
            const file = line.slice(0, nul);
            let showing = verdicts.get(file);
            if (showing === undefined) {
              showing = await notes.showing(join(ctx.cwd, file));
              verdicts.set(file, showing);
            }
            if (showing === 'closed' || showing === 'withheld') continue;
            if (showing === 'shown-local') local = true;
            kept.push(`${file}:${line.slice(nul + 1)}`);
          }
          if (!kept.length) return none;
          lines = kept;
        }
        return markedLocal(
          { ok: true, content: capContent(lines.slice(0, max).join('\n')) },
          local,
        );
      }
      if (res.status === 1) return none;
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
    let local = false;
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
      let judged: NoteShowing | undefined;
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]!)) {
          // The walk follows links, so a note is known by its real path.
          judged ??= notes ? await notes.showing(join(ctx.cwd, rel), text) : 'open';
          if (judged === 'closed' || judged === 'withheld') break;
          if (judged === 'shown-local') local = true;
          hits.push(`${rel}:${i + 1}:${lines[i]!.trim().slice(0, 200)}`);
          if (hits.length >= max) {
            return markedLocal({ ok: true, content: capContent(hits.join('\n')) }, local);
          }
        }
      }
    }
    return hits.length
      ? markedLocal({ ok: true, content: capContent(hits.join('\n')) }, local)
      : none;
  },
};
