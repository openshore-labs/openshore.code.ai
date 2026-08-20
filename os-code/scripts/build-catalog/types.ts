// Shared types for the server-side catalog builder. The builder runs in CI
// ONLY. It reads metadata (never weights) from Hugging Face and the Ollama
// library, derives provenance-backed star ratings from published benchmarks,
// merges the founder's editorial overlay, gates the result, and writes the
// enriched catalog.json that the client fetches. Nothing here is shipped in
// the client bundle: the isolation guard test forbids src/ from importing it.
import type { CapabilityCategory } from '../../src/router/roles.js';

/**
 * Metadata for one model, fetched from a source (Hugging Face or the Ollama
 * library). Numbers and dates only. Weights are never touched, downloaded, or
 * rehosted. This is the ONLY shape the source layer returns.
 */
export interface ModelMetadata {
  /** The source ref this metadata describes, e.g. "qwen2.5-coder:14b". */
  ref: string;
  source: 'huggingface' | 'ollama';
  downloads?: number;
  likes?: number;
  /** ISO timestamps, exactly as the source reports them. */
  createdAt?: string;
  lastModified?: string;
  /** Raw license tag from the source. NEVER used to synthesize a license note;
   *  the fail-closed rule takes id/name only from the SPDX allow-list table. */
  licenseTag?: string;
  tags?: string[];
}

/**
 * The metadata source interface. Real implementations hit the network; the
 * tests inject a fixture source, so no live fetch runs in the suite (this
 * environment has no Hugging Face access on purpose).
 */
export interface MetadataSource {
  readonly kind: 'huggingface' | 'ollama';
  /** Fetch metadata for one ref. Returns undefined when the source has no
   *  entry (a broken ref, a private repo). Never throws for a missing model. */
  fetchMetadata(ref: string): Promise<ModelMetadata | undefined>;
}

/** Published benchmark scores for one model, keyed by canonical benchmark name
 *  (the names in router/roles.ts). Native units, e.g. HumanEval 0..100, MT-Bench
 *  0..10. Curated input, committed under curation/benchmarks.json. */
export type BenchmarkScores = Record<string, number>;

/** The local eval average (0..1) from the harness, per model id. osCodeFit is
 *  round(average * 5). Committed under curation/eval.json. */
export type EvalAverages = Record<string, number>;

/** One editorial overlay entry, from curation/recommended.json. */
export interface OverlayEntry {
  isRecommended: boolean;
  /** The recommendation note (why the founder picked it). */
  note?: string;
  /** An override rank inside the recommended shelf (lower shows first). */
  rank?: number;
  /** The ONLY place a human license note may come from. The builder never
   *  synthesizes a note from a source tag. */
  licenseNote?: string;
}

export type Overlay = Record<string, OverlayEntry>;

/** Everything the pure build needs, gathered by index.ts (the only file that
 *  touches the filesystem or the network). Passing it in keeps the build
 *  itself pure and unit-testable with fixtures. */
export interface BuildInputs {
  /** The editorial seed: catalog.sample.json, the curated base to enrich. */
  seed: unknown;
  /** Fetched metadata, keyed by source ref. Empty when offline; the builder
   *  degrades (popularity and timestamps are optional). */
  metadata: Record<string, ModelMetadata>;
  benchmarks: Record<string, BenchmarkScores>;
  evals: EvalAverages;
  overlay: Overlay;
  /** The previously published catalog.json, for the regression gate. Undefined
   *  on the very first build (nothing to regress against yet). */
  previous?: unknown;
}

/** One reason a model was dropped from the curated storefront, for the log. */
export interface DropRecord {
  id: string;
  reason: string;
}

/** A regression gate breach. Any breach fails the whole job: publish nothing,
 *  leave the previous catalog serving. */
export interface GateBreach {
  check: string;
  detail: string;
}

export type CapabilityStar = {
  capability: CapabilityCategory;
  stars: number;
  /** The benchmark names that produced the star. Never empty. */
  provenance: string[];
};
