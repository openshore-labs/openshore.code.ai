// Metadata sources. Every HTTP fetch to Hugging Face lives behind the
// MetadataSource interface, so the build can be unit-tested with fixtures and
// no live network. These fetchers read METADATA ONLY: id, downloads, likes,
// timestamps, tags, license tag. They never touch, download, or rehost weights.
// The pull still goes straight from the source at install time
// (src/market/install.ts), unchanged.
//
// Popularity is Hugging Face only, on purpose. Ollama has no public JSON
// popularity API, so an Ollama-distributed model reads its number from its
// equivalent HF GGUF home (named by source.popularityRef). One consistent,
// HF-API-backed number, and no invented Ollama endpoint.
import type { MetadataSource, ModelMetadata } from './types.js';

/** Hugging Face model metadata via the public models API. GGUF-tagged repos.
 *  No auth: only public repos are read, and only their metadata. */
export class HuggingFaceSource implements MetadataSource {
  readonly kind = 'huggingface' as const;
  constructor(private readonly base = 'https://huggingface.co') {}

  async fetchMetadata(ref: string): Promise<ModelMetadata | undefined> {
    // The repo id is "org/name". Encode each path SEGMENT, preserving the slash:
    // encoding the whole id turns "/" into "%2F" and 404s every lookup.
    const path = ref.split('/').map(encodeURIComponent).join('/');
    try {
      const res = await fetch(`${this.base}/api/models/${path}`, {
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

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : undefined;
}

/** One source ref to resolve. An HF-distributed model reads its own ref; an
 *  Ollama-distributed model reads the HF GGUF home named by popularityRef, and
 *  without one it simply carries no popularity (omitted, never fabricated). */
export interface SourceRef {
  ref: string;
  kind: 'huggingface' | 'ollama';
  /** For an Ollama model: the HF repo id to read popularity from. */
  popularityRef?: string;
}

/**
 * Fetch metadata for a list of source refs, keyed by each model's OWN ref (so
 * enrich.ts finds it via base.source.ref, whichever HF repo the number came
 * from). Popularity is Hugging Face only: HF models read their ref, Ollama
 * models read popularityRef, and an Ollama model with no popularityRef is
 * skipped rather than fabricated. A ref that fails to answer contributes
 * nothing; the build goes on with the optional fields omitted.
 *
 * Logs `popularity resolved N/M` so a silent-empty run is visible in the build
 * log (Bug C: a swallowed failure must not look identical to "no entry").
 * This is the one function index.ts calls to gather live metadata; the tests
 * inject a fixture HF source, so no live fetch runs in the suite.
 */
export async function gatherMetadata(
  refs: SourceRef[],
  sources: { huggingface: MetadataSource },
): Promise<Record<string, ModelMetadata>> {
  const out: Record<string, ModelMetadata> = {};
  // How many refs even have a Hugging Face home to try. An Ollama model with no
  // popularityRef is not "attempted" (it has no honest source), so it does not
  // drag the resolved/attempted ratio down.
  let attempted = 0;
  await Promise.all(
    refs.map(async ({ ref, kind, popularityRef }) => {
      const hfRef = kind === 'huggingface' ? ref : popularityRef;
      if (!hfRef) return;
      attempted += 1;
      const meta = await sources.huggingface.fetchMetadata(hfRef);
      // Key by the model's own ref, not the HF repo it was read from.
      if (meta) out[ref] = { ...meta, ref };
    }),
  );
  console.log(`popularity resolved ${Object.keys(out).length}/${attempted}`);
  return out;
}
