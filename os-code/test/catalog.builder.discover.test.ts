// Live discovery, pinned with fixtures (no live network in the suite). The
// honesty contract: a discovered entry is labelled, unrated, never an
// orchestrator, only from a public repo with an allow-listed license and a
// single-file GGUF at a supported quant; the seed wins collisions; last time's
// discoveries carry forward; and enrich keeps them as unrated.
import { describe, expect, it } from 'vitest';
import {
  baseKey,
  classify,
  discoverModels,
  pickGguf,
  slugId,
  type DiscoveredRepo,
  type DiscoveryClient,
  type RepoDetail,
} from '../scripts/build-catalog/discover.js';
import { enrichCatalog } from '../scripts/build-catalog/enrich.js';
import { derivePresets } from '../scripts/build-catalog/presets.js';
import { CatalogSchema, type CatalogModel } from '../src/market/schema.js';

function repo(id: string, extra: Partial<DiscoveredRepo> = {}): DiscoveredRepo {
  return { id, downloads: 1000, likes: 10, ...extra };
}

function detail(id: string, extra: Partial<RepoDetail> = {}): RepoDetail {
  return {
    id,
    cardData: { license: 'apache-2.0' },
    siblings: [
      { rfilename: `${id.split('/')[1]}-Q4_K_M.gguf`, size: 4.9e9 },
      { rfilename: `${id.split('/')[1]}-Q8_0.gguf`, size: 8.7e9 },
      { rfilename: 'README.md', size: 1000 },
    ],
    ...extra,
  };
}

function client(
  trending: DiscoveredRepo[],
  newest: DiscoveredRepo[],
  details: Record<string, RepoDetail | undefined>,
): DiscoveryClient & { detailCalls: string[] } {
  const detailCalls: string[] = [];
  return {
    detailCalls,
    list: async (sort) => (sort === 'trendingScore' ? trending : newest),
    detail: async (id) => {
      detailCalls.push(id);
      return details[id];
    },
  };
}

describe('discoverModels', () => {
  it('turns a public, licensed, single-file GGUF repo into a labelled entry', async () => {
    const c = client([repo('bartowski/Qwen3-8B-GGUF')], [], {
      'bartowski/Qwen3-8B-GGUF': detail('bartowski/Qwen3-8B-GGUF'),
    });
    const { models, skipped } = await discoverModels(c, { today: '2026-09-02' });
    expect(skipped).toEqual([]);
    expect(models).toHaveLength(1);
    const m = models[0]!;
    expect(m.id).toBe('hf-bartowski-qwen3-8b');
    expect(m.name).toBe('Qwen3 8B');
    expect(m.source).toEqual({
      kind: 'ollama',
      ref: 'hf.co/bartowski/Qwen3-8B-GGUF:Q4_K_M',
      pullCommand: 'ollama pull hf.co/bartowski/Qwen3-8B-GGUF:Q4_K_M',
      popularityRef: 'bartowski/Qwen3-8B-GGUF',
    });
    expect(m.sizeGB).toBe(4.9);
    expect(m.quantization).toBe('Q4_K_M');
    expect(m.license.id).toBe('Apache-2.0');
    expect(m.orchestratorCapable).toBe(false);
    expect(m.blessed).toBe(false);
    expect(m.ratings).toBeUndefined();
    expect(m.onDevice).toBeUndefined(); // 4.9 GB is not a phone model
    expect(m.discovery).toEqual({
      source: 'huggingface',
      repo: 'bartowski/Qwen3-8B-GGUF',
      foundAt: '2026-09-02',
    });
    expect(m.curation.rank).toBeGreaterThanOrEqual(1000);
  });

  it('skips gated, private, unlicensed, denylisted, sharded, and unreadable repos', async () => {
    const trending = [
      repo('meta-llama/Llama-4-GGUF', { gated: 'auto' }),
      repo('someone/secret-GGUF', { private: true }),
      repo('someone/NoLicense-GGUF'),
      repo('someone/Bad-Uncensored-GGUF'),
      repo('someone/Sharded-GGUF'),
      repo('someone/Vanished-GGUF'),
      repo('someone/OtherLicense-GGUF'),
    ];
    const c = client(trending, [], {
      'someone/NoLicense-GGUF': detail('someone/NoLicense-GGUF', { cardData: {} }),
      'someone/Sharded-GGUF': detail('someone/Sharded-GGUF', {
        siblings: [{ rfilename: 'x-Q4_K_M-00001-of-00002.gguf', size: 2e9 }],
      }),
      'someone/Vanished-GGUF': undefined,
      'someone/OtherLicense-GGUF': detail('someone/OtherLicense-GGUF', {
        cardData: { license: 'other' },
      }),
    });
    const { models, skipped } = await discoverModels(c, { today: '2026-09-02' });
    expect(models).toEqual([]);
    expect(skipped.map((s) => s.repo)).toEqual(trending.map((r) => r.id));
    // Cheap rejections never cost a detail read.
    expect(c.detailCalls).not.toContain('meta-llama/Llama-4-GGUF');
    expect(c.detailCalls).not.toContain('someone/Bad-Uncensored-GGUF');
  });

  it('unions trending and newest, seed wins a collision, and the cap holds', async () => {
    const trending = [repo('a/One-GGUF'), repo('a/Two-GGUF')];
    const newest = [repo('a/Two-GGUF'), repo('unsloth/Three-GGUF')];
    const details = Object.fromEntries(
      ['a/One-GGUF', 'a/Two-GGUF', 'unsloth/Three-GGUF'].map((id) => [id, detail(id)]),
    );
    const c = client(trending, newest, details);
    const { models, skipped } = await discoverModels(c, {
      today: '2026-09-02',
      reserved: new Set(['hf-a-one']),
      cap: 2,
    });
    expect(skipped.some((s) => s.repo === 'a/One-GGUF' && /seed/.test(s.reason))).toBe(true);
    // Trusted new drops shelve ahead of untrusted trending, so the unsloth
    // drop leads; a/One is reserved by the seed; a/Two fills the cap.
    expect(models.map((m) => m.id)).toEqual(['hf-unsloth-three', 'hf-a-two']);
  });

  it('newest axis is trusted publishers only; trending needs real downloads', async () => {
    const trending = [repo('a/Quiet-GGUF', { downloads: 3 }), repo('a/Loud-GGUF')];
    const newest = [repo('nobody/Fresh-GGUF'), repo('bartowski/Fresh2-GGUF')];
    const details = Object.fromEntries(
      ['a/Loud-GGUF', 'bartowski/Fresh2-GGUF'].map((id) => [id, detail(id)]),
    );
    const c = client(trending, newest, details);
    const { models, skipped } = await discoverModels(c, { today: '2026-09-02' });
    expect(models.map((m) => m.id)).toEqual(['hf-bartowski-fresh2', 'hf-a-loud']);
    expect(skipped.map((s) => s.repo)).toEqual(['a/Quiet-GGUF', 'nobody/Fresh-GGUF']);
    expect(c.detailCalls).toEqual(['bartowski/Fresh2-GGUF', 'a/Loud-GGUF']);
  });

  it('keeps one entry per underlying model across quantizers and imatrix twins', async () => {
    const trending = [
      repo('bartowski/Qwen3-8B-GGUF'),
      repo('mradermacher/Qwen3-8B-i1-GGUF'),
      repo('unsloth/Qwen3-8B-GGUF'),
      repo('mradermacher/Qwen3-8B-GGUF'),
    ];
    const details = Object.fromEntries(trending.map((r) => [r.id, detail(r.id)]));
    const { models, skipped } = await discoverModels(client(trending, [], details), {
      today: '2026-09-02',
    });
    expect(models.map((m) => m.id)).toEqual(['hf-bartowski-qwen3-8b']);
    expect(skipped).toHaveLength(3);
    expect(skipped.every((s) => /duplicate/.test(s.reason))).toBe(true);
  });

  it('rejects guardrail-removal spellings, speech models, and toy files', async () => {
    const trending = [
      repo('a/Qwen3-8B-OBLITERATED-GGUF'),
      repo('a/Llama-Unleashed-GGUF'),
      repo('a/Model-heretic-GGUF'),
      repo('a/mongolian-stt-asr-GGUF'),
      repo('a/Toy-GGUF'),
    ];
    const details = {
      'a/Toy-GGUF': detail('a/Toy-GGUF', {
        siblings: [{ rfilename: 'toy-Q4_K_M.gguf', size: 1e8 }],
      }),
    };
    const { models, skipped } = await discoverModels(client(trending, [], details), {
      today: '2026-09-02',
    });
    expect(models).toEqual([]);
    expect(skipped.map((s) => s.repo)).toEqual(trending.map((r) => r.id));
    expect(skipped[4]!.reason).toMatch(/too small/);
  });

  it('carries forward previous discoveries with their first-seen date', async () => {
    const c = client([repo('a/Fresh-GGUF')], [], { 'a/Fresh-GGUF': detail('a/Fresh-GGUF') });
    const first = await discoverModels(
      client([repo('a/Old-GGUF')], [], {
        'a/Old-GGUF': detail('a/Old-GGUF'),
      }),
      { today: '2026-08-01' },
    );
    const { models } = await discoverModels(c, { today: '2026-09-02', previous: first.models });
    expect(models.map((m) => m.id)).toEqual(['hf-a-fresh', 'hf-a-old']);
    expect(models[1]!.discovery?.foundAt).toBe('2026-08-01');
    expect(models[0]!.discovery?.foundAt).toBe('2026-09-02');
    // Ranks are re-laid in shelf order.
    expect(models.map((m) => m.curation.rank)).toEqual([1000, 1001]);
  });

  it('gives a small model a phone download straight from huggingface.co', async () => {
    const c = client([repo('a/Tiny-GGUF')], [], {
      'a/Tiny-GGUF': detail('a/Tiny-GGUF', {
        siblings: [{ rfilename: 'tiny-q4_k_m.gguf', size: 1.1e9 }],
      }),
    });
    const { models } = await discoverModels(c, { today: '2026-09-02' });
    expect(models[0]!.onDevice).toEqual({
      url: 'https://huggingface.co/a/Tiny-GGUF/resolve/main/tiny-q4_k_m.gguf',
      sizeGB: 1.1,
      minRamGB: 4,
    });
    expect(models[0]!.categories).toContain('fast');
  });

  it('survives a listing that throws', async () => {
    const c: DiscoveryClient = {
      list: async () => {
        throw new Error('rate limited');
      },
      detail: async () => undefined,
    };
    const { models } = await discoverModels(c, { today: '2026-09-02' });
    expect(models).toEqual([]);
  });
});

describe('discovery helpers', () => {
  it('pickGguf prefers Q4_K_M and ignores shards and projectors', () => {
    const files = [
      { rfilename: 'mmproj-Q4_K_M.gguf', size: 1 },
      { rfilename: 'm-Q8_0.gguf', size: 8 },
      { rfilename: 'm-Q4_K_M.gguf', size: 4 },
    ];
    expect(pickGguf(files)?.rfilename).toBe('m-Q4_K_M.gguf');
    expect(pickGguf([{ rfilename: 'm-Q8_0.gguf', size: 8 }])?.quant).toBe('Q8_0');
    expect(pickGguf([{ rfilename: 'm-IQ2_XS.gguf', size: 2 }])).toBeUndefined();
  });

  it('classify reads the name and tags', () => {
    expect(classify('a/Qwen3-Coder-30B-GGUF', [], 18)).toEqual(['coding']);
    expect(classify('a/nomic-embed-v2-GGUF', [], 0.3)).toEqual(['embedding']);
    expect(classify('a/Gemma-3-4b-it-GGUF', ['image-text-to-text'], 2.5)).toContain('vision');
    expect(classify('a/DeepSeek-R1-0528-Qwen3-8B-GGUF', [], 5)).toEqual(['reasoning', 'analysis']);
    expect(classify('a/SmolLM3-3B-GGUF', [], 1.9)).toEqual(['reasoning', 'fast']);
  });

  it('baseKey collapses quantizer and imatrix variants', () => {
    expect(baseKey('bartowski/Qwen3-8B-GGUF')).toBe('qwen3-8b');
    expect(baseKey('mradermacher/Qwen3-8B-i1-GGUF')).toBe('qwen3-8b');
    expect(baseKey('unsloth/Qwen3-8B-GGUF')).toBe('qwen3-8b');
    expect(baseKey('a/Spark-X2.5-4B-Q8_0-GGUF')).toBe('spark-x2-5-4b');
    expect(baseKey('a/Other-9B-GGUF')).not.toBe(baseKey('a/Other-27B-GGUF'));
  });

  it('slugId is stable and prefixed', () => {
    expect(slugId('bartowski/Qwen3-8B-GGUF')).toBe('hf-bartowski-qwen3-8b');
    expect(slugId('unsloth/gemma-3-4b-it-GGUF')).toBe('hf-unsloth-gemma-3-4b-it');
  });
});

describe('discovered models through the build', () => {
  const seedModel: CatalogModel = {
    id: 'qwen2.5-coder-7b',
    name: 'Qwen 2.5 Coder 7B',
    tagline: 'x',
    categories: ['coding', 'reasoning'],
    orchestratorCapable: true,
    source: {
      kind: 'ollama',
      ref: 'qwen2.5-coder:7b',
      pullCommand: 'ollama pull qwen2.5-coder:7b',
    },
    sizeGB: 4.7,
    quantization: 'Q4_K_M',
    contextTokens: 32768,
    license: { id: 'Apache-2.0', name: 'Apache License 2.0' },
    curation: { rank: 1, note: 'seed' },
    blessed: true,
  };

  it('enrich keeps a discovered model as unrated, and presets never name it', async () => {
    const c = client([repo('a/Coder-GGUF')], [], { 'a/Coder-GGUF': detail('a/Coder-GGUF') });
    const { models: found } = await discoverModels(c, { today: '2026-09-02' });
    const seed = { version: 1, updated: '2026-09-02', models: [seedModel, ...found], presets: [] };
    const { catalog, drops } = enrichCatalog({
      seed,
      metadata: {},
      benchmarks: {},
      evals: { 'qwen2.5-coder-7b': 0.9 },
      overlay: {},
    });
    expect(drops).toEqual([]);
    expect(() => CatalogSchema.parse(catalog)).not.toThrow();
    const discovered = catalog.models.find((m) => m.discovery);
    expect(discovered?.ratings).toBeUndefined();
    expect(discovered?.license.commercial).toBe('ok');
    const presets = derivePresets(catalog.models, { 'qwen2.5-coder-7b': 0.9 });
    for (const p of presets) {
      expect(p.stack.orchestrator).not.toBe(discovered!.id);
      expect(Object.values(p.stack.specialists)).not.toContain(discovered!.id);
    }
  });

  it('a discovered model that claims orchestrator is still dropped', () => {
    const bad: CatalogModel = {
      ...seedModel,
      id: 'hf-x',
      orchestratorCapable: true,
      blessed: false,
      discovery: { source: 'huggingface', repo: 'x/y', foundAt: '2026-09-02' },
    };
    const { drops } = enrichCatalog({
      seed: { version: 1, updated: '2026-09-02', models: [bad], presets: [] },
      metadata: {},
      benchmarks: {},
      evals: {},
      overlay: {},
    });
    expect(drops.map((d) => d.id)).toEqual(['hf-x']);
  });
});
