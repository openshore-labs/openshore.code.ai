// Reconcile a local clone with its remote: push the branch's unpushed commits,
// and when the remote has moved on, merge it in and push the result. This is the
// engine behind the app's "nothing stays only on your device" promise. The
// project's memory notes ride into ordinary commits with the code, so pushing
// the branch is what carries them to wherever the project points.
//
// Safety rails (these are load-bearing, not optional):
//  - Only ever pushes the current branch to its OWN tracking upstream. No
//    upstream means we do not guess a remote or branch; we report and stop.
//  - Never force-pushes. On divergence we fetch and merge; a real merge conflict
//    is aborted (the working tree is left exactly as it was) and surfaced for the
//    person to resolve. Nothing is clobbered and nothing is lost.
//  - Never merges over uncommitted work: a dirty tree on divergence is reported,
//    not stepped on.
//  - Never auto-pushes the repository's DEFAULT branch (the one origin/HEAD
//    points at, else main, else master) unless the project opted in with
//    sync.autoPushDefaultBranch in its os-code.config.json (board call 5,
//    2026-09-16). A branch whose push deploys is the person's to push. Other
//    branches keep the durable-outbox behavior. A held branch is reported as
//    'held' so the app can name what it did not push.
// No em dashes anywhere in this file (repo policy is total here).
import { simpleGit, type SimpleGit } from 'simple-git';
import { loadConfig } from '../config/load.js';

/** A git handle for reconcile work, time-bounded so a stalled transfer (an
 *  unreachable remote, a credential prompt that never gets answered) gives up
 *  after 20s rather than leaking a running op. The parent process environment
 *  (PATH, the credential helper, the SSH agent) passes through unchanged. */
function reconcileGit(cwd: string): SimpleGit {
  return simpleGit(cwd, { timeout: { block: 20_000 } });
}

/** Split a tracking ref ("origin/main", "origin/feature/x") into its remote and
 *  the upstream branch name, so the push targets the branch actually tracked,
 *  not a same-named branch on the remote. */
function splitTracking(tracking: string): { remote: string; branch: string } {
  const slash = tracking.indexOf('/');
  if (slash <= 0) return { remote: 'origin', branch: tracking };
  return { remote: tracking.slice(0, slash), branch: tracking.slice(slash + 1) };
}

export type ReconcileStatus =
  | 'not-repo' // the path is not a git repository
  | 'no-upstream' // the branch has no tracking remote; nothing to push safely to
  | 'clean' // no unpushed commits
  | 'held' // unpushed commits on the default branch; the project has not opted in
  | 'pushed' // pushed the branch's unpushed commits (fast-forward)
  | 'merged' // the remote had advanced; merged it in and pushed
  | 'conflict' // divergence we could not merge automatically; nothing pushed, nothing lost
  | 'offline' // the remote was unreachable
  | 'error'; // anything else, with a message

export interface ReconcileResult {
  cwd: string;
  status: ReconcileStatus;
  branch?: string;
  /** How many local commits were ahead of the remote when we started. */
  ahead?: number;
  /** A human sentence for the states that need one (conflict, offline, error). */
  message?: string;
}

/** True when a push failed because the remote moved on (a non-fast-forward),
 *  which is the signal to fetch and merge rather than give up. */
export function isNonFastForward(message: string): boolean {
  return /non-fast-forward|\[rejected\]|failed to push some refs|fetch first|tip of your current branch is behind/i.test(
    message,
  );
}

/** True when a git failure looks like a network or remote-availability problem,
 *  so it is worth retrying on reconnect rather than surfacing as an error. */
export function isOffline(message: string): boolean {
  return /could not resolve host|unable to access|could not read from remote|connection (timed out|refused|reset)|network is unreachable|ssh: connect to host|timed out|temporary failure in name resolution/i.test(
    message,
  );
}

/** The one line for a held default branch: what was not pushed, and why. */
export function DEFAULT_BRANCH_HELD(branch: string): string {
  return `${branch} is this repository's default branch, so it was not pushed for you. Push it yourself, or turn on sync.autoPushDefaultBranch in the project's os-code.config.json.`;
}

/** The branch a remote treats as its default: the one its HEAD points at
 *  (origin/HEAD, set by clone or `git remote set-head`), else main, else master
 *  when the remote has that branch. Undefined when none of those exist, which
 *  is a remote with no branches yet. */
export async function defaultBranchOf(cwd: string, remote: string): Promise<string | undefined> {
  const g = reconcileGit(cwd);
  try {
    const head = (await g.raw(['symbolic-ref', '-q', `refs/remotes/${remote}/HEAD`])).trim();
    const prefix = `refs/remotes/${remote}/`;
    if (head.startsWith(prefix)) return head.slice(prefix.length);
  } catch {
    // No origin/HEAD. Fall through to the conventional names.
  }
  try {
    const listed = await g.raw([
      'for-each-ref',
      '--format=%(refname)',
      `refs/remotes/${remote}/main`,
      `refs/remotes/${remote}/master`,
    ]);
    const have = new Set(
      listed
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    );
    for (const name of ['main', 'master']) {
      if (have.has(`refs/remotes/${remote}/${name}`)) return name;
    }
  } catch {
    // No refs to list; a remote with no branches yet.
  }
  return undefined;
}

export interface ReconcileOptions {
  /** Push the repository's default branch too. Off unless the project opted
   *  in; the caller passes the project's choice. */
  allowDefaultBranch?: boolean;
}

/** Whether this clone's project opted in to auto-pushing its default branch
 *  (sync.autoPushDefaultBranch in its os-code.config.json). Unreadable config
 *  means the default: not opted in. */
export function projectAllowsDefaultBranchPush(cwd: string): boolean {
  try {
    return loadConfig(cwd).config.sync?.autoPushDefaultBranch === true;
  } catch {
    return false;
  }
}

/** Push a clone's unpushed commits to its upstream, merging the remote in first
 *  when it has advanced. See the file header for the safety rails. */
export async function reconcilePush(
  cwd: string,
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const g = reconcileGit(cwd);
  if (!(await g.checkIsRepo())) return { cwd, status: 'not-repo' };

  const status = await g.status();
  const branch = status.current ?? undefined;
  if (!branch) return { cwd, status: 'error', message: 'No branch is checked out.' };
  // An unfinished merge (conflicted paths in the tree) is the person's to
  // resolve; never push or merge on top of it.
  if (status.conflicted.length > 0) {
    return {
      cwd,
      status: 'conflict',
      branch,
      message: 'This repository has an unfinished merge. Resolve it, then sync again.',
    };
  }
  if (!status.tracking) return { cwd, status: 'no-upstream', branch };
  const ahead = status.ahead ?? 0;
  if (ahead === 0) return { cwd, status: 'clean', branch, ahead: 0 };

  const { remote, branch: upstreamBranch } = splitTracking(status.tracking);

  // The default branch is the person's to push unless the project said
  // otherwise. Judged by the branch actually tracked, so a local "work" branch
  // tracking origin/main is held the same way main itself is.
  if (!options.allowDefaultBranch) {
    const def = await defaultBranchOf(cwd, remote);
    if (def && def === upstreamBranch) {
      return { cwd, status: 'held', branch, ahead, message: DEFAULT_BRANCH_HELD(upstreamBranch) };
    }
  }

  // First try a plain push of the current HEAD to the branch it tracks.
  try {
    await g.push(remote, `HEAD:${upstreamBranch}`);
    return { cwd, status: 'pushed', branch, ahead };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (isOffline(msg)) return { cwd, status: 'offline', branch, ahead, message: msg };
    if (!isNonFastForward(msg)) return { cwd, status: 'error', branch, ahead, message: msg };
    // fall through: the remote advanced, integrate it below
  }

  // Never merge over uncommitted work. If the tree is dirty on a divergence,
  // leave it untouched and ask the person to handle it.
  if (status.files.length > 0) {
    return {
      cwd,
      status: 'conflict',
      branch,
      ahead,
      message: 'The remote moved on and you have uncommitted changes. Sync after committing them.',
    };
  }

  // Fetch and merge the upstream in. A conflict is aborted so the tree is left
  // exactly as it was, and reported rather than forced.
  try {
    await g.fetch(remote, upstreamBranch);
    await g.merge([status.tracking]);
  } catch (err) {
    try {
      await g.merge(['--abort']);
    } catch {
      // No merge in progress to abort (e.g. the fetch itself failed); nothing
      // to undo. Fall through to classify the failure.
    }
    const msg = String((err as Error)?.message ?? err);
    if (isOffline(msg)) return { cwd, status: 'offline', branch, ahead, message: msg };
    return {
      cwd,
      status: 'conflict',
      branch,
      ahead,
      message: 'The notes changed on the remote too. Merge them by hand, then sync again.',
    };
  }

  // Merge is clean: push the integrated branch.
  try {
    await g.push(remote, `HEAD:${upstreamBranch}`);
    return { cwd, status: 'merged', branch, ahead };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (isOffline(msg)) return { cwd, status: 'offline', branch, ahead, message: msg };
    return { cwd, status: 'error', branch, ahead, message: msg };
  }
}

/** Reconcile several clones, in order. Deduplicates paths and never lets one
 *  repo's failure stop the rest. Each clone's default-branch opt-in is read
 *  from its own project config unless the caller decides per path. */
export async function reconcileRepos(
  cwds: string[],
  options: { allowDefaultBranch?: (cwd: string) => boolean } = {},
): Promise<ReconcileResult[]> {
  const seen = new Set<string>();
  const out: ReconcileResult[] = [];
  const allow = options.allowDefaultBranch ?? projectAllowsDefaultBranchPush;
  for (const cwd of cwds) {
    if (seen.has(cwd)) continue;
    seen.add(cwd);
    try {
      out.push(await reconcilePush(cwd, { allowDefaultBranch: allow(cwd) }));
    } catch (err) {
      out.push({ cwd, status: 'error', message: String((err as Error)?.message ?? err) });
    }
  }
  return out;
}
