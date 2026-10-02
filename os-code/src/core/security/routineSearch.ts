// The guard on a Crew routine's web search (CTO security review, 2026-10-01,
// finding F1). A routine runs with nobody at the desk and reads text other
// people wrote (a cloned README, a clipped note), so an injected line could
// ask the model to search for a secret or a private note's contents and leave
// it in a search provider's logs. A routine's search is therefore held to a
// short, plain query, on a backend that only returns results (never one that
// browses a page the query names), and stops for the rest of the run once the
// run has read anything local-only or secret-shaped. Pure: no Node built-ins.
import { redactSecrets } from './redaction.js';

/** Backends that only return ranked results. Perplexity's Sonar is a model
 *  that browses, so a query naming a page would make it open that page. */
const RESULT_ONLY_BACKENDS = new Set(['duckduckgo', 'brave', 'searxng', 'tavily']);

/** Long enough for a real search, too short to carry a document out. */
export const ROUTINE_QUERY_MAX = 150;

/** A run of characters that reads like a key or an encoded blob, not words. */
const OPAQUE_RUN = /[A-Za-z0-9+/=_-]{25,}/;
const URL_LIKE = /:\/\/|\bwww\.|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S/i;

/** Why a routine's search does not run, or null when it may. */
export function routineSearchRefusal(
  query: unknown,
  backend: string,
  tainted: boolean,
): string | null {
  if (!RESULT_ONLY_BACKENDS.has(backend)) {
    return 'Routines search only with a backend that returns results, so this search did not run.';
  }
  if (tainted) {
    return 'This run read a private note or something that looked like a secret, so it does not search the web for the rest of the run.';
  }
  if (typeof query !== 'string' || !query.trim()) return 'The search was empty.';
  const q = query.trim();
  if (q.length > ROUTINE_QUERY_MAX) {
    return `A routine's search stays under ${ROUTINE_QUERY_MAX} characters, so this one did not run.`;
  }
  if (URL_LIKE.test(q))
    return 'A routine does not search for web addresses, so this one did not run.';
  if (redactSecrets(q) !== q || OPAQUE_RUN.test(q)) {
    return 'The search looked like it carried a secret, so it did not run.';
  }
  return null;
}
