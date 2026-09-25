// The repo picker in the chat header (founder, 2026-09-03: a multi-select of
// the repositories connected to the account, the Claude Code way, in basic
// chats and in projects). The pure model is tested outright; the wiring (the
// header, the first send, the project seed, the context that rides into each
// driver) is pinned by reading the source.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bitbucketAuthorization,
  cloneUrlFor,
  firstWorkspace,
  githubAccess,
  githubAccessHint,
  githubRepoId,
  githubStatus,
  isGithubRepoId,
  isRemoteRepoId,
  listBitbucketRepos,
  listGitHubRepos,
  listGitLabRepos,
  localCloneFor,
  parseRemoteRepoId,
  platformForCloneUrl,
  remoteIdFromUrl,
  repoContextLine,
  repoLabel,
  sameRepo,
  summarizeRepos,
  toRepoOptions,
  toggleRepo,
  withClone,
  type RepoOption,
} from '../src/lib/chatRepos.js';

const SRC = join(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('repo ids and labels', () => {
  it('tells a GitHub repo from a workspace path and names both short', () => {
    expect(githubRepoId('openshore-labs/uki-audio')).toBe('github:openshore-labs/uki-audio');
    expect(isGithubRepoId('github:a/b')).toBe(true);
    expect(isGithubRepoId('/Users/me/code/uki-audio')).toBe(false);
    expect(repoLabel('github:openshore-labs/uki-audio')).toBe('uki-audio');
    expect(repoLabel('/Users/me/code/uki-audio')).toBe('uki-audio');
    expect(repoLabel('C:\\code\\uki-audio')).toBe('uki-audio');
  });

  it('summarizes for the header: none, one, or the first plus a count', () => {
    expect(summarizeRepos([])).toBe('No repositories');
    expect(summarizeRepos(['/code/uki-audio'])).toBe('uki-audio');
    expect(summarizeRepos(['/code/uki-audio', 'github:o/openshore-hq', 'github:o/x'])).toBe(
      'uki-audio +2',
    );
  });

  it('works in the first workspace and carries every repo as context', () => {
    const ids = ['github:o/hq', '/code/uki-audio', '/code/other'];
    expect(firstWorkspace(ids)).toBe('/code/uki-audio');
    expect(firstWorkspace(['github:o/hq'])).toBeUndefined();
    expect(repoContextLine([])).toBeUndefined();
    expect(repoContextLine(ids)).toBe(
      'Repositories in this chat: o/hq (GitHub); uki-audio at /code/uki-audio; other at /code/other.',
    );
  });

  it('toggles in order without duplicates', () => {
    expect(toggleRepo([], 'a')).toEqual(['a']);
    expect(toggleRepo(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleRepo(['a'], 'b')).toEqual(['a', 'b']);
  });
});

describe('the GitHub road', () => {
  it('maps /user/repos rows and skips malformed ones', () => {
    const rows = toRepoOptions([
      { full_name: 'o/uki-audio', name: 'uki-audio', private: true, owner: { login: 'o' } },
      { full_name: 'broken', name: 'broken' },
    ]);
    expect(rows).toEqual([
      { id: 'github:o/uki-audio', kind: 'github', name: 'uki-audio', detail: 'o', private: true },
    ]);
  });

  it('lists on the stored token with the GitHub headers and pages until a short page', async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    const page = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        full_name: `o/r${calls.length}-${i}`,
        name: `r${i}`,
      }));
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: (init?.headers as Record<string, string>).authorization });
      const body = calls.length === 1 ? page(100) : page(3);
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const repos = await listGitHubRepos('ghp_x', fetchImpl);
    expect(repos).toHaveLength(103);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain('https://api.github.com/user/repos?per_page=100');
    expect(calls[0]!.url).toContain('page=1');
    expect(calls[1]!.url).toContain('page=2');
    expect(calls[0]!.auth).toBe('Bearer ghp_x');
  });

  it('surfaces a refused token as a sentence that names the fix, never an empty list', async () => {
    const answer = (status: number) =>
      (async () => new Response('', { status })) as unknown as typeof fetch;
    await expect(listGitHubRepos('bad', answer(401))).rejects.toThrow(
      'Your GitHub sign-in has expired. Open Repositories, remove GitHub, and connect it again.',
    );
    await expect(listGitHubRepos('bad', answer(403))).rejects.toThrow(/limiting requests/);
    await expect(listGitHubRepos('bad', answer(500))).rejects.toThrow(/did not answer/);
    // The status code itself never reaches the screen.
    await expect(listGitHubRepos('bad', answer(401))).rejects.not.toThrow(/401/);
  });

  it('pages past 300 repositories (a big organization) and stops at a short page', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      const n = calls <= 4 ? 100 : 7;
      return new Response(
        JSON.stringify(
          Array.from({ length: n }, (_, i) => ({ full_name: `o/r${calls}-${i}`, name: `r${i}` })),
        ),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    expect(await listGitHubRepos('t', fetchImpl)).toHaveLength(407);
    expect(calls).toBe(5);
  });
});

describe('platform repo ids (GitHub, GitLab, Bitbucket)', () => {
  it('parses each platform and never mistakes one for a folder', () => {
    expect(parseRemoteRepoId('gitlab:group/sub/app')).toEqual({
      platform: 'gitlab',
      fullName: 'group/sub/app',
    });
    expect(parseRemoteRepoId('bitbucket:ws/app')).toEqual({
      platform: 'bitbucket',
      fullName: 'ws/app',
    });
    expect(parseRemoteRepoId('/code/app')).toBeUndefined();
    expect(parseRemoteRepoId('C:\\code\\app')).toBeUndefined();
    expect(parseRemoteRepoId('github:noslash')).toBeUndefined();
    expect(isRemoteRepoId('gitlab:group/app')).toBe(true);
    expect(isRemoteRepoId('/code/app')).toBe(false);
    // The agent works in the first FOLDER; a GitLab or Bitbucket id is context.
    expect(firstWorkspace(['gitlab:g/a', 'bitbucket:w/b', '/code/app'])).toBe('/code/app');
    expect(repoLabel('gitlab:group/sub/app')).toBe('app');
    expect(repoContextLine(['gitlab:g/a', 'bitbucket:w/b'])).toBe(
      'Repositories in this chat: g/a (GitLab); w/b (Bitbucket).',
    );
  });

  it('builds the https clone address for each platform', () => {
    expect(cloneUrlFor('github:openshore-labs/openshore-hq')).toBe(
      'https://github.com/openshore-labs/openshore-hq.git',
    );
    expect(cloneUrlFor('gitlab:g/sub/a')).toBe('https://gitlab.com/g/sub/a.git');
    expect(cloneUrlFor('bitbucket:w/a')).toBe('https://bitbucket.org/w/a.git');
    expect(cloneUrlFor('/code/app')).toBeUndefined();
  });

  it('sends a token only for a plain https address on the platform host', () => {
    expect(platformForCloneUrl('https://github.com/o/r.git')).toBe('github');
    expect(platformForCloneUrl('https://gitlab.com/g/r')).toBe('gitlab');
    expect(platformForCloneUrl('https://bitbucket.org/w/r.git')).toBe('bitbucket');
    for (const url of [
      'http://github.com/o/r.git',
      'https://github.com.evil.example/o/r.git',
      'https://evil.example/github.com/o/r.git',
      'https://user@github.com/o/r.git',
      'https://github.com:8443/o/r.git',
      'git@github.com:o/r.git',
      'not a url',
    ]) {
      expect(platformForCloneUrl(url), url).toBeUndefined();
    }
  });

  it('reads a clone origin as a platform id, https or ssh, and compares ids case-insensitively', () => {
    expect(remoteIdFromUrl('https://github.com/Openshore-Labs/openshore-hq.git')).toBe(
      'github:Openshore-Labs/openshore-hq',
    );
    expect(remoteIdFromUrl('git@github.com:o/r.git')).toBe('github:o/r');
    expect(remoteIdFromUrl('ssh://git@gitlab.com/g/sub/r.git')).toBe('gitlab:g/sub/r');
    expect(remoteIdFromUrl('https://bitbucket.org/w/r/')).toBe('bitbucket:w/r');
    expect(remoteIdFromUrl('https://example.com/o/r.git')).toBeUndefined();
    expect(remoteIdFromUrl(undefined)).toBeUndefined();
    expect(sameRepo('github:Openshore-Labs/HQ', 'github:openshore-labs/hq')).toBe(true);
    expect(sameRepo('github:o/a', 'gitlab:o/a')).toBe(false);
  });

  it('finds the clone that holds a platform repo, and puts it first when opened', () => {
    const ws: RepoOption[] = [
      { id: '/home/me/OSCode/hq', kind: 'workspace', name: 'hq', remoteId: 'github:o/hq' },
      { id: '/home/me/other', kind: 'workspace', name: 'other' },
    ];
    expect(localCloneFor('github:O/HQ', ws)?.id).toBe('/home/me/OSCode/hq');
    expect(localCloneFor('github:o/site', ws)).toBeUndefined();
    expect(withClone(['/code/x', 'github:o/hq'], 'github:o/hq', '/home/me/OSCode/hq')).toEqual([
      '/home/me/OSCode/hq',
      '/code/x',
      'github:o/hq',
    ]);
    // Idempotent: opening twice does not duplicate the folder.
    expect(
      withClone(['/home/me/OSCode/hq', 'github:o/hq'], 'github:o/hq', '/home/me/OSCode/hq'),
    ).toEqual(['/home/me/OSCode/hq', 'github:o/hq']);
  });
});

describe('the GitLab and Bitbucket roads', () => {
  it('lists GitLab projects the person is a member of, nested groups included', async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: (init?.headers as Record<string, string>).authorization });
      return new Response(
        JSON.stringify([
          {
            path_with_namespace: 'grp/sub/app',
            name: 'App',
            visibility: 'private',
            namespace: { full_path: 'grp/sub' },
          },
          { path_with_namespace: 'broken' },
        ]),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const rows = await listGitLabRepos('glpat-x', fetchImpl);
    expect(rows).toEqual([
      { id: 'gitlab:grp/sub/app', kind: 'gitlab', name: 'App', detail: 'grp/sub', private: true },
    ]);
    expect(calls[0]!.url).toContain('https://gitlab.com/api/v4/projects?membership=true');
    expect(calls[0]!.auth).toBe('Bearer glpat-x');
    await expect(
      listGitLabRepos(
        'x',
        (async () => new Response('', { status: 401 })) as unknown as typeof fetch,
      ),
    ).rejects.toThrow('Your GitLab sign-in has expired.');
  });

  it('lists Bitbucket repositories and follows next only on its own API host', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      const body =
        urls.length === 1
          ? {
              values: [
                { full_name: 'ws/app', name: 'App', is_private: true, workspace: { slug: 'ws' } },
              ],
              next: 'https://api.bitbucket.org/2.0/repositories?page=2',
            }
          : { values: [{ full_name: 'ws/two', name: 'two' }], next: 'https://evil.example/steal' };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const rows = await listBitbucketRepos('tok', fetchImpl);
    expect(rows.map((r) => r.id)).toEqual(['bitbucket:ws/app', 'bitbucket:ws/two']);
    expect(rows[0]).toMatchObject({ kind: 'bitbucket', detail: 'ws', private: true });
    expect(urls).toHaveLength(2);
    expect(urls.some((u) => u.includes('evil.example'))).toBe(false);
  });

  it('sends an Atlassian API token (email:token) as Basic and anything else as a bearer', () => {
    expect(bitbucketAuthorization('tok')).toBe('Bearer tok');
    expect(bitbucketAuthorization('me@example.com:ATATT3x')).toBe(
      `Basic ${Buffer.from('me@example.com:ATATT3x').toString('base64')}`,
    );
  });
});

describe('why a GitHub list can look short', () => {
  /** A fake GitHub: each path answers with its body (and headers). */
  function github(
    routes: Record<string, { status?: number; body: unknown; headers?: Record<string, string> }>,
  ): typeof fetch {
    return (async (url: string) => {
      const path = new URL(url).pathname;
      const hit = routes[path];
      if (!hit) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(hit.body), {
        status: hit.status ?? 200,
        headers: hit.headers,
      });
    }) as unknown as typeof fetch;
  }
  const repo = (name: string, priv: boolean) => ({
    full_name: `openshore-labs/${name}`,
    name,
    private: priv,
    owner: { login: 'openshore-labs' },
  });
  // The founder's account on 2026-09-25: four public repositories and the
  // rest private; the picker showed exactly the four public ones.
  const PUBLIC = [
    'openshore.code.ai',
    'OpenShore.ai-marketing-site',
    'Personal-thank-you-generator-',
    'Vestibular-migraine-support',
  ].map((n) => repo(n, false));
  const PRIVATE = ['openshore-hq', 'Open-Shore-LLC-Homepage'].map((n) => repo(n, true));

  it('names an OAuth App sign-in with no repo scope as the reason only public repos show', async () => {
    const status = await githubStatus('gho_abc', {
      fetchImpl: github({
        '/user': { body: { login: 'openshore-labs' }, headers: { 'x-oauth-scopes': '' } },
        '/user/repos': { body: PUBLIC },
      }),
    });
    expect(status.repos).toHaveLength(4);
    expect(status.access).toMatchObject({ kind: 'oauth', login: 'openshore-labs', scopes: [] });
    expect(status.line).toBe('Signed in to GitHub as @openshore-labs, through an OAuth app.');
    expect(status.hint).toEqual({
      text: 'This GitHub sign-in can see only your public repositories: GitHub gave it no access to private ones. Reconnect GitHub to allow them.',
      action: 'Reconnect GitHub',
      reconnect: true,
    });
  });

  it('says nothing is wrong when an OAuth App sign-in holds the repo scope', async () => {
    const status = await githubStatus('gho_abc', {
      fetchImpl: github({
        '/user': { body: { login: 'me' }, headers: { 'x-oauth-scopes': 'repo, read:org' } },
        '/user/repos': { body: [...PUBLIC, ...PRIVATE] },
      }),
    });
    expect(status.access?.scopes).toEqual(['repo', 'read:org']);
    expect(status.hint).toBeUndefined();
  });

  it("merges each App installation's own list, so an App sign-in sees what it was granted", async () => {
    const status = await githubStatus('ghu_app', {
      fetchImpl: github({
        '/user': { body: { login: 'openshore-labs' } },
        '/user/repos': { body: PUBLIC },
        '/user/installations': {
          body: {
            installations: [
              {
                id: 42,
                account: { login: 'openshore-labs' },
                repository_selection: 'all',
                html_url: 'https://github.com/settings/installations/42',
                app_slug: 'openshore-code',
              },
            ],
          },
        },
        '/user/installations/42/repositories': {
          body: { total_count: 6, repositories: [...PUBLIC, ...PRIVATE] },
        },
      }),
    });
    expect(status.repos.map((r) => r.name)).toEqual([
      ...PUBLIC.map((r) => r.name),
      'openshore-hq',
      'Open-Shore-LLC-Homepage',
    ]);
    expect(status.line).toBe(
      'Signed in to GitHub as @openshore-labs, through the OpenShore Code GitHub App.',
    );
    // Everything granted, private ones included: only the add-an-account line.
    expect(status.hint?.action).toBe('Add on GitHub');
  });

  it('asks an App sign-in that still sees only public repos to reconnect', () => {
    const hint = githubAccessHint(
      { kind: 'app', installations: [{ account: 'me', selection: 'all' }] },
      { publicOnly: true },
    );
    expect(hint).toMatchObject({ action: 'Reconnect GitHub', reconnect: true });
  });

  it('reads the GitHub App installations and whether each picked a few repositories', async () => {
    const access = await githubAccess(
      'ghu_app',
      github({
        '/user': { body: { login: 'me' } },
        '/user/installations': {
          body: {
            installations: [
              {
                id: 7,
                account: { login: 'openshore-labs' },
                repository_selection: 'selected',
                html_url:
                  'https://github.com/organizations/openshore-labs/settings/installations/7',
                app_slug: 'openshore-code',
              },
            ],
          },
        },
      }),
    );
    expect(access).toEqual({
      kind: 'app',
      login: 'me',
      scopes: undefined,
      installations: [
        {
          id: 7,
          account: 'openshore-labs',
          selection: 'selected',
          manageUrl: 'https://github.com/organizations/openshore-labs/settings/installations/7',
          appSlug: 'openshore-code',
        },
      ],
    });
    expect(githubAccessHint(access)).toEqual({
      text: 'OpenShore sees only the repositories you picked for openshore-labs on GitHub.',
      action: 'Choose repositories',
      url: 'https://github.com/organizations/openshore-labs/settings/installations/7',
    });
  });

  it('never trusts a manage link or slug that is not GitHub-shaped', async () => {
    const access = await githubAccess(
      'ghu_app',
      github({
        '/user': { body: { login: 'me' } },
        '/user/installations': {
          body: {
            installations: [
              {
                account: { login: 'a' },
                repository_selection: 'selected',
                html_url: 'https://evil.example/x',
                app_slug: 'bad slug/..',
              },
            ],
          },
        },
      }),
    );
    expect(githubAccessHint(access)?.url).toBe('https://github.com/settings/installations');
  });

  it('sends several picked accounts, or none installed, to the App install page', () => {
    const two = githubAccessHint(
      {
        kind: 'app',
        installations: [
          {
            account: 'me',
            selection: 'selected',
            manageUrl: 'https://github.com/settings/installations/1',
          },
          {
            account: 'org',
            selection: 'selected',
            manageUrl: 'https://github.com/organizations/org/settings/installations/2',
          },
        ],
      },
      { slug: 'openshore-code' },
    );
    expect(two?.text).toBe(
      'OpenShore sees only the repositories you picked for me and org on GitHub.',
    );
    expect(two?.url).toBe('https://github.com/apps/openshore-code/installations/new');
    const none = githubAccessHint({ kind: 'app', installations: [] }, { slug: 'openshore-code' });
    expect(none?.action).toBe('Add it on GitHub');
    // Everything granted, not public-only, and no slug known: nothing to say.
    expect(
      githubAccessHint({ kind: 'app', installations: [{ account: 'me', selection: 'all' }] }),
    ).toBeUndefined();
  });

  it('points a pasted token at the token page, and says nothing when GitHub cannot be asked', async () => {
    const classic = await githubAccess(
      'ghp_classic',
      github({ '/user': { body: { login: 'me' }, headers: { 'x-oauth-scopes': 'read:user' } } }),
    );
    expect(classic).toMatchObject({ kind: 'classic', scopes: ['read:user'] });
    expect(githubAccessHint(classic)?.text).toMatch(/can see only public repositories/);
    const fine = await githubAccess('github_pat_x', github({ '/user': { body: { login: 'me' } } }));
    expect(fine?.kind).toBe('fine-grained');
    expect(githubAccessHint(fine, { publicOnly: true })?.text).toMatch(/only public repositories/);
    expect(githubAccessHint(fine)?.url).toBe('https://github.com/settings/personal-access-tokens');
    // A refused or unreachable GitHub: no hint rather than a wrong one.
    expect(
      await githubAccess('ghu_x', github({ '/user': { status: 401, body: {} } })),
    ).toBeUndefined();
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await githubAccess('ghu_x', offline)).toBeUndefined();
    expect(githubAccessHint(undefined)).toBeUndefined();
  });
});

describe('the wiring', () => {
  const chat = read('screens/ChatScreen.tsx');
  const store = read('state/store.ts');

  it('puts the picker where the model name was, in a live chat and before the first message', () => {
    expect(chat).not.toMatch(/thread\.model\.name\} · \$\{thread\.model\.kind\}/);
    expect(chat).toMatch(/<RepoPicker[\s\S]*?selected=\{conv\.repoIds \?\? \[\]\}/);
    expect(chat).toMatch(/<RepoPicker[\s\S]*?selected=\{pendingRepoIds\}/);
    expect(chat).toMatch(/newConversation\(source, \{\s*repoIds: pendingRepoIds,/);
  });

  it('seeds a chat from its project and lets the chat keep its own list', () => {
    expect(store).toMatch(/const repoIds = opts\?\.repoIds \?\? project\?\.repoIds \?\? \[\]/);
    expect(store).toMatch(/async setConversationRepos\(id, repoIds\)/);
    expect(read('state/types.ts')).toMatch(/repoIds\?: string\[\];/);
  });

  it('works in the first workspace and hands every driver the repo context', () => {
    expect(store).toMatch(
      /const cwd = conv\.source\.cwd \?\? firstWorkspace\(conv\.repoIds \?\? \[\]\)/,
    );
    expect(store).toMatch(/createSession\(cwd, sessionOpts\)/);
    // The daemon path hands the repo context (instructions) over explicitly,
    // NOT the whole sessionOpts, so a device's project secrets never travel to a
    // remote machine. The repo context still reaches it via instructions.
    expect(store).toMatch(/daemonCreateSession\(settings\.daemon, cwd, \{/);
    expect(store).toMatch(/instructions: sessionOpts\.instructions/);
    // Repo context reaches every driver. The shared helper carries it for the
    // on-device and cloud drivers (one definition, no duplication), and the
    // desktop and stack paths assemble it alongside their own session options.
    expect(store).toMatch(
      /function standingContext[\s\S]*?repoContextLine\(conv\.repoIds \?\? \[\]\)/,
    );
    // The device driver takes it directly; the cloud and desktop-chat drivers
    // take chatContext, which wraps it with the guided setup's live step (and
    // reads the chat fresh each reply, so a picker change reaches the model).
    expect(
      (store.match(/standingContext\((conv|get\(\)\.conversations\[conv\.id\] \?\? conv)\)/g) ?? [])
        .length,
    ).toBeGreaterThanOrEqual(2);
    expect((store.match(/chatContext\(conv\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(
      (store.match(/repoContextLine\(conv\.repoIds \?\? \[\]\)/g) ?? []).length,
    ).toBeGreaterThanOrEqual(3);
    expect(read('drivers/cloudClaudeDriver.ts')).toMatch(
      /readChatContext\(this\.extraSystem\),?[\s\S]{0,40}\.filter\(Boolean\)/,
    );
  });

  it('offers the same repos in the project detail sheet', () => {
    expect(read('screens/ProjectDetailScreen.tsx')).toContain('useConnectedRepos(');
    expect(read('screens/ProjectDetailScreen.tsx')).toMatch(/repos\.remote/);
  });

  it('lists every connected platform on a refreshed token, not the raw stored one', () => {
    const hook = read('hooks/useConnectedRepos.ts');
    expect(hook).toMatch(/repoToken\(platform\)/);
    expect(hook).toMatch(/listRemoteRepos\(platform, token\)/);
    expect(hook).not.toMatch(/secretGet\(repoSecretKey/);
    expect(read('screens/ProjectMemoryScreen.tsx')).toMatch(/repoToken\('github'\)/);
  });

  it('says why a repository may be missing and links to the fix, then refreshes on return', () => {
    const picker = read('components/RepoPicker.tsx');
    expect(picker).toMatch(/repos\.access/);
    expect(picker).toMatch(/openInAppBrowser\(repos\.access!\.url!, repos\.refresh\)/);
    // A reconnect fix routes to the Repositories screen, which reconnects.
    expect(picker).toMatch(/repos\.access\.reconnect[\s\S]{0,500}onOpenRepos\(\)/);
    const screen = read('screens/ReposScreen.tsx');
    expect(screen).toMatch(/githubStatus\(token/);
    expect(screen).toMatch(
      /const reconnectGithub = async[\s\S]{0,200}disconnectRepoPlatform\('github'\)[\s\S]{0,200}runOAuth\('github'/,
    );
  });

  it('a picker change in a live chat reaches the model on its next turn', () => {
    // Cloud chats read the chat's repositories fresh on every reply.
    expect(store).toMatch(
      /function chatContext[\s\S]{0,400}standingContext\(get\(\)\.conversations\[conv\.id\] \?\? conv\)/,
    );
    // An on-device model and the Stack take them at build: a change marks the
    // chat, and the next send, between turns, rebuilds from the transcript.
    expect(store).toMatch(
      /before\.source\.kind === 'device' \|\| before\.source\.kind === 'stack'\)[\s\S]{0,80}repoContextStale\.add\(id\)/,
    );
    expect(store).toMatch(
      /repoContextStale\.has\(activeId\)[\s\S]{0,300}!c\.thread\.busy[\s\S]{0,200}dropDriver\(activeId\)/,
    );
  });

  it('a started session says where it works and offers a new chat in the picked folder', () => {
    // The folder the session started in is kept on the chat...
    expect(store).toMatch(/bindSessionId\(conv\.id, sessionId, cwd\)/);
    expect((store.match(/bindSessionId\(conv\.id, sessionId, cwd\)/g) ?? []).length).toBe(2);
    // ...and handed to the picker, which offers a new chat when it differs.
    expect(chat).toMatch(/workingIn=\{[\s\S]{0,120}conv\.source\.cwd/);
    expect(chat).toMatch(
      /onNewChat=\{\(ids\) => void newConversation\(\{ kind: 'desktop' \}, \{ repoIds: ids \}\)\}/,
    );
    const picker = read('components/RepoPicker.tsx');
    expect(picker).toMatch(/firstPicked !== workingIn/);
    expect(picker).toMatch(/New chat there/);
  });

  it('pushes a token-made clone with the connected tokens (desktop reconcile)', () => {
    expect(store).toMatch(
      /repoToken\(c\.id\)[\s\S]{0,120}bridge\(\)!\.reconcileRepos\(roots, tokens\)/,
    );
    const host = readFileSync(join(process.cwd(), 'electron', 'engineHost.ts'), 'utf8');
    expect(host).toMatch(/tokens\?\.github \?\? getGithubToken\(\)/);
    expect(readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8')).toMatch(
      /host\.reconcileRepos\([\s\S]{0,120}platformTokens\(tokens\)\)/,
    );
  });

  it('clones with the connected token, from the picker and the Repositories screen', () => {
    expect(read('components/RepoPicker.tsx')).toMatch(/cloneOnComputer\(url,/);
    expect(read('screens/ReposScreen.tsx')).toMatch(/cloneOnComputer\(cleaned, settings\)/);
    const lib = read('lib/repoClone.ts');
    expect(lib).toMatch(/platformForCloneUrl\(url\)/);
    expect(lib).toMatch(/bridge\(\)!\.cloneRepo\(url, token\)/);
    expect(lib).toMatch(/daemonCloneRepo\(settings\.daemon!, url, token\)/);
  });
});
