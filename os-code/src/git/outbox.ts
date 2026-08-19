// Materialize a buffered commit-intent from a phone into a real git commit and
// push it, on the desktop the daemon serves. This is the server counterpart to
// the client protocol in app/src/lib/repoSync.ts, and it holds the line the CTO
// drew: it NEVER touches the live working tree or index (the founder may be
// sitting at this machine editing), it confines every write inside the repo,
// it is idempotent on clientOpId via a durable receipts log, and a conflict
// lands on a rescue branch rather than force-pushing over anyone.
//
// The commit is built with plumbing: hash-object the post-images into the
// object store, assemble a tree in a TEMPORARY index, commit-tree onto the
// branch tip, then a compare-and-swap ref update and a fast-forward push. We
// shell git directly (execFile) rather than through simple-git so we can set
// GIT_INDEX_FILE and the author identity without its env guards fighting us.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { oscHome } from '../config/load.js';

const run = promisify(execFile);

export interface OutboxApplyFile {
  path: string;
  mode: 'upsert' | 'delete';
  /** Post-image content, base64. Required for upsert, ignored for delete. */
  contentBase64?: string;
}

export interface OutboxApplyRequest {
  /** Repo root on the desktop. Must be an existing git repository. */
  cwd: string;
  clientOpId: string;
  itemId: string;
  deviceId: string;
  branch: string;
  message: string;
  baseCommit: string;
  files: OutboxApplyFile[];
}

export type OutboxApplyResult =
  | { ok: true; resultCommit: string; idempotentReplay?: boolean }
  | { ok: false; conflict: true; resultCommit: string; rescueBranch: string }
  | { ok: false; error: string };

const AUTHOR_ENV = {
  GIT_AUTHOR_NAME: 'OS Code',
  GIT_AUTHOR_EMAIL: 'bot@os-code.local',
  GIT_COMMITTER_NAME: 'OS Code',
  GIT_COMMITTER_EMAIL: 'bot@os-code.local',
};

/** Run a git subcommand in cwd, returning trimmed stdout. Throws on non-zero. */
async function git(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
  const { stdout } = await run('git', args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

/** True/false subcommands (merge-base --is-ancestor, ref CAS) via exit code. */
async function gitOk(cwd: string, args: string[]): Promise<boolean> {
  try {
    await git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

/**
 * Confine a file path to the repo root. Rejects absolute paths and any `..`
 * segment, then resolves and asserts containment. Pure and unit-tested.
 */
export function confinedPath(repoRoot: string, p: string): string {
  if (typeof p !== 'string' || !p) throw new Error('empty path');
  if (isAbsolute(p)) throw new Error(`absolute path rejected: ${p}`);
  if (p.split(/[\\/]/).some((seg) => seg === '..')) throw new Error(`parent segment rejected: ${p}`);
  const resolved = resolve(repoRoot, p);
  if (resolved !== repoRoot && !resolved.startsWith(repoRoot + sep)) {
    throw new Error(`path escapes repo: ${p}`);
  }
  return resolved;
}

// ---- durable receipts log (idempotency on clientOpId) ---------------------

interface Receipt {
  clientOpId: string;
  resultCommit: string;
  branch: string;
  appliedAt: string;
  conflict?: boolean;
  rescueBranch?: string;
}

function receiptsPath(repoRoot: string): string {
  const hash = createHash('sha256').update(repoRoot).digest('hex').slice(0, 16);
  return join(oscHome(), 'outbox', 'receipts', `${hash}.jsonl`);
}

export function lookupReceipt(repoRoot: string, clientOpId: string): Receipt | undefined {
  const path = receiptsPath(repoRoot);
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Receipt;
      if (row.clientOpId === clientOpId) return row;
    } catch {
      // skip a torn/partial line
    }
  }
  return undefined;
}

function appendReceipt(repoRoot: string, receipt: Receipt): void {
  mkdirSync(join(oscHome(), 'outbox', 'receipts'), { recursive: true });
  // Flush before the caller returns 200: a receipt must be at least as durable
  // as the commit it records, so a retried offload never double-applies.
  appendFileSync(receiptsPath(repoRoot), `${JSON.stringify(receipt)}\n`, { flush: true });
}

// ---- confirmation (the client's independent re-read) ----------------------

/**
 * Does this commit exist, and is it reachable from the branch? This is the
 * server side of the client's "confirm by an independent ref re-read, not the
 * HTTP 200" rule: the phone calls this after an apply and only then clears the
 * buffered item.
 */
export async function verifyCommit(input: {
  cwd: string;
  commit: string;
  branch?: string;
}): Promise<{ exists: boolean; onBranch: boolean }> {
  const exists = await gitOk(input.cwd, ['cat-file', '-e', `${input.commit}^{commit}`]);
  let onBranch = false;
  if (exists && input.branch) {
    onBranch = await gitOk(input.cwd, [
      'merge-base',
      '--is-ancestor',
      input.commit,
      `refs/heads/${input.branch}`,
    ]);
  }
  return { exists, onBranch };
}

// ---- the apply ------------------------------------------------------------

function tmp(prefix: string): string {
  return join(tmpdir(), `${prefix}_${randomBytes(8).toString('hex')}`);
}

/**
 * Apply one buffered commit-intent. Callers must serialize per repo (see
 * applyQueue.withKeyLock) so the temp-index dance is atomic.
 */
export async function applyOutboxItem(req: OutboxApplyRequest): Promise<OutboxApplyResult> {
  if (!(await gitOk(req.cwd, ['rev-parse', '--is-inside-work-tree']))) {
    return { ok: false, error: 'Not a git repository.' };
  }
  const repoRoot = await git(req.cwd, ['rev-parse', '--show-toplevel']);

  // Idempotency: a replay of an applied op returns the same commit, never re-commits.
  const prior = lookupReceipt(repoRoot, req.clientOpId);
  if (prior) {
    return prior.conflict
      ? { ok: false, conflict: true, resultCommit: prior.resultCommit, rescueBranch: prior.rescueBranch ?? '' }
      : { ok: true, resultCommit: prior.resultCommit, idempotentReplay: true };
  }

  // Validate every path up front, before writing a single object.
  for (const f of req.files) confinedPath(repoRoot, f.path);

  // The branch the edits were composed against must exist.
  let branchTip: string;
  try {
    branchTip = await git(req.cwd, ['rev-parse', '--verify', `refs/heads/${req.branch}`]);
  } catch {
    return { ok: false, error: `Branch ${req.branch} does not exist on the home repo.` };
  }

  // Build the tree in a throwaway index seeded from baseCommit; hash the
  // post-images into the object store. None of this touches the checkout.
  const indexFile = tmp('oscidx');
  const blobFiles: string[] = [];
  let tree: string;
  try {
    const idxEnv = { GIT_INDEX_FILE: indexFile };
    await git(req.cwd, ['read-tree', req.baseCommit], idxEnv);
    for (const f of req.files) {
      if (f.mode === 'delete') {
        await git(req.cwd, ['update-index', '--force-remove', f.path], idxEnv);
        continue;
      }
      const blobFile = tmp('oscblob');
      blobFiles.push(blobFile);
      writeFileSync(blobFile, Buffer.from(f.contentBase64 ?? '', 'base64'));
      const sha = await git(req.cwd, ['hash-object', '-w', blobFile]);
      await git(req.cwd, ['update-index', '--add', '--cacheinfo', `100644,${sha},${f.path}`], idxEnv);
    }
    tree = await git(req.cwd, ['write-tree'], idxEnv);
  } finally {
    for (const bf of blobFiles) if (existsSync(bf)) unlinkSync(bf);
    if (existsSync(indexFile)) unlinkSync(indexFile);
  }

  // Commit the tree onto the branch tip with a fixed bot identity.
  const resultCommit = await git(req.cwd, ['commit-tree', tree, '-p', branchTip, '-m', req.message], AUTHOR_ENV);

  const landOnRescue = async (): Promise<OutboxApplyResult> => {
    const rescueBranch = `oscode/outbox/${req.deviceId}/${req.itemId}`;
    await git(req.cwd, ['update-ref', `refs/heads/${rescueBranch}`, resultCommit]);
    await gitOk(req.cwd, ['push', '-u', 'origin', rescueBranch]); // saved locally even if remote is down
    appendReceipt(repoRoot, {
      clientOpId: req.clientOpId,
      resultCommit,
      branch: req.branch,
      appliedAt: new Date().toISOString(),
      conflict: true,
      rescueBranch,
    });
    return { ok: false, conflict: true, resultCommit, rescueBranch };
  };

  // Conflict gate: if the base is not an ancestor of the tip, someone moved the
  // branch. Never force-push; land on a rescue branch instead.
  if (!(await gitOk(req.cwd, ['merge-base', '--is-ancestor', req.baseCommit, branchTip]))) {
    return landOnRescue();
  }

  // Fast-forward: compare-and-swap the branch ref (fails if the tip moved during
  // apply, in which case we also rescue rather than clobber).
  if (!(await gitOk(req.cwd, ['update-ref', `refs/heads/${req.branch}`, resultCommit, branchTip]))) {
    return landOnRescue();
  }

  appendReceipt(repoRoot, {
    clientOpId: req.clientOpId,
    resultCommit,
    branch: req.branch,
    appliedAt: new Date().toISOString(),
  });
  await gitOk(req.cwd, ['push', 'origin', req.branch]); // client confirms against the ref; push retries next sync
  return { ok: true, resultCommit };
}
