// GitHub over Octokit, using the token from the auth store. Everything the
// terminal workflow needs: identity, repo info, and opening a PR.
import { Octokit } from '@octokit/rest';
import { getGithubToken } from '../auth/github.js';

export function octokit(): Octokit {
  const token = getGithubToken();
  if (!token) {
    throw new Error(
      'GitHub is not connected. Run osc auth github (device flow or a personal access token).',
    );
  }
  return new Octokit({ auth: token });
}

export async function whoami(): Promise<string> {
  const { data } = await octokit().rest.users.getAuthenticated();
  return data.login;
}

/** Parse origin URL into owner/repo. Supports ssh and https remotes. */
export function parseRemote(url: string): { owner: string; repo: string } | undefined {
  const m = /github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/.exec(url);
  return m ? { owner: m[1]!, repo: m[2]! } : undefined;
}

export interface OpenPrOptions {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base?: string;
}

export async function openPullRequest(opts: OpenPrOptions): Promise<string> {
  const client = octokit();
  const base =
    opts.base ??
    (await client.rest.repos.get({ owner: opts.owner, repo: opts.repo })).data.default_branch;
  const { data } = await client.rest.pulls.create({
    owner: opts.owner,
    repo: opts.repo,
    title: opts.title,
    body: opts.body,
    head: opts.head,
    base,
  });
  return data.html_url;
}

export async function listOpenPullRequests(owner: string, repo: string): Promise<string[]> {
  const { data } = await octokit().rest.pulls.list({ owner, repo, state: 'open', per_page: 20 });
  return data.map(
    (pr) => `#${pr.number} ${pr.title} (${pr.head.ref} -> ${pr.base.ref}) ${pr.html_url}`,
  );
}
