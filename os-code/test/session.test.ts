// LocalDriver correctness that is independent of the daemon HTTP surface.
// C1 (session half): aborting while an approval is pending must settle the
// approver promise as declined, or the run parked on it wedges forever and a
// later approve would execute a tool the user already aborted.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDriver, deleteSession, listSessions } from '../src/daemon/session.js';
import type { ApprovalRequest } from '../src/core/agent/types.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'oschome-'));
  process.env.OSC_HOME = home;
});
afterEach(() => {
  delete process.env.OSC_HOME;
  rmSync(home, { recursive: true, force: true });
});

const REQUEST: ApprovalRequest = {
  id: 'ap1',
  kind: 'tool',
  toolName: 'runShell',
  risk: 'shell',
  summary: 'rm -rf everything',
};

describe('LocalDriver.abort settles pending approvals (C1)', () => {
  it('resolves an outstanding approval as declined so an aborted run unwedges', async () => {
    const driver = new LocalDriver(home, { id: 'c1', persist: false });
    const answer = driver.approver(REQUEST);
    expect(driver.pendingApprovalIds()).toContain('ap1');

    driver.abort();

    const resolved = await answer;
    expect(resolved.approve).toBe(false);
    expect(driver.pendingApprovalIds()).toEqual([]);
  });

  it('emits approval-resolved(approved:false) so attached UIs clear the prompt', async () => {
    const driver = new LocalDriver(home, { id: 'c2', persist: false });
    const resolutions: boolean[] = [];
    driver.subscribe((event) => {
      if (event.type === 'approval-resolved') resolutions.push(event.approved);
    });
    const answer = driver.approver(REQUEST);
    driver.abort();
    await answer;
    expect(resolutions).toEqual([false]);
  });
});

describe('a late answer after abort is a no-op (ENG-15)', () => {
  it('emits no phantom approval-resolved and keeps the pending set empty', async () => {
    const driver = new LocalDriver(home, { id: 'c3', persist: false });
    const resolutions: boolean[] = [];
    driver.subscribe((event) => {
      if (event.type === 'approval-resolved') resolutions.push(event.approved);
    });
    const answer = driver.approver(REQUEST);
    driver.abort();
    await answer;
    expect(driver.pendingApprovalIds()).toEqual([]);
    driver.answerApproval('ap1', { approve: true });
    expect(resolutions).toEqual([false]);
    expect(driver.pendingApprovalIds()).toEqual([]);
  });
});

describe('info.json durability and the session index (DAE-6, DAE-12)', () => {
  it('a torn info.json next to a valid journal still lists, repaired from the journal', () => {
    const driver = new LocalDriver(home, { id: 'torn1' });
    driver.emit({ type: 'repo-info', cwd: home });
    driver.emit({ type: 'task-start', input: 'fix the widget' });
    const infoPath = join(home, 'sessions', 'torn1', 'info.json');
    expect(existsSync(infoPath)).toBe(true);
    writeFileSync(infoPath, '');
    const listed = listSessions().find((s) => s.id === 'torn1');
    expect(listed?.cwd).toBe(home);
    expect(listed?.title).toBe('fix the widget');
    // The repair is written back atomically so the next list is a plain read.
    expect(JSON.parse(readFileSync(infoPath, 'utf8')).cwd).toBe(home);
  });

  it('writes info.json only on milestones, never per text delta, and always via rename', () => {
    const driver = new LocalDriver(home, { id: 'delta1' });
    const infoPath = join(home, 'sessions', 'delta1', 'info.json');
    const before = statSync(infoPath).mtimeMs;
    const stamp = readFileSync(infoPath, 'utf8');
    driver.emit({ type: 'text', delta: 'hello' });
    driver.emit({ type: 'text', delta: ' world' });
    expect(readFileSync(infoPath, 'utf8')).toBe(stamp);
    expect(statSync(infoPath).mtimeMs).toBe(before);
    driver.emit({ type: 'task-start', input: 'do it' });
    expect(readFileSync(infoPath, 'utf8')).not.toBe(stamp);
    expect(existsSync(`${infoPath}.tmp`)).toBe(false);
  });

  it('the index is cached between calls and invalidated by a write', () => {
    const a = new LocalDriver(home, { id: 'idx1' });
    expect(listSessions().map((s) => s.id)).toEqual(['idx1']);
    a.emit({ type: 'title', title: 'first title' });
    expect(listSessions()[0]?.title).toBe('first title');
    new LocalDriver(home, { id: 'idx2' });
    expect(
      listSessions()
        .map((s) => s.id)
        .sort(),
    ).toEqual(['idx1', 'idx2']);
    expect(deleteSession('idx2')).toBe(true);
    expect(listSessions().map((s) => s.id)).toEqual(['idx1']);
    expect(deleteSession('..')).toBe(false);
    expect(existsSync(join(home, 'sessions'))).toBe(true);
  });

  it('reports what eviction needs: viewers, activity, and an evictable idle state', () => {
    const driver = new LocalDriver(home, { id: 'ev1' });
    expect(driver.evictable).toBe(true);
    const off = driver.subscribe(() => {});
    expect(driver.viewerCount).toBe(1);
    expect(driver.evictable).toBe(false);
    off();
    expect(driver.evictable).toBe(true);
    void driver.approver(REQUEST);
    expect(driver.evictable).toBe(false);
    driver.abort();
    expect(driver.evictable).toBe(true);
    expect(typeof driver.lastActivityAt).toBe('number');
    // A non-persisted driver cannot be rehydrated, so it is never evicted.
    expect(new LocalDriver(home, { id: 'ev2', persist: false }).evictable).toBe(false);
  });
});
