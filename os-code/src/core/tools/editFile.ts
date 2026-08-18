// The editFile tool: structured search/replace blocks through the edit
// engine, with post-apply verification and a diff for approval. This is the
// top failure mode for local models, so every rejection message teaches the
// model how to fix its next attempt.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import type { ToolDef } from './index.js';
import { EDIT_FORMAT_DOC, parseEditBlocks } from '../edit/searchReplace.js';
import { applyEditBlocks } from '../edit/apply.js';
import { structuralCheck, verifyWritten } from '../edit/verify.js';
import { unifiedDiff } from '../edit/diff.js';

const schema = z.object({
  path: z.string().describe('File to edit, relative to the workspace root'),
  edits: z
    .string()
    .describe('One or more search/replace blocks in the exact SEARCH/REPLACE format'),
});

type Plan =
  | { error: string }
  | { error?: undefined; result: import('../edit/apply.js').ApplyResult; warnings: string[] };

function plan(args: z.infer<typeof schema>, before: string): Plan {
  const parsed = parseEditBlocks(args.edits);
  if (parsed.blocks.length === 0) {
    return {
      error: `No valid edit blocks found.${parsed.problems.length ? ` Problems: ${parsed.problems.join(' ')}` : ''}\n${EDIT_FORMAT_DOC}`,
    };
  }
  const result = applyEditBlocks(before, parsed.blocks);
  if (!result.ok) {
    const reasons = result.failures.map((f) => `Block ${f.index + 1}: ${f.reason}`).join('\n');
    return { error: `The edit did not apply.\n${reasons}` };
  }
  return { result, warnings: parsed.problems };
}

export const editFileTool: ToolDef<typeof schema> = {
  name: 'editFile',
  description: `Edit part of a file with search/replace blocks. ${EDIT_FORMAT_DOC}`,
  schema,
  risk: 'write',
  pathOf: (args) => args.path,
  async preview(args, ctx) {
    const abs = ctx.jail.resolve(args.path);
    if (!existsSync(abs)) return { summary: `Edit ${args.path}`, detail: 'File does not exist.' };
    const before = readFileSync(abs, 'utf8');
    const planned = plan(args, before);
    if (planned.error !== undefined) return { summary: `Edit ${args.path}`, detail: planned.error };
    const { text, stats } = unifiedDiff(before, planned.result.content, args.path);
    return { summary: `Edit ${args.path} (+${stats.additions} -${stats.deletions})`, detail: text };
  },
  async execute(args, ctx) {
    const abs = ctx.jail.resolve(args.path);
    if (!existsSync(abs)) {
      return {
        ok: false,
        content: `No file at ${args.path}. To create a new file use writeFile.`,
      };
    }
    const before = readFileSync(abs, 'utf8');
    const planned = plan(args, before);
    if (planned.error !== undefined) return { ok: false, content: planned.error };

    const after = planned.result.content;
    const structural = structuralCheck(abs, after);
    if (!structural.ok) {
      return {
        ok: false,
        content: `The edit was NOT applied because verification failed: ${structural.detail}`,
      };
    }
    writeFileSync(abs, after);
    const verify = verifyWritten(abs, after);
    if (!verify.ok) return { ok: false, content: verify.detail };

    const { text, stats } = unifiedDiff(before, after, args.path);
    const strategies = planned.result.applied.map((a) => a.strategy);
    const fuzzyNote = strategies.includes('anchored')
      ? ' One block matched by context anchors rather than exactly; the diff shows precisely what changed.'
      : '';
    return {
      ok: true,
      content: `Applied ${planned.result.applied.length} edit${planned.result.applied.length === 1 ? '' : 's'} to ${args.path} (+${stats.additions} -${stats.deletions}).${fuzzyNote}`,
      diffText: text,
    };
  },
};
