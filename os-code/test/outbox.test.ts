// The outbox apply is the one server path that materializes a phone's buffered
// work into a real commit. It must never touch the live working tree, must be
// idempotent on clientOpId, must confine writes to the repo, and must route a
// conflict to a rescue branch instead of force-pushing. These run against real
// git in a throwaway repo.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { applyOutboxItem, confinedPath, type OutboxApplyRequest } from '../src/git/outbox.js';

let repo: string;
let home: string;
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

function req(over: Partial<OutboxApplyRequest> & { baseCommit: string }): OutboxApplyRequest {
  return {
    cwd: repo,
    clientOpId: 'op-1',
    itemId: 'itm-1',
    deviceId: 'dev-1',
    branch: 'main',
    message: 'from the phone',
    files: [{ path: 'new.txt', mode: 'upsert', contentBase64: b64('hello from offshore') }],
    ...over,
  };
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), 'oscrepo-'));
  home = mkdtempSync(join(tmpdir(), 'oschome-'));
  process.env.OSC_HOME = home;
  const g = simpleGit(repo);
  await g.init(['--initial-branch=main']);
  await g.addConfig('user.email', 'dev@test.local');
  await g.addConfig('user.name', 'Dev');
  await g.addConfig('commit.gpgsign', 'false');
  writeFileSync(join(repo, 'README.md'), '# repo\n');
  await g.add(['README.md']);
  await g.commit('init');
});

afterEach(() => {
  delete process.env.OSC_HOME;
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

async function head(): Promise<string> {
  return (await simpleGit(repo).revparse(['HEAD'])).trim();
}

describe('outbox apply', () => {
  it('commits a buffered file without touching the working tree', async () => {
    // A dirty, uncommitted edit sits in the working tree; apply must not sweep it.
    writeFileSync(join(repo, 'README.md'), '# repo\nlocal uncommitted edit\n');

    const base = await head();
    const result = await applyOutboxItem(req({ baseCommit: base }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The new commit is on main, and carries the buffered file.
    const show = await simpleGit(repo).raw(['show', `${result.resultCommit}:new.txt`]);
    expect(show).toContain('hello from offshore');
    // The founder's uncommitted edit is still uncommitted and unchanged.
    const status = await simpleGit(repo).status();
    expect(status.modified).toContain('README.md');
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toContain('local uncommitted edit');
    // The commit did NOT include the dirty README (proves no `add -A`).
    const changed = await simpleGit(repo).raw(['diff-tree', '--no-commit-id', '--name-only', '-r', result.resultCommit]);
    expect(changed.trim()).toBe('new.txt');
  });

  it('is idempotent on clientOpId (a replay returns the same commit)', async () => {
    const base = await head();
    const first = await applyOutboxItem(req({ baseCommit: base }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const replay = await applyOutboxItem(req({ baseCommit: base }));
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.resultCommit).toBe(first.resultCommit);
    expect(replay.idempotentReplay).toBe(true);
    // Only one new commit landed, not two.
    const count = (await simpleGit(repo).raw(['rev-list', '--count', 'main'])).trim();
    expect(count).toBe('2');
  });

  it('routes a conflict to a rescue branch, never force-pushing main', async () => {
    // The phone composed against a base commit that the branch later diverged
    // from (a rewrite / rebase), so base is no longer an ancestor of the tip.
    writeFileSync(join(repo, 'a.txt'), 'work composed against this\n');
    await simpleGit(repo).add(['a.txt']);
    await simpleGit(repo).commit('base for the buffered item');
    const base = await head();

    // History is rewritten: main resets back and lands a different commit, so
    // `base` becomes a sibling, not an ancestor, of the new tip.
    await simpleGit(repo).raw(['reset', '--hard', 'HEAD~1']);
    writeFileSync(join(repo, 'b.txt'), 'divergent history\n');
    await simpleGit(repo).add(['b.txt']);
    await simpleGit(repo).commit('divergent tip');
    const movedTip = await head();

    const result = await applyOutboxItem(req({ baseCommit: base, clientOpId: 'op-2', itemId: 'itm-2' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect('conflict' in result && result.conflict).toBe(true);
    if (!('conflict' in result)) return;
    expect(result.rescueBranch).toBe('oscode/outbox/dev-1/itm-2');
    // main is untouched: still the "meanwhile" tip, not force-moved.
    expect(await head()).toBe(movedTip);
    // The work is preserved on the rescue ref.
    expect(existsSync(join(repo, '.git', 'refs', 'heads', 'oscode', 'outbox', 'dev-1', 'itm-2'))).toBe(true);
  });

  it('deletes a file through the outbox', async () => {
    const base = await head();
    const result = await applyOutboxItem(
      req({ baseCommit: base, clientOpId: 'op-del', itemId: 'itm-del', files: [{ path: 'README.md', mode: 'delete' }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await expect(simpleGit(repo).raw(['show', `${result.resultCommit}:README.md`])).rejects.toBeTruthy();
  });
});

describe('path confinement', () => {
  it('accepts a normal path', () => {
    expect(confinedPath('/repo', 'src/a.ts')).toBe('/repo/src/a.ts');
  });
  it('rejects absolute paths', () => {
    expect(() => confinedPath('/repo', '/etc/passwd')).toThrow();
  });
  it('rejects parent-directory escapes', () => {
    expect(() => confinedPath('/repo', '../../.ssh/authorized_keys')).toThrow();
    expect(() => confinedPath('/repo', 'a/../../b')).toThrow();
  });
});
