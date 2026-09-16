// The app-side reconcile helpers: which local clones to push, and how the
// outcome is summarized and phrased.
import { describe, expect, it } from 'vitest';
import type { ReconcileResult } from 'os-code/protocol';
import type { Project } from '../src/state/types.js';
import { projectWorkspaces, reconcileToast, summarizeReconcile } from '../src/lib/repoReconcile.js';

function project(partial: Partial<Project>): Project {
  return { id: 'p1', name: 'Demo', repoIds: [], createdAt: '2026-01-01T00:00:00Z', ...partial };
}
function result(status: ReconcileResult['status'], cwd = '/r'): ReconcileResult {
  return { cwd, status };
}

describe('projectWorkspaces', () => {
  it("takes each project's primary local clone and skips GitHub-only repos", () => {
    const a = project({ id: 'a', repoIds: ['github:acme/x', '/home/me/a'] });
    const b = project({ id: 'b', repoIds: ['/home/me/b'] });
    const c = project({ id: 'c', repoIds: ['github:acme/y'] });
    expect(projectWorkspaces([a, b, c])).toEqual(['/home/me/a', '/home/me/b']);
  });

  it('deduplicates a clone shared by two projects', () => {
    const a = project({ id: 'a', repoIds: ['/home/me/shared'] });
    const b = project({ id: 'b', repoIds: ['/home/me/shared'] });
    expect(projectWorkspaces([a, b])).toEqual(['/home/me/shared']);
  });
});

describe('summarizeReconcile', () => {
  it('counts pushes and merges together, and collects conflicts and offline', () => {
    const s = summarizeReconcile([
      result('pushed'),
      result('merged'),
      result('clean'),
      result('conflict', '/c'),
      result('offline'),
      result('no-upstream'),
    ]);
    expect(s.pushed).toBe(2);
    expect(s.conflicts.map((c) => c.cwd)).toEqual(['/c']);
    expect(s.offline).toBe(1);
  });

  it('counts outright errors', () => {
    const s = summarizeReconcile([result('error'), result('clean')]);
    expect(s.errors).toBe(1);
  });
});

describe('reconcileToast', () => {
  it('is silent when nothing moved', () => {
    expect(
      reconcileToast(summarizeReconcile([result('clean'), result('no-upstream')])),
    ).toBeUndefined();
  });

  it('names what it pushed: the commits, the branch, the repository', () => {
    const one = reconcileToast(
      summarizeReconcile([
        { cwd: '/home/me/my-app', status: 'pushed', branch: 'feature/notes', ahead: 2 },
      ]),
    );
    expect(one).toBe('Pushed 2 commits on feature/notes in my-app.');
    const two = reconcileToast(
      summarizeReconcile([
        { cwd: '/home/me/my-app', status: 'pushed', branch: 'feature/notes', ahead: 1 },
        { cwd: '/home/me/other', status: 'merged', branch: 'work', ahead: 3 },
      ]),
    );
    expect(two).toMatch(/^Pushed 1 commit on feature\/notes in my-app, and 1 more repository\./);
  });

  it('never claims a push for a held default branch, and says whose it is', () => {
    const held = reconcileToast(
      summarizeReconcile([{ cwd: '/home/me/my-app', status: 'held', branch: 'main', ahead: 4 }]),
    );
    expect(held).toMatch(/^Not pushed: main in my-app\./);
    expect(held).toMatch(/yours to push/);
    expect(held).toMatch(/autoPushDefaultBranch/);
    // A push beside a held branch names both.
    const both = reconcileToast(
      summarizeReconcile([
        { cwd: '/home/me/my-app', status: 'pushed', branch: 'feature/x', ahead: 1 },
        { cwd: '/home/me/site', status: 'held', branch: 'master', ahead: 2 },
      ]),
    );
    expect(both).toMatch(/^Pushed 1 commit on feature\/x in my-app\. master stayed here/);
    expect(summarizeReconcile([result('held')]).pushed).toBe(0);
  });

  it('states a conflict plainly and reassures', () => {
    const msg = reconcileToast(summarizeReconcile([result('conflict')]));
    expect(msg).toMatch(/manual merge/);
    expect(msg).toMatch(/safe/);
    // Conflict wins over a concurrent push in the message.
    const both = reconcileToast(summarizeReconcile([result('pushed'), result('conflict')]));
    expect(both).toMatch(/manual merge/);
  });

  it('surfaces an outright failure so the person knows notes are not syncing', () => {
    const msg = reconcileToast(summarizeReconcile([result('error'), result('clean')]));
    expect(msg).toMatch(/Could not sync/);
    expect(msg).toMatch(/retry/);
  });
});
