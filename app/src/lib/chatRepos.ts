// The repositories a chat works with (founder, 2026-09-03: "replace the model
// name in the header with a repo dropdown that lets you select multiple repos
// connected to your account, like Claude Code, in basic chats and in
// projects"). Two roads bring repos in: the paired computer's workspaces (a
// clone on disk, id = its path, the same id Project.repoIds has always used)
// and the connected platforms' repositories (id = "github:owner/name",
// "gitlab:group/name", or "bitbucket:workspace/name", listed on the stored
// token). A chat keeps its own selection; a project's repoIds seed it. Pure
// helpers here; the fetching lives in the hook.
//
// Honest scope: the engine works in one directory per session, so the first
// selected workspace is where the agent works and every selected repo rides
// into the chat's context by name. A platform repo with no clone is context
// until it is cloned onto the computer (the picker offers that in one tap).
import { storeDelete, storeGetJson, storeSetJson } from './platform.js';
import { PlainError } from './plainError.js';
import type { RepoPlatform } from './repos.js';

export type RepoKind = 'workspace' | RepoPlatform;

export interface RepoOption {
  /** A workspace path, or "<platform>:<full name>". */
  id: string;
  kind: RepoKind;
  /** The short name shown in a row and in the summary. */
  name: string;
  /** A second line: the owner, or the path. */
  detail?: string;
  private?: boolean;
  /** A workspace's origin as a platform repo id, when the computer reported
   *  one, so a platform row can be matched to the clone already on disk. */
  remoteId?: string;
}

const PLATFORMS: readonly RepoPlatform[] = ['github', 'gitlab', 'bitbucket'];

export const PLATFORM_NAME: Record<RepoPlatform, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
};

const PLATFORM_HOST: Record<RepoPlatform, string> = {
  github: 'github.com',
  gitlab: 'gitlab.com',
  bitbucket: 'bitbucket.org',
};

export function remoteRepoId(platform: RepoPlatform, fullName: string): string {
  return `${platform}:${fullName}`;
}

export function githubRepoId(fullName: string): string {
  return remoteRepoId('github', fullName);
}

/** Any platform repo id (as opposed to a workspace path). A prefix check, like
 *  the GitHub one always was, so a malformed id is never mistaken for a path. */
export function isRemoteRepoId(id: string): boolean {
  return PLATFORMS.some((p) => id.startsWith(`${p}:`));
}

export function isGithubRepoId(id: string): boolean {
  return id.startsWith('github:');
}

/** The platform and full name of a platform repo id, or undefined for a
 *  workspace path or a malformed id. */
export function parseRemoteRepoId(
  id: string,
): { platform: RepoPlatform; fullName: string } | undefined {
  const colon = id.indexOf(':');
  if (colon <= 0) return undefined;
  const platform = id.slice(0, colon) as RepoPlatform;
  if (!PLATFORMS.includes(platform)) return undefined;
  const fullName = id.slice(colon + 1);
  if (!/^[^/\s]+(\/[^/\s]+)+$/.test(fullName)) return undefined;
  return { platform, fullName };
}

/** The https clone address for a platform repo id. */
export function cloneUrlFor(id: string): string | undefined {
  const parsed = parseRemoteRepoId(id);
  if (!parsed) return undefined;
  return `https://${PLATFORM_HOST[parsed.platform]}/${parsed.fullName}.git`;
}

/** The platform whose connected token authorizes a clone of this address:
 *  only an https address on the platform's own host, so a token is never sent
 *  anywhere else. */
export function platformForCloneUrl(url: string): RepoPlatform | undefined {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return undefined;
  const host = u.hostname.toLowerCase();
  return PLATFORMS.find((p) => PLATFORM_HOST[p] === host);
}

/** A git remote address (https, ssh, or scp-style) as a platform repo id, or
 *  undefined when it is not on one of the three platforms. */
export function remoteIdFromUrl(url: string | undefined): string | undefined {
  const raw = url?.trim();
  if (!raw) return undefined;
  let host: string;
  let path: string;
  const scp = /^[\w.-]+@([\w.-]+):(?!\/)(.+)$/.exec(raw);
  if (scp) {
    host = scp[1]!;
    path = scp[2]!;
  } else {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return undefined;
    }
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(u.protocol)) return undefined;
    host = u.hostname;
    path = u.pathname;
  }
  const platform = PLATFORMS.find((p) => PLATFORM_HOST[p] === host.toLowerCase());
  if (!platform) return undefined;
  const fullName = path
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  return parseRemoteRepoId(remoteRepoId(platform, fullName))
    ? remoteRepoId(platform, fullName)
    : undefined;
}

/** Whether two repo ids name the same repository. Platform paths are
 *  case-insensitive, so the comparison is too. */
export function sameRepo(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

/** The short name for any repo id: the repo name for a platform repo, the
 *  folder for a path. */
export function repoLabel(id: string): string {
  const parsed = parseRemoteRepoId(id);
  if (parsed) return parsed.fullName.split('/').pop() || id;
  if (isRemoteRepoId(id))
    return (
      id
        .slice(id.indexOf(':') + 1)
        .split('/')
        .pop() || id
    );
  return id.split(/[\\/]/).filter(Boolean).pop() || id;
}

/** The first selected workspace, where a desktop session works. */
export function firstWorkspace(ids: readonly string[]): string | undefined {
  return ids.find((id) => !isRemoteRepoId(id));
}

/** The header summary: "No repos", one name, or "name +2". */
export function summarizeRepos(ids: readonly string[]): string {
  if (ids.length === 0) return 'No repositories';
  const first = repoLabel(ids[0]!);
  return ids.length === 1 ? first : `${first} +${ids.length - 1}`;
}

/** The line that rides into a chat's system context, or undefined for none. */
export function repoContextLine(ids: readonly string[]): string | undefined {
  if (ids.length === 0) return undefined;
  const parts = ids.map((id) => {
    const parsed = parseRemoteRepoId(id);
    if (parsed) return `${parsed.fullName} (${PLATFORM_NAME[parsed.platform]})`;
    return `${repoLabel(id)} at ${id}`;
  });
  return `Repositories in this chat: ${parts.join('; ')}.`;
}

/** The clone on the computer that holds this platform repo, matched by its
 *  origin, so the agent can work in it. */
export function localCloneFor(
  id: string,
  workspaces: readonly RepoOption[],
): RepoOption | undefined {
  return workspaces.find((w) => w.kind === 'workspace' && sameRepo(w.remoteId, id));
}

// --- Listing, one reader per platform ------------------------------------

/** Enough pages for a big organization (1000 repos), few enough that a
 *  runaway listing stops. */
const MAX_PAGES = 10;

/** A refused or failed list as a sentence that names the fix. The status code
 *  never reaches the screen. */
export function repoListError(platform: RepoPlatform, status: number): PlainError {
  const name = PLATFORM_NAME[platform];
  if (status === 401) {
    return new PlainError(
      `Your ${name} sign-in has expired. Open Repositories, remove ${name}, and connect it again.`,
    );
  }
  if (status === 403 || status === 429) {
    return new PlainError(`${name} is limiting requests right now. Wait a minute, then try again.`);
  }
  return new PlainError(`${name} did not answer. Check your connection and try again.`);
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

function githubHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
}

/** The repositories the token can see, newest push first, up to 1000. With a
 *  GitHub App sign-in that is only the repositories the App was given on each
 *  account (see githubAccess), which is why a list can look short. */
export async function listGitHubRepos(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RepoOption[]> {
  const out: RepoOption[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await fetchImpl(
      `https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member&page=${page}`,
      { headers: githubHeaders(token) },
    );
    if (!res.ok) throw repoListError('github', res.status);
    const rows = (await res.json()) as GitHubRepoRow[];
    if (!Array.isArray(rows)) break;
    out.push(...toRepoOptions(rows));
    if (rows.length < 100) break;
  }
  return out;
}

/** The shape of one GitLab /projects row this app reads. */
interface GitLabProjectRow {
  path_with_namespace?: string;
  name?: string;
  visibility?: string;
  namespace?: { full_path?: string };
}

export function toGitLabOptions(rows: GitLabProjectRow[]): RepoOption[] {
  return rows
    .filter((r) => typeof r.path_with_namespace === 'string' && r.path_with_namespace.includes('/'))
    .map((r) => {
      const full = r.path_with_namespace!;
      return {
        id: remoteRepoId('gitlab', full),
        kind: 'gitlab' as const,
        name: r.name || full.split('/').pop()!,
        detail: r.namespace?.full_path ?? full.slice(0, full.lastIndexOf('/')),
        private: r.visibility ? r.visibility !== 'public' : undefined,
      };
    });
}

/** The GitLab projects the person is a member of, latest activity first. A
 *  personal access token and an OAuth token both ride as a bearer. */
export async function listGitLabRepos(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RepoOption[]> {
  const out: RepoOption[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await fetchImpl(
      `https://gitlab.com/api/v4/projects?membership=true&simple=true&archived=false&order_by=last_activity_at&per_page=100&page=${page}`,
      { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
    );
    if (!res.ok) throw repoListError('gitlab', res.status);
    const rows = (await res.json()) as GitLabProjectRow[];
    if (!Array.isArray(rows)) break;
    out.push(...toGitLabOptions(rows));
    if (rows.length < 100) break;
  }
  return out;
}

/** The shape of one Bitbucket /repositories row this app reads. */
interface BitbucketRepoRow {
  full_name?: string;
  name?: string;
  is_private?: boolean;
  workspace?: { slug?: string };
}

export function toBitbucketOptions(rows: BitbucketRepoRow[]): RepoOption[] {
  return rows
    .filter((r) => typeof r.full_name === 'string' && r.full_name.includes('/'))
    .map((r) => {
      const full = r.full_name!;
      return {
        id: remoteRepoId('bitbucket', full),
        kind: 'bitbucket' as const,
        name: r.name || full.split('/')[1]!,
        detail: r.workspace?.slug ?? full.split('/')[0],
        private: r.is_private === undefined ? undefined : Boolean(r.is_private),
      };
    });
}

function base64Utf8(text: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Bitbucket's two credential shapes: an OAuth or access token rides as a
 *  bearer; an Atlassian API token needs the account email, so it is pasted as
 *  "email:token" and rides as HTTP Basic (app passwords stopped working
 *  2026-06-09). */
export function bitbucketAuthorization(token: string): string {
  return token.includes(':') ? `Basic ${base64Utf8(token)}` : `Bearer ${token}`;
}

/** The Bitbucket repositories the person is a member of, latest update first. */
export async function listBitbucketRepos(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RepoOption[]> {
  const out: RepoOption[] = [];
  let url: string | undefined =
    'https://api.bitbucket.org/2.0/repositories?role=member&pagelen=100&sort=-updated_on';
  for (let page = 0; url && page < MAX_PAGES; page += 1) {
    const res: Response = await fetchImpl(url, {
      headers: { authorization: bitbucketAuthorization(token), accept: 'application/json' },
    });
    if (!res.ok) throw repoListError('bitbucket', res.status);
    const body = (await res.json()) as { values?: BitbucketRepoRow[]; next?: unknown };
    out.push(...toBitbucketOptions(Array.isArray(body.values) ? body.values : []));
    // Follow the next page only on Bitbucket's own API host.
    url =
      typeof body.next === 'string' && body.next.startsWith('https://api.bitbucket.org/')
        ? body.next
        : undefined;
  }
  return out;
}

/** The lister for a platform. */
export function listRemoteRepos(
  platform: RepoPlatform,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RepoOption[]> {
  if (platform === 'gitlab') return listGitLabRepos(token, fetchImpl);
  if (platform === 'bitbucket') return listBitbucketRepos(token, fetchImpl);
  return listGitHubRepos(token, fetchImpl);
}

// --- Why a GitHub list can look short --------------------------------------
//
// What OpenShore sees on GitHub depends on HOW it is signed in, so the picker
// reads that and says it plainly:
//  - A GitHub App sign-in sees the repositories that both the person and the
//    App can reach: on each account the App is installed on, "All
//    repositories" or a hand-picked few.
//  - A GitHub OAuth App sign-in, or a classic token, sees private repositories
//    only with the `repo` scope; without it GitHub hands over public data
//    alone. The founder's picker showed exactly the account's four public
//    repositories (2026-09-25), which is that shape.
//  - A fine-grained token sees what it was given on GitHub.

export interface GithubInstallation {
  /** The installation id, for listing its repositories. */
  id?: number;
  /** The account or organization login. */
  account: string;
  selection: 'all' | 'selected';
  /** The installation's settings page on GitHub, where repositories are picked. */
  manageUrl?: string;
  appSlug?: string;
}

/** How OpenShore is signed in to GitHub. */
export type GithubSignIn = 'app' | 'oauth' | 'classic' | 'fine-grained';

export interface GithubAccess {
  kind: GithubSignIn;
  /** The GitHub account the credential belongs to. */
  login?: string;
  /** The scopes GitHub granted an OAuth App sign-in or a classic token (its
   *  X-OAuth-Scopes answer). Undefined when GitHub reports none, as for a
   *  GitHub App sign-in or a fine-grained token. */
  scopes?: string[];
  /** For a GitHub App sign-in: where the App is installed. */
  installations: GithubInstallation[];
}

function kindFromPrefix(token: string): GithubSignIn | undefined {
  if (token.startsWith('ghu_')) return 'app';
  if (token.startsWith('gho_')) return 'oauth';
  if (token.startsWith('ghp_')) return 'classic';
  if (token.startsWith('github_pat_')) return 'fine-grained';
  return undefined;
}

/** Read how this credential is signed in: the account, the granted scopes,
 *  and for a GitHub App sign-in, where the App is installed and whether each
 *  account gave it every repository or a picked few. Undefined when GitHub
 *  could not be asked or refused the credential (the list says that itself),
 *  so no hint is shown rather than a wrong one. */
export async function githubAccess(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GithubAccess | undefined> {
  let me: Response;
  try {
    me = await fetchImpl('https://api.github.com/user', { headers: githubHeaders(token) });
  } catch {
    return undefined;
  }
  if (!me.ok) return undefined;
  const user = (await me.json().catch(() => ({}))) as { login?: unknown };
  const login = typeof user.login === 'string' ? user.login : undefined;
  const header = me.headers.get('x-oauth-scopes');
  const scopes =
    header === null
      ? undefined
      : header
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
  let kind = kindFromPrefix(token) ?? (scopes !== undefined ? 'oauth' : 'app');
  if (kind !== 'app') return { kind, login, scopes, installations: [] };

  let res: Response;
  try {
    res = await fetchImpl('https://api.github.com/user/installations?per_page=100', {
      headers: githubHeaders(token),
    });
  } catch {
    return undefined;
  }
  if (!res.ok) {
    // GitHub refuses this call for anything but an App sign-in.
    if (res.status === 403 && !token.startsWith('ghu_')) kind = 'oauth';
    return kind === 'app' ? undefined : { kind, login, scopes, installations: [] };
  }
  const body = (await res.json().catch(() => ({}))) as {
    installations?: Array<{
      id?: unknown;
      account?: { login?: unknown };
      repository_selection?: unknown;
      html_url?: unknown;
      app_slug?: unknown;
    }>;
  };
  const installations = (Array.isArray(body.installations) ? body.installations : [])
    .filter((i) => typeof i.account?.login === 'string')
    .map((i) => ({
      ...(typeof i.id === 'number' ? { id: i.id } : {}),
      account: i.account!.login as string,
      selection: i.repository_selection === 'all' ? ('all' as const) : ('selected' as const),
      manageUrl:
        typeof i.html_url === 'string' && i.html_url.startsWith('https://github.com/')
          ? i.html_url
          : undefined,
      appSlug:
        typeof i.app_slug === 'string' && /^[a-z0-9-]+$/i.test(i.app_slug) ? i.app_slug : undefined,
    }));
  return { kind: 'app', login, scopes, installations };
}

/** The repositories a GitHub App sign-in reaches through each installation,
 *  GitHub's own answer for an App (GET /user/installations/{id}/repositories).
 *  Merged with /user/repos, so nothing an installation grants goes missing. */
export async function listGitHubInstallationRepos(
  token: string,
  installationIds: number[],
  fetchImpl: typeof fetch = fetch,
): Promise<RepoOption[]> {
  const out: RepoOption[] = [];
  for (const id of installationIds) {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const res = await fetchImpl(
        `https://api.github.com/user/installations/${id}/repositories?per_page=100&page=${page}`,
        { headers: githubHeaders(token) },
      );
      if (!res.ok) break;
      const body = (await res.json().catch(() => ({}))) as { repositories?: GitHubRepoRow[] };
      const rows = Array.isArray(body.repositories) ? body.repositories : [];
      out.push(...toRepoOptions(rows));
      if (rows.length < 100) break;
    }
  }
  return out;
}

/** One line under the list saying why a repository might be missing, with the
 *  one place that fixes it: a page on GitHub, or reconnecting GitHub here. */
export interface RepoAccessHint {
  text: string;
  action: string;
  /** Where the action goes on GitHub. Absent when the fix is reconnecting. */
  url?: string;
  /** The fix is removing GitHub here and connecting it again. */
  reconnect?: boolean;
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function githubAccessHint(
  access: GithubAccess | undefined,
  opts: {
    /** The GitHub App's slug from the build, when no installation names it. */
    slug?: string;
    /** Every repository the sign-in listed is public. */
    publicOnly?: boolean;
  } = {},
): RepoAccessHint | undefined {
  if (!access) return undefined;
  const noRepoScope = access.scopes !== undefined && !access.scopes.includes('repo');
  if (access.kind === 'oauth') {
    return noRepoScope || opts.publicOnly
      ? {
          text: 'This GitHub sign-in can see only your public repositories: GitHub gave it no access to private ones. Reconnect GitHub to allow them.',
          action: 'Reconnect GitHub',
          reconnect: true,
        }
      : undefined;
  }
  if (access.kind === 'classic') {
    return noRepoScope || opts.publicOnly
      ? {
          text: 'Your access token can see only public repositories. Give it the repo scope on GitHub, then refresh.',
          action: 'Edit it on GitHub',
          url: 'https://github.com/settings/tokens',
        }
      : {
          text: 'Missing a repository? Your access token decides which ones OpenShore sees.',
          action: 'Check it on GitHub',
          url: 'https://github.com/settings/tokens',
        };
  }
  if (access.kind === 'fine-grained') {
    return {
      text: opts.publicOnly
        ? 'Your fine-grained token can see only public repositories. On GitHub, give it your private ones too.'
        : 'Your fine-grained token decides which repositories OpenShore sees.',
      action: 'Edit it on GitHub',
      url: 'https://github.com/settings/personal-access-tokens',
    };
  }
  const slug = access.installations.find((i) => i.appSlug)?.appSlug ?? opts.slug;
  const addUrl = slug
    ? `https://github.com/apps/${slug}/installations/new`
    : 'https://github.com/settings/installations';
  if (access.installations.length === 0) {
    return {
      text: 'OpenShore is not added to any of your GitHub accounts yet, so it cannot see a repository.',
      action: 'Add it on GitHub',
      url: addUrl,
    };
  }
  const picked = access.installations.filter((i) => i.selection === 'selected');
  if (picked.length) {
    return {
      text: `OpenShore sees only the repositories you picked for ${listNames(
        picked.map((i) => i.account),
      )} on GitHub.`,
      action: 'Choose repositories',
      url: (picked.length === 1 ? picked[0]!.manageUrl : undefined) ?? addUrl,
    };
  }
  if (opts.publicOnly) {
    return {
      text: 'OpenShore sees only public repositories on this sign-in. If you have private ones, reconnect GitHub.',
      action: 'Reconnect GitHub',
      reconnect: true,
    };
  }
  return slug
    ? {
        text: 'Missing a repository? Add another account or organization on GitHub.',
        action: 'Add on GitHub',
        url: addUrl,
      }
    : undefined;
}

/** "Signed in to GitHub as @login, through ..." for the Repositories screen,
 *  so a person can see which account and which kind of sign-in is in use. */
export function githubSignInLine(access: GithubAccess | undefined): string | undefined {
  if (!access?.login) return undefined;
  const how: Record<GithubSignIn, string> = {
    app: 'through the OpenShore Code GitHub App',
    oauth: 'through an OAuth app',
    classic: 'with a classic access token',
    'fine-grained': 'with a fine-grained access token',
  };
  return `Signed in to GitHub as @${access.login}, ${how[access.kind]}.`;
}

export interface GithubStatus {
  repos: RepoOption[];
  access?: GithubAccess;
  hint?: RepoAccessHint;
  line?: string;
}

/** Everything the picker and the Repositories screen show about GitHub: the
 *  repositories (from /user/repos, plus each App installation's own list), how
 *  the sign-in is made, and the one line that says why something is missing.
 *  Throws the list's own sentence when GitHub refuses the credential. */
export async function githubStatus(
  token: string,
  opts: { slug?: string; fetchImpl?: typeof fetch } = {},
): Promise<GithubStatus> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const [listed, access] = await Promise.all([
    listGitHubRepos(token, fetchImpl),
    githubAccess(token, fetchImpl).catch(() => undefined),
  ]);
  let repos = listed;
  if (access?.kind === 'app') {
    const ids = access.installations.flatMap((i) => (i.id === undefined ? [] : [i.id]));
    const extra = ids.length
      ? await listGitHubInstallationRepos(token, ids, fetchImpl).catch(() => [])
      : [];
    const seen = new Set(repos.map((r) => r.id.toLowerCase()));
    repos = [...repos, ...extra.filter((r) => !seen.has(r.id.toLowerCase()))];
  }
  const publicOnly = repos.length > 0 && repos.every((r) => r.private === false);
  return {
    repos,
    access,
    hint: githubAccessHint(access, { slug: opts.slug, publicOnly }),
    line: githubSignInLine(access),
  };
}

// A device-local cache so the picker opens with the list it had, then
// refreshes. A cache, not a preference: never synced. It rides the sealed
// store like everything else the app keeps (APP-12): a list of private repo
// names is account data, not scratch. The store hydrates it at boot and drops
// it when a platform is disconnected; the picker reads the in-memory mirror.
// It holds every connected platform's rows (each row carries its kind).
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

/** Forget the cached list, in memory and on disk (a platform disconnected). */
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

/** Put a clone's path first in a selection, so the agent works in the repo the
 *  person just opened on their computer. The platform id it came from stays
 *  selected as context (and as the read path for project memory on a phone);
 *  it is added if it was not there. */
export function withClone(ids: readonly string[], remoteId: string, cwd: string): string[] {
  const rest = ids.filter((x) => x !== cwd);
  return [cwd, ...(rest.includes(remoteId) ? rest : [...rest, remoteId])];
}
