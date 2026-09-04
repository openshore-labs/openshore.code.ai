// The project-memory write tool. A narrow, hard-scoped capability: it writes
// ONLY the five managed notes under the current project's memory folder
// (Projects/<project>/), and nothing else. Because it cannot touch anything
// outside that set, its writes land silently but visibly: the permission engine
// auto-allows it by name, while every general vault write (vaultWriteTool) still
// always-asks. This is the founder's "narrow exception" to the vault always-ask
// rule. No em dashes anywhere in this file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { Jail } from '../security/jail.js';
import { unifiedDiff } from '../edit/diff.js';
import type { ToolContext, ToolDef } from './index.js';
import {
  MEMORY_FILES,
  PROJECT_MEMORY_WRITE_TOOL,
  isMemoryFilePath,
  memoryFilePath,
  memorySegment,
} from '../agent/projectMemory.js';

const TITLES = MEMORY_FILES.map((f) => f.title) as [string, ...string[]];

/** The vault root for this session as a jail, so a note path can never escape
 *  it (symlinks included). Shared shape with the general vault tools. */
function vaultJail(ctx: ToolContext): Jail {
  if (!ctx.vaultRoot) throw new Error('The vault is not configured for this session.');
  mkdirSync(ctx.vaultRoot, { recursive: true });
  return new Jail(ctx.vaultRoot);
}

/** The project's memory folder segment for this session, or a clear error when
 *  neither a project name nor the workspace basename yields one. */
function segmentOf(ctx: ToolContext): string {
  const seg = memorySegment(ctx.projectName, ctx.cwd);
  if (!seg) {
    throw new Error('This session has no project to keep memory for.');
  }
  return seg;
}

/** The vault-relative path this call targets, always one of the five managed
 *  files under the current project. Re-checked against isMemoryFilePath so the
 *  tool is provably incapable of writing anywhere else. */
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
    "Update one of this project's five memory notes in the Vault (Current State, Progress, Decisions, Action Items, Skills). Use it as work lands: refresh Current State (keep it a 2 to 5 minute read), add a Progress log entry, record an ambiguous call in Decisions, keep Action Items ranked, and capture reusable recipes in Skills. These writes save without interrupting the person. This tool can only write those five notes; use vaultWrite for any other note.",
  schema: writeSchema,
  risk: 'write',
  // Deliberately NOT alwaysAsk: the permission engine auto-allows this tool by
  // name because it is hard-scoped to the five memory files. General vault
  // writes keep their always-ask guarantee.
  // Report the real target path so the engine can confirm it is a managed
  // memory file before auto-allowing. Never throws here (a bad segment falls
  // to undefined, which the engine treats as "not a memory file" and asks).
  pathOf: (args, ctx) => {
    const seg = ctx ? memorySegment(ctx.projectName, ctx.cwd) : '';
    return seg ? memoryFilePath(seg, args.file) : undefined;
  },
  async preview(args, ctx) {
    const rel = targetPath(ctx, args.file);
    const abs = vaultJail(ctx).resolve(rel);
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
    const jail = vaultJail(ctx);
    const rel = targetPath(ctx, args.file);
    const abs = jail.resolve(rel);
    const before = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    const after = applied(before, args.content, args.mode);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, after);
    const { text, stats } = unifiedDiff(before, after, rel);
    return {
      ok: true,
      content: `Updated project memory: ${rel} (+${stats.additions} -${stats.deletions}).`,
      diffText: text,
    };
  },
};
