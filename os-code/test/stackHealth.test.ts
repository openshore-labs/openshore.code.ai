// Stack Health folds the session journals into the dashboard payload. These
// tests pin the parts with real logic risk: local-vs-cloud attribution of the
// usage that follows each turn, the savings reprice against the named basis,
// approvals/denials/outcomes counting, and the session-grained bucketing. The
// disk/date wrapper is thin; the fold is where correctness lives.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SAVINGS_BASIS,
  __test,
  _atRestScanCacheSizes,
  _resetAtRestScanCache,
  computeStackHealth,
} from '../src/insights/stackHealth.js';
import type { DriverEvent } from '../src/core/agent/types.js';

const { foldSession, zeroTotals, priceLocal, planBuckets, bucketIndex, buildModelUsage } = __test;

const DAY_MS = 86_400_000;

// A journal: two local turns, then an escalation to cloud, then a cloud turn.
// The usage after each turn-start is attributed to that turn's provider kind.
const journal: DriverEvent[] = [
  { type: 'task-start', input: 'do a thing' },
  { type: 'turn-start', turn: 1, model: 'qwen2.5-coder', providerKind: 'local' },
  { type: 'usage', promptTokens: 1000, completionTokens: 500, dollars: 0, contextPercent: 10 },
  { type: 'tool-start', call: { name: 'edit', input: {} } as never },
  {
    type: 'tool-end',
    call: { name: 'edit', input: {} } as never,
    result: {} as never,
    durationMs: 5,
  },
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

describe('model usage', () => {
  it('ranks each model by its local turn count, most-used first, dropping unused', () => {
    const t = zeroTotals();
    foldSession(journal, t);
    // qwen ran two turns, claude one; a model with zero turns never appears.
    expect(buildModelUsage(t.turnsByModel)).toEqual([
      { model: 'qwen2.5-coder', turns: 2 },
      { model: 'claude-sonnet', turns: 1 },
    ]);
  });

  it('is an empty list when nothing has run', () => {
    expect(buildModelUsage(zeroTotals().turnsByModel)).toEqual([]);
  });

  it('breaks turn-count ties by model id, for a deterministic order', () => {
    const map = new Map([
      ['zephyr', 3],
      ['aardvark', 3],
    ]);
    expect(buildModelUsage(map)).toEqual([
      { model: 'aardvark', turns: 3 },
      { model: 'zephyr', turns: 3 },
    ]);
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

describe('stack health day-bucket anchoring (F1)', () => {
  // Built with LOCAL Date constructors so the assertions are timezone-agnostic.
  // A mid-day mid-week "now": buckets must anchor to local midnight, not to
  // now's time-of-day.
  const now = new Date(2026, 7, 19, 12, 0, 0); // Aug 19 2026, 12:00 local

  it('buckets a session ~6.5 days ago into bucket 0, not -1, for a week', () => {
    const plan = planBuckets(now, 'week', now.getTime());
    expect(plan.starts.length).toBe(7);
    // With midnight anchoring, bucket 0 starts ~6.5 days back, so an in-range
    // session that old lands in it. With the old time-of-day anchoring bucket 0
    // started only 6 days back and this session fell off the chart (-1).
    const sixAndAHalfDaysAgo = now.getTime() - 6.5 * DAY_MS;
    expect(bucketIndex(plan.starts, sixAndAHalfDaysAgo)).toBe(0);
  });

  it('labels a Monday-morning session "Mon" from a mid-week now', () => {
    const plan = planBuckets(now, 'week', now.getTime());
    // The Monday of now's own week, at 09:00 local (before now's 12:00). Old
    // anchoring put this in the prior day's bucket ("Sun"); midnight anchoring
    // labels it correctly.
    const daysSinceMonday = (now.getDay() + 6) % 7;
    const mondayMorning = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - daysSinceMonday,
      9,
      0,
      0,
    );
    const idx = bucketIndex(plan.starts, mondayMorning.getTime());
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(plan.labels[idx]).toBe('Mon');
  });

  it('keeps day boundaries a fixed 24 hours apart despite the fixed-ms removal', () => {
    // Sanity: seven consecutive local midnights, each a real calendar day apart.
    const plan = planBuckets(now, 'week', now.getTime());
    for (let i = 1; i < plan.starts.length; i++) {
      const d = new Date(plan.starts[i]);
      expect(d.getHours()).toBe(0);
      expect(d.getMinutes()).toBe(0);
    }
  });
});

describe('stack health timeline sums equal the headline (F1)', () => {
  let prevHome: string | undefined;
  let home: string;

  function makeSession(id: string, updatedAt: string, events: DriverEvent[]): void {
    const sdir = join(home, 'sessions', id);
    mkdirSync(sdir, { recursive: true });
    writeFileSync(
      join(sdir, 'info.json'),
      JSON.stringify({ id, cwd: '/x', title: 'T', createdAt: updatedAt, updatedAt }),
    );
    const lines = events.map((event, seq) => JSON.stringify({ seq, event })).join('\n');
    writeFileSync(join(sdir, 'events.jsonl'), `${lines}\n`);
  }

  beforeEach(() => {
    prevHome = process.env.OSC_HOME;
    home = mkdtempSync(join(tmpdir(), 'osc-sh-'));
    process.env.OSC_HOME = home;
    _resetAtRestScanCache();
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.OSC_HOME;
    else process.env.OSC_HOME = prevHome;
    _resetAtRestScanCache();
    rmSync(home, { recursive: true, force: true });
  });

  it('does not drop an in-range session that predates bucket 0 from the timeline', () => {
    const now = new Date(2026, 7, 19, 12, 0, 0);
    // ~6.5 days old: inside the rolling week cutoff (counted in the headline)
    // but before bucket 0's local midnight (would be dropped without clamping).
    const oldTs = new Date(now.getTime() - 6.5 * DAY_MS).toISOString();
    const turn: DriverEvent[] = [
      { type: 'task-start', input: 'x' },
      { type: 'turn-start', turn: 1, model: 'qwen2.5-coder', providerKind: 'local' },
    ];
    makeSession('s1', oldTs, turn);

    const health = computeStackHealth('week', now);
    const timelineLocal = health.timeline.reduce((a, b) => a + b.localTurns, 0);
    // The chart total must equal the headline privacy-ring count, not miss one.
    expect(health.privacyRing.localTurns).toBe(1);
    expect(timelineLocal).toBe(1);
  });
});

describe('stack health at-rest scan cache eviction (P2-2)', () => {
  let prevHome: string | undefined;
  let home: string;

  function makeSession(id: string): void {
    const sdir = join(home, 'sessions', id);
    mkdirSync(sdir, { recursive: true });
    const updatedAt = new Date().toISOString();
    writeFileSync(
      join(sdir, 'info.json'),
      JSON.stringify({ id, cwd: '/x', title: 'T', createdAt: updatedAt, updatedAt }),
    );
    writeFileSync(
      join(sdir, 'events.jsonl'),
      `${JSON.stringify({ seq: 0, event: { type: 'task-start', input: 'hi' } })}\n`,
    );
  }

  beforeEach(() => {
    prevHome = process.env.OSC_HOME;
    home = mkdtempSync(join(tmpdir(), 'osc-evict-'));
    process.env.OSC_HOME = home;
    _resetAtRestScanCache();
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.OSC_HOME;
    else process.env.OSC_HOME = prevHome;
    _resetAtRestScanCache();
    rmSync(home, { recursive: true, force: true });
  });

  it('drops cache entries for sessions gone from disk on the next pass', () => {
    makeSession('a');
    makeSession('b');
    computeStackHealth('all', new Date());
    expect(_atRestScanCacheSizes().journals).toBe(2);
    expect(_atRestScanCacheSizes().titles).toBe(2);

    // Session b is deleted; the next scan must evict its cached entries rather
    // than grow unbounded.
    rmSync(join(home, 'sessions', 'b'), { recursive: true, force: true });
    computeStackHealth('all', new Date());
    expect(_atRestScanCacheSizes().journals).toBe(1);
    expect(_atRestScanCacheSizes().titles).toBe(1);
  });
});
