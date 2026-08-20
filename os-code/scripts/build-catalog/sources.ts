// Metadata sources. Every HTTP fetch to Hugging Face and the Ollama library
// lives behind the MetadataSource interface, so the build can be unit-tested
// with fixtures and no live network. These fetchers read METADATA ONLY: id,
// downloads, likes, timestamps, tags, license tag. They never touch, download,
// or rehost weights. The pull still goes straight from the source at install
// time (src/market/install.ts), unchanged.
import type { MetadataSource, ModelMetadata } from './types.js';

/** Hugging Face model metadata via the public models API. GGUF-tagged repos.
 *  No auth: only public repos are read, and only their metadata. */
export class HuggingFaceSource implements MetadataSource {
  readonly kind = 'huggingface' as const;
  constructor(private readonly base = 'https://huggingface.co') {}

  async fetchMetadata(ref: string): Promise<ModelMetadata | undefined> {
    try {
      const res = await fetch(`${this.base}/api/models/${encodeURIComponent(ref)}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as {
        downloads?: number;
        likes?: number;
        createdAt?: string;
        lastModified?: string;
        tags?: string[];
        cardData?: { license?: string };
      };
      return {
        ref,
        source: 'huggingface',
        downloads: numberOrUndefined(body.downloads),
        likes: numberOrUndefined(body.likes),
        createdAt: body.createdAt,
        lastModified: body.lastModified,
        tags: body.tags,
        licenseTag: body.cardData?.license,
      };
    } catch {
      // A source hiccup degrades to no metadata (popularity and timestamps are
      // optional). It never fails the build.
      return undefined;
    }
  }
}

/** Ollama library metadata. The public library exposes model info without auth;
 *  we read the numbers only. */
export class OllamaSource implements MetadataSource {
  readonly kind = 'ollama' as const;
  constructor(private readonly base = 'https://ollama.com') {}

  async fetchMetadata(ref: string): Promise<ModelMetadata | undefined> {
    // The library groups by model name; a ref like "qwen2.5-coder:14b" keys off
    // the name before the tag.
    const name = ref.split(':')[0] ?? ref;
    try {
      const res = await fetch(`${this.base}/api/library/${encodeURIComponent(name)}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as {
        pulls?: number;
        downloads?: number;
        stars?: number;
        likes?: number;
        modified_at?: string;
        created_at?: string;
      };
      return {
        ref,
        source: 'ollama',
        downloads: numberOrUndefined(body.pulls ?? body.downloads),
        likes: numberOrUndefined(body.stars ?? body.likes),
        createdAt: body.created_at,
        lastModified: body.modified_at,
      };
    } catch {
      return undefined;
    }
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : undefined;
}

/**
 * Fetch metadata for a list of source refs across both sources, keyed by ref.
 * A source that fails to answer simply contributes nothing: the build goes on
 * with the optional fields omitted. This is the one function index.ts calls to
 * gather live metadata; the tests never reach it (they pass a fixture map).
 */
export async function gatherMetadata(
  refs: { ref: string; kind: 'huggingface' | 'ollama' }[],
  sources: { huggingface: MetadataSource; ollama: MetadataSource },
): Promise<Record<string, ModelMetadata>> {
  const out: Record<string, ModelMetadata> = {};
  await Promise.all(
    refs.map(async ({ ref, kind }) => {
      const meta = await sources[kind].fetchMetadata(ref);
      if (meta) out[ref] = meta;
    }),
  );
  return out;
}
