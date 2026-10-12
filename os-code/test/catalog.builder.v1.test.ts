// The catalog for apps released before the model library (scripts/build-
// catalog/v1.ts). Those apps reject the WHOLE catalog on one source kind or
// one category they do not know, so the v1 file must hold only the values
// below, frozen here as they were on 2026-10-11. If this test fails, an app
// already on someone's phone would show the bundled starter catalog instead
// of the live one.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toV1 } from '../scripts/build-catalog/v1.js';
import { CatalogSchema, type CatalogModel } from '../src/market/schema.js';

// The enums of the schema as released before the library. Do not widen them.
const FrozenV1Model = z.object({
  categories: z.array(
    z.enum([
      'reasoning',
      'coding',
      'writing',
      'analysis',
      'vision',
      'image-gen',
      'embedding',
      'fast',
    ]),
  ),
  source: z.object({ kind: z.enum(['ollama', 'huggingface']) }),
  license: z.object({ commercial: z.enum(['ok', 'non-commercial', 'gated']).optional() }),
});
const FrozenV1 = z.object({ models: z.array(FrozenV1Model) });

function model(over: Partial<CatalogModel> & { id: string }): CatalogModel {
  return {
    name: over.id,
    tagline: 't',
    categories: ['reasoning'],
    orchestratorCapable: false,
    source: { kind: 'ollama', ref: `${over.id}:1`, pullCommand: `ollama pull ${over.id}:1` },
    sizeGB: 1,
    quantization: 'Q4_K_M',
    contextTokens: 8192,
    license: { id: 'Apache-2.0', name: 'Apache', commercial: 'ok' },
    curation: { rank: 1, note: 'n' },
    blessed: false,
    ...over,
  };
}

const library = CatalogSchema.parse({
  version: 1,
  updated: '2026-10-12',
  presets: [{ id: 'p', name: 'P', tagline: 't', minVramGB: 0, stack: { orchestrator: 'chat' } }],
  models: [
    model({ id: 'chat', categories: ['reasoning', 'writing'] }),
    model({ id: 'mixed', categories: ['vision', 'image-edit'] }),
    model({
      id: 'lama',
      categories: ['image-edit'],
      runtime: 'comfyui',
      source: {
        kind: 'github',
        ref: 'lama',
        pullCommand: 'downloads into ComfyUI',
        files: [
          { url: 'https://github.com/x/y/releases/download/v1/big-lama.pt', dest: 'lama.pt' },
        ],
      },
    }),
    model({
      id: 'flux',
      categories: ['image-gen'],
      runtime: 'comfyui',
      runner: { graph: 'flux-schnell' },
      source: { kind: 'huggingface', ref: 'org/flux', pullCommand: 'see files' },
    }),
  ],
  library: { picks: { 'overall.everyday': { laptop: { model: 'chat', why: 'w' } } } },
});

describe('the v1 catalog', () => {
  const v1 = toV1(library);

  it('parses under the enums apps before the library were released with', () => {
    expect(FrozenV1.safeParse(v1).success).toBe(true);
  });

  it('keeps the chat models and drops every model that runs outside Ollama', () => {
    expect(v1.models.map((m) => m.id)).toEqual(['chat', 'mixed']);
  });

  it('narrows a model with a new category to the categories it already had', () => {
    expect(v1.models.find((m) => m.id === 'mixed')?.categories).toEqual(['vision']);
  });

  it('carries no library block and no library-only fields', () => {
    expect(v1.library).toBeUndefined();
    for (const m of v1.models) {
      expect(m.runtime).toBeUndefined();
      expect(m.runner).toBeUndefined();
      expect(m.source.files).toBeUndefined();
    }
  });

  it('keeps a preset whose models all survive', () => {
    expect(v1.presets.map((p) => p.id)).toEqual(['p']);
  });

  it('leaves the v2 catalog it was made from untouched', () => {
    expect(library.models).toHaveLength(4);
    expect(library.library).toBeDefined();
  });
});
