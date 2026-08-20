// LocalDriver correctness that is independent of the daemon HTTP surface.
// C1 (session half): aborting while an approval is pending must settle the
// approver promise as declined, or the run parked on it wedges forever and a
// later approve would execute a tool the user already aborted.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDriver } from '../src/daemon/session.js';
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
