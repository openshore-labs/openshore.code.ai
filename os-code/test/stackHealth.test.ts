// Stack Health folds the session journals into the dashboard payload. These
// tests pin the parts with real logic risk: local-vs-cloud attribution of the
// usage that follows each turn, the savings reprice against the named basis,
// approvals/denials/outcomes counting, and the session-grained bucketing. The
// disk/date wrapper is thin; the fold is where correctness lives.
import { describe, expect, it } from 'vitest';
import { SAVINGS_BASIS, __test } from '../src/insights/stackHealth.js';
import type { DriverEvent } from '../src/core/agent/types.js';

const { foldSession, zeroTotals, priceLocal, planBuckets, bucketIndex } = __test;

// A journal: two local turns, then an escalation to cloud, then a cloud turn.
// The usage after each turn-start is attributed to that turn's provider kind.
const journal: DriverEvent[] = [
  { type: 'task-start', input: 'do a thing' },
  { type: 'turn-start', turn: 1, model: 'qwen2.5-coder', providerKind: 'local' },
  { type: 'usage', promptTokens: 1000, completionTokens: 500, dollars: 0, contextPercent: 10 },
  { type: 'tool-start', call: { name: 'edit', input: {} } as never },
  { type: 'tool-end', call: { name: 'edit', input: {} } as never, result: {} as never, durationMs: 5 },
  { type: 'turn-start', turn: 2, model: 'qwen2.5-coder', providerKind: 'local' },
  { type: 'usage', promptTokens: 2000, completionTokens: 1000, dollars: 0, contextPercent: 20 },
  { type: 'tool-denied', call: { name: 'bash', input: {} } as never, reason: 'blocked' },
  { type: 'model-switch', model: 'claude-sonnet', providerKind: 'cloud', reason: 'hard task' },
  { type: 'turn-start', turn: 3, model: 'claude-sonnet', providerKind: 'cloud' },
  { type: 'usage', promptTokens: 4000, completionTokens: 2000, dollars: 0.042, contextPercent: 40 },
  { type: 'approval-request', request: { id: 'a1', kind: 'cloud-spend' } as never },
  { type: 'approval-resolved', id: 'a1', approved: false },
  { type: 'task-done', reason: 'complete' },
];

describe('stack health fold', () => {
  it('attributes turns and usage to the right provider side', () => {
    const t = zeroTotals();
    foldSession(journal, t);
    expect(t.localTurns).toBe(2);
    expect(t.cloudTurns).toBe(1);
    // Local usage accumulates across the two local turns.
    expect(t.localPrompt).toBe(3000);
    expect(t.localCompletion).toBe(1500);
    // Cloud usage is the one cloud turn, and cloud dollars come straight from
    // the journal (never repriced).
    expect(t.cloudPrompt).toBe(4000);
    expect(t.cloudCompletion).toBe(2000);
    expect(t.cloudDollars).toBeCloseTo(0.042, 6);
  });

  it('counts flips, tools, approvals, and outcomes', () => {
    const t = zeroTotals();
    foldSession(journal, t);
    expect(t.cloudFlips).toBe(1);
    expect(t.toolRuns).toBe(1);
    expect(t.toolDenied).toBe(1);
    expect(t.approvalsRequested).toBe(1);
    expect(t.approvalsDenied).toBe(1);
    expect(t.tasksAttempted).toBe(1);
    expect(t.complete).toBe(1);
  });

  it('attributes turns to their model for crew stats', () => {
    const t = zeroTotals();
    foldSession(journal, t);
    expect(t.turnsByModel.get('qwen2.5-coder')).toBe(2);
    expect(t.turnsByModel.get('claude-sonnet')).toBe(1);
  });

  it('prices local work at the named cloud basis, not as a guess', () => {
    const t = zeroTotals();
    foldSession(journal, t);
    const saved = priceLocal(t.localPrompt, t.localCompletion);
    // 3000 prompt * 3/M + 1500 completion * 15/M.
    const expected = (3000 * SAVINGS_BASIS.inPerM + 1500 * SAVINGS_BASIS.outPerM) / 1_000_000;
    expect(saved).toBeCloseTo(expected, 9);
    expect(SAVINGS_BASIS.model).toBe('Claude Sonnet');
  });

  it('a usage event with no preceding turn defaults to the local side', () => {
    const t = zeroTotals();
    foldSession(
      [{ type: 'usage', promptTokens: 100, completionTokens: 50, dollars: 0, contextPercent: 1 }],
      t,
    );
    expect(t.localPrompt).toBe(100);
    expect(t.cloudPrompt).toBe(0);
  });
});

describe('stack health bucketing', () => {
  const now = new Date('2026-08-20T12:00:00Z');

  it('lays out one column per day across a week', () => {
    const plan = planBuckets(now, 'week', now.getTime());
    expect(plan.starts.length).toBe(7);
    expect(plan.labels.length).toBe(7);
  });

  it('places a timestamp in the last bucket that starts at or before it', () => {
    const plan = planBuckets(now, 'week', now.getTime());
    // Today falls in the final bucket.
    expect(bucketIndex(plan.starts, now.getTime())).toBe(6);
    // A moment before the first boundary falls outside (-1).
    expect(bucketIndex(plan.starts, plan.starts[0] - 1)).toBe(-1);
  });

  it('gives the year range twelve monthly columns', () => {
    const plan = planBuckets(now, 'year', now.getTime());
    expect(plan.starts.length).toBe(12);
  });
});
