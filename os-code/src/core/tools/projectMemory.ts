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
  CURRENT_STATE_FILE,
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

// ---------------------------------------------------------------------------
// The harness keeps Current State current for lean seats (Vault M4, 4.7, CTO
// I12). After a change verifies on a small or tiny seat, the loop records one
// dated line itself, so a 7B that never calls projectMemoryWrite still leaves
// its project memory true. Called directly by the loop, never through
// executeTool: it cannot mark the task as having written, rerun verify, or ask.

/** Every line the harness writes ends with this, so the person can tell it
 *  from their own and the harness can prune only its own. */
export const HARNESS_LINE_MARK = '(noted by the harness)';

/** The most harness lines Current State keeps; the oldest go first. Current
 *  State is a summary, not a log. */
export const HARNESS_LINES_KEPT = 5;

const LANDED_HEADING = '## What last landed and launched';
const LANDED_PLACEHOLDER = 'Nothing yet. The first change to land is recorded here.';

const isHarnessLine = (line: string): boolean =>
  line.trimStart().startsWith('- ') && line.trimEnd().endsWith(HARNESS_LINE_MARK);

/**
 * Current State with `line` put first under "What last landed and launched".
 * Pure. Undefined when the section already holds that exact line (a repeat
 * run writes nothing). The seed's placeholder sentence goes once a real line
 * lands; past `HARNESS_LINES_KEPT` harness lines, the oldest (lowest) go. A
 * note with no such section gets one at its end.
 */
export function withLandedLine(text: string, line: string): string | undefined {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.trim().toLowerCase() === LANDED_HEADING.toLowerCase());
  if (at === -1) {
    const body = text.endsWith('\n') || !text ? text : `${text}\n`;
    return `${body}${body ? '\n' : ''}${LANDED_HEADING}\n${line}\n`;
  }
  let end = lines.findIndex((l, i) => i > at && /^#{1,2} /.test(l));
  if (end === -1) end = lines.length;
  const section = lines.slice(at + 1, end);
  if (section.some((l) => l.trim() === line.trim())) return undefined;
  const kept = section.filter((l) => l.trim() !== LANDED_PLACEHOLDER);
  kept.unshift(line);
  let harness = kept.filter(isHarnessLine).length;
  for (let i = kept.length - 1; i >= 0 && harness > HARNESS_LINES_KEPT; i--) {
    if (isHarnessLine(kept[i]!)) {
      kept.splice(i, 1);
      harness -= 1;
    }
  }
  return [...lines.slice(0, at + 1), ...kept, ...lines.slice(end)].join('\n');
}

/**
 * Write one harness line into this project's Current State (seeding the five
 * notes first, as the tool does, when the folder is new). Returns the
 * repo-relative path and whether anything was written; false for a repeat.
 */
export function appendLandedLine(
  ctx: ToolContext,
  line: string,
): { written: boolean; path: string } {
  const segment = segmentOf(ctx);
  const rel = targetPath(ctx, CURRENT_STATE_FILE);
  const abs = ctx.jail.resolve(rel);
  const before = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
  const after = withLandedLine(before, line);
  if (after === undefined) return { written: false, path: rel };
  ensureSeeded(ctx, segment);
  // Seeding may have just created the note: apply the line to what is there.
  const seeded = before ? after : withLandedLine(readFileSync(abs, 'utf8'), line);
  if (seeded === undefined) return { written: false, path: rel };
  writeFileSync(abs, seeded);
  return { written: true, path: rel };
}
