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
});

export const CatalogLicenseSchema = z.object({
  id: z.string(), // SPDX-ish id, e.g. "Apache-2.0", "Llama-3.1-Community"
  name: z.string(),
  url: z.string().optional(),
  /** One honest sentence: commercial use, restrictions, gotchas. */
  note: z.string().optional(),
});

export const CatalogModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Plain language: what this model is good at, no benchmark names. */
  tagline: z.string(),
  /** Standard capability categories (router/roles.ts taxonomy). */
  categories: z.array(z.enum(['reasoning', 'coding', 'writing', 'analysis', 'vision', 'image-gen', 'embedding', 'fast'])),
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
