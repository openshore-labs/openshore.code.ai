// Self-hosted SearXNG: the privacy and local-first choice. Point
// search.searxngUrl at your instance and the whole search path stays yours.
import type { SearchConfig, SearchProvider, SearchResult } from './index.js';

export function searxngProvider(config: SearchConfig): SearchProvider {
  return {
    id: 'searxng',
    describe: () =>
      `SearXNG at ${config.searxngUrl ?? '(searxngUrl not set)'} (self-hosted, fully private)`,
    async search(query, count, egress) {
      if (!config.searxngUrl) {
        throw new Error(
          'search.backend is searxng but search.searxngUrl is not set. Point it at your instance, e.g. "http://localhost:8888".',
        );
      }
      const base = config.searxngUrl.replace(/\/$/, '');
      const url = `${base}/search?q=${encodeURIComponent(query)}&format=json`;
      const res = await egress.fetch(url, 'web-search', {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        throw new Error(
          `SearXNG answered ${res.status}. If it is 403, enable the json format in its settings.yml (search.formats).`,
        );
      }
      const body = (await res.json()) as {
        results?: Array<{ title: string; url: string; content?: string }>;
      };
      return (body.results ?? [])
        .slice(0, count)
        .map((r): SearchResult => ({ title: r.title, url: r.url, snippet: r.content ?? '' }));
    },
  };
}
