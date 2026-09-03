// The repo picker in the chat header (founder, 2026-09-03: a multi-select of
// the repositories connected to the account, the Claude Code way, in basic
// chats and in projects). The pure model is tested outright; the wiring (the
// header, the first send, the project seed, the context that rides into each
// driver) is pinned by reading the source.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  firstWorkspace,
  githubRepoId,
  isGithubRepoId,
  listGitHubRepos,
  repoContextLine,
  repoLabel,
  summarizeRepos,
  toRepoOptions,
  toggleRepo,
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
    expect(summarizeRepos([])).toBe('No repos');
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

  it('surfaces a refused token as an error, never an empty list', async () => {
    const fetchImpl = (async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    await expect(listGitHubRepos('bad', fetchImpl)).rejects.toThrow('GitHub answered 401.');
  });
});

describe('the wiring', () => {
  const chat = read('screens/ChatScreen.tsx');
  const store = read('state/store.ts');

  it('puts the picker where the model name was, in a live chat and before the first message', () => {
    expect(chat).not.toMatch(/thread\.model\.name\} · \$\{thread\.model\.kind\}/);
    expect(chat).toMatch(/<RepoPicker[\s\S]*?selected=\{conv\.repoIds \?\? \[\]\}/);
    expect(chat).toMatch(/<RepoPicker[\s\S]*?selected=\{pendingRepoIds\}/);
    expect(chat).toMatch(/newConversation\(source, \{ repoIds: pendingRepoIds \}\)/);
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
    expect(store).toMatch(/daemonCreateSession\(settings\.daemon, cwd, sessionOpts\)/);
    expect((store.match(/repoContextLine\(conv\.repoIds \?\? \[\]\)/g) ?? []).length).toBe(3);
    expect(read('drivers/cloudClaudeDriver.ts')).toMatch(/this\.extraSystem\]\.filter\(Boolean\)/);
  });

  it('offers the same repos in the project sheet', () => {
    expect(read('screens/ProjectsScreen.tsx')).toContain('useConnectedRepos(');
  });
});
