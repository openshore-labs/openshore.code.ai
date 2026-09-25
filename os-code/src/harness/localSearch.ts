// Web search for local models. A small model asks for a search by writing one
// plain line, "SEARCH: <query>", instead of a tool-call schema it may not
// reproduce. The host (the phone, or the desktop's free chat) runs the search
// on the person's own provider and hands the results back for a real answer.
//
// Pure and synchronous (tenet 5): no network, no Node built-ins. The search
// itself lives with each host.

export const SEARCH_PREFIX = 'SEARCH:';

/** The instruction a local model reads so it knows it can search. */
export const SEARCH_PROTOCOL_NOTE = `You can search the web. To search, respond with EXACTLY one line and nothing else: "${SEARCH_PREFIX} your search query". Do this whenever the question needs current information, a fact you are not certain of, or anything you would otherwise have to guess at. You will then be given the results and asked to answer for real. Do not fabricate results or pretend you searched.`;

/** The instruction for a local model that cannot reach the web right now. */
export const NO_SEARCH_NOTE =
  'You have no web access right now. Answer from what you know, and say plainly when you are not sure rather than guessing.';

const MAX_QUERY_CHARS = 200;

/** The query when a reply opens with a search line, else undefined. Only the
 *  first line counts: a small model sometimes invents "results" after asking,
 *  and those must be dropped, never shown. */
export function parseSearchLine(reply: string): string | undefined {
  const first = reply.trimStart().split('\n')[0] ?? '';
  if (first.slice(0, SEARCH_PREFIX.length).toUpperCase() !== SEARCH_PREFIX) return undefined;
  const query = first
    .slice(SEARCH_PREFIX.length)
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
  return query ? query.slice(0, MAX_QUERY_CHARS) : undefined;
}

/** Holds back the start of a streamed reply until it is clear whether it is a
 *  search line, so the control line never flashes on screen. A normal reply is
 *  held for at most the length of the prefix, then flows through untouched. */
export class SearchLineFilter {
  private held = '';
  private state: 'undecided' | 'search' | 'pass';

  constructor(enabled = true) {
    this.state = enabled ? 'undecided' : 'pass';
  }

  /** Feed one streamed delta; returns the text that may be shown now. */
  push(delta: string): string {
    if (this.state === 'pass') return delta;
    this.held += delta;
    if (this.state === 'search') return '';
    const t = this.held.trimStart();
    const n = SEARCH_PREFIX.length;
    const head = t.slice(0, n).toUpperCase();
    if (t.length < n ? SEARCH_PREFIX.startsWith(head) : head === SEARCH_PREFIX) {
      if (t.length >= n) this.state = 'search';
      return '';
    }
    this.state = 'pass';
    const out = this.held;
    this.held = '';
    return out;
  }

  /** The reply ended. A search request yields its query; anything else yields
   *  the text still held back, to show. */
  end(): { query?: string; flush: string } {
    const held = this.held;
    this.held = '';
    const query = this.state === 'pass' ? undefined : parseSearchLine(held);
    this.state = 'pass';
    return query ? { query, flush: '' } : { flush: held };
  }
}
