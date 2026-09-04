// The project-memory write tool. A narrow, hard-scoped capability: it writes
// ONLY the five managed notes inside the current project's memory folder
// ("OpenShore Project <name> MDs/") in the repo working tree, and nothing else.
// Because it cannot touch anything outside that set, its writes land silently
// but visibly: the permission engine auto-allows it by name, while every general
// write (writeFile, editFile, vaultWrite) still asks. This is the founder's
// "narrow exception". The notes live in the repo and ride into the agent's
// commits with the code. No em dashes anywhere in this file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { unifiedDiff } from '../edit/diff.js';
import type { ToolContext, ToolDef } from './index.js';
import {
  MEMORY_FILES,
  PROJECT_MEMORY_WRITE_TOOL,
  isMemoryFilePath,
  memoryFilePath,
  memorySeeds,
  memorySegment,
} from '../agent/projectMemory.js';

const TITLES = MEMORY_FILES.map((f) => f.title) as [string, ...string[]];

/** The project's memory folder segment for this session, or a clear error when
 *  neither a project name nor the workspace basename yields one. */
function segmentOf(ctx: ToolContext): string {
  const seg = memorySegment(ctx.projectName, ctx.cwd);
  if (!seg) {
    throw new Error('This session has no project to keep memory for.');
  }
  return seg;
}

/** The repo-relative path this call targets, always one of the five managed
 *  files inside the current project's memory folder. Re-checked against
 *  isMemoryFilePath so the tool is provably incapable of writing anywhere else. */
function targetPath(ctx: ToolContext, file: string): string {
  const rel = memoryFilePath(segmentOf(ctx), file);
  if (!isMemoryFilePath(rel)) {
    throw new Error(`"${file}" is not one of the project memory notes.`);
  }
  return rel;
}

function applied(before: string, content: string, mode: 'replace' | 'append'): string {
  if (mode === 'append' && before) {
    return `${before}${before.endsWith('\n') ? '' : '\n'}${content}`;
  }
  return content;
}

/** Create any of the five notes that do not exist yet from their templates, so
 *  the folder always materializes as a complete set the first time it is
 *  touched. Never overwrites an existing note. Returns how many were created. */
function ensureSeeded(ctx: ToolContext, segment: string): number {
  let created = 0;
  for (const seed of memorySeeds(segment)) {
    const abs = ctx.jail.resolve(seed.path);
    if (existsSync(abs)) continue;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, seed.text);
    created += 1;
  }
  return created;
}

const writeSchema = z.object({
  file: z
    .enum(TITLES)
    .describe('Which project memory note to write: one of the five managed notes.'),
  content: z.string().describe('The markdown to save.'),
  mode: z
    .enum(['replace', 'append'])
    .default('replace')
    .describe(
      'replace the whole note (use for Current State), or append to the end (use to add a Progress log entry, a Decision line, or an Action Item)',
    ),
});

export const projectMemoryWriteTool: ToolDef<typeof writeSchema> = {
  name: PROJECT_MEMORY_WRITE_TOOL,
  description:
    'Update one of this project\'s five memory notes, kept in the repo under "OpenShore Project <name> MDs/" (Current State, Progress, Decisions, Action Items, Skills). Use it as work lands: refresh Current State (keep it a 2 to 5 minute read), add a Progress log entry, record an ambiguous call in Decisions, keep Action Items ranked, and capture reusable recipes in Skills. These writes save without interrupting the person and ride into your commit with the code. This tool can only write those five notes; use writeFile for anything else.',
  schema: writeSchema,
  risk: 'write',
  // Deliberately NOT alwaysAsk: the permission engine auto-allows this tool by
  // name because it is hard-scoped to the five memory files. General writes keep
  // their always-ask behavior.
  // Report the real target path so the engine can confirm it is a managed memory
  // file before auto-allowing. Never throws here (a bad segment falls to
  // undefined, which the engine treats as "not a memory file" and asks).
  pathOf: (args, ctx) => {
    const seg = ctx ? memorySegment(ctx.projectName, ctx.cwd) : '';
    return seg ? memoryFilePath(seg, args.file) : undefined;
  },
  async preview(args, ctx) {
    const rel = targetPath(ctx, args.file);
    const abs = ctx.jail.resolve(rel);
    const before = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    const after = applied(before, args.content, args.mode);
    const { text, stats } = unifiedDiff(before, after, rel);
    const verb = before ? (args.mode === 'append' ? 'Append to' : 'Update') : 'Create';
    return {
      summary: `Project memory: ${verb} ${rel} (+${stats.additions} -${stats.deletions})`,
      detail: text || '(no textual change)',
    };
  },
  async execute(args, ctx) {
    const segment = segmentOf(ctx);
    const rel = targetPath(ctx, args.file);
    // Materialize the full set from templates first, so a fresh project folder
    // arrives complete rather than with one lonely note.
    const seeded = ensureSeeded(ctx, segment);
    const abs = ctx.jail.resolve(rel);
    const before = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    const after = applied(before, args.content, args.mode);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, after);
    const { text, stats } = unifiedDiff(before, after, rel);
    const seedNote =
      seeded > 1 ? ` Created the memory folder with ${seeded} notes from templates.` : '';
    return {
      ok: true,
      content: `Updated project memory: ${rel} (+${stats.additions} -${stats.deletions}).${seedNote}`,
      diffText: text,
    };
  },
};
