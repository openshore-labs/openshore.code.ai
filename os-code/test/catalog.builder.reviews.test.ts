// The reviews scale path: the community-snapshot source and its pure merge.
// A browse row shows a crowd star from the shipped catalog, with no per-view
// request to Supabase, because the daily builder bakes a one-shot aggregate into
// catalog.json. These tests pin the honesty and safety rules of that bake:
//   - the aggregate is a SEPARATE axis, never merged into benchmark ratings;
//   - a malformed, empty, or off-model snapshot entry is dropped, never trusted;
//   - a reviews-backend failure degrades to an empty snapshot (the build goes on
//     without the field), never a throw;
//   - the merge is pure (it returns a new array and leaves the input untouched).
import { afterEach, describe, expect, it } from 'vitest';
import {
  mergeCommunity,
  normalizeSnapshot,
  SupabaseReviewSource,
  type CommunityAggregate,
} from '../scripts/build-catalog/reviews.js';
import { CatalogModelSchema, type CatalogModel } from '../src/market/schema.js';

function model(id: string, over: Partial<CatalogModel> = {}): CatalogModel {
  return CatalogModelSchema.parse({
    id,
    name: id,
    tagline: 'A test model.',
    categories: ['coding'],
    orchestratorCapable: false,
    source: { kind: 'ollama', ref: `${id}:7b`, pullCommand: `ollama pull ${id}:7b` },
    sizeGB: 4,
    quantization: 'Q4_K_M',
    contextTokens: 32768,
    license: { id: 'Apache-2.0', name: 'Apache 2.0' },
    curation: { rank: 1, note: 'test' },
    blessed: false,
    ...over,
  });
}

describe('normalizeSnapshot', () => {
  it('parses PostgREST json_agg rows, coercing string numbers', () => {
    // json_agg returns count/average as strings; the RPC ships them that way.
    const rows = [
      { model_id: 'a', count: '12', average: '4.5' },
      { model_id: 'b', count: 3, average: 2 },
    ];
    expect(normalizeSnapshot(rows)).toEqual([
      { modelId: 'a', count: 12, average: 4.5 },
      { modelId: 'b', count: 3, average: 2 },
    ]);
  });

  it('drops malformed, zero-count, and id-less entries', () => {
    const rows = [
      { model_id: 'ok', count: 5, average: 4 },
      { model_id: 'zero', count: 0, average: 0 }, // no visible reviews, absent by design
      { model_id: 'neg', count: -2, average: 3 }, // impossible, drop
      { count: 4, average: 3 }, // no model_id, drop
      { model_id: 'nan', count: 'x', average: 'y' }, // unparseable, drop
      null,
      'garbage',
    ];
    expect(normalizeSnapshot(rows)).toEqual([{ modelId: 'ok', count: 5, average: 4 }]);
  });

  it('returns [] for a non-array body (an error object, null)', () => {
    expect(normalizeSnapshot({ message: 'boom' })).toEqual([]);
    expect(normalizeSnapshot(null)).toEqual([]);
    expect(normalizeSnapshot(undefined)).toEqual([]);
  });
});

describe('mergeCommunity', () => {
  it('attaches the aggregate as the community field, rounding the average', () => {
    const models = [model('a'), model('b')];
    const aggs: CommunityAggregate[] = [{ modelId: 'a', count: 12, average: 4.4667 }];
    const merged = mergeCommunity(models, aggs);
    expect(merged[0]!.community).toEqual({ count: 12, average: 4.5 });
    expect(merged[1]!.community).toBeUndefined();
  });

  it('never touches the benchmark ratings axis', () => {
    const rated = model('a', {
      ratings: {
        perCapability: { coding: 4.5 },
        osCodeFit: 4,
        provenance: { coding: ['HumanEval'] },
      },
    });
    const merged = mergeCommunity([rated], [{ modelId: 'a', count: 30, average: 2.1 }]);
    // The community star is 2.1; the benchmark fit stays 4. Two separate axes.
    expect(merged[0]!.community).toEqual({ count: 30, average: 2.1 });
    expect(merged[0]!.ratings?.osCodeFit).toBe(4);
  });

  it('drops an aggregate for a model no longer in the catalog', () => {
    const merged = mergeCommunity([model('a')], [{ modelId: 'gone', count: 9, average: 5 }]);
    expect(merged[0]!.community).toBeUndefined();
  });

  it('clamps a stray average into the schema star bound so the catalog validates', () => {
    const merged = mergeCommunity([model('a')], [{ modelId: 'a', count: 4, average: 7 }]);
    expect(merged[0]!.community!.average).toBe(5);
    // The whole model must still parse against the schema after the merge.
    expect(() => CatalogModelSchema.parse(merged[0])).not.toThrow();
  });

  it('is pure: the input models are not mutated', () => {
    const models = [model('a')];
    const before = JSON.stringify(models);
    mergeCommunity(models, [{ modelId: 'a', count: 3, average: 4 }]);
    expect(JSON.stringify(models)).toBe(before);
    expect(models[0]!.community).toBeUndefined();
  });
});

describe('SupabaseReviewSource', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('is unconfigured (and reads nothing) with no env, returning []', async () => {
    const src = new SupabaseReviewSource({});
    expect(src.configured).toBe(false);
    expect(await src.snapshot()).toEqual([]);
  });

  it('is configured from CATALOG_REVIEWS_* and posts to the snapshot RPC', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        json: async () => [{ model_id: 'a', count: '5', average: '4.2' }],
      } as Response;
    }) as typeof fetch;
    const src = new SupabaseReviewSource({
      CATALOG_REVIEWS_URL: 'https://proj.supabase.co/',
      CATALOG_REVIEWS_ANON_KEY: 'anon-key',
    });
    expect(src.configured).toBe(true);
    const snap = await src.snapshot();
    expect(snap).toEqual([{ modelId: 'a', count: 5, average: 4.2 }]);
    expect(calls[0]!.url).toBe('https://proj.supabase.co/rest/v1/rpc/model_review_snapshot');
    expect(calls[0]!.init?.method).toBe('POST');
    expect((calls[0]!.init?.headers as Record<string, string>).apikey).toBe('anon-key');
  });

  it('falls back to SUPABASE_* when the CATALOG_REVIEWS_* pair is unset', () => {
    const src = new SupabaseReviewSource({
      SUPABASE_URL: 'https://proj.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
    });
    expect(src.configured).toBe(true);
  });

  it('degrades to [] on a non-ok response, never throwing', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 500 }) as Response) as typeof fetch;
    const src = new SupabaseReviewSource({
      SUPABASE_URL: 'https://proj.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
    });
    expect(await src.snapshot()).toEqual([]);
  });

  it('degrades to [] when the fetch throws (a reviews outage), never failing the build', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    const src = new SupabaseReviewSource({
      SUPABASE_URL: 'https://proj.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
    });
    expect(await src.snapshot()).toEqual([]);
  });
});
