// Model families: the browse axis a person actually thinks in. "Qwen", "Llama",
// "Gemma", not a flat heap of one hundred and seventy sizes and quantizations.
// The catalog carries no family field, so a family is DERIVED here from a
// model's id, name, and source ref against a small ordered table, with a
// first-word fallback so a model from a maker we have not listed still lands
// somewhere sensible instead of vanishing. Pure, no React, unit-tested.
import type { CatalogModel } from 'os-code/protocol';

export interface FamilyInfo {
  /** Stable key, used for focus state and test pins. */
  id: string;
  /** The display name. */
  name: string;
  /** Who makes it. */
  maker: string;
  /** One honest line: what the family is known for. Empty for a derived
   *  family we have no editorial line for. */
  blurb: string;
}

interface FamilyRule extends FamilyInfo {
  /** Matched against the lowercased "id name ref" haystack. Order matters:
   *  the first rule that matches wins, so specific names (Ministral, Devstral)
   *  sit above the general one (Mistral) that would also match. */
  match: RegExp;
}

// Editorial order. The families most people come for lead; the rail keeps
// this order for known families and appends derived ones alphabetically.
const FAMILY_RULES: FamilyRule[] = [
  // Distills name their base model ("DeepSeek R1 Distill Llama 8B"), so the
  // distiller is tested before the bases it borrows names from.
  {
    id: 'deepseek',
    name: 'DeepSeek',
    maker: 'DeepSeek',
    blurb: 'Reasoning models that think step by step before they answer.',
    match: /deepseek/,
  },
  {
    id: 'qwen',
    name: 'Qwen',
    maker: 'Alibaba',
    blurb: 'The strongest small models for code and reasoning right now, at every size.',
    match: /\bqwen|\bqwq\b/,
  },
  {
    id: 'llama',
    name: 'Llama',
    maker: 'Meta',
    blurb: 'Solid all-rounders with the biggest ecosystem of fine-tunes.',
    match: /\bllama(?!va)|\bllama-?3/,
  },
  {
    id: 'gemma',
    name: 'Gemma',
    maker: 'Google',
    blurb: 'Tuned for writing and reading images. The E sizes are built for phones.',
    match: /gemma/,
  },
  {
    id: 'mistral',
    name: 'Mistral',
    maker: 'Mistral AI',
    blurb: 'Efficient models from Paris, strong at code and reasoning for their size.',
    match: /mistral|ministral|magistral|devstral|codestral|pixtral|mixtral/,
  },
  {
    id: 'phi',
    name: 'Phi',
    maker: 'Microsoft',
    blurb: 'Small models trained on textbook-quality data. They punch above their size.',
    match: /\bphi-?\d|\bphi\b/,
  },
  {
    id: 'granite',
    name: 'Granite',
    maker: 'IBM',
    blurb: 'Enterprise models: conservative, well documented, commercial friendly.',
    match: /granite/,
  },
  {
    id: 'smollm',
    name: 'SmolLM',
    maker: 'Hugging Face',
    blurb: 'Tiny models made for phones and laptops.',
    match: /smollm|smol-?lm/,
  },
  {
    id: 'minicpm',
    name: 'MiniCPM',
    maker: 'OpenBMB',
    blurb: 'A phone-first family that is unusually good at reading images.',
    match: /minicpm|bitcpm|agentcpm/,
  },
  {
    id: 'glm',
    name: 'GLM',
    maker: 'Zhipu',
    blurb: 'Strong reasoning at every size.',
    match: /\bglm/,
  },
  {
    id: 'gpt-oss',
    name: 'gpt-oss',
    maker: 'OpenAI',
    blurb: 'Open-weight reasoning models.',
    match: /gpt-?oss/,
  },
  {
    id: 'olmo',
    name: 'OLMo',
    maker: 'Ai2',
    blurb: 'Fully open models: weights, data, and training all published.',
    match: /\bolmo/,
  },
  {
    id: 'internlm',
    name: 'InternLM',
    maker: 'Shanghai AI Lab',
    blurb: 'Research models with strong long-context work.',
    match: /internlm|intern-?vl|caprl/,
  },
  {
    id: 'moondream',
    name: 'Moondream',
    maker: 'Moondream',
    blurb: 'A tiny model that reads screenshots.',
    match: /moondream/,
  },
  {
    id: 'llava',
    name: 'LLaVA',
    maker: 'LLaVA',
    blurb: 'The original open model that reads images.',
    match: /llava/,
  },
  {
    id: 'nomic',
    name: 'Nomic Embed',
    maker: 'Nomic',
    blurb: 'Embedding models that find files by meaning.',
    match: /nomic/,
  },
  {
    id: 'jina',
    name: 'Jina Embeddings',
    maker: 'Jina',
    blurb: 'Embedding models for search and retrieval.',
    match: /jina/,
  },
  {
    id: 'yi',
    name: 'Yi',
    maker: '01.AI',
    blurb: 'Bilingual models with a good coder.',
    match: /\byi-|\byi\b/,
  },
  {
    id: 'arcee',
    name: 'Arcee',
    maker: 'Arcee',
    blurb: 'Merged and distilled models tuned for specific jobs.',
    match: /arcee|supernova|virtuoso|homunculus|\bcaller\b/,
  },
  {
    id: 'step',
    name: 'Step',
    maker: 'StepFun',
    blurb: 'Reasoning and vision models.',
    match: /\bstep-?\d|stepfun/,
  },
  {
    id: 'jamba',
    name: 'Jamba',
    maker: 'AI21',
    blurb: 'Hybrid models with very long memory.',
    match: /jamba|ai21/,
  },
  {
    id: 'danube',
    name: 'Danube',
    maker: 'H2O.ai',
    blurb: 'Small open models for phones.',
    match: /danube|h2o/,
  },
  {
    id: 'ling',
    name: 'Ling',
    maker: 'inclusionAI',
    blurb: 'Efficient mixture-of-experts models.',
    match: /\bling-|\bring-|inclusionai|armorocr/,
  },
  {
    id: 'baichuan',
    name: 'Baichuan',
    maker: 'Baichuan',
    blurb: 'Large bilingual models.',
    match: /baichuan/,
  },
];

const KNOWN_ORDER = new Map(FAMILY_RULES.map((r, i) => [r.id, i]));

function haystack(model: CatalogModel): string {
  return `${model.id} ${model.name} ${model.source.ref}`.toLowerCase();
}

/** The family a model belongs to. A known maker resolves from the table; any
 *  other model derives a family from the first alphabetic word of its name,
 *  so nothing is ever left out of the family browse. */
export function familyOf(model: CatalogModel): FamilyInfo {
  const hay = haystack(model);
  for (const rule of FAMILY_RULES) {
    if (rule.match.test(hay)) {
      const { match: _match, ...info } = rule;
      return info;
    }
  }
  const word = model.name.split(/\s+/).find((w) => /^[a-z]/i.test(w)) ?? model.name;
  const clean = word.replace(/[^a-z0-9.-]/gi, '');
  const name = clean.charAt(0).toUpperCase() + clean.slice(1);
  return { id: `other-${clean.toLowerCase()}`, name, maker: '', blurb: '' };
}

export interface FamilyGroup extends FamilyInfo {
  models: CatalogModel[];
  /** How many of these run on the phone (carry an on-device build). */
  phoneCount: number;
}

/** Group a catalog into families, known makers first in editorial order, then
 *  derived families alphabetically. Empty families never appear. */
export function groupByFamily(models: CatalogModel[]): FamilyGroup[] {
  const groups = new Map<string, FamilyGroup>();
  for (const m of models) {
    const fam = familyOf(m);
    let g = groups.get(fam.id);
    if (!g) {
      g = { ...fam, models: [], phoneCount: 0 };
      groups.set(fam.id, g);
    }
    g.models.push(m);
    if (m.onDevice) g.phoneCount++;
  }
  return [...groups.values()].sort((a, b) => {
    const ka = KNOWN_ORDER.get(a.id);
    const kb = KNOWN_ORDER.get(b.id);
    if (ka !== undefined && kb !== undefined) return ka - kb;
    if (ka !== undefined) return -1;
    if (kb !== undefined) return 1;
    return a.name.localeCompare(b.name);
  });
}

/** The parameter count a name states ("Qwen 2.5 Coder 7B" is 7, "gemma 4 E4B"
 *  is 4, "0.6B" is 0.6), or undefined when the name does not say. Used to
 *  order a family's sizes smallest first even when file sizes tie. */
export function statedParamsB(name: string): number | undefined {
  const m = /(?:^|[\s-])e?(\d+(?:\.\d+)?)\s?b\b/i.exec(name);
  return m ? Number(m[1]) : undefined;
}

/** A family's models, smallest first: by stated parameter count, then by file
 *  size, then by name, so the page reads as a size ladder. */
export function bySizeAscending(models: CatalogModel[]): CatalogModel[] {
  return [...models].sort((a, b) => {
    const pa = statedParamsB(a.name) ?? Number.POSITIVE_INFINITY;
    const pb = statedParamsB(b.name) ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    if (a.sizeGB !== b.sizeGB) return a.sizeGB - b.sizeGB;
    return a.name.localeCompare(b.name);
  });
}
