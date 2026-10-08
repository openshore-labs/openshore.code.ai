// The words OpenShore says once a chat holds a private note's text (CX and
// CMO, 2026-10-08, rulings A, D, F, G and H). One source for each line, so
// the engine's cards and refusals and the app's drivers and sheets say the
// same thing: the engine's loop reads them here, and the app through
// `os-code/protocol`. Pure: no Node built-ins, no I/O.

/** What makes a chat hold a private note's text: the project's own private
 *  pin in the pack and nothing else ('pin'), or anything else ('read': a
 *  read, a marked turn, a private Current State, the repository's
 *  instructions, a task sent marked). */
export type PrivateCause = 'pin' | 'read';

/** Why a handoff to a cloud model did not run (G): a read, or a pin alone.
 *  A search on Perplexity is a handoff too. */
export const HANDOFF_LOCAL_ONLY_DENIED =
  'This chat has read a private note, so this step is not handed to a cloud model.';
export const HANDOFF_PIN_DENIED =
  'A private note is pinned to this project, so this step is not handed to a cloud model.';

/** The refusal for a cause. */
export function handoffRefusalLine(cause: PrivateCause): string {
  return cause === 'pin' ? HANDOFF_PIN_DENIED : HANDOFF_LOCAL_ONLY_DENIED;
}

/** The line above a project note change's diff (A): the change lands in the
 *  repository, where a cloud model may read it later. */
export const MEMORY_WHY_READ =
  'This chat has read a private note, and a cloud model may later read what this change writes.';
export const MEMORY_WHY_PIN =
  'A private note is pinned to this project, and a cloud model may later read what this change writes.';

/** The line above the diff for a cause. */
export function memoryWhyLine(cause: PrivateCause): string {
  return cause === 'pin' ? MEMORY_WHY_PIN : MEMORY_WHY_READ;
}

/** What the model reads when the person keeps the project note as it was. */
export const MEMORY_DECLINED =
  'Not run: the person kept this project note as it was. Carry on without updating it.';
/** A routine has nobody to ask (A): its denial reason, and its run note's
 *  line after "Note: ". */
export const MEMORY_ROUTINE_DENIED =
  "This run drew on a private note, so it left the project's memory notes as they were, since a routine cannot ask you to approve a change to them.";
/** What a routine's model reads in its place. */
export const MEMORY_ROUTINE_REFUSED =
  "Not run: this run drew on a private note, so a change to the project's memory notes needs the person's approval, and a routine cannot ask for it. Carry on without it.";

/** The lead of a web card (H). */
export const PRIVATE_WEB_LEAD_READ = 'This chat has read a private note.';
export const PRIVATE_WEB_LEAD_PIN = 'A private note is pinned to this project.';

/** The lead for a cause. */
export function privateWebLead(cause: PrivateCause): string {
  return cause === 'pin' ? PRIVATE_WEB_LEAD_PIN : PRIVATE_WEB_LEAD_READ;
}

/** What the model reads when the person keeps a search or a page off the web. */
export const WEB_DECLINED = 'Not run: the person kept this off the web. Answer from what you have.';

/** The search services a model-written search goes to, as a person names
 *  them, by backend. */
const SEARCH_SERVICE: Readonly<Record<string, string>> = {
  duckduckgo: 'DuckDuckGo',
  brave: 'Brave',
  tavily: 'Tavily',
  searxng: 'SearXNG',
};

/** A search backend as a person names it ("DuckDuckGo"); an unknown one by
 *  its own name. */
export function searchServiceName(backend: string): string {
  return SEARCH_SERVICE[backend] ?? backend;
}

/** The card before a model-written search, once the chat holds a private
 *  note's text (H): the exact words, and why it asks. */
export function privateSearchCard(
  service: string,
  query: string,
  cause: PrivateCause,
): { summary: string; detail: string } {
  return {
    summary: `Search ${service} for "${query}"`,
    detail: `${privateWebLead(cause)} These words go to ${service} as written, so check that they carry nothing from it. Nothing is sent without this approval.`,
  };
}

/** The card before a page fetch, once the chat holds a private note's text
 *  (H): the exact address, and why it asks. */
export function privatePageCard(
  host: string,
  url: string,
  cause: PrivateCause,
): { summary: string; detail: string } {
  return {
    summary: `Open ${host}`,
    detail: `${privateWebLead(cause)} Nothing is sent without this approval. This address goes to ${host} as written, so check that it carries nothing from the note: ${url}`,
  };
}

/** Said once per chat for each model off this network, on the first turn it
 *  is sent the placeholder in place of a marked reply (F). */
export function placeholderLine(model: string): string {
  return `This chat drew on a private note, so ${model} sees your local models' replies since then only as a placeholder.`;
}

/** The card's summary before a handoff to a placed cloud model, on the
 *  computer (D). `category` is the Stack's label lowercased, Fast as "fast
 *  answers". */
export function handoffCardSummary(model: string, category: string): string {
  return `This step goes to ${model}, the cloud model you placed for ${category}.`;
}

/** What the person and, after "Not run: ", the model read after a no on that
 *  card (D). */
export function handoffDeclined(model: string): string {
  return `You declined sending this step to ${model}.`;
}
