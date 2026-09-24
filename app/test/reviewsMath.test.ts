// Community review math. The load-bearing contract (DECISIONS.md 2026-09-24,
// "Community ratings show the raw average"): the number is the raw mean of user
// stars, hidden below five reviews, always with its count, never blended with
// the benchmark fit; and the hardware signal only speaks for comparable
// machines.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_FIT_LABEL,
  MIN_REPORTS_FOR_AVERAGE,
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
    model_id: 'm',
    rating: 5,
    created_at: '2026-09-03T00:00:00Z',
    ...over,
  };
}

describe('communityScore', () => {
  it('shows no average below five reviews, but keeps the count', () => {
    expect(MIN_REPORTS_FOR_AVERAGE).toBe(5);
    const s = communityScore(summary(4, 5));
    expect(s.hasAverage).toBe(false);
    expect(s.count).toBe(4);
  });

  it('shows the raw mean from the fifth review on, with nothing blended in', () => {
    const s = communityScore(summary(5, 5));
    expect(s.hasAverage).toBe(true);
    expect(s.average).toBe(5);
    expect(s.count).toBe(5);
  });

  it('rounds the raw mean to one decimal and never pulls it toward a prior', () => {
    expect(communityScore(summary(7, 2.14)).average).toBe(2.1);
    expect(communityScore(summary(500, 4.96)).average).toBe(5);
    // The function takes no benchmark at all: the axes cannot mix here.
    expect(communityScore.length).toBe(1);
  });

  it('is empty and numberless with no summary', () => {
    const s = communityScore(undefined);
    expect(s).toMatchObject({ hasAverage: false, count: 0 });
  });

  it('keeps the benchmark on its own labeled axis', () => {
    expect(BENCHMARK_FIT_LABEL).toBe('OpenShore fit (benchmark, not user reviews)');
    const market = readFileSync(
      join(process.cwd(), 'src', 'screens', 'MarketplaceScreen.tsx'),
      'utf8',
    );
    expect(market).toMatch(/<span className="osfit-label">\{BENCHMARK_FIT_LABEL\}<\/span>/);
    expect(market).not.toMatch(/communityScore\([^)]*osCodeFit/);
  });

  it('says "Rated by people who ran it." only over a real user average', () => {
    const section = readFileSync(
      join(process.cwd(), 'src', 'components', 'ReviewsSection.tsx'),
      'utf8',
    );
    expect(section).toMatch(
      /score\.hasAverage \? 'Rated by people who ran it\.' : 'Run reports from people who ran it\.'/,
    );
    expect(section).not.toMatch(/benchmarkStars/);
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
