// The catalog schema. The marketplace is a CATALOG, not a weight host: a
// static JSON manifest OpenShore publishes, pointing at each model's own home
// (Ollama, Hugging Face, a GitHub release, Civitai, or the publisher's own
// site) with license flags. The client pulls weights straight from the
// source; OpenShore never rehosts or proxies them.
//
// Two files are published (the model library, 2026-10-12): `catalog.v2.json`,
// this schema, and `catalog.json`, the same catalog narrowed to the shape apps
// released before the library can read (scripts/build-catalog/v1.ts), since
// those apps reject a source kind or a category they do not know.
import { z } from 'zod';

/** Where a model's files come from. The kinds name the host family; every
 *  host a download may touch is on SOURCE_HOSTS and on the What leaves this
 *  device list (app/src/lib/egressManifest.ts), which a test holds together. */
export const SOURCE_KINDS = ['ollama', 'huggingface', 'github', 'civitai', 'publisher'] as const;

/** One file a model needs, fetched straight from its source. `dest` is where it
 *  goes inside its runtime's model folder (for ComfyUI, for example,
 *  `diffusion_models/flux1-schnell.safetensors`). */
export const CatalogFileSchema = z.object({
  url: z.string(),
  /** The SHA-256 the download must match. The builder fills it from the
   *  source (market/sources.ts, filePinned) and the downloader refuses a
   *  file without one. */
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  sizeGB: z.number().positive().optional(),
  dest: z.string(),
  /** The file's own license id (scripts/build-catalog/licenses.table.ts),
   *  when it is not the model's: a file from another repository must name
   *  one, or the builder drops its model (fileLicenses.ts). */
  license: z.string().optional(),
});

export const CatalogSourceSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
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
  /** The files to fetch, for a model that is not one Ollama pull (a ComfyUI
   *  model is a diffusion model, its text encoders and its VAE, for example).
   *  Absent for an Ollama model, whose `ref` is the whole download. */
  files: z.array(CatalogFileSchema).optional(),
});

/** How a model runs (os-code/src/market/library.ts, RUNTIME_INFO). Absent means
 *  Ollama, which is every entry from before the library. */
export const RuntimeEnum = z.enum(['ollama', 'comfyui', 'speech', 'separator', 'denoiser']);

/** What the runtime is told when the Stack calls this model: the ComfyUI
 *  workflow family it fills (and the file names in it), the speech server's
 *  model id and voice, audio-separator's model file, or DeepFilterNet's model.
 *  `install` is the runtime's own name for fetching it, where the runtime
 *  fetches its own files (a speech server's gallery id). */
export const CatalogRunnerSchema = z.object({
  /** A ComfyUI workflow OpenShore ships (os-code/src/media/graphs.ts). */
  graph: z.string().optional(),
  /** The runtime's own name for the model. */
  model: z.string().optional(),
  /** Files the workflow names, by the role each plays (`unet`, `clip`,
   *  `vae`, `lora`, `checkpoint`), so one workflow serves every size of a
   *  family. Plain file names, never paths. */
  files: z.record(z.string(), z.string()).optional(),
  /** The ComfyUI custom node pack the workflow needs beyond core, by name. */
  nodePack: z.string().optional(),
  /** True when every output carries the model's own watermark (a voice that
   *  copies a person's voice must). */
  watermark: z.boolean().optional(),
  /** A speech server's default voice. */
  voice: z.string().optional(),
  /** The runtime's own install name (LocalAI's gallery id, `localai@kokoro`). */
  install: z.string().optional(),
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
  /** The exact condition a `gated` license puts on commercial use (a revenue
   *  or user threshold, a use policy, attribution), in one plain sentence. */
  conditions: z.string().optional(),
  /** Text the license asks to be shown with the model or its output. */
  attribution: z.string().optional(),
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
  'image-edit',
  'video',
  'listen',
  'voice',
  'audio',
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
  /** How it runs; absent means Ollama. */
  runtime: RuntimeEnum.optional(),
  runner: CatalogRunnerSchema.optional(),
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
  /** A maintainer's editorial pick, merged from curation/recommended.json. */
  recommended: z
    .object({
      isRecommended: z.boolean(),
      note: z.string().optional(),
    })
    .optional(),
  /**
   * Community review aggregate, baked in by the daily builder from a snapshot of
   * the reviews backend (the scale path: a browse row shows a crowd star without
   * a per-view request to Supabase). It is the SEPARATE community axis, never the
   * benchmark ratings above, and always carries its count so it can never be read
   * as the measured score. A daily snapshot, not live: the product page still
   * fetches the live number when a reader taps in. Present only on models that
   * had visible reviews at snapshot time; absence means zero as of that day.
   * OPTIONAL for back-compat, and independent of `reviewsSnapshotAt`, which says
   * whether the snapshot ran at all.
   */
  community: z
    .object({
      count: z.number().int().min(0),
      average: z.number().min(0).max(5),
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

// One pick: the model, and one factual line on why it is the pick at its size.
export const LibraryPickSchema = z.object({
  model: z.string(),
  why: z.string(),
});

/** A shelf's picks, keyed by size class, so a shelf holds at most one model per
 *  size by its shape (os-code/src/market/library.ts). */
export const LibraryShelfPicksSchema = z.object({
  phone: LibraryPickSchema.optional(),
  laptop: LibraryPickSchema.optional(),
  workstation: LibraryPickSchema.optional(),
  server: LibraryPickSchema.optional(),
});

/** The model library: the curators' picks, by shelf id. The shelves, categories
 *  and collections themselves are product copy in library.ts. */
export const LibrarySchema = z.object({
  picks: z.record(z.string(), LibraryShelfPicksSchema),
});

export const CatalogSchema = z.object({
  version: z.number().int(),
  updated: z.string(),
  models: z.array(CatalogModelSchema),
  presets: z.array(CatalogPresetSchema),
  /** OPTIONAL: a catalog from before the library has none, and the app then
   *  shows the library bundled with it. */
  library: LibrarySchema.optional(),
  /** The day (YYYY-MM-DD) the community review aggregates on the models were
   *  snapshotted, set by the builder only when the reviews snapshot actually ran.
   *  Its PRESENCE is the signal that per-model `community` fields are complete as
   *  of that day, so the app can drive the browse list from them alone and skip
   *  the live per-view summary request entirely (the scale path). When absent
   *  (an older catalog, or a build with no reviews backend configured) the app
   *  falls back to the live browse RPC, exactly as before. OPTIONAL for
   *  back-compat: older catalogs and clients omit it. */
  reviewsSnapshotAt: z.string().optional(),
});

export type Catalog = z.infer<typeof CatalogSchema>;
export type CatalogModel = z.infer<typeof CatalogModelSchema>;
export type CatalogPreset = z.infer<typeof CatalogPresetSchema>;
export type CatalogFile = z.infer<typeof CatalogFileSchema>;
export type CatalogRunner = z.infer<typeof CatalogRunnerSchema>;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type Library = z.infer<typeof LibrarySchema>;
