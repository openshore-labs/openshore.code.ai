// Star normalization: published benchmark scores become 0..5 stars, in 0.5
// steps, per capability dimension. This is a DATA TABLE, the same shape as
// PRICES in src/auth/usage.ts: one row per benchmark, a descending scale of
// (minScore -> stars). Tuning a threshold is one edit. Every star carries
// provenance (the benchmark names that produced it), and a capability is rated
// ONLY when the model targets it AND at least one of its benchmarks has a
// score. A star is never invented from thin air.
import type { CapabilityCategory } from '../../src/router/roles.js';
import type { BenchmarkScores, CapabilityStar } from './types.js';

/** A descending scale: the first row whose minScore the value meets wins.
 *  Native units per benchmark (percent, elo, a 0..10 judge score). */
type Scale = ReadonlyArray<readonly [minScore: number, stars: number]>;

/** The standard percent scale (0..100), used by most accuracy benchmarks. */
const PCT: Scale = [
  [90, 5],
  [80, 4.5],
  [70, 4],
  [60, 3.5],
  [50, 3],
  [40, 2.5],
  [30, 2],
  [20, 1.5],
  [10, 1],
  [0, 0.5],
];

/** MT-Bench and similar 0..10 judge scores. */
const TEN: Scale = [
  [9, 5],
  [8, 4.5],
  [7, 4],
  [6, 3.5],
  [5, 3],
  [4, 2],
  [3, 1.5],
  [0, 1],
];

/** Chatbot Arena elo. Anchored around the open-model band. */
const ELO: Scale = [
  [1300, 5],
  [1250, 4.5],
  [1200, 4],
  [1150, 3.5],
  [1100, 3],
  [1050, 2.5],
  [1000, 2],
  [0, 1],
];

/** MTEB averages sit in a tighter band than raw accuracy. */
const MTEB: Scale = [
  [70, 5],
  [66, 4.5],
  [62, 4],
  [58, 3.5],
  [54, 3],
  [50, 2.5],
  [45, 2],
  [0, 1],
];

/** GenEval and other 0..1 image-fidelity scores. */
const UNIT: Scale = [
  [0.85, 5],
  [0.75, 4.5],
  [0.65, 4],
  [0.55, 3.5],
  [0.45, 3],
  [0.35, 2],
  [0, 1],
];

/** Tokens per second, for the "fast" dimension (higher is better). */
const TPS: Scale = [
  [120, 5],
  [90, 4.5],
  [60, 4],
  [40, 3.5],
  [25, 3],
  [15, 2],
  [0, 1],
];

interface BenchmarkNorm {
  /** Canonical benchmark key, matched against curation/benchmarks.json. */
  benchmark: string;
  /** The capability dimension this benchmark informs (router/roles.ts). */
  capability: CapabilityCategory;
  scale: Scale;
}

// The table. One row per benchmark. The capability column ties a benchmark to a
// router/roles.ts dimension, so the ratings and the taxonomy cannot drift.
export const STAR_TABLE: BenchmarkNorm[] = [
  // reasoning
  { benchmark: 'MMLU', capability: 'reasoning', scale: PCT },
  { benchmark: 'GPQA', capability: 'reasoning', scale: PCT },
  { benchmark: 'ARC-AGI', capability: 'reasoning', scale: PCT },
  // coding
  { benchmark: 'SWE-bench', capability: 'coding', scale: PCT },
  { benchmark: 'HumanEval', capability: 'coding', scale: PCT },
  { benchmark: 'MBPP', capability: 'coding', scale: PCT },
  { benchmark: 'LiveCodeBench', capability: 'coding', scale: PCT },
  { benchmark: 'BFCL', capability: 'coding', scale: PCT },
  // writing
  { benchmark: 'MT-Bench', capability: 'writing', scale: TEN },
  { benchmark: 'EQ-Bench', capability: 'writing', scale: PCT },
  { benchmark: 'Chatbot Arena (writing)', capability: 'writing', scale: ELO },
  // analysis
  { benchmark: 'MATH-500', capability: 'analysis', scale: PCT },
  { benchmark: 'GSM8K', capability: 'analysis', scale: PCT },
  { benchmark: 'AIME', capability: 'analysis', scale: PCT },
  { benchmark: 'TableBench', capability: 'analysis', scale: PCT },
  // vision
  { benchmark: 'MMMU', capability: 'vision', scale: PCT },
  { benchmark: 'MathVista', capability: 'vision', scale: PCT },
  { benchmark: 'ChartQA', capability: 'vision', scale: PCT },
  // image-gen
  { benchmark: 'GenEval', capability: 'image-gen', scale: UNIT },
  { benchmark: 'DPG-Bench', capability: 'image-gen', scale: PCT },
  // embedding
  { benchmark: 'MTEB', capability: 'embedding', scale: MTEB },
  // fast
  { benchmark: 'tokens per second', capability: 'fast', scale: TPS },
];

/** Snap a raw star value to the nearest 0.5, clamped to 0..5. */
function snapHalf(value: number): number {
  const snapped = Math.round(value * 2) / 2;
  return Math.max(0, Math.min(5, snapped));
}

/** Score one benchmark value against its scale. */
function starsForScore(scale: Scale, value: number): number {
  for (const [minScore, stars] of scale) {
    if (value >= minScore) return stars;
  }
  return 0;
}

/**
 * Rate a single capability from the available benchmark scores. Returns
 * undefined when the model targets the capability but no defining benchmark has
 * a score, so the caller emits no star rather than inventing one. When several
 * benchmarks inform the dimension, the stars average and snap to a 0.5 step,
 * and every contributing benchmark is recorded as provenance.
 */
export function rateCapability(
  capability: CapabilityCategory,
  scores: BenchmarkScores,
): CapabilityStar | undefined {
  const contributions: { benchmark: string; stars: number }[] = [];
  for (const row of STAR_TABLE) {
    if (row.capability !== capability) continue;
    const value = scores[row.benchmark];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    contributions.push({ benchmark: row.benchmark, stars: starsForScore(row.scale, value) });
  }
  if (contributions.length === 0) return undefined;
  const mean = contributions.reduce((a, c) => a + c.stars, 0) / contributions.length;
  return {
    capability,
    stars: snapHalf(mean),
    provenance: contributions.map((c) => c.benchmark),
  };
}

/**
 * Rate every capability a model targets. Categories the model does not target
 * are never rated. Capabilities with no benchmark score are omitted. The result
 * is the sparse perCapability shape the schema expects.
 */
export function rateModel(
  categories: readonly CapabilityCategory[],
  scores: BenchmarkScores,
): CapabilityStar[] {
  const out: CapabilityStar[] = [];
  for (const capability of categories) {
    const rated = rateCapability(capability, scores);
    if (rated) out.push(rated);
  }
  return out;
}

/** osCodeFit = round(evalReport.average * 5), clamped to a valid 0..5 star. */
export function osCodeFitFromEval(average: number): number {
  return Math.max(0, Math.min(5, Math.round(average * 5)));
}
