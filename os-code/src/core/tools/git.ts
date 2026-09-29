// Git tools for the agent: status, diff, commit. Backed by simple-git in the
// workspace root. Push stays a human-facing command (or an approved shell
// call); the agent's commit never pushes.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { z } from 'zod';
import { JailViolation } from '../security/jail.js';
import { containsSecret } from '../security/redaction.js';
import { defaultBranchOf } from '../../git/reconcile.js';
import type { StageFile, StageSecret } from '../agent/types.js';
import { capContent, type ToolContext, type ToolDef } from './index.js';

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

/** Files a secret usually lives in, by name (CX 7): a settings file of keys
 *  (`.env`, `.env.local`, but not the committed templates), a certificate or
 *  private key (`*.pem`), a private login key (`id_rsa`, `id_ed25519`, never
 *  the `.pub` half). */
const ENV_TEMPLATE = /\.(?:example|sample|template|dist)$/i;

/** Why a file may hold a secret: by its name first, then by what it says,
 *  read only for a text file of modest size. Undefined for a plain file. */
export function stageSecretOf(
  path: string,
  read: () => string | undefined,
): StageSecret | undefined {
  const name = (path.split('/').pop() ?? path).toLowerCase();
  if ((name === '.env' || name.startsWith('.env.')) && !ENV_TEMPLATE.test(name)) return 'env';
  if (name.endsWith('.pem')) return 'pem';
  if (name.startsWith('id_') && !name.endsWith('.pub')) return 'login-key';
  const text = read();
  return text !== undefined && containsSecret(text) ? 'detected' : undefined;
}

/** The most of one file read to look for a secret; past it the file is
 *  judged by its name alone. */
const SECRET_SCAN_BYTES = 512 * 1024;

function readForScan(abs: string): string | undefined {
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > SECRET_SCAN_BYTES) return undefined;
    const buf = readFileSync(abs);
    // A binary file (a NUL early on) is not scanned as text.
    if (buf.subarray(0, 8000).includes(0)) return undefined;
    return buf.toString('utf8');
  } catch {
    return undefined;
  }
}

function nulList(out: string): string[] {
  return out.split('\0').filter(Boolean);
}

/**
 * Every file this commit would record, repo-relative with forward slashes,
 * each flagged when it may hold a secret (D3): what is staged already
 * anywhere (a commit takes the whole index), plus the tracked changes and new
 * files under `pathspec` (the workspace when none), which the commit stages.
 */
export async function commitStageFiles(
  git: SimpleGit,
  root: string,
  pathspec: string[],
): Promise<StageFile[]> {
  const spec = pathspec.length ? pathspec : ['.'];
  const [staged, changed, fresh] = await Promise.all([
    git.raw(['diff', '--cached', '--name-only', '-z', '--no-renames']),
    git.raw(['diff', '--name-only', '-z', '--no-renames', '--', ...spec]),
    git.raw(['ls-files', '-z', '--others', '--exclude-standard', '--full-name', '--', ...spec]),
  ]);
  const paths = [...new Set([...nulList(staged), ...nulList(changed), ...nulList(fresh)])].sort();
  return paths.map((path) => {
    const secret = stageSecretOf(path, () => readForScan(join(root, path)));
    return secret ? { path, secret } : { path };
  });
}

/** The platform's own name for a remote address ("GitHub"), else its host. */
export function platformOfRemote(url: string): string | undefined {
  const trimmed = url.trim();
  let host: string | undefined;
  try {
    host = new URL(trimmed).hostname;
  } catch {
    // scp-style: git@github.com:owner/repo.git
    host = /^[^@\s]+@([^:\s]+):/.exec(trimmed)?.[1];
  }
  if (!host) return undefined;
  const h = host.toLowerCase();
  if (h === 'github.com') return 'GitHub';
  if (h === 'gitlab.com') return 'GitLab';
  if (h === 'bitbucket.org') return 'Bitbucket';
  return h;
}

/**
 * Where the app's sync sends this branch after a commit (CX 7's "and sent to
 * {platform}"), or undefined when the commit stays on this computer: the
 * project turned `sync.autoPush` off, the branch tracks nothing, or it tracks
 * the remote's default branch and the project has not opted in to pushing
 * that (the rules `reconcilePush` follows).
 */
async function pushDestination(
  git: SimpleGit,
  cwd: string,
  ctx: ToolContext,
): Promise<string | undefined> {
  if (ctx.config.sync?.autoPush === false) return undefined;
  try {
    const status = await git.status();
    if (!status.tracking) return undefined;
    const slash = status.tracking.indexOf('/');
    const remote = slash > 0 ? status.tracking.slice(0, slash) : 'origin';
    const branch = slash > 0 ? status.tracking.slice(slash + 1) : status.tracking;
    if (ctx.config.sync?.autoPushDefaultBranch !== true) {
      const def = await defaultBranchOf(cwd, remote);
      if (def && def === branch) return undefined;
    }
    const url = String(await git.remote(['get-url', remote])).trim();
    return platformOfRemote(url);
  } catch {
    return undefined;
  }
}

/** The explicit paths through the jail, so one that leaves the workspace is
 *  refused and never handed to git (ENG-8). */
function jailedPaths(paths: string[] | undefined, ctx: ToolContext): string[] {
  return (paths ?? []).map((p) => ctx.jail.resolve(p));
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const gitCommitTool: ToolDef<typeof commitSchema> = {
  name: 'gitCommit',
  description:
    'Stage the given paths (or all changes) and create a git commit. Never pushes. A file that may hold a secret (.env, a key) is left out unless the person ticks it.',
  schema: commitSchema,
  risk: 'write',
  async preview(args, ctx) {
    const scope = args.paths?.length ? args.paths.join(', ') : 'all changes';
    const git = simpleGit(ctx.cwd);
    const root = (await git.revparse(['--show-toplevel'])).trim();
    const files = await commitStageFiles(git, root, jailedPaths(args.paths, ctx));
    const pushesTo = await pushDestination(git, ctx.cwd, ctx);
    // The terminal clients read the detail; the app renders the list itself.
    const lines = files.map(
      (f) => `  ${f.path}${f.secret ? ' (may hold a secret; left out)' : ''}`,
    );
    return {
      summary: `git commit (${scope})`,
      detail: [`Message: ${args.message}`, ...(lines.length ? ['Files:', ...lines] : [])].join(
        '\n',
      ),
      commit: { message: args.message, files, ...(pushesTo ? { pushesTo } : {}) },
    };
  },
  async execute(args, ctx, approved) {
    let pathspec: string[] = [];
    try {
      pathspec = jailedPaths(args.paths, ctx);
    } catch (err) {
      if (err instanceof JailViolation) return { ok: false, content: `Not staged: ${err.message}` };
      throw err;
    }
    try {
      const git = simpleGit(ctx.cwd);
      const root = (await git.revparse(['--show-toplevel'])).trim();
      const listed = await commitStageFiles(git, root, pathspec);
      // What the person ticked, or with no answer naming files, every listed
      // file but those that may hold a secret: those stay out unless ticked.
      const chosen = new Set(approved?.files ?? listed.filter((f) => !f.secret).map((f) => f.path));
      const leftOut = listed.filter((f) => f.secret && !chosen.has(f.path)).map((f) => f.path);
      // `git add -A` with no pathspec stages the whole repository since Git
      // 2.0, not just the workspace; `.` pins it to the working directory.
      await git.add(pathspec.length ? ['--', ...pathspec] : ['-A', '--', '.']);
      // Then everything staged that the person did not keep goes back out of
      // the index, so the commit holds exactly the approved files.
      const staged = nulList(
        await git.raw(['diff', '--cached', '--name-only', '-z', '--no-renames']),
      );
      const drop = staged.filter((p) => !chosen.has(p));
      if (drop.length) await unstage(simpleGit(root), drop);
      const note = leftOut.length
        ? ` Left out ${plural(leftOut.length, 'file that may hold a secret', 'files that may hold secrets')}: ${leftOut.join(', ')}. They stay out unless the person ticks them.`
        : '';
      if (staged.length === drop.length) {
        const why = leftOut.length ? '' : ' The working tree is clean.';
        return { ok: false, content: `Nothing to commit.${why}${note}` };
      }
      const result = await git.commit(args.message);
      if (!result.commit) {
        return { ok: false, content: `Nothing to commit. The working tree is clean.${note}` };
      }
      return {
        ok: true,
        content: `Committed ${result.commit.slice(0, 10)} on ${result.branch}: ${args.message} (${result.summary.changes} files, +${result.summary.insertions} -${result.summary.deletions}).${note}`,
      };
    } catch (err) {
      return { ok: false, content: gitHint(err) };
    }
  },
};

/** Take repo-relative paths back out of the index: to HEAD's version when
 *  there is a HEAD, or out of a first commit altogether. Paths are literal,
 *  never globs, and run from the repository's root. */
async function unstage(rootGit: SimpleGit, paths: string[]): Promise<void> {
  // `rev-parse --verify -q` prints nothing (and exits 1) before a first commit.
  let hasHead = false;
  try {
    hasHead = (await rootGit.raw(['rev-parse', '--verify', '-q', 'HEAD'])).trim().length > 0;
  } catch {
    hasHead = false;
  }
  const args = hasHead
    ? ['--literal-pathspecs', 'reset', '-q', 'HEAD', '--', ...paths]
    : ['--literal-pathspecs', 'rm', '--cached', '-q', '-r', '--ignore-unmatch', '--', ...paths];
  await rootGit.raw(args);
}

function gitHint(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/not a git repository/i.test(msg)) {
    return 'This workspace is not a git repository. Run git init first if version control is wanted.';
  }
  return `git failed: ${msg.split('\n')[0]}`;
}
