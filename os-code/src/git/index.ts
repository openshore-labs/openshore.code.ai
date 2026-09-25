// Local git operations for commands and the daemon: the full working verb
// set over simple-git, with errors translated into actionable sentences.
import { execFile } from 'node:child_process';
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

// A token for the platform that hosts the address, sent as git's basic-auth
// user plus the token. Each platform names the user a token rides under.
const TOKEN_USER: Record<string, string> = {
  'github.com': 'x-access-token',
  'gitlab.com': 'oauth2',
  'bitbucket.org': 'x-token-auth',
};

/**
 * The one-shot auth header for cloning `url` with a connected platform's
 * token, scoped to that platform's host, or undefined when the address is not
 * a plain https address on GitHub, GitLab, or Bitbucket (a token is never sent
 * to any other host). A Bitbucket Atlassian API token arrives as
 * "email:token"; git takes it under Bitbucket's static API-token user.
 */
export function cloneAuthHeader(
  url: string,
  token: string,
): { key: string; value: string } | undefined {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return undefined;
  const host = u.hostname.toLowerCase();
  let user = TOKEN_USER[host];
  let secret = token.trim();
  if (!user || !secret || /[\r\n]/.test(secret)) return undefined;
  if (host === 'bitbucket.org' && secret.includes(':')) {
    user = 'x-bitbucket-api-token-auth';
    secret = secret.slice(secret.indexOf(':') + 1);
  }
  const basic = Buffer.from(`${user}:${secret}`).toString('base64');
  return { key: `http.https://${host}/.extraheader`, value: `Authorization: Basic ${basic}` };
}

/** Remove a token (and its base64 header form) from text a person may read. */
export function redactToken(text: string, token: string | undefined): string {
  if (!token?.trim()) return text;
  let out = text.split(token.trim()).join('[token]');
  for (const user of [...Object.values(TOKEN_USER), 'x-bitbucket-api-token-auth']) {
    const b64 = Buffer.from(`${user}:${token.trim()}`).toString('base64');
    out = out.split(b64).join('[token]');
  }
  return out;
}

/** Each connected platform's token, keyed the way the app names platforms. */
export type PlatformTokens = Partial<Record<'github' | 'gitlab' | 'bitbucket', string>>;

const HOST_PLATFORM: Record<string, keyof PlatformTokens> = {
  'github.com': 'github',
  'gitlab.com': 'gitlab',
  'bitbucket.org': 'bitbucket',
};

/** The token that authorizes git traffic to this address: the one for the
 *  platform whose host it is, only for a plain https address. */
export function tokenForUrl(url: string, tokens: PlatformTokens | undefined): string | undefined {
  if (!tokens) return undefined;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return undefined;
  const platform = HOST_PLATFORM[u.hostname.toLowerCase()];
  const token = platform ? tokens[platform]?.trim() : undefined;
  return token || undefined;
}

/**
 * The environment for one git command against `url`: terminal prompts off (a
 * missing credential fails at once instead of waiting on a prompt nobody can
 * answer), and with a token, a host-scoped auth header appended to any git
 * config the environment already carries (GIT_CONFIG_COUNT). The token never
 * lands in the process arguments, the clone's .git/config, or its remote.
 */
export function gitAuthEnv(url: string, token: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const header = token ? cloneAuthHeader(url, token) : undefined;
  if (header) {
    const count = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10);
    const at = Number.isFinite(count) && count > 0 ? count : 0;
    env[`GIT_CONFIG_KEY_${at}`] = header.key;
    env[`GIT_CONFIG_VALUE_${at}`] = header.value;
    env.GIT_CONFIG_COUNT = String(at + 1);
  }
  return env;
}

/** Run one git command. Rejects with git's own error lines (token redacted),
 *  or "timed out" when it outlives `timeoutMs`. */
export function runGit(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; token?: string; timeoutMs?: number } = {},
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd: opts.cwd,
        env: opts.env,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        timeout: opts.timeoutMs,
      },
      (err, stdout, stderr) => {
        if (!err) return resolve(String(stdout));
        const killed = (err as { killed?: boolean }).killed;
        const detail = String(stderr || '')
          .split('\n')
          .filter((l) => l.trim() && !/^Cloning into /.test(l))
          .join('\n');
        const message = detail || (killed ? `git ${args[0]} timed out.` : err.message);
        reject(new Error(redactToken(message, opts.token)));
      },
    );
  });
}

/**
 * Clone `url` into `dir`. With a token, the token rides as an http header
 * scoped to the platform's host through git's environment config (see
 * gitAuthEnv), so it never lands in the clone's .git/config, its remote
 * address, or the process arguments.
 */
export async function clone(
  url: string,
  dir: string,
  opts: { token?: string } = {},
): Promise<void> {
  await runGit(['clone', '--', url, dir], {
    env: gitAuthEnv(url, opts.token),
    token: opts.token,
  }).catch((err: Error) => {
    throw new Error(err.message || 'git clone failed.');
  });
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
