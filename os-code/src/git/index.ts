// Local git operations for commands and the daemon: the full working verb
// set over simple-git, with errors translated into actionable sentences.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';

export function git(cwd: string): SimpleGit {
  return simpleGit(cwd);
}

export interface RepoSummary {
  isRepo: boolean;
  branch?: string;
  tracking?: string | null;
  dirtyFiles?: number;
  ahead?: number;
  behind?: number;
}

export async function repoSummary(cwd: string): Promise<RepoSummary> {
  const g = git(cwd);
  if (!(await g.checkIsRepo())) return { isRepo: false };
  const status = await g.status();
  return {
    isRepo: true,
    branch: status.current ?? undefined,
    tracking: status.tracking,
    dirtyFiles: status.files.length,
    ahead: status.ahead,
    behind: status.behind,
  };
}

export async function clone(url: string, dir: string): Promise<void> {
  await simpleGit().clone(url, dir);
}

/** The default branch a freshly cloned repo checked out, e.g. "main". Read from
 *  the working copy so the home-repo record starts on the right branch instead
 *  of guessing "main". Falls back to "main" if HEAD is detached or unreadable. */
export async function currentBranch(cwd: string): Promise<string> {
  try {
    const name = (await git(cwd).revparse(['--abbrev-ref', 'HEAD'])).trim();
    return name && name !== 'HEAD' ? name : 'main';
  } catch {
    return 'main';
  }
}

// ---- backups (the headline gitOS differentiator) --------------------------
//
// The repo already lives on storage the user owns, so a backup is a cheap,
// complete second copy. Two shapes, chosen by where the backup lands:
//   - mirrorRepo: a full --mirror clone (every ref and object) at a second
//     LOCAL or NAS path. Binary-safe and incremental after the first run, so a
//     daily snapshot is near-free. This is the gold-standard restore: point git
//     at the mirror and clone it back, history intact.
//   - bundleRepo: a single-file `git bundle` of all refs, for a destination
//     that only holds files (a cloud drive the text-only storage seam syncs).
//     One portable file, restored with `git clone backup.bundle`.

/**
 * Snapshot a repo into a full mirror at destDir (binary-safe, all refs). First
 * run clones with --mirror; later runs fetch new objects into the existing
 * mirror, so a scheduled backup only moves what changed. destDir must be a real
 * filesystem path (local disk or a NAS/Tailscale mount), never a naive
 * cloud-drive sync folder, which corrupts a live object store.
 */
export async function mirrorRepo(srcDir: string, destDir: string): Promise<void> {
  // A mirror is a bare repo (checkIsRepo() tests for a work tree and would say
  // no), so detect an existing mirror by its HEAD file. First run clones the
  // mirror; later runs fetch every ref forward and drop deleted ones.
  if (existsSync(join(destDir, 'HEAD'))) {
    await git(destDir).raw(['remote', 'update', '--prune']);
    return;
  }
  await simpleGit().clone(srcDir, destDir, ['--mirror']);
}

/**
 * Write a single-file bundle of every ref to destFile. Portable and restorable
 * with `git clone <bundle>`; the right shape for a backup location that stores
 * opaque files rather than a live repo (a cloud drive). Overwrites destFile.
 */
export async function bundleRepo(srcDir: string, destFile: string): Promise<void> {
  await git(srcDir).raw(['bundle', 'create', destFile, '--all']);
}

export async function createBranch(cwd: string, name: string): Promise<void> {
  await git(cwd).checkoutLocalBranch(name);
}

export async function checkout(cwd: string, ref: string): Promise<void> {
  await git(cwd).checkout(ref);
}

export async function commitAll(cwd: string, message: string): Promise<string> {
  const g = git(cwd);
  await g.add(['-A']);
  const result = await g.commit(message);
  if (!result.commit) throw new Error('Nothing to commit; the working tree is clean.');
  return result.commit;
}

export async function push(cwd: string, remote = 'origin', branch?: string): Promise<string> {
  const g = git(cwd);
  const target = branch ?? (await g.status()).current;
  if (!target) throw new Error('No branch to push. Check out a branch first.');
  await g.push(['-u', remote, target]);
  return target;
}

export async function log(cwd: string, count = 10): Promise<string> {
  const entries = await git(cwd).log({ maxCount: count });
  return entries.all
    .map((e) => `${e.hash.slice(0, 8)} ${e.date.slice(0, 10)} ${e.message}`)
    .join('\n');
}
