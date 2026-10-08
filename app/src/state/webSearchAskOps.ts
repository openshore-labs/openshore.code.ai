// The web search sheet's rules, apart from the store (which only wires them
// in). Web search asks once (founder, 2026-10-02; What leaves this device): a
// yes is remembered on this device, a "not now" holds until the next launch.
// A search a model writes once its chat on a seat that stays on this network
// holds a private note's text (CX and CMO, 2026-10-08, H) asks every time
// instead, on a card with the exact words and why, whatever was allowed
// before, and its answer is never remembered: no standing allow, and a no
// keeps web search as it was. One card is on screen at a time.
import type { SearchAllowed } from '../lib/localSearch.js';

/** What the sheet shows: the words a model wants to search for, and for a
 *  search after a private read, its card (summary and detail, the engine's
 *  own words through `privateSearchCard`). */
export interface WebSearchSheet {
  query: string;
  private?: { summary: string; detail: string };
}

/** How a clean search is answered without a sheet (true or false), or
 *  undefined when the sheet must ask. A search after a private read always
 *  asks, so it never takes a shortcut. */
export function searchAskShortcut(
  consent: SearchAllowed | undefined,
  declinedThisRun: boolean,
  afterPrivate: boolean,
): boolean | undefined {
  if (afterPrivate) return undefined;
  if (consent === 'allowed') return true;
  if (consent === 'declined' || declinedThisRun) return false;
  return undefined;
}

/** Whether the answer to the sheet on screen is remembered: a clean search's
 *  is (a yes saved, a no for this launch); a card after a private read
 *  answers that one search only. */
export function remembersAnswer(sheet: WebSearchSheet | undefined): boolean {
  return !sheet?.private;
}

/** Whether an answer lands: a card is on screen, and the tap was on that
 *  card (`sheet`, when the caller names it). The sheet keeps its last card
 *  drawn while it slides away, so a second tap there, or on its scrim, would
 *  otherwise answer nothing on screen as a clean card, and a second tap on
 *  a private card's Approve once would save a standing allow. */
export function answersSheet(
  current: WebSearchSheet | undefined,
  sheet: WebSearchSheet | undefined,
): boolean {
  if (!current) return false;
  return sheet === undefined || sheet === current;
}

/** The sheets in order: each one shows once the card ahead of it is
 *  answered, so two searches at once never overwrite each other's card. */
export class WebSearchSheets {
  private queue: Promise<unknown> = Promise.resolve();
  private resolve?: (allow: boolean) => void;

  constructor(private readonly show: (sheet: WebSearchSheet) => void) {}

  /** Show `sheet` after the ones ahead of it; resolves with the answer. */
  open(sheet: WebSearchSheet): Promise<boolean> {
    const answered = this.queue.then(
      () =>
        new Promise<boolean>((resolve) => {
          this.resolve = resolve;
          this.show(sheet);
        }),
    );
    this.queue = answered.catch(() => undefined);
    return answered;
  }

  /** The person answered the sheet on screen. */
  answer(allow: boolean): void {
    const resolve = this.resolve;
    this.resolve = undefined;
    resolve?.(allow);
  }
}
