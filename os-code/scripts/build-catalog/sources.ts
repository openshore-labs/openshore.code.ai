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
 *  Reads only public repos and only their metadata. An HF_TOKEN in the
 *  environment is sent as a bearer credential to lift the anonymous rate limit;
 *  its absence keeps the anonymous behavior exactly as before. */
export class HuggingFaceSource implements MetadataSource {
  readonly kind = 'huggingface' as const;
  /** Base backoff for the one transient retry. A constructor knob so tests pass
   *  0 and do not sleep. */
  constructor(
    private readonly base = 'https://huggingface.co',
    private readonly retryBaseMs = 500,
  ) {}

  async fetchMetadata(ref: string): Promise<ModelMetadata | undefined> {
    // The repo id is "org/name". Encode each path SEGMENT, preserving the slash:
    // encoding the whole id turns "/" into "%2F" and 404s every lookup.
    const path = ref.split('/').map(encodeURIComponent).join('/');
    const url = `${this.base}/api/models/${path}`;
    const headers: Record<string, string> = { accept: 'application/json' };
    // MP-A-2: authenticate when HF_TOKEN is set. Anonymous stays the default.
    const token = process.env.HF_TOKEN?.trim();
    if (token) headers.authorization = `Bearer ${token}`;

    // One retry with a bounded, jittered backoff on a transient answer (429 or
    // 5xx). Any other non-ok status is a real miss (private or gone) and does
    // not retry. A thrown error (timeout, network) degrades to no metadata.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
        if (res.ok) {
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
        }
        if (attempt === 0 && isTransient(res.status)) {
          await sleep(this.retryBaseMs + Math.floor(Math.random() * this.retryBaseMs));
          continue;
        }
        return undefined;
      } catch {
        // A source hiccup degrades to no metadata (popularity and timestamps are
        // optional). It never fails the build.
        return undefined;
      }
    }
    return undefined;
  }
}

/** A transient HTTP status worth one retry: rate limiting or a server error. */
function isTransient(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  // MP-A-2: bound concurrency. Firing every ref at once via Promise.all trips
  // the anonymous rate limit on a large roster. A tiny inline worker pool, at
  // most MAX_IN_FLIGHT requests outstanding, keeps it dependency-free.
  const queue = [...refs];
  async function worker(): Promise<void> {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      const hfRef = item.kind === 'huggingface' ? item.ref : item.popularityRef;
      if (!hfRef) continue;
      attempted += 1;
      const meta = await sources.huggingface.fetchMetadata(hfRef);
      // Key by the model's own ref, not the HF repo it was read from.
      if (meta) out[item.ref] = { ...meta, ref: item.ref };
    }
  }
  const lanes = Math.min(MAX_IN_FLIGHT, refs.length);
  await Promise.all(Array.from({ length: lanes }, () => worker()));
  console.log(`popularity resolved ${Object.keys(out).length}/${attempted}`);
  return out;
}

/** At most this many HF metadata requests in flight at once. */
const MAX_IN_FLIGHT = 4;
