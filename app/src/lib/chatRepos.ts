// The repositories a chat works with (founder, 2026-09-03: "replace the model
// name in the header with a repo dropdown that lets you select multiple repos
// connected to your account, like Claude Code, in basic chats and in
// projects"). Two roads bring repos in: the paired computer's workspaces (a
// clone on disk, id = its path, the same id Project.repoIds has always used)
// and the connected GitHub account's repositories (id = "github:owner/name",
// listed on the stored token). A chat keeps its own selection; a project's
// repoIds seed it. Pure helpers here; the fetching lives in the hook.
//
// Honest scope: the engine works in one directory per session, so the first
// selected workspace is where the agent works and every selected repo rides
// into the chat's context by name. A GitHub repo with no clone is context
// until it is cloned onto the computer.
import { storeDelete, storeGetJson, storeSetJson } from './platform.js';

export type RepoKind = 'workspace' | 'github';

export interface RepoOption {
  /** A workspace path, or "github:owner/name". */
  id: string;
  kind: RepoKind;
  /** The short name shown in a row and in the summary. */
  name: string;
  /** A second line: the owner, or the path. */
  detail?: string;
  private?: boolean;
}

const GITHUB_PREFIX = 'github:';

export function githubRepoId(fullName: string): string {
  return `${GITHUB_PREFIX}${fullName}`;
}

export function isGithubRepoId(id: string): boolean {
  return id.startsWith(GITHUB_PREFIX);
}

/** The short name for any repo id: the repo name for GitHub, the folder for a path. */
export function repoLabel(id: string): string {
  if (isGithubRepoId(id)) return id.slice(GITHUB_PREFIX.length).split('/').pop() || id;
  return id.split(/[\\/]/).filter(Boolean).pop() || id;
}

/** The first selected workspace, where a desktop session works. */
export function firstWorkspace(ids: readonly string[]): string | undefined {
  return ids.find((id) => !isGithubRepoId(id));
}

/** The header summary: "No repos", one name, or "name +2". */
export function summarizeRepos(ids: readonly string[]): string {
  if (ids.length === 0) return 'No repos';
  const first = repoLabel(ids[0]!);
  return ids.length === 1 ? first : `${first} +${ids.length - 1}`;
}

/** The line that rides into a chat's system context, or undefined for none. */
export function repoContextLine(ids: readonly string[]): string | undefined {
  if (ids.length === 0) return undefined;
  const parts = ids.map((id) =>
    isGithubRepoId(id) ? `${id.slice(GITHUB_PREFIX.length)} (GitHub)` : `${repoLabel(id)} at ${id}`,
  );
  return `Repositories in this chat: ${parts.join('; ')}.`;
}

/** The shape of one GitHub /user/repos row this app reads. */
interface GitHubRepoRow {
  full_name: string;
  name: string;
  private?: boolean;
  owner?: { login?: string };
  pushed_at?: string;
}

export function toRepoOptions(rows: GitHubRepoRow[]): RepoOption[] {
  return rows
    .filter((r) => typeof r.full_name === 'string' && r.full_name.includes('/'))
    .map((r) => ({
      id: githubRepoId(r.full_name),
      kind: 'github' as const,
      name: r.name || r.full_name.split('/')[1]!,
      detail: r.owner?.login ?? r.full_name.split('/')[0],
      private: Boolean(r.private),
    }));
}

/** The repositories the token can see, newest push first, up to 300. */
export async function listGitHubRepos(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RepoOption[]> {
  const out: RepoOption[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const res = await fetchImpl(
      `https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member&page=${page}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
      },
    );
    if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
    const rows = (await res.json()) as GitHubRepoRow[];
    out.push(...toRepoOptions(rows));
    if (rows.length < 100) break;
  }
  return out;
}

// A device-local cache so the picker opens with the list it had, then
// refreshes. A cache, not a preference: never synced. It rides the sealed
// store like everything else the app keeps (APP-12): a list of private repo
// names is account data, not scratch. The store hydrates it at boot and drops
// it when GitHub is disconnected; the picker reads the in-memory mirror.
const CACHE_KEY = 'oscode.githubRepos';
export const CACHE_TTL_MS = 10 * 60 * 1000;

interface RepoCacheRow {
  at: number;
  repos: RepoOption[];
}

let repoCache: RepoCacheRow | undefined;

function liveCache(row: RepoCacheRow | undefined, now: number): RepoOption[] | undefined {
  if (!row || !Array.isArray(row.repos) || now - row.at > CACHE_TTL_MS) return undefined;
  return row.repos;
}

/** Load the sealed cache into memory (called once at boot by the store). */
export async function hydrateRepoCache(now = Date.now()): Promise<RepoOption[] | undefined> {
  try {
    const row = await storeGetJson<RepoCacheRow>(CACHE_KEY);
    if (row) repoCache = row;
  } catch {
    // Unreadable cache: the next open fetches again.
  }
  return liveCache(repoCache, now);
}

/** The cached list, if it is fresh. Synchronous: it reads the hydrated mirror. */
export function readRepoCache(now = Date.now()): RepoOption[] | undefined {
  return liveCache(repoCache, now);
}

export function writeRepoCache(repos: RepoOption[], now = Date.now()): void {
  repoCache = { at: now, repos };
  void storeSetJson(CACHE_KEY, repoCache).catch(() => {
    // No storage: the mirror still serves this session.
  });
}

/** Forget the cached list, in memory and on disk (GitHub disconnected). */
export async function clearRepoCache(): Promise<void> {
  repoCache = undefined;
  try {
    await storeDelete(CACHE_KEY);
  } catch {
    // Nothing stored.
  }
}

/** Toggle one id in a selection, keeping order. */
export function toggleRepo(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}
