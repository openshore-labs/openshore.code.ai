// App-side helpers for reconciling project repos: which local clones to push,
// and how to summarize the outcome for the person. The actual push runs in the
// desktop main process (the reconcile engine in os-code); these are the pure
// pieces around it, so they are easy to test and reason about.
import type { ReconcileResult } from 'os-code/protocol';
import { isRemoteRepoId } from './chatRepos.js';
import type { Project } from '../state/types.js';

/** The local clone to reconcile for each project: its primary (first
 *  workspace) repo id, which is a working-tree path on this desktop. Platform
 *  ids (GitHub, GitLab, Bitbucket) have no local clone here and are skipped. Deduplicated, so a repo shared
 *  by two projects is pushed once. */
export function projectWorkspaces(projects: Project[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of projects) {
    const ws = p.repoIds.find((id) => !isRemoteRepoId(id));
    if (ws && !seen.has(ws)) {
      seen.add(ws);
      out.push(ws);
    }
  }
  return out;
}

export interface ReconcileSummary {
  /** Repos whose unpushed commits reached the remote (pushed or merged+pushed). */
  pushed: number;
  /** The pushes themselves, so the toast can name what left this device. */
  pushes: ReconcileResult[];
  /** Repos whose default branch had commits but was not pushed: the project
   *  has not opted in (board call 5). Nothing left this device. */
  held: ReconcileResult[];
  /** Repos that diverged and need a manual merge. Nothing was pushed or lost. */
  conflicts: ReconcileResult[];
  /** Repos whose remote was unreachable; worth retrying on the next reconnect. */
  offline: number;
  /** Repos that failed for another reason (e.g. no push credentials); the
   *  person should know their notes are not reaching the remote. */
  errors: number;
}

export function summarizeReconcile(results: ReconcileResult[]): ReconcileSummary {
  const pushes = results.filter((r) => r.status === 'pushed' || r.status === 'merged');
  return {
    pushed: pushes.length,
    pushes,
    held: results.filter((r) => r.status === 'held'),
    conflicts: results.filter((r) => r.status === 'conflict'),
    offline: results.filter((r) => r.status === 'offline').length,
    errors: results.filter((r) => r.status === 'error').length,
  };
}

/** The last path segment: the repository's folder name. */
export function repoName(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
}

/** "2 commits on feature/x in my-app", naming what a push actually carried. */
function describePush(r: ReconcileResult): string {
  const n = r.ahead ?? 0;
  const commits = n === 1 ? '1 commit' : `${n} commits`;
  const branch = r.branch ? ` on ${r.branch}` : '';
  return `${commits}${branch} in ${repoName(r.cwd)}`;
}

/** The one-line status to surface, or undefined when nothing happened worth
 *  saying (everything was already in sync, offline, or had no upstream). A
 *  conflict is stated plainly and reassuringly (no work is ever lost). A push
 *  names what it pushed; a held default branch says so and why. */
export function reconcileToast(s: ReconcileSummary): string | undefined {
  if (s.conflicts.length > 0) {
    const n = s.conflicts.length;
    return `${n} project ${n === 1 ? 'repository needs' : 'repositories need'} a manual merge before syncing. Your work is safe on this device.`;
  }
  if (s.pushed > 0) {
    const first = s.pushes[0]!;
    const rest = s.pushes.length - 1;
    const named = describePush(first);
    const more = rest > 0 ? `, and ${rest} more ${rest === 1 ? 'repository' : 'repositories'}` : '';
    const held = s.held.length
      ? ` ${s.held.map((h) => h.branch ?? 'the default branch').join(', ')} stayed here: a default branch is yours to push.`
      : '';
    return `Pushed ${named}${more}.${held}`;
  }
  if (s.held.length > 0) {
    const names = s.held.map((h) => `${h.branch ?? 'the default branch'} in ${repoName(h.cwd)}`);
    return `Not pushed: ${names.join(', ')}. A default branch is yours to push unless the project opts in (sync.autoPushDefaultBranch).`;
  }
  // Nothing pushed and nothing to merge, but something failed outright (usually
  // missing push credentials): tell the person their notes are not syncing.
  if (s.errors > 0) {
    const n = s.errors;
    return `Could not sync ${n === 1 ? 'a project repository' : `${n} project repositories`}. Your notes are safe here and will retry.`;
  }
  return undefined;
}
