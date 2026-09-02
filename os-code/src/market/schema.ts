// The catalog schema. The marketplace is a CATALOG, not a weight host: a
// static JSON manifest OpenShore publishes, pointing at Hugging Face and
// Ollama with license flags. The client pulls weights straight from the
// source; OpenShore never rehosts or proxies them.
import { z } from 'zod';

export const CatalogSourceSchema = z.object({
  kind: z.enum(['ollama', 'huggingface']),
  /** The pullable reference, e.g. "qwen2.5-coder:14b" or an HF repo id. */
  ref: z.string(),
  /** The exact command a user runs to fetch it, shown before install. */
  pullCommand: z.string(),
  /** OPTIONAL, back-compat. For an Ollama-distributed model: the Hugging Face
   *  GGUF repo id to read popularity from, since Ollama has no public JSON
   *  popularity API. Omitting it just means the model carries no popularity
   *  number (never a fabricated one). Ignored for HF-distributed models, which
   *  read their own ref. */
  popularityRef: z.string().optional(),
});

export const CatalogLicenseSchema = z.object({
  id: z.string(), // SPDX-ish id, e.g. "Apache-2.0", "Llama-3.1-Community"
  name: z.string(),
  url: z.string().optional(),
  /** One honest sentence: commercial use, restrictions, gotchas. */
  note: z.string().optional(),
  /** The machine-known commercial posture, published by the builder from the
   *  SPDX allow-list. OPTIONAL for back-compat: older catalogs omit it and the
   *  client falls back to its own id-to-posture table. */
  commercial: z.enum(['ok', 'non-commercial', 'gated']).optional(),
});

// The capability taxonomy (router/roles.ts). Promoted to a shared const so the
// categories field and the ratings map agree and cannot drift.
export const CapabilityEnum = z.enum([
  'reasoning',
  'coding',
  'writing',
  'analysis',
  'vision',
  'image-gen',
  'embedding',
  'fast',
]);

// A 0..5 star, in 0.5 steps. n*2 is exact for halves, so the integer check is
// safe. Ratings are computed by the server-side builder from benchmarks + the
// local eval, never crowd-sourced, and every star is provenance-backed.
const StarSchema = z
  .number()
  .min(0)
  .max(5)
  .refine((n) => Number.isInteger(n * 2), { message: 'stars must be in 0.5 steps' });

export const CatalogModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Plain language: what this model is good at, no benchmark names. */
  tagline: z.string(),
  /** Standard capability categories (router/roles.ts taxonomy). */
  categories: z.array(CapabilityEnum),
  /** May this model serve as the mandatory reasoning orchestrator? */
  orchestratorCapable: z.boolean(),
  source: CatalogSourceSchema,
  sizeGB: z.number().positive(),
  quantization: z.string(),
  contextTokens: z.number().int().positive(),
  license: CatalogLicenseSchema,
  curation: z.object({
    rank: z.number().int().min(1),
    note: z.string(),
  }),
  /** True when the eval harness blessed this exact profile. */
  blessed: z.boolean().default(false),
  /** Benchmark detail, one keystroke away in the picker, never the headline. */
  benchmarks: z.record(z.string(), z.string()).optional(),
  /**
   * Set when this model can run ON the phone: a direct, public GGUF download
   * (straight from the source, never rehosted) the iOS app pulls in-app.
   */
  onDevice: z
    .object({
      /** Direct GGUF URL (Hugging Face resolve link, public, no auth). */
      url: z.string(),
      sizeGB: z.number().positive(),
      /** Honest floor: phones under this RAM will struggle or crash. */
      minRamGB: z.number().positive(),
    })
    .optional(),

  /**
   * Set when the builder found this model on its own (live discovery of newly
   * released GGUF repos), rather than from the editorial seed. Discovered
   * models carry no ratings and no eval, so the UI labels them new and
   * unrated instead of rated. OPTIONAL: older catalogs and clients omit it.
   */
  discovery: z
    .object({
      source: z.enum(['huggingface']),
      /** The source repo id the entry was built from, e.g. "org/name-GGUF". */
      repo: z.string(),
      /** The day the builder first saw it (YYYY-MM-DD), carried forward. */
      foundAt: z.string(),
    })
    .optional(),

  // ---- Builder-computed fields (all OPTIONAL for backward compatibility) ----
  // Old clients strip these; the bundled sample (which has none) still
  // validates. Populated only by the server-side catalog builder.

  /** Capability ratings, computed from published benchmarks + the local eval.
   *  perCapability is SPARSE (only categories the model targets): it MUST be a
   *  partialRecord, not a record, or zod 4 would require every category key. */
  ratings: z
    .object({
      perCapability: z.partialRecord(CapabilityEnum, StarSchema),
      /** Fit as an OS Code orchestrator/tool-user, from the local eval average. */
      osCodeFit: StarSchema,
      /** Which benchmark(s) produced each star, so the UI can show provenance. */
      provenance: z.partialRecord(CapabilityEnum, z.array(z.string()).nonempty()),
    })
    .optional(),
  /** Source popularity (numbers only; weights are never touched). A SORT input,
   *  labelled as popularity, not quality. */
  popularity: z
    .object({
      downloads: z.number().int().min(0),
      likes: z.number().int().min(0),
      source: z.enum(['huggingface', 'ollama']),
    })
    .optional(),
  /** ISO timestamps from source metadata. Plain strings on purpose: a weird
   *  format degrades (ignored) rather than rejecting the whole catalog. */
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  /** The founder's editorial pick, merged from curation/recommended.json. */
  recommended: z
    .object({
      isRecommended: z.boolean(),
      note: z.string().optional(),
    })
    .optional(),
});

export const CatalogPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Plain language pitch, e.g. "a good coding setup". */
  tagline: z.string(),
  minVramGB: z.number().min(0),
  stack: z.object({
    orchestrator: z.string(), // catalog model id
    specialists: z
      .object({
        coding: z.string().optional(),
        vision: z.string().optional(),
        embedding: z.string().optional(),
        fast: z.string().optional(),
      })
      .prefault({}),
  }),
});

export const CatalogSchema = z.object({
  version: z.number().int(),
  updated: z.string(),
  models: z.array(CatalogModelSchema),
  presets: z.array(CatalogPresetSchema),
});

export type Catalog = z.infer<typeof CatalogSchema>;
export type CatalogModel = z.infer<typeof CatalogModelSchema>;
export type CatalogPreset = z.infer<typeof CatalogPresetSchema>;
