// The attach roster and its helpers: what shows up in the pickers, how a stored
// id renders when its repo is offline, and how a chat resolves the repos it
// runs on (its own override, else the project's).
import { describe, expect, it } from 'vitest';
import {
  availableRepos,
  repoRefLabel,
  resolveChatRepoIds,
} from '../src/lib/availableRepos.js';
import type { GitosResource } from '../src/lib/gitos/providers.js';
import type { HomeRepo } from '../src/lib/repos.js';

const homeRepo: HomeRepo = {
  id: 'h1',
  label: 'OpenShore mono',
  kind: 'github',
  defaultBranch: 'main',
};

const gitosRepo: GitosResource = {
  id: 'r1',
  name: 'notes-engine',
  kind: 'repo',
  providerId: 'local',
  createdAt: '2026-08-25T00:00:00.000Z',
};

const gitosVault: GitosResource = {
  id: 'v1',
  name: 'My Vault',
  kind: 'vault',
  providerId: 'local',
  createdAt: '2026-08-25T00:00:00.000Z',
};

describe('availableRepos', () => {
  it('merges home repo, gitOS repos, and desktop workspaces, home first', () => {
    const list = availableRepos({
      homeRepo,
      gitosResources: [gitosVault, gitosRepo],
      workspaces: [{ cwd: '/Users/me/code/app', name: 'app' }],
    });
    expect(list.map((r) => r.id)).toEqual([
      'home:h1',
      'gitos:r1',
      'desktop:/Users/me/code/app',
    ]);
    // A vault is not a repo, so it never enters the code-repo roster.
    expect(list.some((r) => r.name === 'My Vault')).toBe(false);
  });

  it('carries a human origin line for each source', () => {
    const list = availableRepos({ homeRepo, gitosResources: [gitosRepo] });
    expect(list.find((r) => r.id === 'home:h1')!.origin).toContain('Home repo');
    expect(list.find((r) => r.id === 'gitos:r1')!.origin).toBe('This device');
  });

  it('dedupes by id', () => {
    const list = availableRepos({
      workspaces: [
        { cwd: '/a', name: 'a' },
        { cwd: '/a', name: 'a-again' },
      ],
    });
    expect(list).toHaveLength(1);
  });

  it('returns an empty roster when nothing is connected', () => {
    expect(availableRepos({})).toEqual([]);
  });
});

describe('repoRefLabel', () => {
  it('uses the roster name when the repo is reachable', () => {
    const list = availableRepos({ gitosResources: [gitosRepo] });
    expect(repoRefLabel('gitos:r1', list)).toBe('notes-engine');
  });

  it('falls back to a readable tail when the repo is offline', () => {
    expect(repoRefLabel('desktop:/Users/me/code/app', [])).toBe('app');
    expect(repoRefLabel('gitos:r1', [])).toBe('r1');
  });
});

describe('resolveChatRepoIds', () => {
  it('inherits the project repos when the chat has no override', () => {
    expect(resolveChatRepoIds(undefined, ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('uses the chat override when it has one, empty included', () => {
    expect(resolveChatRepoIds(['x'], ['a', 'b'])).toEqual(['x']);
    expect(resolveChatRepoIds([], ['a', 'b'])).toEqual([]);
  });

  it('is empty when neither the chat nor the project set repos', () => {
    expect(resolveChatRepoIds(undefined, undefined)).toEqual([]);
  });
});
