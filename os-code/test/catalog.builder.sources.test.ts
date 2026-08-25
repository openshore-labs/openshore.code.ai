// Metadata source fetching, pinned with fixtures (no live network: this
// sandbox blocks huggingface.co on purpose). These tests lock the three bugs
// the CTO diagnosed after the first live CI run published popularity empty on
// every model:
//   Bug A  the HF repo id "org/name" must be encoded PER SEGMENT, so the URL
//          keeps a literal slash, not "%2F" (which 404s every lookup).
//   Bug B  Ollama has no public JSON popularity API; an Ollama model reads its
//          number from the HF GGUF home named by popularityRef, keyed by the
//          model's OWN ref. No popularityRef means omitted, never fabricated.
//   Bug C  a missing entry resolves to omitted popularity, not a made-up number.
import { afterEach, describe, expect, it } from 'vitest';
import { gatherMetadata, HuggingFaceSource } from '../scripts/build-catalog/sources.js';
import { enrichCatalog } from '../scripts/build-catalog/enrich.js';
import type { BuildInputs, MetadataSource, ModelMetadata } from '../scripts/build-catalog/types.js';

// ---- Bug A: the HF URL is built with a literal slash, not %2F ----

describe('HuggingFaceSource URL construction (Bug A)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function stubFetch(body: unknown, ok = true): { calls: string[] } {
    const calls: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      calls.push(String(url));
      return {
        ok,
        json: async () => body,
      } as Response;
    }) as typeof fetch;
    return { calls };
  }

  it('encodes each path segment, preserving the slash in "org/name"', async () => {
    const { calls } = stubFetch({ downloads: 123456, likes: 789 });
    const src = new HuggingFaceSource('https://huggingface.co');
    const meta = await src.fetchMetadata('Qwen/Qwen2.5-Coder-7B-Instruct-GGUF');

    // The literal slash between org and name survives; it is NOT percent-encoded.
    expect(calls[0]).toBe('https://huggingface.co/api/models/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF');
    expect(calls[0]).not.toContain('%2F');

    // Bug: the whole-id encode that shipped would have produced this bad URL.
    expect(calls[0]).not.toContain('Qwen%2FQwen2.5-Coder-7B-Instruct-GGUF');
    expect(meta?.source).toBe('huggingface');
  });

  it('maps downloads and likes from the response shape', async () => {
    stubFetch({ downloads: 120000, likes: 800, lastModified: '2026-01-02T00:00:00Z' });
    const src = new HuggingFaceSource();
    const meta = await src.fetchMetadata('org/model-GGUF');
    expect(meta?.downloads).toBe(120000);
    expect(meta?.likes).toBe(800);
    expect(meta?.lastModified).toBe('2026-01-02T00:00:00Z');
  });

  it('returns undefined on a non-ok response (a missing/private repo)', async () => {
    stubFetch({}, false);
    const src = new HuggingFaceSource();
    expect(await src.fetchMetadata('ghost/does-not-exist')).toBeUndefined();
  });
});

// ---- Bug B: Ollama popularity comes from its HF GGUF home ----

/** A fixture HF source: a small in-memory table, keyed by HF repo id. */
function fixtureHf(table: Record<string, { downloads: number; likes: number }>): MetadataSource {
  return {
    kind: 'huggingface',
    async fetchMetadata(ref: string): Promise<ModelMetadata | undefined> {
      const e = table[ref];
      return e ? { ref, source: 'huggingface', downloads: e.downloads, likes: e.likes } : undefined;
    },
  };
}

describe('gatherMetadata routing (Bug B)', () => {
  it('resolves an Ollama model via its HF popularityRef, keyed by its own ref', async () => {
    const hf = fixtureHf({
      'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF': { downloads: 100, likes: 10 },
      'org/plain-hf-GGUF': { downloads: 5, likes: 1 },
    });

    const out = await gatherMetadata(
      [
        {
          ref: 'qwen2.5-coder:7b',
          kind: 'ollama',
          popularityRef: 'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF',
        },
        // An Ollama model with NO popularityRef: honest omission, not a fetch.
        { ref: 'mystery-model', kind: 'ollama' },
        // A plain HF model reads its own ref.
        { ref: 'org/plain-hf-GGUF', kind: 'huggingface' },
        // A missing HF entry stays omitted (Bug C).
        { ref: 'ghost/missing-GGUF', kind: 'huggingface' },
      ],
      { huggingface: hf },
    );

    // Keyed by the Ollama model's OWN ref, and the number came from HF.
    expect(out['qwen2.5-coder:7b']).toMatchObject({
      ref: 'qwen2.5-coder:7b',
      source: 'huggingface',
      downloads: 100,
      likes: 10,
    });
    // No popularityRef -> not attempted -> omitted (never fabricated).
    expect(out['mystery-model']).toBeUndefined();
    // Plain HF model resolves on its own ref.
    expect(out['org/plain-hf-GGUF']).toMatchObject({ downloads: 5, likes: 1 });
    // Missing entry -> omitted.
    expect(out['ghost/missing-GGUF']).toBeUndefined();
  });
});

// ---- Bug C: a missing entry yields omitted popularity in the enriched model ----

function specialistSeed(id: string, ref: string) {
  return {
    version: 1,
    updated: '2026-08-20',
    models: [
      {
        id,
        name: id,
        tagline: 'A test model.',
        categories: ['coding'],
        orchestratorCapable: false,
        source: { kind: 'ollama', ref, pullCommand: `ollama pull ${ref}` },
        sizeGB: 4,
        quantization: 'Q4_K_M',
        contextTokens: 32768,
        license: { id: 'Apache-2.0', name: 'seed name' },
        curation: { rank: 1, note: 'test' },
        blessed: false,
      },
    ],
    presets: [],
  };
}

function inputsFor(seed: unknown, metadata: BuildInputs['metadata']): BuildInputs {
  return {
    seed,
    metadata,
    // A strong coding score so the model clears the gate and the only variable
    // under test is popularity presence.
    benchmarks: { m1: { HumanEval: 92 } },
    evals: {},
    overlay: {},
  };
}

describe('popularity presence in the enriched model (Bug C)', () => {
  it('maps popularity when metadata is present, keyed by source ref', () => {
    const seed = specialistSeed('m1', 'm1:7b');
    const { catalog } = enrichCatalog(
      inputsFor(seed, {
        'm1:7b': { ref: 'm1:7b', source: 'huggingface', downloads: 4200, likes: 37 },
      }),
    );
    expect(catalog.models[0]?.popularity).toEqual({
      downloads: 4200,
      likes: 37,
      source: 'huggingface',
    });
  });

  it('omits popularity entirely when there is no metadata entry (never fabricates 0/0)', () => {
    const seed = specialistSeed('m1', 'm1:7b');
    const { catalog } = enrichCatalog(inputsFor(seed, {}));
    expect(catalog.models[0]?.popularity).toBeUndefined();
  });
});

// ---- MP-A-2: auth header and one transient retry ----

describe('HuggingFaceSource auth header (MP-A-2)', () => {
  const realFetch = globalThis.fetch;
  const realToken = process.env.HF_TOKEN;
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realToken === undefined) delete process.env.HF_TOKEN;
    else process.env.HF_TOKEN = realToken;
  });

  function stubCapturingHeaders(): { headers: Array<Record<string, string>> } {
    const headers: Array<Record<string, string>> = [];
    globalThis.fetch = (async (_url: unknown, init?: { headers?: Record<string, string> }) => {
      headers.push({ ...(init?.headers ?? {}) });
      return { ok: true, json: async () => ({ downloads: 1, likes: 0 }) } as Response;
    }) as typeof fetch;
    return { headers };
  }

  it('sends authorization: Bearer when HF_TOKEN is set', async () => {
    process.env.HF_TOKEN = 'hf_secrettoken';
    const { headers } = stubCapturingHeaders();
    await new HuggingFaceSource().fetchMetadata('org/model-GGUF');
    expect(headers[0]?.authorization).toBe('Bearer hf_secrettoken');
  });

  it('sends no authorization header when HF_TOKEN is unset', async () => {
    delete process.env.HF_TOKEN;
    const { headers } = stubCapturingHeaders();
    await new HuggingFaceSource().fetchMetadata('org/model-GGUF');
    expect(headers[0]?.authorization).toBeUndefined();
  });
});

describe('HuggingFaceSource transient retry (MP-A-2)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('retries once after a 429 and resolves on the follow-up success', async () => {
    let call = 0;
    globalThis.fetch = (async () => {
      call += 1;
      if (call === 1) return { ok: false, status: 429, json: async () => ({}) } as Response;
      return { ok: true, status: 200, json: async () => ({ downloads: 77, likes: 3 }) } as Response;
    }) as typeof fetch;
    // retryBaseMs 0 so the test does not sleep.
    const meta = await new HuggingFaceSource('https://huggingface.co', 0).fetchMetadata(
      'org/m-GGUF',
    );
    expect(call).toBe(2);
    expect(meta?.downloads).toBe(77);
    expect(meta?.likes).toBe(3);
  });

  it('does not retry a plain 404 (a real miss)', async () => {
    let call = 0;
    globalThis.fetch = (async () => {
      call += 1;
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof fetch;
    const meta = await new HuggingFaceSource('https://huggingface.co', 0).fetchMetadata('ghost/x');
    expect(call).toBe(1);
    expect(meta).toBeUndefined();
  });
});

// ---- MP-F5: popularity carries forward when this run's metadata is missing ----

describe('popularity carry-forward (MP-F5)', () => {
  it('keeps the previous catalog popularity when metadata is absent this run', () => {
    const seed = specialistSeed('m1', 'm1:7b');
    // Last week's published catalog carried a number for m1.
    const first = enrichCatalog(
      inputsFor(seed, {
        'm1:7b': { ref: 'm1:7b', source: 'huggingface', downloads: 5000, likes: 40 },
      }),
    ).catalog;
    expect(first.models[0]?.popularity).toEqual({
      downloads: 5000,
      likes: 40,
      source: 'huggingface',
    });

    // This run resolves NO metadata, but the previous catalog is in inputs.
    const again = enrichCatalog({ ...inputsFor(seed, {}), previous: first }).catalog;
    expect(again.models[0]?.popularity).toEqual({
      downloads: 5000,
      likes: 40,
      source: 'huggingface',
    });
  });

  it('still omits popularity when neither this run nor the previous catalog has it', () => {
    const seed = specialistSeed('m1', 'm1:7b');
    const first = enrichCatalog(inputsFor(seed, {})).catalog;
    const again = enrichCatalog({ ...inputsFor(seed, {}), previous: first }).catalog;
    expect(again.models[0]?.popularity).toBeUndefined();
  });
});

// ---- MP-A-8: the no-op updated stamp ----

describe('updated timestamp no-op stamp (MP-A-8)', () => {
  const today = new Date().toISOString().slice(0, 10);

  it('carries the previous updated stamp forward on a true no-op build', () => {
    const seed = specialistSeed('m1', 'm1:7b');
    const first = enrichCatalog(inputsFor(seed, {})).catalog;
    // Byte-identical content, only an older stamp: the signature matches.
    const previous = { ...first, updated: '2020-01-01' };
    const again = enrichCatalog({ ...inputsFor(seed, {}), previous }).catalog;
    expect(again.updated).toBe('2020-01-01');
  });

  it('advances the stamp to today when content actually changed', () => {
    const seed = specialistSeed('m1', 'm1:7b');
    const first = enrichCatalog(inputsFor(seed, {})).catalog;
    // Previous carried different model copy, so the content signature differs.
    // (Popularity is deliberately NOT the lever here: MP-F5 carry-forward would
    // copy a prior number into this run and mask the change.)
    const previous = {
      ...first,
      updated: '2020-01-01',
      models: [{ ...first.models[0]!, tagline: 'An older tagline.' }],
    };
    const again = enrichCatalog({ ...inputsFor(seed, {}), previous }).catalog;
    expect(again.updated).toBe(today);
  });
});
