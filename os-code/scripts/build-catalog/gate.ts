// The bad-build regression gate. It runs AFTER the schema parse and BEFORE
// publish. On any breach the whole job fails and nothing is written, so the
// previously published catalog keeps serving. This is the safety net that
// stops a bad metadata day (a source outage that drops half the models, a
// blessed model vanishing) from shipping a broken storefront.
import { CatalogSchema, type Catalog } from '../../src/market/schema.js';
import type { GateBreach } from './types.js';

export interface RegressionResult {
  ok: boolean;
  breaches: GateBreach[];
}

/** Validate the enriched output against the schema before anything else. Throws
 *  on an invalid catalog: a build that cannot even parse must never publish. */
export function validateCatalog(catalog: unknown): Catalog {
  return CatalogSchema.parse(catalog);
}

/**
 * Assert the invariants that a good build always holds. previousRaw is the
 * last published catalog.json (undefined on the first ever build).
 */
export function regressionGate(next: Catalog, previousRaw: unknown | undefined): RegressionResult {
  const breaches: GateBreach[] = [];

  // Invariant: a catalog with no models is never a valid publish.
  if (next.models.length === 0) {
    breaches.push({ check: 'non-empty', detail: 'the enriched catalog has no models' });
  }

  // Invariant: every preset orchestrator and specialist id resolves to a model.
  const ids = new Set(next.models.map((m) => m.id));
  for (const preset of next.presets) {
    const refs: [string, string | undefined][] = [
      ['orchestrator', preset.stack.orchestrator],
      ...Object.entries(preset.stack.specialists),
    ];
    for (const [slot, ref] of refs) {
      if (ref && !ids.has(ref)) {
        breaches.push({
          check: 'preset ids resolve',
          detail: `preset "${preset.id}" ${slot} "${ref}" resolves to no model in the catalog`,
        });
      }
    }
  }

  // Invariants against the last published catalog.
  if (previousRaw !== undefined) {
    const prev = safeParse(previousRaw);
    if (prev) {
      // No previously blessed model may silently disappear.
      for (const model of prev.models) {
        if (model.blessed && !ids.has(model.id)) {
          breaches.push({
            check: 'no blessed model dropped',
            detail: `previously blessed model "${model.id}" is missing from the new catalog`,
          });
        }
      }
      // The model count must not collapse: a fall of more than 25 percent reads
      // as a source failure, not an editorial choice.
      if (prev.models.length > 0) {
        const dropFraction = (prev.models.length - next.models.length) / prev.models.length;
        if (dropFraction > 0.25) {
          breaches.push({
            check: 'model count not down more than 25 percent',
            detail: `model count fell ${(dropFraction * 100).toFixed(0)} percent (${prev.models.length} to ${next.models.length})`,
          });
        }
      }
    }
  }

  return { ok: breaches.length === 0, breaches };
}

function safeParse(raw: unknown): Catalog | undefined {
  try {
    return CatalogSchema.parse(raw);
  } catch {
    // A previous catalog that no longer parses (an old shape) cannot anchor the
    // regression checks; skip them rather than blocking a fresh, valid build.
    return undefined;
  }
}
