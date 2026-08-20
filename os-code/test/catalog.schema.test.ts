// The catalog is a shipped contract: the bundled sample and any older client
// must keep validating as the builder adds optional rating/popularity fields.
// This pins backward compatibility (old sample still parses), the new fields
// round-tripping, and the two zod-4 gotchas the CTO flagged: perCapability is a
// sparse partialRecord, and stars are 0..5 in 0.5 steps.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatalogSchema, CatalogModelSchema } from '../src/market/schema.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const sample = JSON.parse(readFileSync(resolve(here, '../catalog.sample.json'), 'utf8'));

const baseModel = sample.models[0];

describe('catalog schema backward compatibility', () => {
  it('the bundled sample (no new fields) still validates', () => {
    expect(() => CatalogSchema.parse(sample)).not.toThrow();
  });

  it('drops unknown future fields instead of rejecting (old client, new catalog)', () => {
    const withFuture = { ...baseModel, someFutureField: 42 };
    const parsed = CatalogModelSchema.parse(withFuture);
    expect('someFutureField' in parsed).toBe(false);
  });
});

describe('catalog schema new builder fields', () => {
  it('round-trips ratings, popularity, timestamps, and recommended', () => {
    const enriched = {
      ...baseModel,
      // perCapability is sparse: only the categories this model targets. This is
      // the partialRecord case that a plain z.record would reject in zod 4.
      ratings: {
        perCapability: { coding: 4.5, reasoning: 4 },
        osCodeFit: 3.5,
        provenance: { coding: ['HumanEval', 'SWE-bench'], reasoning: ['MMLU'] },
      },
      popularity: { downloads: 120000, likes: 800, source: 'huggingface' },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
      recommended: { isRecommended: true, note: 'Great local coder.' },
    };
    const parsed = CatalogModelSchema.parse(enriched);
    expect(parsed.ratings?.perCapability.coding).toBe(4.5);
    expect(parsed.ratings?.osCodeFit).toBe(3.5);
    expect(parsed.popularity?.source).toBe('huggingface');
    expect(parsed.recommended?.isRecommended).toBe(true);
  });

  it('rejects a star that is not on a 0.5 step', () => {
    const bad = { ...baseModel, ratings: { perCapability: { coding: 4.25 }, osCodeFit: 3, provenance: { coding: ['x'] } } };
    expect(() => CatalogModelSchema.parse(bad)).toThrow();
  });

  it('rejects a star above 5', () => {
    const bad = { ...baseModel, ratings: { perCapability: { coding: 6 }, osCodeFit: 3, provenance: { coding: ['x'] } } };
    expect(() => CatalogModelSchema.parse(bad)).toThrow();
  });
});
