// Brave Search API. Needs a key (search.braveKeyEnv names the env var).
import type { SearchConfig, SearchProvider, SearchResult } from './index.js';

export function braveProvider(config: SearchConfig): SearchProvider {
  return {
    id: 'brave',
    describe: () => `Brave Search API (key from $${config.braveKeyEnv})`,
    async search(query, count, egress) {
      const key = process.env[config.braveKeyEnv];
      if (!key) {
        throw new Error(
          `Brave search needs an API key in $${config.braveKeyEnv}. Get one at brave.com/search/api, export it, or switch search.backend to duckduckgo.`,
        );
      }
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
      const res = await egress.fetch(url, 'web-search', {
        headers: { accept: 'application/json', 'x-subscription-token': key },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) throw new Error(`Brave Search answered ${res.status}. Check the key and plan.`);
      const body = (await res.json()) as {
        web?: { results?: Array<{ title: string; url: string; description?: string }> };
      };
      return (body.web?.results ?? [])
        .slice(0, count)
        .map((r): SearchResult => ({ title: r.title, url: r.url, snippet: r.description ?? '' }));
    },
  };
}
