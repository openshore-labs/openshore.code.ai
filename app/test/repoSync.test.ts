// The offload-then-reset protocol is the one place work can be lost, so pin
// every rule: order, idempotency, independent confirmation, reset-only-when-
// confirmed, and batch-stop on conflict.
import { describe, expect, it } from 'vitest';
import type { OutboxItem } from '../src/lib/repos.js';
import {
  applyResult,
  bufferHealth,
  confirm,
  itemBytes,
  MAX_OUTBOX_FILE_BYTES,
  MAX_OUTBOX_TOTAL_BYTES,
  pendingForRepo,
  resettableIds,
  stopsBatch,
  unsyncedCount,
  withinCaps,
} from '../src/lib/repoSync.js';

function item(id: string, over: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id,
    clientOpId: `op-${id}`,
    repoId: 'r1',
    branch: 'main',
    message: 'change',
    baseCommit: 'base',
    files: [{ path: 'a.ts', mode: 'upsert', sha256: 'h1' }],
    state: 'pending',
    attempts: 0,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('repo sync protocol', () => {
  it('orders pending items by their monotonic id', () => {
    const items = [item('b0003'), item('b0001'), item('b0002')];
    expect(pendingForRepo(items, 'r1').map((i) => i.id)).toEqual(['b0001', 'b0002', 'b0003']);
  });

  it('only lists pending items for the asked repo', () => {
    const items = [item('b1'), item('b2', { repoId: 'other' }), item('b3', { state: 'confirmed' })];
    expect(pendingForRepo(items, 'r1').map((i) => i.id)).toEqual(['b1']);
  });

  it('a successful apply moves to offloading but does NOT confirm', () => {
    const out = applyResult(item('b1'), { ok: true, resultCommit: 'c1' });
    expect(out.state).toBe('offloading');
    expect(out.resultCommit).toBe('c1');
  });

  it('is idempotent: a confirmed item is untouched by a replay', () => {
    const confirmed = item('b1', { state: 'confirmed', resultCommit: 'c1' });
    expect(applyResult(confirmed, { ok: true, resultCommit: 'c1' })).toBe(confirmed);
  });

  it('marks a conflict without losing the item', () => {
    const out = applyResult(item('b1'), { ok: false, conflict: true });
    expect(out.state).toBe('conflict');
    expect(stopsBatch(out)).toBe(true);
  });

  it('confirms only when the ref exists AND the tree matches', () => {
    const offloaded = item('b1', { state: 'offloading', resultCommit: 'c1' });
    expect(confirm(offloaded, { refExists: true, treeMatches: true }).state).toBe('confirmed');
    expect(confirm(offloaded, { refExists: true, treeMatches: false }).state).toBe('failed');
    expect(confirm(offloaded, { refExists: false, treeMatches: true }).state).toBe('failed');
  });

  it('resets only confirmed items, never pending or failed', () => {
    const items = [
      item('b1', { state: 'confirmed' }),
      item('b2', { state: 'pending' }),
      item('b3', { state: 'failed' }),
      item('b4', { state: 'offloading' }),
    ];
    expect(resettableIds(items)).toEqual(['b1']);
  });

  it('counts what still needs to sync', () => {
    const items = [
      item('b1', { state: 'confirmed' }),
      item('b2', { state: 'pending' }),
      item('b3', { state: 'conflict' }),
    ];
    expect(unsyncedCount(items)).toBe(2);
  });

  it('does not confirm an item that was never offloaded', () => {
    const pending = item('b1', { state: 'pending' });
    expect(confirm(pending, { refExists: true, treeMatches: true })).toBe(pending);
  });
});

describe('buffer safety (S2 pending-window protection)', () => {
  const withContent = (id: string, bytes: number, over: Partial<OutboxItem> = {}) =>
    item(id, {
      files: [
        {
          path: 'a.ts',
          mode: 'upsert',
          sha256: 'h',
          contentBase64: 'A'.repeat(Math.ceil((bytes * 4) / 3)),
        },
      ],
      ...over,
    });

  it('sizes an item from its inline content', () => {
    expect(itemBytes(withContent('b1', 300))).toBeGreaterThan(200);
  });

  it('reports pending count and total, ignoring confirmed', () => {
    const health = bufferHealth(
      [withContent('b1', 1000), withContent('b2', 1000, { state: 'confirmed' })],
      Date.parse('2026-01-01T00:00:00Z'),
    );
    expect(health.pendingCount).toBe(1);
    expect(health.totalBytes).toBeGreaterThan(500);
  });

  it('flags a stale buffered item', () => {
    const old = withContent('b1', 100, { createdAt: '2026-01-01T00:00:00Z' });
    const health = bufferHealth([old], Date.parse('2026-01-10T00:00:00Z')); // 9 days later
    expect(health.stale).toBe(true);
  });

  it('refuses to buffer past the caps rather than truncate', () => {
    expect(withinCaps(0, 1000, 1000)).toBe(true);
    expect(withinCaps(MAX_OUTBOX_TOTAL_BYTES, 1, 1)).toBe(false);
    expect(withinCaps(0, MAX_OUTBOX_FILE_BYTES + 1, MAX_OUTBOX_FILE_BYTES + 1)).toBe(false);
  });
});
