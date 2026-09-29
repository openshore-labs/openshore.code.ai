// The harness package's words (CTO 6 and the task-done card), in one place so
// the tests hold them: the verdict pill on the task-done card, the card for
// retrieval before turn one, and the little-room card in the truncation
// card's family. A card reads its lines from here, never its own copy. None
// claims the lift helps: that waits for the eval on the reference box
// (tenet 2); each says only what happened.

// ---- the verdict pill on the task-done card ----
// A check's verdict reads in the transcript verify pill's own words
// (`verdictLabel` in components/VerifyPill.tsx), so one verdict never reads
// two ways; these are the words only the task-done card needs.

/** When no check ran on the task's work: said plainly, never as a pass. */
export const NOT_CHECKED = 'Not checked';

/** The tap on a pill that has a check behind it. */
export const SHOW_CHECK = 'Show the check';

// ---- retrieval before turn one ----

/** The card's head: how many places the model was given before it started. */
export function retrievalHeadline(n: number): string {
  return `Started from ${n} ${n === 1 ? 'place' : 'places'} in your code`;
}

/** Where the excerpts went: only ever a model on this computer's network. */
export const RETRIEVAL_SEAT = 'Stayed with a local model';

/** One excerpt, by file and the line it starts at. */
export function retrievalPlace(path: string, line: number): string {
  return `${path}, line ${line}`;
}

// ---- the little-room card (the truncation card's family) ----

export function windowTightTitle(model: string): string {
  return `${model} has little room left for this chat on this computer`;
}

export const WINDOW_TIGHT_BODY =
  'Its instructions and tools fill most of the room your computer gives it, so older messages get summarized sooner.';
