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

/** The instruction for the answer pass after a search: the one search this
 *  message may make is spent, so the model answers now instead of asking
 *  again (a second search line is never run, and never shown). */
export const SEARCHED_NOTE =
  'You already searched the web for this message, and the results are in the conversation. Answer now, from those results and what you know. Do not ask to search again.';

const MAX_QUERY_CHARS = 200;

// Search first (founder, 2026-10-27). A small local model knows little and
// guesses the rest, and it seldom asks for a search on its own, so for a
// research or factual question the host searches before the model writes a
// word and the model answers from the results (tenet 3: retrieval first, the
// way the guide harness already does for Harbor Lite). Small talk, code,
// writing and pasted text are left to the model, which may still ask.

const SMALL_TALK =
  /^(hi|hello|hey|yo|thanks|thank you|thx|ty|ok|okay|cool|nice|great|awesome|lol|haha|yes|no|yep|nope|sure|good (morning|afternoon|evening|night)|how are you|how's it going|who are you|what'?s up|sup)\b[\s!.?]*$/;
const HAS_CODE =
  /```|^\s{4}\S|[;{}]\s*$|=>|\b(def|const|let|var|function|import|return)\b\s*[\w(]/m;
const MAKE_ASK =
  /^(please\s+)?(write|draft|rewrite|rephrase|reword|summari[sz]e|translate|edit|proofread|fix|debug|refactor|implement|make|create|generate|build|compose|brainstorm|outline|format|convert|calculate|solve)\b/;
const ABOUT_THIS_CHAT =
  /\b(you (just )?said|your (last|previous) (answer|reply|message)|(the|this) (code|text|paragraph|email|essay|message|file|list) (above|below))\b/;
const ARITHMETIC = /^[\d\s+\-*/().^%=x,]+\??$/;
const ASKS =
  /\?\s*$|^(who|what|what's|whats|when|where|why|how|which|is|are|was|were|can|could|does|do|did|will|should|would|has|have|tell me|explain|define|describe|compare|look up|search|find|research|latest|news)\b/;

/** The longest message that is still a question rather than pasted text. */
const MAX_QUESTION_CHARS = 400;

/** The search query to run before the model answers, or undefined when this
 *  message is not a research or factual question. Pure, so the eval can pin
 *  it. */
export function searchFirstQuery(message: string): string | undefined {
  const text = message.trim();
  if (!text || text.length > MAX_QUESTION_CHARS) return undefined;
  const lower = text.toLowerCase();
  if (SMALL_TALK.test(lower) || ARITHMETIC.test(lower)) return undefined;
  if (HAS_CODE.test(text) || MAKE_ASK.test(lower) || ABOUT_THIS_CHAT.test(lower)) return undefined;
  if (!ASKS.test(lower)) return undefined;
  const query = text
    .replace(/^(hey|hi|hello|so|ok|okay)[,!.\s]+/i, '')
    .replace(
      /^(can you|could you|would you|please)\s+(tell me|explain|find out|look up|search( for)?)\s*/i,
      '',
    )
    .replace(/^(look up|search( for)?|research|find)\s+/i, '')
    .replace(/[?!.]+$/, '')
    .trim();
  // A follow-up of a word or two ("why?", "and tomorrow?") leans on the chat
  // so far; the model asks for itself if it needs to.
  if (query.split(/\s+/).length < 3) return undefined;
  return query.slice(0, MAX_QUERY_CHARS);
}

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
