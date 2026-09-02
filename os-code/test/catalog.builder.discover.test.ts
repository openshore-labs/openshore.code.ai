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

/** One discovered model built through the real path, for previous-catalog fixtures. */
async function one(id: string): Promise<CatalogModel> {
  const { models } = await discoverModels(client([repo(id)], [], { [id]: detail(id) }), {
    today: '2026-09-02',
  });
  return models[0]!;
}
const disc = (repo: string, foundAt: string) => ({
  source: 'huggingface' as const,
  repo,
  foundAt,
});

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
      repo('unsloth/secret-GGUF', { private: true }),
      repo('unsloth/NoLicense-GGUF'),
      repo('unsloth/Bad-Uncensored-GGUF'),
      repo('unsloth/Sharded-GGUF'),
      repo('unsloth/Vanished-GGUF'),
      repo('unsloth/OtherLicense-GGUF'),
    ];
    const c = client(trending, [], {
      'unsloth/NoLicense-GGUF': detail('unsloth/NoLicense-GGUF', { cardData: {} }),
      'unsloth/Sharded-GGUF': detail('unsloth/Sharded-GGUF', {
        siblings: [{ rfilename: 'x-Q4_K_M-00001-of-00002.gguf', size: 2e9 }],
      }),
      'unsloth/Vanished-GGUF': undefined,
      'unsloth/OtherLicense-GGUF': detail('unsloth/OtherLicense-GGUF', {
        cardData: { license: 'other' },
      }),
    });
    const { models, skipped } = await discoverModels(c, { today: '2026-09-02' });
    expect(models).toEqual([]);
    expect(skipped.map((s) => s.repo)).toEqual(trending.map((r) => r.id));
    // Cheap rejections never cost a detail read.
    expect(c.detailCalls).not.toContain('meta-llama/Llama-4-GGUF');
    expect(c.detailCalls).not.toContain('unsloth/Bad-Uncensored-GGUF');
  });

  it('unions trending and newest, seed wins a collision, and the cap holds', async () => {
    const trending = [repo('unsloth/One-GGUF'), repo('unsloth/Two-GGUF')];
    const newest = [repo('unsloth/Two-GGUF'), repo('unsloth/Three-GGUF')];
    const details = Object.fromEntries(
      ['unsloth/One-GGUF', 'unsloth/Two-GGUF', 'unsloth/Three-GGUF'].map((id) => [id, detail(id)]),
    );
    const c = client(trending, newest, details);
    const { models, skipped } = await discoverModels(c, {
      today: '2026-09-02',
      reserved: new Set(['hf-unsloth-one']),
      cap: 2,
    });
    expect(skipped.some((s) => s.repo === 'unsloth/One-GGUF' && /seed/.test(s.reason))).toBe(true);
    // One is reserved by the seed; trending Two leads, new drop Three fills the cap.
    expect(models.map((m) => m.id)).toEqual(['hf-unsloth-two', 'hf-unsloth-three']);
  });

  it('both axes are trusted publishers only; trending also needs real downloads', async () => {
    const trending = [
      repo('unsloth/Quiet-GGUF', { downloads: 3 }),
      repo('nobody/Open-GGUF', { downloads: 50000 }),
      repo('unsloth/Loud-GGUF'),
    ];
    const newest = [repo('nobody/Fresh-GGUF'), repo('bartowski/Fresh2-GGUF')];
    const details = Object.fromEntries(
      ['unsloth/Loud-GGUF', 'bartowski/Fresh2-GGUF'].map((id) => [id, detail(id)]),
    );
    const c = client(trending, newest, details);
    const { models, skipped } = await discoverModels(c, { today: '2026-09-02' });
    // Trusted trending leads, trusted new drops follow.
    expect(models.map((m) => m.id)).toEqual(['hf-unsloth-loud', 'hf-bartowski-fresh2']);
    expect(skipped.map((s) => s.repo)).toEqual([
      'unsloth/Quiet-GGUF',
      'nobody/Open-GGUF',
      'nobody/Fresh-GGUF',
    ]);
    expect(skipped[1]!.reason).toMatch(/unlisted publisher/);
    // Unlisted publishers never cost a detail read.
    expect(c.detailCalls).toEqual(['unsloth/Loud-GGUF', 'bartowski/Fresh2-GGUF']);
  });

  it('keeps one entry per underlying model across quantizers and imatrix twins', async () => {
    const trending = [
      repo('bartowski/Qwen3-8B-GGUF'),
      repo('quantfactory/Qwen3-8B-i1-GGUF'),
      repo('unsloth/Qwen3-8B-GGUF'),
      repo('quantfactory/Qwen3-8B-GGUF'),
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
      repo('unsloth/Qwen3-8B-OBLITERATED-GGUF'),
      repo('unsloth/Llama-Unleashed-GGUF'),
      repo('unsloth/Model-heretic-GGUF'),
      repo('unsloth/mongolian-stt-asr-GGUF'),
      repo('unsloth/Toy-GGUF'),
    ];
    const details = {
      'unsloth/Toy-GGUF': detail('unsloth/Toy-GGUF', {
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

  it('re-applies the bar to carried entries, so a tightened bar cleans the shelf', async () => {
    const keep = await one('unsloth/Keep-GGUF');
    const previous: CatalogModel[] = [
      { ...keep, discovery: disc('unsloth/Keep-GGUF', '2026-08-01') },
      // Shelved under yesterday's bar; today's denylist rejects it.
      {
        ...keep,
        id: 'hf-unsloth-old-obliterated',
        discovery: disc('unsloth/Old-OBLITERATED-GGUF', '2026-08-02'),
      },
      // An imatrix twin of Keep, from another quantizer.
      {
        ...keep,
        id: 'hf-quantfactory-keep-i1',
        discovery: disc('quantfactory/Keep-i1-GGUF', '2026-08-03'),
      },
    ];
    const { models, skipped } = await discoverModels(client([], [], {}), {
      today: '2026-09-02',
      previous,
    });
    // Carried entries are considered newest sighting first, so the i1 twin
    // (seen 08-03) holds the "keep" slot and the 08-01 original is its duplicate.
    expect(models.map((m) => m.discovery?.repo)).toEqual(['quantfactory/Keep-i1-GGUF']);
    expect(skipped.map((s) => s.reason)).toEqual([
      'carried entry dropped: name contains "obliterated"',
      'carried entry dropped: duplicate of an earlier upload (keep)',
    ]);
  });

  it('carries forward previous discoveries with their first-seen date', async () => {
    const c = client([repo('unsloth/Fresh-GGUF')], [], {
      'unsloth/Fresh-GGUF': detail('unsloth/Fresh-GGUF'),
    });
    const first = await discoverModels(
      client([repo('unsloth/Old-GGUF')], [], {
        'unsloth/Old-GGUF': detail('unsloth/Old-GGUF'),
      }),
      { today: '2026-08-01' },
    );
    const { models } = await discoverModels(c, { today: '2026-09-02', previous: first.models });
    expect(models.map((m) => m.id)).toEqual(['hf-unsloth-fresh', 'hf-unsloth-old']);
    expect(models[1]!.discovery?.foundAt).toBe('2026-08-01');
    expect(models[0]!.discovery?.foundAt).toBe('2026-09-02');
    // Ranks are re-laid in shelf order.
    expect(models.map((m) => m.curation.rank)).toEqual([1000, 1001]);
  });

  it('gives a small model a phone download straight from huggingface.co', async () => {
    const c = client([repo('unsloth/Tiny-GGUF')], [], {
      'unsloth/Tiny-GGUF': detail('unsloth/Tiny-GGUF', {
        siblings: [{ rfilename: 'tiny-q4_k_m.gguf', size: 1.1e9 }],
      }),
    });
    const { models } = await discoverModels(c, { today: '2026-09-02' });
    expect(models[0]!.onDevice).toEqual({
      url: 'https://huggingface.co/unsloth/Tiny-GGUF/resolve/main/tiny-q4_k_m.gguf',
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
    expect(classify('unsloth/Qwen3-Coder-30B-GGUF', [], 18)).toEqual(['coding']);
    expect(classify('unsloth/nomic-embed-v2-GGUF', [], 0.3)).toEqual(['embedding']);
    expect(classify('unsloth/Gemma-3-4b-it-GGUF', ['image-text-to-text'], 2.5)).toContain('vision');
    expect(classify('unsloth/DeepSeek-R1-0528-Qwen3-8B-GGUF', [], 5)).toEqual([
      'reasoning',
      'analysis',
    ]);
    expect(classify('unsloth/SmolLM3-3B-GGUF', [], 1.9)).toEqual(['reasoning', 'fast']);
  });

  it('baseKey collapses quantizer and imatrix variants', () => {
    expect(baseKey('bartowski/Qwen3-8B-GGUF')).toBe('qwen3-8b');
    expect(baseKey('quantfactory/Qwen3-8B-i1-GGUF')).toBe('qwen3-8b');
    expect(baseKey('unsloth/Qwen3-8B-GGUF')).toBe('qwen3-8b');
    expect(baseKey('unsloth/Spark-X2.5-4B-Q8_0-GGUF')).toBe('spark-x2-5-4b');
    expect(baseKey('unsloth/Other-9B-GGUF')).not.toBe(baseKey('unsloth/Other-27B-GGUF'));
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
    const c = client([repo('unsloth/Coder-GGUF')], [], {
      'unsloth/Coder-GGUF': detail('unsloth/Coder-GGUF'),
    });
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
