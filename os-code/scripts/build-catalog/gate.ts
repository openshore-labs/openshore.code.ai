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
export function regressionGate(
  next: Catalog,
  previousRaw: unknown | undefined,
  opts: { online?: boolean } = {},
): RegressionResult {
  const breaches: GateBreach[] = [];
  const online = opts.online ?? false;

  // Invariant: a catalog with no models is never a valid publish.
  if (next.models.length === 0) {
    breaches.push({ check: 'non-empty', detail: 'the enriched catalog has no models' });
  }

  // MP-S2: an onDevice.url points iPhones at a multi-GB GGUF that llama.cpp
  // parses (a parser with a CVE history against malicious GGUF). Whoever can
  // write the published catalog must not be able to redirect that download off
  // Hugging Face, so pin the host. The client follows the CDN resolve redirect
  // to cdn-lfs.huggingface.co AFTER its own host check, which is fine.
  for (const model of next.models) {
    if (!model.onDevice) continue;
    let host: string | undefined;
    try {
      host = new URL(model.onDevice.url).host;
    } catch {
      host = undefined;
    }
    if (host !== 'huggingface.co') {
      breaches.push({
        check: 'onDevice.url host is huggingface.co',
        detail: `model "${model.id}" onDevice.url host is "${host ?? 'unparseable'}", not huggingface.co`,
      });
    }
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
    if (!prev) {
      // H3: a baseline that is present but does not schema-parse (a truncated
      // download, an HTML error page seeded over it, or an old catalog shape)
      // cannot anchor the checks below. Silently skipping them would publish
      // UNGATED exactly when the baseline is most suspect, so treat it as a
      // breach: publish nothing and keep serving whatever is live.
      breaches.push({
        check: 'baseline parses',
        detail:
          'the previous catalog is present but does not schema-parse (truncated, non-JSON, or old-schema baseline); refusing to publish ungated',
      });
    } else {
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
      // P2-4: the same collapse guard for presets. A build that drops EVERY
      // preset while the last catalog shipped some is a broken storefront (no
      // stacks to pick), not an editorial choice.
      if (prev.presets.length > 0 && next.presets.length === 0) {
        breaches.push({
          check: 'presets not all dropped',
          detail: `every preset was dropped (${prev.presets.length} to 0)`,
        });
      }
      // MP-A-4: popularity coverage guard. On an ONLINE run, a collapse in how
      // many models carry popularity is a source-outage signature (MP-F5 carries
      // last week's numbers forward, so a real online run should not lose half
      // its coverage). Offline runs legitimately carry no popularity, so this
      // check is online-only. "More than half lost" means next < prev / 2.
      if (online) {
        const prevWithPop = prev.models.filter((m) => m.popularity).length;
        const nextWithPop = next.models.filter((m) => m.popularity).length;
        if (prevWithPop > 0 && nextWithPop < prevWithPop / 2) {
          breaches.push({
            check: 'popularity coverage not halved',
            detail: `models carrying popularity fell from ${prevWithPop} to ${nextWithPop} (more than half lost)`,
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
    // A previous catalog that no longer parses (an old shape, a truncated or
    // non-JSON body). The caller turns this into a breach rather than skipping
    // the regression checks: an unparseable baseline must not disarm the gate.
    return undefined;
  }
}
