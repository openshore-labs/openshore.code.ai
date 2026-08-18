// Local git operations for commands and the daemon: the full working verb
// set over simple-git, with errors translated into actionable sentences.
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
