// The catalog for apps released before the model library (2026-10-12). Those
// apps parse `catalog.json` with a schema whose source kinds are only Ollama
// and Hugging Face and whose categories are only the first eight, and a single
// value outside either list makes them reject the WHOLE catalog. So the
// builder publishes the library in `catalog.v2.json` and narrows a copy to
// what they can read here: no media models, no new categories, no library
// block. Unknown object keys are fine (zod strips them), so only enum values
// need narrowing. catalog.builder.v1.test.ts parses the result with a frozen
// copy of the old enums.
import type { Catalog, CatalogModel } from '../../src/market/schema.js';

/** The source kinds a pre-library app reads. */
export const V1_SOURCE_KINDS = ['ollama', 'huggingface'] as const;

/** The categories a pre-library app reads. */
export const V1_CATEGORIES = [
  'reasoning',
  'coding',
  'writing',
  'analysis',
  'vision',
  'image-gen',
  'embedding',
  'fast',
] as const;

type V1Category = (typeof V1_CATEGORIES)[number];

function readsInV1(model: CatalogModel): boolean {
  if (!(V1_SOURCE_KINDS as readonly string[]).includes(model.source.kind)) return false;
  return (model.runtime ?? 'ollama') === 'ollama';
}

/** Narrow a library catalog to the shape a pre-library app can parse. */
export function toV1(catalog: Catalog): Catalog {
  const models: CatalogModel[] = [];
  for (const model of catalog.models) {
    if (!readsInV1(model)) continue;
    const categories = model.categories.filter((c): c is V1Category =>
      (V1_CATEGORIES as readonly string[]).includes(c),
    );
    if (categories.length === 0) continue;
    // Drop the library-only fields too, so the v1 file is the v1 shape and not
    // just a parseable one.
    const { runtime: _runtime, runner: _runner, ...rest } = model;
    const { files: _files, ...source } = rest.source;
    models.push({ ...rest, source, categories });
  }
  const ids = new Set(models.map((m) => m.id));
  const presets = catalog.presets.filter((p) =>
    [p.stack.orchestrator, ...Object.values(p.stack.specialists)]
      .filter((r): r is string => typeof r === 'string' && r.length > 0)
      .every((r) => ids.has(r)),
  );
  const { library: _library, ...rest } = catalog;
  return { ...rest, models, presets };
}
