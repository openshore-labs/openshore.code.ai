// The server cut the chat to fit (C1, CX 6): a teal card, once per chat per
// model, saying what fell out of view and, when this computer has the memory,
// offering one action that states its cost before the tap. After the tap the
// action gives way to what changed. Built on the context card's teal frame;
// it arrives the way every transcript card does. Every line is from
// lib/securityCopy.ts, and the little-room variant's title and body (CTO 6:
// even the lean prompt fills most of the window) from lib/harnessCopy.ts.
import type { ThreadItem } from '../state/types.js';
import { hapticCommit } from '../lib/haptics.js';
import {
  MORE_ROOM_ACTION,
  NO_ROOM_LINE,
  OPEN_STACK,
  WINDOW_CUT_BODY,
  moreRoomCost,
  moreRoomGiven,
  windowCutTitle,
} from '../lib/securityCopy.js';
import { WINDOW_TIGHT_BODY, windowTightTitle } from '../lib/harnessCopy.js';

export function WindowCutCard({
  item,
  onGiveMoreRoom,
  onOpenStack,
}: {
  item: Extract<ThreadItem, { kind: 'window-cut' }>;
  /** The tap on "Give it more room" (the store's giveMoreRoom). */
  onGiveMoreRoom?: () => void;
  /** Open the Stack room, offered when there is no memory to spare. */
  onOpenStack?: () => void;
}) {
  const given = item.state === 'given';
  const giving = item.state === 'giving';
  return (
    <div className="window-cut-card" role="status">
      <div className="window-cut-title">
        {item.tight ? windowTightTitle(item.model) : windowCutTitle(item.model)}
      </div>
      <p className="window-cut-body">{item.tight ? WINDOW_TIGHT_BODY : WINDOW_CUT_BODY}</p>
      {item.room === 'more' && !given ? (
        <div className="window-cut-action">
          <button
            type="button"
            className="btn local press-fb"
            disabled={giving}
            aria-busy={giving || undefined}
            onClick={() => {
              hapticCommit();
              onGiveMoreRoom?.();
            }}
          >
            {MORE_ROOM_ACTION}
          </button>
          <span className="window-cut-sub">{moreRoomCost(item.gb)}</span>
        </div>
      ) : null}
      {given ? <p className="window-cut-done">{moreRoomGiven(item.model)}</p> : null}
      {item.room === 'full' ? (
        <p className="window-cut-body">
          {NO_ROOM_LINE}{' '}
          {onOpenStack ? (
            <button type="button" className="linklike press-fb" onClick={onOpenStack}>
              {OPEN_STACK}
            </button>
          ) : null}
        </p>
      ) : null}
      {item.error ? <div className="msg-note window-cut-error">{item.error}</div> : null}
    </div>
  );
}
