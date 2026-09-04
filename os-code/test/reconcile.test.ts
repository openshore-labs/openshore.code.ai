// reconcilePush against real temp git repositories: a fast-forward push, the
// clean no-op, a divergence that merges, and a divergence that conflicts (and is
// left untouched, never force-pushed). Plus the error-string classifiers.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import {
  isNonFastForward,
  isOffline,
  reconcilePush,
  reconcileRepos,
} from '../src/git/reconcile.js';

let dirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
async function configure(dir: string): Promise<void> {
  const g = simpleGit(dir);
  await g.addConfig('user.email', 't@example.com');
  await g.addConfig('user.name', 'Test');
  await g.addConfig('commit.gpgsign', 'false');
}
async function commitFile(dir: string, name: string, body: string, message: string): Promise<void> {
  writeFileSync(join(dir, name), body);
  const g = simpleGit(dir);
  await g.add(['-A']);
  await g.commit(message);
}

/** A bare "remote" plus a clone that has committed and pushed main once, so the
 *  clone's branch tracks origin/main and both share a base commit. */
async function remoteAndClone(): Promise<{ remote: string; clone: string }> {
  const remote = tmp('osc-remote-');
  await simpleGit(remote).raw(['init', '--bare', '-b', 'main']);
  const clone = tmp('osc-clone-');
  await simpleGit().clone(remote, clone);
  await configure(clone);
  await commitFile(clone, 'README.md', 'base\n', 'base');
  await simpleGit(clone).push(['-u', 'origin', 'main']);
  return { remote, clone };
}

beforeEach(() => {
  dirs = [];
});
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('reconcilePush', () => {
  it('reports not-repo for a plain directory', async () => {
    const r = await reconcilePush(tmp('osc-plain-'));
    expect(r.status).toBe('not-repo');
  });

  it('reports no-upstream when the branch does not track a remote', async () => {
    const dir = tmp('osc-solo-');
    await simpleGit(dir).raw(['init', '-b', 'main']);
    await configure(dir);
    await commitFile(dir, 'a.txt', 'x', 'first');
    const r = await reconcilePush(dir);
    expect(r.status).toBe('no-upstream');
    expect(r.branch).toBe('main');
  });

  it('is clean when there is nothing to push', async () => {
    const { clone } = await remoteAndClone();
    const r = await reconcilePush(clone);
    expect(r.status).toBe('clean');
    expect(r.ahead).toBe(0);
  });

  it('pushes unpushed commits (fast-forward)', async () => {
    const { remote, clone } = await remoteAndClone();
    await commitFile(clone, 'note.md', 'hello\n', 'add note');
    const r = await reconcilePush(clone);
    expect(r.status).toBe('pushed');
    expect(r.ahead).toBe(1);
    // The remote now has the file (checked via a fresh clone).
    const verify = tmp('osc-verify-');
    await simpleGit().clone(remote, verify);
    expect(existsSync(join(verify, 'note.md'))).toBe(true);
  });

  it('merges a diverged remote (non-conflicting) and pushes', async () => {
    const { remote, clone } = await remoteAndClone();
    // A second clone advances the remote on a different file.
    const other = tmp('osc-other-');
    await simpleGit().clone(remote, other);
    await configure(other);
    await commitFile(other, 'remote-only.md', 'from remote\n', 'remote change');
    await simpleGit(other).push();
    // Our clone commits a different file, then reconciles.
    await commitFile(clone, 'local-only.md', 'from local\n', 'local change');
    const r = await reconcilePush(clone);
    expect(r.status).toBe('merged');
    // The remote now carries both changes.
    const verify = tmp('osc-verify2-');
    await simpleGit().clone(remote, verify);
    expect(existsSync(join(verify, 'remote-only.md'))).toBe(true);
    expect(existsSync(join(verify, 'local-only.md'))).toBe(true);
  });

  it('reports a real conflict without force-pushing or dirtying the tree', async () => {
    const { remote, clone } = await remoteAndClone();
    const other = tmp('osc-other2-');
    await simpleGit().clone(remote, other);
    await configure(other);
    await commitFile(other, 'shared.md', 'remote wins\n', 'remote edit');
    await simpleGit(other).push();
    // Our clone edits the SAME file differently.
    await commitFile(clone, 'shared.md', 'local wins\n', 'local edit');
    const r = await reconcilePush(clone);
    expect(r.status).toBe('conflict');
    // The merge was aborted: the working tree is clean and our commit stands.
    const status = await simpleGit(clone).status();
    expect(status.files.length).toBe(0);
    // The remote was NOT force-pushed: it still has the remote's version.
    const verify = tmp('osc-verify3-');
    await simpleGit().clone(remote, verify);
    // remote's tip is "remote edit", not our "local edit".
    const head = await simpleGit(verify).log({ maxCount: 1 });
    expect(head.latest?.message).toBe('remote edit');
  });

  it('skips a repo with an unfinished merge and says so', async () => {
    const { remote, clone } = await remoteAndClone();
    const other = tmp('osc-other3-');
    await simpleGit().clone(remote, other);
    await configure(other);
    await commitFile(other, 'shared.md', 'remote side\n', 'remote edit');
    await simpleGit(other).push();
    await commitFile(clone, 'shared.md', 'local side\n', 'local edit');
    // Leave the clone mid-merge (conflicts present, not aborted).
    await simpleGit(clone).fetch('origin', 'main');
    await simpleGit(clone)
      .merge(['origin/main'])
      .catch(() => {});
    const r = await reconcilePush(clone);
    expect(r.status).toBe('conflict');
    expect(r.message).toMatch(/unfinished merge/i);
  });

  it('reconcileRepos returns one result per unique path and survives a bad one', async () => {
    const { clone } = await remoteAndClone();
    const results = await reconcileRepos([clone, clone, tmp('osc-plain2-')]);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.status).sort()).toEqual(['clean', 'not-repo']);
  });
});

describe('error classifiers', () => {
  it('recognizes a non-fast-forward rejection', () => {
    expect(isNonFastForward('! [rejected] main -> main (non-fast-forward)')).toBe(true);
    expect(isNonFastForward('failed to push some refs to origin')).toBe(true);
    expect(isNonFastForward('everything up-to-date')).toBe(false);
  });
  it('recognizes offline/remote-unreachable failures', () => {
    expect(isOffline('fatal: unable to access ... Could not resolve host: github.com')).toBe(true);
    expect(isOffline('ssh: connect to host github.com port 22: Connection timed out')).toBe(true);
    expect(isOffline('! [rejected] (non-fast-forward)')).toBe(false);
  });
});
