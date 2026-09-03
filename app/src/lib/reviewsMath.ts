// Pure math for community reviews, kept out of the network layer so the store
// never reasons about raw rows. The load-bearing honesty rules live here:
//
//   1. A community average is HIDDEN below a minimum count, so one grumpy first
//      report cannot stamp a score on a good model (CX: below ~5 the mean swings
//      on a single voice).
//   2. When shown, a sparse average is SHRUNK toward the benchmark prior, so the
//      number is honest at n=1 and converges to the crowd as reports arrive
//      (CX: Bayesian shrinkage beats a hard show/hide cliff).
//   3. Community stars are ALWAYS reported with their count. The count is the
//      tell that separates a crowd score from the benchmark score (CMO).
//
// None of this ever writes into the benchmark ratings; it is a separate axis.

/** The star distribution for a model, counts per star 1..5. */
export interface ReviewDistribution {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

/** The server summary returned by the model_review_summary RPC. */
export interface ReviewSummary {
  count: number;
  average: number;
  dist: ReviewDistribution;
}

/** Below this many reports, an average is not trustworthy enough to show as a
 *  number: the individual reports are shown, but no star aggregate. */
export const MIN_REPORTS_FOR_AVERAGE = 5;

/** The weight (in "virtual reports") of the benchmark prior when shrinking a
 *  sparse community average toward it. At C reports the community and the prior
 *  carry equal weight; past that the crowd dominates. */
export const PRIOR_WEIGHT = 8;

export interface CommunityScore {
  /** Whether there are enough reports to show an averaged number at all. */
  hasAverage: boolean;
  /** The shrunk, display-ready average (only meaningful when hasAverage). */
  average: number;
  /** The raw crowd average before shrinkage, for reference. */
  rawAverage: number;
  count: number;
  dist: ReviewDistribution;
}

/** Turn a server summary into a display score. `benchmarkStars` (0..5, the
 *  model's OpenShore fit) is the prior a sparse average is pulled toward; pass
 *  undefined for a model with no benchmark rating (a discovered model), in which
 *  case no number is shown until the count floor is met and no shrink applies. */
export function communityScore(
  summary: ReviewSummary | undefined,
  benchmarkStars?: number,
): CommunityScore {
  const count = summary?.count ?? 0;
  const dist = summary?.dist ?? { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const rawAverage = summary && count > 0 ? summary.average : 0;
  if (count < MIN_REPORTS_FOR_AVERAGE) {
    return { hasAverage: false, average: 0, rawAverage, count, dist };
  }
  // Shrink toward the benchmark prior when there is one; otherwise the raw crowd
  // average stands (a discovered model has no prior to borrow).
  const average =
    benchmarkStars === undefined
      ? rawAverage
      : (rawAverage * count + benchmarkStars * PRIOR_WEIGHT) / (count + PRIOR_WEIGHT);
  return {
    hasAverage: true,
    average: Math.round(average * 10) / 10,
    rawAverage: Math.round(rawAverage * 10) / 10,
    count,
    dist,
  };
}

/** A plain-language count for the card, always paired with a community star so
 *  the crowd score can never be read as the benchmark one. "128 ran it". */
export function ranItLabel(count: number): string {
  if (count === 0) return 'No run reports yet';
  if (count === 1) return '1 ran it';
  return `${count.toLocaleString()} ran it`;
}

// ----------------------------------------------------- content filtering
// Apple App Store 1.2 requires a METHOD for filtering objectionable content,
// not only a report path. This is the first line: an obvious-slur and threat
// screen on submit, so the worst content never posts. It is intentionally
// narrow (it must not censor a frank technical review), and the report + block
// + moderation path behind it catches what a wordlist cannot. Kept pure and
// tested; the wordlist stays terse and is matched on word boundaries so a
// substring inside an innocent word ("assistant", "class") never trips it.
const OBJECTIONABLE = [
  '\\bn[i1]gger',
  '\\bf[a4]ggot',
  '\\bk[i1]ke',
  '\\bch[i1]nk',
  '\\bsp[i1]c\\b',
  '\\bt[r]anny',
  '\\bretard',
  '\\brape\\b',
  '\\bkill yourself',
  '\\bkys\\b',
  '\\bcunt',
];
const OBJECTIONABLE_RE = new RegExp(OBJECTIONABLE.join('|'), 'i');

/** True when text contains obviously objectionable content that must not post.
 *  A narrow first-line filter; report/block/moderation handle the rest. */
export function containsObjectionable(text: string | undefined | null): boolean {
  if (!text) return false;
  return OBJECTIONABLE_RE.test(text);
}

// ------------------------------------------------------- hardware-aware read

/** One review row, as read from the reviews table (the fields the fit signal
 *  and the list need). */
export interface ReviewRow {
  id: string;
  user_id: string;
  model_id: string;
  rating: number;
  body?: string | null;
  use_cases?: string[] | null;
  hardware?: string | null;
  ram_gb?: number | null;
  tokens_per_sec?: number | null;
  quant?: string | null;
  felt_speed?: 'snappy' | 'usable' | 'slow' | null;
  created_at: string;
}

/** A coarse memory tier for "machines like yours", so a reader on a 16GB phone
 *  is matched with reports from similar boxes rather than a 128GB workstation.
 *  Buckets are wide on purpose: the point is "roughly my class of machine." */
export function memoryTier(ramGB: number | null | undefined): string | undefined {
  if (!ramGB || ramGB <= 0) return undefined;
  if (ramGB <= 8) return 'up to 8 GB';
  if (ramGB <= 16) return '8 to 16 GB';
  if (ramGB <= 32) return '16 to 32 GB';
  if (ramGB <= 64) return '32 to 64 GB';
  return '64 GB and up';
}

export interface HardwareSignal {
  /** Reports from machines in the reader's memory tier. */
  count: number;
  /** Median felt tokens/sec across those reports, or undefined if none gave one. */
  medianTokensPerSec?: number;
  /** The tier label these reports share. */
  tier: string;
}

/** The "runs well on machines like yours" signal: the reports on the reader's
 *  own memory tier, with a median felt speed. This is the differentiator a
 *  benchmark cannot produce, and it degrades to undefined (show nothing) when
 *  there are no comparable reports rather than mixing incomparable hardware. */
export function hardwareSignal(
  reviews: ReviewRow[],
  readerRamGB: number | null | undefined,
): HardwareSignal | undefined {
  const tier = memoryTier(readerRamGB);
  if (!tier) return undefined;
  const onTier = reviews.filter((r) => memoryTier(r.ram_gb) === tier);
  if (onTier.length === 0) return undefined;
  const speeds = onTier
    .map((r) => r.tokens_per_sec)
    .filter((s): s is number => typeof s === 'number' && s > 0)
    .sort((a, b) => a - b);
  const medianTokensPerSec = speeds.length
    ? speeds.length % 2
      ? speeds[(speeds.length - 1) / 2]
      : (speeds[speeds.length / 2 - 1]! + speeds[speeds.length / 2]!) / 2
    : undefined;
  return {
    count: onTier.length,
    medianTokensPerSec:
      medianTokensPerSec === undefined ? undefined : Math.round(medianTokensPerSec),
    tier,
  };
}
