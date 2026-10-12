// The success haptic at a turn's end, and when a turn has earned it. The rule
// lives here, apart from the store (tech review ruling 9), as plain functions a test
// reads without it; the store's attachDriver folds each event through
// turnShown and asks celebratesTurn at the task's end. The haptic itself
// still goes through lib/haptics.ts, the one path. Test:
// app/test/turnEndHaptic.test.ts.
//
// A turn whose only result is the image offer (nothing here could read the
// picture, 2026-10-07) ends complete, since it is a calm reply and
// not a failure, but it answered nothing: a success tap there would cheer a
// picture that went unread. A play that answered and then offers still has
// its answer, so it keeps the tap.
import type { DriverEvent } from 'os-code/protocol';

/** What a turn has put on screen so far, for the tap at its end. */
export interface TurnShown {
  /** Words of an answer arrived. */
  answered: boolean;
  /** The image offer arrived. */
  offered: boolean;
}

/** A turn that has shown nothing yet. */
export const NOTHING_SHOWN: TurnShown = { answered: false, offered: false };

/** Fold one event into what the turn has shown. A new task starts clean. */
export function turnShown(shown: TurnShown, event: DriverEvent): TurnShown {
  switch (event.type) {
    case 'task-start':
      return NOTHING_SHOWN;
    case 'text-delta':
    case 'text-final':
      return event.text.trim() ? { ...shown, answered: true } : shown;
    case 'image-reader-offer':
      return { ...shown, offered: true };
    default:
      return shown;
  }
}

/** Whether this event ends a turn that earns the success haptic: a complete
 *  ending, unless the turn's only result was the image offer. */
export function celebratesTurn(shown: TurnShown, event: DriverEvent): boolean {
  if (event.type !== 'task-done' || event.reason !== 'complete') return false;
  return !(shown.offered && !shown.answered);
}
