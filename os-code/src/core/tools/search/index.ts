// Pluggable web search. DuckDuckGo needs no key and works out of the box;
// Brave and Tavily take an API key; a self-hosted SearXNG keeps the whole
// path private. Backend choice lives in config (search.backend).
import type { EgressPolicy } from '../../security/egress.js';
import type { SearchSchema } from '../../../config/schema.js';
import type { z } from 'zod';

export type SearchConfig = z.infer<typeof SearchSchema>;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  id: string;
  /** One warm line for doctor: what this backend is and what it needs. */
  describe(): string;
  search(query: string, count: number, egress: EgressPolicy): Promise<SearchResult[]>;
}

import { duckduckgoProvider } from './duckduckgo.js';
import { braveProvider } from './brave.js';
import { searxngProvider } from './searxng.js';
import { tavilyProvider } from './tavily.js';

export function searchProviderFor(config: SearchConfig): SearchProvider {
  switch (config.backend) {
    case 'brave':
      return braveProvider(config);
    case 'searxng':
      return searxngProvider(config);
    case 'tavily':
      return tavilyProvider(config);
    case 'duckduckgo':
    default:
      return duckduckgoProvider();
  }
}
