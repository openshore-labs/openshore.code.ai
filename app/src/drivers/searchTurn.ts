// The search turn, done once (build 2026-09-29, A4). A local model asks for a
// web search with one "SEARCH:" line; the host runs it and hands the results
// back for a real answer. Every chat driver that speaks the protocol (the
// phone's pocket model, the Stack's local seats, the desktop's free chat) goes
// through this one helper, so the rules live in one place:
//
// - The stream filter is always on for a searchable seat, on the answer pass
//   too, so a second SEARCH: line never prints as the answer.
// - One search per message. A search line the host cannot honor (the search is
//   spent, declined, or offline) ends the reply; it never runs a third pass.
// - The prompt says what is true this pass: the model may search, it already
//   searched and must answer now, or it has no web access. A declined search
//   is never offered, so it costs one generation, not two.
// - The raw results are a turn for the answer pass only. Once the answer is
//   in, history keeps one line in their place, so later turns do not carry
//   (and re-read) a page of search results.
import type { DriverEvent } from 'os-code/protocol';
import {
  NO_SEARCH_NOTE,
  SEARCHED_NOTE,
  SEARCH_PROTOCOL_NOTE,
  SearchLineFilter,
  searchFirstQuery,
} from 'os-code/protocol';
import {
  searchFirstOn,
  searchForModel,
  searchOffered,
  type AfterPrivate,
} from '../lib/localSearch.js';
import { raceAbort } from './providerClient.js';

/** The line history keeps for a search once the answer is in. */
export function searchedLine(query: string): string {
  return `(searched the web for "${query}")`;
}

/** What a finished pass asks of the driver: answer with what it wrote, run the
 *  one search, or end because the model asked for a search that cannot run. */
export type SearchDecision =
  { kind: 'answer'; flush: string } | { kind: 'search'; query: string } | { kind: 'refused' };

export class SearchTurn {
  private filter = new SearchLineFilter(false);
  private spent?: { query: string; results: string };
  /** The person's message before this one, and this one, for a follow-up's
   *  query; kept across messages, read once per message. */
  private previous?: string;
  private current?: string;

  /** The chat's project closed the web (Project Wayfinder's network access
   *  none): nothing is offered, asked for, or searched first. Read live. */
  private closed: () => boolean = () => false;

  /** Close this chat's web while `closed` answers true. */
  closedBy(closed: () => boolean): void {
    this.closed = closed;
  }

  /** A new message: nothing searched yet. */
  begin(): void {
    this.spent = undefined;
    if (this.current !== undefined) this.previous = this.current;
    this.current = undefined;
    this.filter = new SearchLineFilter(false);
  }

  /** This message already ran its one search. */
  get searched(): boolean {
    return this.spent !== undefined;
  }

  /** Whether the model may ask for a search on this pass: the web is offered
   *  (in reach, not declined) and the search is not yet spent. */
  mayAsk(offered: boolean = searchOffered()): boolean {
    return offered && !this.searched && !this.closed();
  }

  /** The system note for this pass. */
  note(offered: boolean = searchOffered()): string {
    if (this.searched) return SEARCHED_NOTE;
    return offered && !this.closed() ? SEARCH_PROTOCOL_NOTE : NO_SEARCH_NOTE;
  }

  /** Arm the filter for one generation. `enabled` is false only for a seat
   *  that never speaks the protocol (Harbor Lite, whose harness searches for
   *  it); every other local seat is filtered on every pass. */
  startPass(enabled = true): void {
    this.filter = new SearchLineFilter(enabled);
  }

  /** One streamed delta of the answer; returns what may be shown now. */
  push(delta: string): string {
    return this.filter.push(delta);
  }

  /** The pass ended: what to do next. `offered` is read now, so a consent
   *  change mid-reply is honored. */
  decide(offered: boolean = searchOffered()): SearchDecision {
    const { query, flush } = this.filter.end();
    if (!query) return { kind: 'answer', flush };
    return this.mayAsk(offered) ? { kind: 'search', query } : { kind: 'refused' };
  }

  /** Run the one search this message may make and return the results turn
   *  for the answer pass. A stop while it runs (or while the consent sheet is
   *  up) unwinds at once. `priv` is set by the driver once the chat on the
   *  seat that wrote the query holds a private note's text (UX and copy review,
   *  2026-10-08, H): the search then asks every time, and one bound for
   *  Perplexity does not run. */
  async run(
    query: string,
    researchOn: boolean,
    emit: (event: DriverEvent) => void,
    signal?: AbortSignal,
    priv?: AfterPrivate,
  ): Promise<string> {
    const results = await raceAbort(searchForModel(query, researchOn, emit, priv), signal);
    this.spent = { query, results };
    return results;
  }

  /** Search first, the Perplexity way (founder, 2026-10-27): outside coding,
   *  a message is searched before the model writes a word, so an open model
   *  answers from current sources instead of what it half remembers. Returns
   *  the results turn to push after the person's message, or undefined when
   *  this message does not search first (search-first is off, the web is not
   *  offered, the search is spent, or the message is code, small talk,
   *  arithmetic, or an edit of given text). A short follow-up searches with
   *  the message before it. It is this message's one search, so the answer
   *  pass reads that it is spent. */
  async first(
    text: string,
    researchOn: boolean,
    emit: (event: DriverEvent) => void,
    signal?: AbortSignal,
    priv?: AfterPrivate,
    offered: boolean = searchOffered(),
  ): Promise<string | undefined> {
    // The first call of a message carries the person's own words; a later
    // one (a fallback seat) only finds the search spent or declined.
    if (this.current === undefined) this.current = text;
    if (!searchFirstOn() || !this.mayAsk(offered)) return undefined;
    const query = searchFirstQuery(this.current, this.previous);
    if (!query) return undefined;
    return this.run(query, researchOn, emit, signal, priv);
  }

  /** Once the answer is in (or the turn ends any other way), replace the raw
   *  results in `history` with one line naming the search. Only the entry this
   *  message pushed is touched. */
  settle<M extends { role: string; content: string }>(history: M[]): void {
    const spent = this.spent;
    if (!spent) return;
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i]!;
      if (m.role === 'user' && m.content === spent.results) {
        history[i] = { ...m, content: searchedLine(spent.query) };
        break;
      }
    }
  }
}
