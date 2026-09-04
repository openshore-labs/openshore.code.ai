// App-side helpers for reconciling project repos: which local clones to push,
// and how to summarize the outcome for the person. The actual push runs in the
// desktop main process (the reconcile engine in os-code); these are the pure
// pieces around it, so they are easy to test and reason about.
import type { ReconcileResult } from 'os-code/protocol';
import { isGithubRepoId } from './chatRepos.js';
import type { Project } from '../state/types.js';

/** The local clone to reconcile for each project: its primary (first
 *  non-GitHub) repo id, which is a working-tree path on this desktop. GitHub
 *  ids have no local clone here and are skipped. Deduplicated, so a repo shared
 *  by two projects is pushed once. */
export function projectWorkspaces(projects: Project[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of projects) {
    const ws = p.repoIds.find((id) => !isGithubRepoId(id));
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
  /** Repos that diverged and need a manual merge. Nothing was pushed or lost. */
  conflicts: ReconcileResult[];
  /** Repos whose remote was unreachable; worth retrying on the next reconnect. */
  offline: number;
}

export function summarizeReconcile(results: ReconcileResult[]): ReconcileSummary {
  return {
    pushed: results.filter((r) => r.status === 'pushed' || r.status === 'merged').length,
    conflicts: results.filter((r) => r.status === 'conflict'),
    offline: results.filter((r) => r.status === 'offline').length,
  };
}

/** The one-line status to surface, or undefined when nothing happened worth
 *  saying (everything was already in sync, offline, or had no upstream). A
 *  conflict is stated plainly and reassuringly (no work is ever lost). */
export function reconcileToast(s: ReconcileSummary): string | undefined {
  if (s.conflicts.length > 0) {
    const n = s.conflicts.length;
    return `${n} project ${n === 1 ? 'repository needs' : 'repositories need'} a manual merge before syncing. Your work is safe on this device.`;
  }
  if (s.pushed > 0) {
    const n = s.pushed;
    return `Synced your project notes to ${n === 1 ? 'the repository' : `${n} repositories`}.`;
  }
  return undefined;
}
