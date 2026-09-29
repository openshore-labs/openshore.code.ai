// The harness package's transcript logic (CTO 9: a sibling module; the
// reducer and the list only call it): the little-room card and the retrieval
// card an event becomes, and the verdict the task-done card shows.
import type { DriverEvent } from 'os-code/protocol';
import type { ThreadItem } from './types.js';

type WindowTightEvent = Extract<DriverEvent, { type: 'window-tight' }>;
type RetrievalEvent = Extract<DriverEvent, { type: 'retrieval' }>;
type WindowCutItem = Extract<ThreadItem, { kind: 'window-cut' }>;
type RetrievalItem = Extract<ThreadItem, { kind: 'retrieval' }>;

/** The card a `window-tight` event becomes: the truncation card's family,
 *  with the same room offer and tap, and its own words. The engine sends it
 *  once per chat per model, so every event is a card. */
export function windowTightItem(event: WindowTightEvent): Omit<WindowCutItem, 'id'> {
  return {
    kind: 'window-cut',
    tight: true,
    model: event.model,
    provider: event.provider,
    ...(event.room ? { room: event.room } : {}),
    ...(event.room === 'more' && event.gb !== undefined ? { gb: event.gb } : {}),
  };
}

/** The card a `retrieval` event becomes. */
export function retrievalItem(event: RetrievalEvent): Omit<RetrievalItem, 'id'> {
  return {
    kind: 'retrieval',
    sources: event.sources.map((s) => ({ path: s.path, line: s.line })),
  };
}

/** What the task-done card says about the task's work: the last check's
 *  verdict ('pass' or 'fail', which check spoke, and the pill to scroll to),
 *  or 'not-run' when nothing checked it. */
export type TaskVerdict =
  { state: 'pass' | 'fail'; check: 'tests' | 'page'; verifyId: string } | { state: 'not-run' };

/**
 * The verdict for the task-done card at `index`: the last verify pill of the
 * same task (between the person's message before it and the card), since a
 * failure that went back to the model is followed by the check that settled
 * it. None means nothing checked the work.
 */
export function taskVerdict(items: readonly ThreadItem[], index: number): TaskVerdict {
  for (let i = index - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === 'user') break;
    if (item.kind === 'verify') {
      return {
        state: item.passed ? 'pass' : 'fail',
        check: item.check,
        verifyId: item.id,
      };
    }
  }
  return { state: 'not-run' };
}

/** The element id the transcript's verify pill carries, so the task-done
 *  card's pill can bring it into view. */
export function verifyAnchor(itemId: string): string {
  return `verify-${itemId}`;
}
