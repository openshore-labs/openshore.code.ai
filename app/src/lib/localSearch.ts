// Web search for local models, the phone's half. A local model asks with one
// "SEARCH:" line (the rule lives in os-code/protocol so the desktop's free chat
// speaks it too); this runs the search on the provider picked in Settings
// (DuckDuckGo by default, or the person's own Brave, Tavily, or Perplexity key)
// and returns the text the model reads before it answers for real. A failed
// search is said plainly, never faked.
import type { DriverEvent } from 'os-code/protocol';
import { harborMiniTurn } from './harborMini.js';
import {
  formatSearchResults,
  resolveSearchKey,
  webSearch,
  type WebSearchResult,
} from './webSearch.js';

export async function searchForModel(
  query: string,
  researchOn: boolean,
  emit: (event: DriverEvent) => void,
): Promise<string> {
  emit({ type: 'status', message: `Searching the web for "${query}".` });
  try {
    const key = await resolveSearchKey(researchOn);
    const results = await webSearch(query, key);
    if (results.length) {
      emit({
        type: 'citations',
        citations: results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
      });
    }
    return formatSearchResults(query, results);
  } catch (err) {
    return `Search failed: ${err instanceof Error ? err.message : String(err)}. Answer from what you already know instead, and say you could not search.`;
  }
}

/** Harbor Lite does not ask for a search; its guide harness decides for it
 *  before it writes a word, and hands it a few results (a small model's share).
 *  Returns the turn's prompt and the fixed line shown after the reply. Offline,
 *  a planned search is reported as unavailable, honestly. */
export async function prepareGuideTurn(
  text: string,
  researchOn: boolean,
  emit: (event: DriverEvent) => void,
  online = true,
): Promise<{ prompt: string; after?: string }> {
  const turn = harborMiniTurn(text);
  const query = turn.plan.searchQuery;
  let sources: WebSearchResult[] | undefined;
  let searchFailed = false;
  if (query && !online) searchFailed = true;
  else if (query) {
    emit({ type: 'status', message: `Searching the web for "${query}".` });
    try {
      const key = await resolveSearchKey(researchOn);
      sources = await webSearch(query, key, 3);
      if (sources.length) {
        emit({
          type: 'citations',
          citations: sources.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
        });
      }
    } catch {
      searchFailed = true;
    }
  }
  return { prompt: turn.prompt({ sources, searchFailed }), after: turn.plan.after };
}
