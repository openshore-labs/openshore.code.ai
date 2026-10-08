// Web search for local models, the phone's half. A local model asks with one
// "SEARCH:" line (the rule lives in os-code/protocol so the desktop's free chat
// speaks it too); this runs the search on the provider picked in Settings
// (DuckDuckGo by default, or the person's own Brave, Tavily, or Perplexity key)
// and returns the text the model reads before it answers for real. A failed
// search is said plainly, never faked.
import type { DriverEvent, PrivateCause } from 'os-code/protocol';
import {
  WEB_DECLINED,
  handoffRefusalLine,
  privateSearchCard,
  searchServiceName,
} from 'os-code/protocol';
import { harborMiniTurn } from './harborMini.js';
import {
  formatSearchResults,
  resolveSearchKey,
  webSearch,
  type WebSearchResult,
} from './webSearch.js';

/** A model-written search once its chat holds a private note's text (CX and
 *  CMO, 2026-10-08, H): what made the chat private, a read or a project pin
 *  alone, which the card's lead and a refusal name. */
export interface AfterPrivate {
  afterPrivate: true;
  cause: PrivateCause;
}

/** The ask for a search after a private read: the service its words would go
 *  to, by the name a person knows it ("DuckDuckGo"), the cause, and the card
 *  the sheet shows (the engine's own words, `privateSearchCard`). */
export type PrivateSearchAsk = AfterPrivate & {
  service: string;
  card: { summary: string; detail: string };
};

/** Web search asks once (What leaves this device): the search words go to a
 *  search service, so nothing is sent until the person allows it. The store
 *  registers the real question at launch; a host with no screen to ask on (a
 *  test, a script) searches as before. After a private read (`afterPrivate`)
 *  the gate asks every time, on a card that shows the exact words and why,
 *  whatever the person allowed before (H). */
export type SearchConsent = (query: string, ask?: PrivateSearchAsk) => Promise<boolean>;
let consent: SearchConsent = async () => true;

/** Where the person stands on web search right now, read without asking:
 *  `allowed` once they said yes, `declined` once they said no (in Settings, or
 *  "not now" this launch), `unknown` while nobody has asked yet. */
export type SearchAllowed = 'allowed' | 'declined' | 'unknown';

/** What a driver reads before it builds a prompt, so a declined search is
 *  never offered to the model (one generation, not two) and an offline one is
 *  said plainly. The store registers the live readers beside the gate; a host
 *  with none reads `unknown` and the browser's own online flag. */
export interface SearchStateReaders {
  allowed?: () => SearchAllowed;
  online?: () => boolean;
}

const browserOnline = (): boolean =>
  typeof navigator === 'undefined' || (navigator as { onLine?: boolean }).onLine !== false;
let allowedReader: () => SearchAllowed = () => 'unknown';
let onlineReader: () => boolean = browserOnline;

export function setSearchConsent(gate: SearchConsent, readers: SearchStateReaders = {}): void {
  consent = gate;
  allowedReader = readers.allowed ?? (() => 'unknown');
  onlineReader = readers.online ?? browserOnline;
}

/** The person's answer to web search right now, without asking. */
export function searchAllowedNow(): SearchAllowed {
  try {
    return allowedReader();
  } catch {
    return 'unknown';
  }
}

/** Whether the web is in reach for a search right now (not offline, and not
 *  on the Offline profile). */
export function webOnlineNow(): boolean {
  try {
    return onlineReader();
  } catch {
    return true;
  }
}

/** Whether a model may be offered web search this turn: the web is in reach
 *  and the person has not declined it. `unknown` offers it, and the first
 *  search asks. */
export function searchOffered(
  online: boolean = webOnlineNow(),
  allowed: SearchAllowed = searchAllowedNow(),
): boolean {
  return online && allowed !== 'declined';
}

/** What the model reads when the person has not allowed web search. */
export const SEARCH_NOT_ALLOWED =
  'Web search is off on this device: the person has not allowed it. Answer from what you already know, and say plainly that you did not search the web.';

/** What the model reads when a search after a private read would go to
 *  Perplexity, a model that answers off this network (H, G): it does not
 *  run, before any ask. */
export function privateSearchRefused(cause: PrivateCause): string {
  return `Not run: ${handoffRefusalLine(cause)} Answer from what you have.`;
}

export async function searchForModel(
  query: string,
  researchOn: boolean,
  emit: (event: DriverEvent) => void,
  /** Set once the chat on the seat that wrote the query holds a private
   *  note's text (H): Perplexity is refused before any ask, and any other
   *  service asks every time, on a card with the exact words. */
  priv?: AfterPrivate,
): Promise<string> {
  if (priv?.afterPrivate) {
    // The service is known before the ask, so the card names it and a search
    // bound for Perplexity is refused with nobody asked.
    let key: Awaited<ReturnType<typeof resolveSearchKey>>;
    try {
      key = await resolveSearchKey(researchOn);
    } catch (err) {
      return `Search failed: ${err instanceof Error ? err.message : String(err)}. Answer from what you already know instead, and say you could not search.`;
    }
    if (key?.backend === 'perplexity') {
      emit({ type: 'status', message: handoffRefusalLine(priv.cause) });
      return privateSearchRefused(priv.cause);
    }
    const service = searchServiceName(key?.backend ?? 'duckduckgo');
    const card = privateSearchCard(service, query, priv.cause);
    if (!(await consent(query, { ...priv, service, card }))) return WEB_DECLINED;
    return runSearch(query, async () => key, emit);
  }
  if (!(await consent(query))) return SEARCH_NOT_ALLOWED;
  return runSearch(query, () => resolveSearchKey(researchOn), emit);
}

/** Run one search the person allowed and return what the model reads. */
async function runSearch(
  query: string,
  searchKey: () => ReturnType<typeof resolveSearchKey>,
  emit: (event: DriverEvent) => void,
): Promise<string> {
  emit({ type: 'status', message: `Searching the web for "${query}".` });
  try {
    const key = await searchKey();
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
  /** The chat this turn answers for, so the guided setup's line reaches only
   *  the walk's own chat. */
  conversationId?: string,
): Promise<{ prompt: string; after?: string }> {
  const turn = harborMiniTurn(text, conversationId);
  const query = turn.plan.searchQuery;
  let sources: WebSearchResult[] | undefined;
  let searchFailed = false;
  if (query && !online) searchFailed = true;
  else if (query && !(await consent(query))) searchFailed = true;
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
