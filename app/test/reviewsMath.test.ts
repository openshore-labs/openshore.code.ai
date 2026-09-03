// Community review math. The load-bearing contract: an average is hidden below
// the count floor, shrinks toward the benchmark prior when sparse, always
// travels with its count, and the hardware signal only speaks for comparable
// machines. None of it touches the benchmark ratings.
import { describe, expect, it } from 'vitest';
import {
  MIN_REPORTS_FOR_AVERAGE,
  PRIOR_WEIGHT,
  communityScore,
  containsObjectionable,
  hardwareSignal,
  memoryTier,
  ranItLabel,
  type ReviewRow,
  type ReviewSummary,
} from '../src/lib/reviewsMath.js';

function summary(count: number, average: number): ReviewSummary {
  return { count, average, dist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: count } };
}

function review(over: Partial<ReviewRow> & { id: string }): ReviewRow {
  return {
    id: over.id,
    user_id: `u-${over.id}`,
    model_id: 'm',
    rating: 5,
    created_at: '2026-09-03T00:00:00Z',
    ...over,
  };
}

describe('communityScore', () => {
  it('hides the average below the count floor', () => {
    const s = communityScore(summary(MIN_REPORTS_FOR_AVERAGE - 1, 5), 3);
    expect(s.hasAverage).toBe(false);
    expect(s.count).toBe(MIN_REPORTS_FOR_AVERAGE - 1);
  });

  it('shows and shrinks the average toward the benchmark prior when sparse', () => {
    // 5 reports at 5.0, prior 3.0 with weight 8: (5*5 + 3*8)/(5+8) = 49/13 ≈ 3.8
    const s = communityScore(summary(5, 5), 3);
    expect(s.hasAverage).toBe(true);
    expect(s.average).toBeCloseTo((5 * 5 + 3 * PRIOR_WEIGHT) / (5 + PRIOR_WEIGHT), 1);
    expect(s.average).toBeLessThan(5);
    expect(s.rawAverage).toBe(5);
  });

  it('lets the crowd dominate as reports pile up', () => {
    const sparse = communityScore(summary(5, 5), 3).average;
    const many = communityScore(summary(500, 5), 3).average;
    expect(many).toBeGreaterThan(sparse);
    expect(many).toBeGreaterThan(4.9);
  });

  it('does not shrink when the model has no benchmark prior (discovered model)', () => {
    const s = communityScore(summary(10, 4.2), undefined);
    expect(s.average).toBe(4.2);
  });

  it('is empty and numberless with no summary', () => {
    const s = communityScore(undefined, 4);
    expect(s).toMatchObject({ hasAverage: false, count: 0 });
  });
});

describe('ranItLabel', () => {
  it('always carries a count, the tell that it is a crowd score', () => {
    expect(ranItLabel(0)).toBe('No run reports yet');
    expect(ranItLabel(1)).toBe('1 ran it');
    expect(ranItLabel(1280)).toBe('1,280 ran it');
  });
});

describe('containsObjectionable', () => {
  it('rejects slurs and threats', () => {
    expect(containsObjectionable('kill yourself')).toBe(true);
    expect(containsObjectionable('you retard')).toBe(true);
  });

  it('does not trip on innocent technical words', () => {
    expect(containsObjectionable('the assistant class handles this well')).toBe(false);
    expect(containsObjectionable('great for coding, 34 tok/s on my M3')).toBe(false);
    expect(containsObjectionable('')).toBe(false);
    expect(containsObjectionable(undefined)).toBe(false);
  });
});

describe('memoryTier', () => {
  it('buckets by class of machine, undefined when unknown', () => {
    expect(memoryTier(8)).toBe('up to 8 GB');
    expect(memoryTier(16)).toBe('8 to 16 GB');
    expect(memoryTier(24)).toBe('16 to 32 GB');
    expect(memoryTier(128)).toBe('64 GB and up');
    expect(memoryTier(0)).toBeUndefined();
    expect(memoryTier(undefined)).toBeUndefined();
  });
});

describe('hardwareSignal', () => {
  it('reports only from the reader tier, with a median tok/s', () => {
    const reviews = [
      review({ id: 'a', ram_gb: 16, tokens_per_sec: 30 }),
      review({ id: 'b', ram_gb: 12, tokens_per_sec: 40 }),
      review({ id: 'c', ram_gb: 128, tokens_per_sec: 200 }), // different tier, excluded
    ];
    const sig = hardwareSignal(reviews, 14); // 8-16 GB tier
    expect(sig?.count).toBe(2);
    expect(sig?.tier).toBe('8 to 16 GB');
    expect(sig?.medianTokensPerSec).toBe(35);
  });

  it('is undefined when no report matches the reader hardware', () => {
    const reviews = [review({ id: 'a', ram_gb: 128, tokens_per_sec: 200 })];
    expect(hardwareSignal(reviews, 8)).toBeUndefined();
  });

  it('is undefined when the reader hardware is unknown', () => {
    const reviews = [review({ id: 'a', ram_gb: 16, tokens_per_sec: 30 })];
    expect(hardwareSignal(reviews, undefined)).toBeUndefined();
  });

  it('omits the median when no on-tier report gave a speed', () => {
    const reviews = [review({ id: 'a', ram_gb: 16, tokens_per_sec: null })];
    const sig = hardwareSignal(reviews, 16);
    expect(sig?.count).toBe(1);
    expect(sig?.medianTokensPerSec).toBeUndefined();
  });
});
