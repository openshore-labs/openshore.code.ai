// Tavily: a search API tuned for agents. Needs a key (search.tavilyKeyEnv).
import type { SearchConfig, SearchProvider, SearchResult } from './index.js';

export function tavilyProvider(config: SearchConfig): SearchProvider {
  return {
    id: 'tavily',
    describe: () => `Tavily (key from $${config.tavilyKeyEnv})`,
    async search(query, count, egress) {
      const key = process.env[config.tavilyKeyEnv];
      if (!key) {
        throw new Error(
          `Tavily needs an API key in $${config.tavilyKeyEnv}. Get one at tavily.com, export it, or switch search.backend to duckduckgo.`,
        );
      }
      const res = await egress.fetch('https://api.tavily.com/search', 'web-search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ query, max_results: count }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Tavily answered ${res.status}. Check the key and plan.`);
      const body = (await res.json()) as {
        results?: Array<{ title: string; url: string; content?: string }>;
      };
      return (body.results ?? []).slice(0, count).map(
        (r): SearchResult => ({ title: r.title, url: r.url, snippet: r.content ?? '' }),
      );
    },
  };
}
