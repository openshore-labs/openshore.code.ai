// Perplexity Sonar as a search backend, the engine-side twin of the app's
// Research toggle. Sonar is search-grounded: it runs a live web search and
// returns both a synthesized answer and its sources; we take the sources here,
// mapped to the same {title, url, snippet} shape as every other backend. Needs
// a key (search.perplexityKeyEnv names the env var), and the key stays on this
// machine, read from the environment like Brave and Tavily, never carried into
// a session that runs on a remote hub (the CTO ruling on provider keys). Sonar
// returns sources as `search_results` (title/url/snippet) or, on older
// responses, a bare `citations` URL list; parse both defensively.
import type { SearchConfig, SearchProvider, SearchResult } from './index.js';

export function perplexityProvider(config: SearchConfig): SearchProvider {
  return {
    id: 'perplexity',
    describe: () => `Perplexity Sonar (key from $${config.perplexityKeyEnv})`,
    async search(query, count, egress) {
      const key = process.env[config.perplexityKeyEnv];
      if (!key) {
        throw new Error(
          `Perplexity search needs an API key in $${config.perplexityKeyEnv}. Get one at perplexity.ai/account/api/keys, export it, or switch search.backend to duckduckgo.`,
        );
      }
      const res = await egress.fetch('https://api.perplexity.ai/chat/completions', 'web-search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: query }] }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Perplexity answered ${res.status}. Check the key and plan.`);
      const body = (await res.json()) as {
        search_results?: Array<{ title?: string; url?: string; snippet?: string }>;
        citations?: string[];
      };
      const fromResults = (body.search_results ?? [])
        .filter((r): r is { url: string; title?: string; snippet?: string } => Boolean(r?.url))
        .map((r): SearchResult => ({
          title: r.title || hostOf(r.url),
          url: r.url,
          snippet: r.snippet ?? '',
        }));
      if (fromResults.length) return fromResults.slice(0, count);
      return (body.citations ?? [])
        .filter((u): u is string => typeof u === 'string' && u.length > 0)
        .slice(0, count)
        .map((url): SearchResult => ({ title: hostOf(url), url, snippet: '' }));
    },
  };
}

/** The host of a URL, for a readable citation title; the raw string on a
 *  malformed URL rather than throwing. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
