// Specialist delegation tools. The orchestrator calls a specialist the way
// it calls any tool: hand over a subtask, fold the answer back in. When the
// needed specialist is not enabled, the router quietly answers with the
// orchestrator itself; delegation never hard-fails a task.
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { z } from 'zod';
import type { ToolDef } from './index.js';

const delegateSchema = z.object({
  role: z
    .enum(['coding', 'writing', 'analysis', 'fast'])
    .describe(
      'Which specialist: coding (hard code subtasks), writing (prose and docs), analysis (math and data), or fast (trivial edits, quick answers)',
    ),
  task: z
    .string()
    .min(1)
    .describe('The complete, self-contained subtask, including any code it needs to see'),
});

export const delegateTool: ToolDef<typeof delegateSchema> = {
  name: 'delegate',
  description:
    'Hand a self-contained subtask to an enabled specialist model and get its answer back: coding for hard code generation, writing for prose, analysis for math and data, fast for trivial work.',
  schema: delegateSchema,
  risk: 'read',
  async execute(args, ctx) {
    if (!ctx.delegate) {
      return {
        ok: false,
        content: 'Delegation is not available in this session; do the subtask yourself.',
      };
    }
    try {
      const answer = await ctx.delegate(args.role, args.task);
      return { ok: true, content: answer };
    } catch (err) {
      return {
        ok: false,
        content: `The ${args.role} specialist could not take this (${(err as Error).message}). Do the subtask yourself.`,
      };
    }
  },
};

const analyzeSchema = z.object({
  path: z
    .string()
    .describe('Path to the image file (workspace-relative, or a file from the inbox)'),
  question: z.string().min(1).describe('What to find out about the image'),
});

const MEDIA: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export const analyzeImageTool: ToolDef<typeof analyzeSchema> = {
  name: 'analyzeImage',
  description:
    'Look at an image (screenshot, chart, mockup) with the vision specialist and answer a question about it.',
  schema: analyzeSchema,
  risk: 'read',
  pathOf: (args) => args.path,
  async execute(args, ctx) {
    if (!ctx.delegate) {
      return { ok: false, content: 'Vision analysis is not available in this session.' };
    }
    const mediaType = MEDIA[extname(args.path).toLowerCase()];
    if (!mediaType) {
      return {
        ok: false,
        content: `Unsupported image type "${extname(args.path)}". Use png, jpg, gif, or webp.`,
      };
    }
    let base64: string;
    try {
      const abs = ctx.jail.resolve(args.path);
      base64 = readFileSync(abs).toString('base64');
    } catch (err) {
      return { ok: false, content: `Could not read ${args.path}: ${(err as Error).message}` };
    }
    try {
      const answer = await ctx.delegate('vision', args.question, [{ base64, mediaType }]);
      return { ok: true, content: answer };
    } catch (err) {
      return { ok: false, content: `Vision analysis failed: ${(err as Error).message}` };
    }
  },
};

const searchRepoSchema = z.object({
  query: z.string().min(1).describe('What code or concept to find in the repository'),
  k: z.number().int().min(1).max(20).optional().describe('How many chunks (default 6)'),
});

export const searchRepoTool: ToolDef<typeof searchRepoSchema> = {
  name: 'searchRepo',
  description:
    'Semantic search over the repository index: find the code most relevant to a concept, even when the words differ. Falls back to grep-style search when no embedding index exists.',
  schema: searchRepoSchema,
  risk: 'read',
  async execute(args, ctx) {
    if (!ctx.searchRepo) {
      return {
        ok: false,
        content: 'Repo search is not available; use grep and glob instead.',
      };
    }
    try {
      const found = await ctx.searchRepo(args.query, args.k ?? 6);
      return {
        ok: true,
        content: found || 'Nothing relevant found; try grep with concrete symbols.',
      };
    } catch (err) {
      return {
        ok: false,
        content: `Repo search failed: ${(err as Error).message}. Use grep instead.`,
      };
    }
  },
};
