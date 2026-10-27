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
  'You already searched the web for this message, and the numbered results are in the conversation. Answer now, from those results, the way a careful researcher would: rely on the sources over your own memory, cite each claim you take from them by its number like [1], say plainly where the sources disagree with each other or with what you believed, and if they do not cover the question, say so rather than guessing. Do not ask to search again.';

const MAX_QUERY_CHARS = 200;

// Search first, the Perplexity way (founder, 2026-10-27). An open model is
// strong at code in its own context, but knowing real-world facts is not a
// reasonable expectation of it, so outside coding the host searches before
// the model writes a word, every message, and the model answers from the
// numbered sources (tenet 3: retrieval first). A short follow-up is searched
// with the question before it. Left to the model, which may still ask: code,
// small talk, arithmetic, and edits of text the person handed it.

const SMALL_TALK =
  /^(hi|hello|hey|yo|thanks|thank you|thx|ty|ok|okay|cool|nice|great|awesome|perfect|got it|lol|haha|yes|no|yep|nope|sure|bye|good (morning|afternoon|evening|night)|how are you|how's it going|who are you|what'?s up|sup)\b[\s!.?]*$/;
const HAS_CODE =
  /```|^\s{4}\S|[;{}]\s*$|=>|\b(def|const|let|var|function|import|return)\b\s*[\w(]/m;
const CODE_ASK =
  /\b(write|build|make|create|code|fix|debug|refactor|implement|generate|convert|optimi[sz]e|review|test)\b[^.?!]{0,40}\b(code|function|script|program|class|component|module|regex|sql|query|api|endpoint|bug|error|stack trace|app|website|site|game|tests?|unit tests?|python|javascript|typescript|swift|kotlin|rust|go|java|c\+\+|react|html|css|shell|bash)\b/;
const CODING_TOPIC =
  /\b(compile|compiler|typecheck|lint|stack trace|traceback|segfault|null pointer|undefined is not|exception|my (code|repo|function|build|tests?)|this (code|function|error|bug|repo))\b/;
const EDIT_GIVEN =
  /^(please\s+)?(rewrite|rephrase|reword|proofread|edit|shorten|tidy|polish|format|translate|summari[sz]e|fix the grammar)\b[^.?!]{0,30}\b(this|these|that|it|my|the following|below|above)\b|:\s*\n/;
const ABOUT_THIS_CHAT =
  /\b(you (just )?said|your (last|previous) (answer|reply|message)|(the|this) (code|text|paragraph|email|essay|message|file|list) (above|below))\b/;
const ARITHMETIC = /^[\d\s+\-*/().^%=x,]+\??$/;
/** A follow-up that leans on the question before it. */
const FOLLOW_UP =
  /^(and|but|what about|how about|why|how so|really|is it|are they|does it|did they|so|then|also|it|that|they|he|she|this)\b/;

/** The longest piece of a message used as a query. */
const MAX_MESSAGE_CHARS = 600;

function cleanQuery(text: string): string {
  return text
    .replace(/^(hey|hi|hello|so|ok|okay)[,!.\s]+/i, '')
    .replace(
      /^(can you|could you|would you|please)\s+(tell me|explain|find out|look up|check|search( for)?)\s*/i,
      '',
    )
    .replace(/^(look up|search( for)?|research|find|check)\s+/i, '')
    .replace(/[?!.]+$/, '')
    .trim();
}

/** The search query to run before the model answers, or undefined when this
 *  message is left to the model (code, small talk, arithmetic, an edit of
 *  given text). `previous` is the person's message before this one, so a
 *  short follow-up ("and in 2023?") searches with what it follows. Pure, so
 *  the eval can pin it. */
export function searchFirstQuery(message: string, previous?: string): string | undefined {
  const text = message.trim();
  if (!text) return undefined;
  const lower = text.toLowerCase();
  if (SMALL_TALK.test(lower) || ARITHMETIC.test(lower)) return undefined;
  if (HAS_CODE.test(text) || CODE_ASK.test(lower) || CODING_TOPIC.test(lower)) return undefined;
  if (EDIT_GIVEN.test(lower) || ABOUT_THIS_CHAT.test(lower)) return undefined;
  // Pasted text: its first line carries the ask, the rest is the material.
  const head = text.length > MAX_MESSAGE_CHARS ? (text.split('\n')[0] ?? '') : text;
  let query = cleanQuery(head);
  if (!query) return undefined;
  const words = query.split(/\s+/).length;
  const followUp = FOLLOW_UP.test(query.toLowerCase());
  if (words < 4 || followUp) {
    const before = previous ? searchFirstQuery(previous) : undefined;
    if (before) query = `${before} ${query}`;
    else if (followUp || words < 2) return undefined;
  }
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
