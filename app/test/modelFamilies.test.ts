// Family derivation is the browse axis the store front leads with, so a wrong
// family is a mis-shelving a person sees. These pin the makers that matter,
// the ordering rules, the first-word fallback, and the size ladder.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CatalogModel } from 'os-code/protocol';
import {
  bySizeAscending,
  familyOf,
  groupByFamily,
  statedParamsB,
} from '../src/components/modelFamilies.js';

function model(over: Partial<CatalogModel> & { id: string; name: string }): CatalogModel {
  return {
    tagline: 'A test model.',
    categories: ['coding'],
    orchestratorCapable: false,
    source: { kind: 'ollama', ref: `${over.id}:7b`, pullCommand: `ollama pull ${over.id}:7b` },
    sizeGB: 4,
    quantization: 'Q4_K_M',
    contextTokens: 32768,
    license: { id: 'Apache-2.0', name: 'Apache License 2.0' },
    curation: { rank: 1, note: 'test' },
    blessed: false,
    ...over,
  } as CatalogModel;
}

const seed = JSON.parse(
  readFileSync(join(process.cwd(), '..', 'os-code', 'catalog.sample.json'), 'utf8'),
) as { models: CatalogModel[] };

describe('familyOf', () => {
  it('resolves the makers that matter', () => {
    const cases: [string, string][] = [
      ['Qwen 2.5 Coder 7B', 'qwen'],
      ['Qwen3 4B (pocket)', 'qwen'],
      ['Llama 3.1 8B', 'llama'],
      ['Meta Llama 3.1 8B Instruct', 'llama'],
      ['gemma 4 E4B it', 'gemma'],
      ['Ministral 3 3B Instruct 2512', 'mistral'],
      ['Devstral Small 2507', 'mistral'],
      ['Phi 4 mini instruct', 'phi'],
      ['DeepSeek R1 Distill Llama 8B', 'deepseek'],
      ['granite 4.2 3b', 'granite'],
      ['SmolLM2 1.7B (pocket)', 'smollm'],
      ['MiniCPM V 4.6', 'minicpm'],
      ['gpt oss 20b', 'gpt-oss'],
      ['Moondream 2', 'moondream'],
      ['LLaVA 7B', 'llava'],
      ['Nomic Embed Text', 'nomic'],
    ];
    for (const [name, id] of cases) {
      expect(familyOf(model({ id: name.toLowerCase().replace(/\s+/g, '-'), name })).id, name).toBe(
        id,
      );
    }
  });

  it('LLaVA never reads as Llama, and DeepSeek distills stay DeepSeek', () => {
    expect(familyOf(model({ id: 'llava-7b', name: 'LLaVA 7B' })).id).toBe('llava');
    expect(familyOf(model({ id: 'x', name: 'DeepSeek R1 Distill Qwen 32B' })).id).toBe('deepseek');
  });

  it('an unlisted maker derives a family from the first word, never disappears', () => {
    const fam = familyOf(model({ id: 'x', name: 'Ateron Deep Thoughts 31B' }));
    expect(fam.id).toBe('other-ateron');
    expect(fam.name).toBe('Ateron');
    expect(fam.blurb).toBe('');
  });

  it('every seed model lands in a family', () => {
    for (const m of seed.models) expect(familyOf(m).name, m.id).toBeTruthy();
  });
});

describe('groupByFamily', () => {
  it('orders known makers editorially, derived ones alphabetically after, and counts phone builds', () => {
    const groups = groupByFamily([
      model({ id: 'z', name: 'Zeta 7B' }),
      model({ id: 'g', name: 'Gemma 2 9B' }),
      model({ id: 'a', name: 'Alpha 3B' }),
      model({
        id: 'q1',
        name: 'Qwen 2.5 1.5B (pocket)',
        onDevice: { url: 'https://x/y.gguf', sizeGB: 1.1, minRamGB: 4 },
      }),
      model({ id: 'q2', name: 'Qwen 2.5 Coder 7B' }),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['qwen', 'gemma', 'other-alpha', 'other-zeta']);
    expect(groups[0]!.models).toHaveLength(2);
    expect(groups[0]!.phoneCount).toBe(1);
    expect(groups[1]!.phoneCount).toBe(0);
  });

  it('never emits an empty family', () => {
    expect(groupByFamily([])).toEqual([]);
  });
});

describe('size ladder', () => {
  it('reads the stated parameter count out of a name', () => {
    expect(statedParamsB('Qwen 2.5 Coder 7B')).toBe(7);
    expect(statedParamsB('gemma 4 E4B it')).toBe(4);
    expect(statedParamsB('Qwen3 0.6B')).toBe(0.6);
    expect(statedParamsB('Qwen3.5 122B A10B')).toBe(122);
    expect(statedParamsB('Moondream 2')).toBeUndefined();
  });

  it('orders a family smallest first, by parameters then file size, unnamed sizes last', () => {
    const sorted = bySizeAscending([
      model({ id: 'b', name: 'Qwen 2.5 Coder 14B', sizeGB: 9 }),
      model({ id: 'a', name: 'Qwen 2.5 Coder 1.5B', sizeGB: 1 }),
      model({ id: 'x', name: 'Qwen Image Edit', sizeGB: 13 }),
      model({ id: 'c', name: 'Qwen 2.5 Coder 7B', sizeGB: 4.7 }),
    ]);
    expect(sorted.map((m) => m.id)).toEqual(['a', 'c', 'b', 'x']);
  });
});
