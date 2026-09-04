// The community-review snapshot source and its pure merge, for the reviews
// scale path. Like sources.ts, the one HTTP fetch lives behind an interface so
// the merge is unit-tested with fixtures and no live network. The fetch reads
// AGGREGATES ONLY (a count and an average per model, over visible rows) through
// the public model_review_snapshot RPC; it never reads a row body, an author,
// or anything private, so the anon key is enough and is the right credential.
//
// This exists so a browse row can carry a crowd star from the shipped catalog
// with zero per-view requests to Supabase. It is a DAILY snapshot: the live
// per-model RPC still serves the product page. Nothing here touches the
// benchmark ratings; the community aggregate is a separate axis on the model.
import type { CatalogModel } from '../../src/market/schema.js';

/** One model's community aggregate, as read from the snapshot RPC. */
export interface CommunityAggregate {
  modelId: string;
  count: number;
  average: number;
}

/** The seam the builder reads the snapshot through. Injected in tests. */
export interface ReviewSnapshotSource {
  /** Every model with visible reviews, its count and average. An empty array is
   *  a legitimate answer (no reviews yet); a failure also degrades to empty so a
   *  reviews-backend hiccup never fails the catalog build. */
  snapshot(): Promise<CommunityAggregate[]>;
}

/**
 * Reads the whole-catalog aggregate from Supabase via the model_review_snapshot
 * RPC. Configured by CATALOG_REVIEWS_URL + CATALOG_REVIEWS_ANON_KEY, falling
 * back to SUPABASE_URL + SUPABASE_ANON_KEY (the same project the app talks to).
 * When neither pair is set, `configured` is false and the builder skips the
 * snapshot entirely, publishing a catalog with no baked aggregates (the app
 * then falls back to the live browse RPC, unchanged). Any fetch failure returns
 * an empty snapshot rather than throwing: a reviews outage must never take down
 * the storefront build.
 */
export class SupabaseReviewSource implements ReviewSnapshotSource {
  private readonly url?: string;
  private readonly anonKey?: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.url = (env.CATALOG_REVIEWS_URL ?? env.SUPABASE_URL)?.trim() || undefined;
    this.anonKey = (env.CATALOG_REVIEWS_ANON_KEY ?? env.SUPABASE_ANON_KEY)?.trim() || undefined;
  }

  /** Whether the reviews backend is configured for this build. */
  get configured(): boolean {
    return Boolean(this.url && this.anonKey);
  }

  async snapshot(): Promise<CommunityAggregate[]> {
    if (!this.url || !this.anonKey) return [];
    const endpoint = `${this.url.replace(/\/+$/, '')}/rest/v1/rpc/model_review_snapshot`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          apikey: this.anonKey,
          authorization: `Bearer ${this.anonKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        // The RPC takes no arguments; an empty JSON object is the PostgREST form.
        body: '{}',
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.warn(`review snapshot: RPC answered ${res.status}, building without it`);
        return [];
      }
      const body = (await res.json()) as unknown;
      return normalizeSnapshot(body);
    } catch (err) {
      console.warn(`review snapshot: fetch failed, building without it: ${String(err)}`);
      return [];
    }
  }
}

/** Coerce the RPC's json (an array of {model_id, count, average}) into clean
 *  aggregates, dropping any malformed or empty-count entry. Numbers arrive as
 *  strings from PostgREST's json_agg, so parse defensively. */
export function normalizeSnapshot(body: unknown): CommunityAggregate[] {
  if (!Array.isArray(body)) return [];
  const out: CommunityAggregate[] = [];
  for (const row of body) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const modelId = typeof r.model_id === 'string' ? r.model_id : undefined;
    const count = Number(r.count);
    const average = Number(r.average);
    if (!modelId) continue;
    if (!Number.isFinite(count) || count <= 0) continue;
    if (!Number.isFinite(average) || average < 0) continue;
    out.push({ modelId, count: Math.round(count), average });
  }
  return out;
}

/**
 * Attach each aggregate to its catalog model as the `community` field, rounding
 * the average to one decimal (the display precision) and clamping to 0..5 so a
 * stray value can never fail the schema's star bound. Pure: returns a new models
 * array, leaves the input untouched, and only writes models that ARE in the
 * catalog (an aggregate for a model no longer shelved is dropped). A model with
 * no aggregate is left without a `community` field; the app reads that absence
 * as zero reports as of the snapshot.
 */
export function mergeCommunity(
  models: CatalogModel[],
  aggregates: CommunityAggregate[],
): CatalogModel[] {
  const byId = new Map(aggregates.map((a) => [a.modelId, a]));
  return models.map((m) => {
    const agg = byId.get(m.id);
    if (!agg) return m;
    const average = Math.min(5, Math.max(0, Math.round(agg.average * 10) / 10));
    return { ...m, community: { count: agg.count, average } };
  });
}
