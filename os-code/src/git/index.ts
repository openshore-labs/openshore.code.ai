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

/**
 * Clone `url` into `dir`. With a token, the token rides as an http header
 * scoped to the platform's host through git's environment config
 * (GIT_CONFIG_COUNT), so it never lands in the clone's .git/config, its
 * remote address, or the process arguments. Terminal prompts are off either
 * way, so a private repository with no credentials fails at once instead of
 * waiting on a prompt nobody can answer.
 */
export async function clone(
  url: string,
  dir: string,
  opts: { token?: string } = {},
): Promise<void> {
  const header = opts.token ? cloneAuthHeader(url, opts.token) : undefined;
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (header) {
    const count = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10);
    const at = Number.isFinite(count) && count > 0 ? count : 0;
    env[`GIT_CONFIG_KEY_${at}`] = header.key;
    env[`GIT_CONFIG_VALUE_${at}`] = header.value;
    env.GIT_CONFIG_COUNT = String(at + 1);
  }
  await new Promise<void>((resolve, reject) => {
    execFile(
      'git',
      ['clone', '--', url, dir],
      { env, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, _stdout, stderr) => {
        if (!err) return resolve();
        const detail = String(stderr || err.message)
          .split('\n')
          .filter((l) => l.trim() && !/^Cloning into /.test(l))
          .join('\n');
        reject(new Error(redactToken(detail || 'git clone failed.', opts.token)));
      },
    );
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
