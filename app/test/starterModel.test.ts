// The desktop starter model must exist in the engine's bundled catalog with
// exactly the id and Ollama ref the app uses, or the one-tap button would
// install nothing (or install the wrong thing). Read the real catalog file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STARTER_MODEL } from '../src/lib/starterModel.js';

interface CatalogModel {
  id: string;
  name: string;
  sizeGB?: number;
  source: { kind: string; ref: string };
}

describe('desktop starter model', () => {
  it('is present in the bundled catalog with matching id, ref, and source', () => {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), '..', 'os-code', 'catalog.sample.json'), 'utf8'),
    ) as { models?: CatalogModel[] } | CatalogModel[];
    const models = Array.isArray(raw) ? raw : (raw.models ?? []);
    const entry = models.find((m) => m.id === STARTER_MODEL.catalogId);
    expect(entry, `catalog has ${STARTER_MODEL.catalogId}`).toBeDefined();
    expect(entry!.source.kind).toBe('ollama');
    expect(entry!.source.ref).toBe(STARTER_MODEL.ollamaRef);
    expect(entry!.name).toBe(STARTER_MODEL.name);
  });
});
