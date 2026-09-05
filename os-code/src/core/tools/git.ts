// Git tools for the agent: status, diff, commit. Backed by simple-git in the
// workspace root. Push stays a human-facing command (or an approved shell
// call); the agent's commit never pushes.
import { simpleGit } from 'simple-git';
import { z } from 'zod';
import { JailViolation } from '../security/jail.js';
import { capContent, type ToolDef } from './index.js';

const statusSchema = z.object({});

export const gitStatusTool: ToolDef<typeof statusSchema> = {
  name: 'gitStatus',
  description: 'Show git status: current branch, staged, modified, and untracked files.',
  schema: statusSchema,
  risk: 'read',
  async execute(_args, ctx) {
    try {
      const git = simpleGit(ctx.cwd);
      const status = await git.status();
      const lines = [
        `branch: ${status.current ?? '(detached)'}${status.tracking ? ` (tracks ${status.tracking})` : ''}`,
        status.staged.length ? `staged: ${status.staged.join(', ')}` : '',
        status.modified.length ? `modified: ${status.modified.join(', ')}` : '',
        status.not_added.length ? `untracked: ${status.not_added.join(', ')}` : '',
        status.deleted.length ? `deleted: ${status.deleted.join(', ')}` : '',
        status.isClean() ? 'working tree clean' : '',
      ].filter(Boolean);
      return { ok: true, content: lines.join('\n') };
    } catch (err) {
      return { ok: false, content: gitHint(err) };
    }
  },
};

const diffSchema = z.object({
  path: z.string().optional().describe('Limit the diff to one path'),
  staged: z.boolean().optional().describe('Show the staged diff instead of the working tree'),
});

export const gitDiffTool: ToolDef<typeof diffSchema> = {
  name: 'gitDiff',
  description: 'Show the git diff of the working tree (or staged changes).',
  schema: diffSchema,
  risk: 'read',
  async execute(args, ctx) {
    try {
      const git = simpleGit(ctx.cwd);
      const params: string[] = [];
      if (args.staged) params.push('--staged');
      if (args.path) params.push('--', args.path);
      const diff = await git.diff(params);
      return { ok: true, content: diff.trim() ? capContent(diff) : 'No changes.' };
    } catch (err) {
      return { ok: false, content: gitHint(err) };
    }
  },
};

const logSchema = z.object({
  count: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('How many commits to show, newest first (default 10, max 50)'),
  since: z
    .string()
    .max(80)
    .optional()
    .describe('Only commits after this point, e.g. "1 day ago", "yesterday", or "2026-09-01"'),
  patch: z.boolean().optional().describe("Include each commit's diff (capped for length)"),
  path: z.string().optional().describe('Limit to commits touching one path'),
});

/** Recent history, read-only. The read-risk sibling of gitDiff, so a plan-mode
 *  (read-only) session, and an unattended routine, can review what landed
 *  without a shell. Arguments reach git as argv, never a shell line. */
export const gitLogTool: ToolDef<typeof logSchema> = {
  name: 'gitLog',
  description:
    'Show recent commits (hash, date, author, subject, and the files each touched), newest first, optionally with their diffs. Read-only; use it to review what changed over a period.',
  schema: logSchema,
  risk: 'read',
  async execute(args, ctx) {
    try {
      const git = simpleGit(ctx.cwd);
      const params = [
        'log',
        `-n${args.count ?? 10}`,
        '--date=iso',
        '--format=%h %ad %an%n  %s',
        '--stat',
      ];
      if (args.since) params.push(`--since=${args.since}`);
      if (args.patch) params.push('-p');
      if (args.path) params.push('--', args.path);
      const out = await git.raw(params);
      return { ok: true, content: out.trim() ? capContent(out) : 'No commits match.' };
    } catch (err) {
      return { ok: false, content: gitHint(err) };
    }
  },
};

const commitSchema = z.object({
  message: z.string().min(1).describe('Commit message'),
  paths: z
    .array(z.string())
    .optional()
    .describe('Paths to stage; omit to stage every change in the workspace'),
});

export const gitCommitTool: ToolDef<typeof commitSchema> = {
  name: 'gitCommit',
  description: 'Stage the given paths (or all changes) and create a git commit. Never pushes.',
  schema: commitSchema,
  risk: 'write',
  async preview(args) {
    const scope = args.paths?.length ? args.paths.join(', ') : 'all changes';
    return { summary: `git commit (${scope})`, detail: `Message: ${args.message}` };
  },
  async execute(args, ctx) {
    // Explicit paths go through the jail first, so a path that leaves the
    // workspace is refused here and never handed to git (ENG-8).
    let pathspec: string[] = [];
    try {
      pathspec = (args.paths ?? []).map((p) => ctx.jail.resolve(p));
    } catch (err) {
      if (err instanceof JailViolation) return { ok: false, content: `Not staged: ${err.message}` };
      throw err;
    }
    try {
      const git = simpleGit(ctx.cwd);
      // `git add -A` with no pathspec stages the whole repository since Git
      // 2.0, not just the workspace; `.` pins it to the working directory.
      await git.add(pathspec.length ? ['--', ...pathspec] : ['-A', '--', '.']);
      const result = await git.commit(args.message);
      if (!result.commit) {
        return { ok: false, content: 'Nothing to commit. The working tree is clean.' };
      }
      return {
        ok: true,
        content: `Committed ${result.commit.slice(0, 10)} on ${result.branch}: ${args.message} (${result.summary.changes} files, +${result.summary.insertions} -${result.summary.deletions})`,
      };
    } catch (err) {
      return { ok: false, content: gitHint(err) };
    }
  },
};

function gitHint(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/not a git repository/i.test(msg)) {
    return 'This workspace is not a git repository. Run git init first if version control is wanted.';
  }
  return `git failed: ${msg.split('\n')[0]}`;
}
