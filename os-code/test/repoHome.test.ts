// The repo-home path is where a user-picked storage folder meets a real clone,
// so it is where the CTO's four must-fix guardrails live. These pin them against
// real git and a real tmp tree: sensitive roots are refused, an existing dir is
// never clobbered or silently reused across a different remote, a repo outside
// ~/OSCode gets allowlisted for the outbox, and a clone into a chosen folder
// lands there with its default branch recorded.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import {
  assertSafeRepoParent,
  repoNameFromUrl,
  normalizeRemote,
  inspectTarget,
  cloneRepoHome,
  cloneWithAuth,
  allowlistOutboxRoot,
  RepoHomeError,
} from '../src/git/repoHome.js';
import { loadConfig } from '../src/config/load.js';

let scratch: string;
let oscHomeDir: string;
let source: string; // a real bare-ish origin to clone from

beforeEach(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'osc-rh-scratch-'));
  oscHomeDir = mkdtempSync(join(tmpdir(), 'osc-rh-home-'));
  process.env.OSC_HOME = oscHomeDir;

  // A real source repo with one commit, used as the clone origin.
  source = mkdtempSync(join(tmpdir(), 'osc-rh-src-'));
  const g = simpleGit(source);
  await g.init(['--initial-branch=trunk']);
  await g.addConfig('user.email', 'dev@test.local');
  await g.addConfig('user.name', 'Dev');
  await g.addConfig('commit.gpgsign', 'false');
  writeFileSync(join(source, 'README.md'), '# src\n');
  await g.add(['README.md']);
  await g.commit('init');
});

afterEach(() => {
  delete process.env.OSC_HOME;
  rmSync(scratch, { recursive: true, force: true });
  rmSync(oscHomeDir, { recursive: true, force: true });
  rmSync(source, { recursive: true, force: true });
});

describe('assertSafeRepoParent', () => {
  it('accepts a normal absolute folder', () => {
    expect(assertSafeRepoParent(scratch)).toBeTruthy();
  });

  it('refuses a relative path', () => {
    expect(() => assertSafeRepoParent('repos')).toThrow(RepoHomeError);
  });

  it('refuses the filesystem root, home itself, and ~/.ssh', () => {
    expect(() => assertSafeRepoParent('/')).toThrow(RepoHomeError);
    expect(() => assertSafeRepoParent(homedir())).toThrow(RepoHomeError);
    expect(() => assertSafeRepoParent(join(homedir(), '.ssh'))).toThrow(RepoHomeError);
    expect(() => assertSafeRepoParent(join(homedir(), '.ssh', 'keys'))).toThrow(RepoHomeError);
  });

  it('refuses a path inside a .git directory', () => {
    expect(() => assertSafeRepoParent(join(scratch, '.git', 'objects'))).toThrow(RepoHomeError);
  });
});

describe('repoNameFromUrl', () => {
  it('derives a safe single segment', () => {
    expect(repoNameFromUrl('https://github.com/owner/my-repo.git')).toBe('my-repo');
    expect(repoNameFromUrl('git@github.com:owner/my-repo.git')).toBe('my-repo');
    expect(repoNameFromUrl('https://github.com/owner/weird name!/')).toBe('weirdname');
  });
});

describe('normalizeRemote', () => {
  it('folds https, scp, .git, and trailing slash to one form', () => {
    const a = normalizeRemote('https://github.com/owner/repo.git');
    const b = normalizeRemote('git@github.com:owner/repo');
    const c = normalizeRemote('https://x-access-token@github.com/owner/repo/');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe('inspectTarget', () => {
  it('says clone when nothing is there', async () => {
    const r = await inspectTarget(scratch, 'repo', 'https://github.com/owner/repo.git');
    expect(r.action).toBe('clone');
  });

  it('reuses an existing checkout of the SAME remote', async () => {
    const target = join(scratch, 'repo');
    await simpleGit().clone(source, target);
    const r = await inspectTarget(scratch, 'repo', source);
    expect(r.action).toBe('reuse');
  });

  it('refuses a different repo at the target', async () => {
    const target = join(scratch, 'repo');
    await simpleGit().clone(source, target);
    await expect(
      inspectTarget(scratch, 'repo', 'https://github.com/someone/else.git'),
    ).rejects.toThrow(RepoHomeError);
  });

  it('refuses a non-repo directory at the target', async () => {
    mkdirSync(join(scratch, 'repo'));
    writeFileSync(join(scratch, 'repo', 'a.txt'), 'not a repo\n');
    await expect(inspectTarget(scratch, 'repo', source)).rejects.toThrow(RepoHomeError);
  });
});

describe('cloneWithAuth', () => {
  it('clones into a chosen folder (no token path)', async () => {
    const target = join(scratch, 'picked');
    await cloneWithAuth(source, target);
    expect(await simpleGit(target).checkIsRepo()).toBe(true);
  });
});

describe('cloneRepoHome', () => {
  // The https anchor blocks local-path/file transports by design, so the real
  // network clone is exercised via cloneWithAuth above. Here we drive the rest
  // of cloneRepoHome (branch read + outbox allowlisting) through the
  // origin-matching reuse path, which needs no network.
  async function preClone(httpsUrl: string): Promise<string> {
    const name = repoNameFromUrl(httpsUrl);
    const target = join(scratch, name);
    await simpleGit().clone(source, target);
    await simpleGit(target).remote(['set-url', 'origin', httpsUrl]);
    return target;
  }

  it('records the default branch and allowlists a repo outside ~/OSCode', async () => {
    const url = 'https://github.com/owner/repo.git';
    const target = await preClone(url);
    const result = await cloneRepoHome({ url, parent: scratch });
    expect(result.cwd).toBe(target);
    expect(result.defaultBranch).toBe('trunk');
    expect(result.registeredRoot).toBe(true);
    const roots = loadConfig().config.daemon.outboxAllowedRoots;
    expect(roots.some((r) => result.cwd.startsWith(r))).toBe(true);
  });

  it('rejects a non-git URL', async () => {
    await expect(cloneRepoHome({ url: 'ftp://nope/repo', parent: scratch })).rejects.toThrow(
      RepoHomeError,
    );
  });
});

describe('allowlistOutboxRoot', () => {
  it('is idempotent', () => {
    const p = join(scratch, 'a-repo');
    mkdirSync(p);
    expect(allowlistOutboxRoot(p)).toBe(true);
    expect(allowlistOutboxRoot(p)).toBe(false);
  });
});
