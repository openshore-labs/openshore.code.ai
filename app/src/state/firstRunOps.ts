// The first ten minutes (build 2026-09-29, package F1). A first message typed
// before anything can answer is held in the store, not in the chat screen, so
// a trip to a setup room (the Stack, pairing, a key) never loses it. On the
// desktop with nothing set up, the message waits on the First Seat and goes
// out the moment the engine has a model, as a plain chat that needs no
// account (CX ruling 2, CTO ruling 8). Signed out, the composer's own default
// is that free chat too, so a first message never runs into the sign-in sheet.
//
// The rules live here as plain functions a test reads without the store (CTO
// ruling 9); the store wires them into its hold, its settle, and the
// composer's default brain. Test: app/test/firstRunDesktop.test.ts.
import type { ConversationSource } from './types.js';
import { firstSeatNeeded } from '../lib/firstSeat.js';
import { HARBOR_MASTER_MODEL_NAME } from '../lib/harborMaster.js';

const SEAT = HARBOR_MASTER_MODEL_NAME;

/** CX ruling 2's words on the First Seat. `signIn` is one sentence with its
 *  middle words as the link that opens the plain Sign in sheet. */
export const FIRST_SEAT_COPY = {
  held: `Your message is saved. It sends when ${SEAT} is ready.`,
  signIn: {
    before: 'While you wait, you can ',
    link: 'sign in',
    after: ` so ${SEAT} can also work in your projects. Free, and not needed to chat.`,
  },
  failed: 'Your message is still saved.',
  sending: `${SEAT} is ready. Sending your message.`,
} as const;

/** A first message held in settings (`heldFirstMessage`). `untilReady` marks
 *  one waiting on the First Seat: it goes out by itself once the engine can
 *  answer. Without it the message goes back into the composer. */
export interface HeldFirstMessage {
  text: string;
  at: string;
  untilReady?: boolean;
}

/** What the store knows about this computer's engine (the desktop's status
 *  read), as far as these rules need it. */
export interface EngineStatusView {
  stack: { configured: boolean; orchestrator?: { kind: 'local' | 'cloud' } };
}

/** Whether this computer's engine can hold a free chat: a model is set up,
 *  and it is not a cloud model, since the free chat refuses a seat that
 *  leaves this network. */
export function engineChatReady(status: EngineStatusView | undefined): boolean {
  return Boolean(status?.stack.configured && status.stack.orchestrator?.kind !== 'cloud');
}

/** The brain a new chat starts on when the person has not picked one. The
 *  phone starts on the Stack. The desktop starts on its engine: the coding
 *  agent when no sign-in is needed, and signed out (the coding agent is
 *  behind a free sign-in) the free chat with the engine's own model, else a
 *  Stack that can answer, else the free chat again, which waits on the First
 *  Seat until a model is set up. */
export function defaultComposerSource(s: {
  desktop: boolean;
  needsAccount: boolean;
  engineChat: boolean;
  stackReady: boolean;
}): ConversationSource {
  if (!s.desktop) return { kind: 'stack' };
  if (!s.needsAccount) return { kind: 'desktop' };
  if (s.engineChat) return { kind: 'desktop-chat' };
  if (s.stackReady) return { kind: 'stack' };
  return { kind: 'desktop-chat' };
}

/** Whether a send that cannot be answered waits on the First Seat rather than
 *  opening the model chooser: the desktop, with its status read, no model
 *  set up and no cloud key, which is exactly when the First Seat is up. */
export function waitsOnFirstSeat(s: {
  desktop: boolean;
  statusKnown: boolean;
  configured: boolean;
  cloudReady: boolean;
}): boolean {
  if (!s.desktop) return false;
  return firstSeatNeeded({
    platform: 'electron',
    desktopStatusKnown: s.statusKnown,
    desktopConfigured: s.configured,
    stackReady: false,
    cloudReady: s.cloudReady,
    hubPaired: false,
  });
}

/** A second message typed while one waits: both go, in order, as one. */
export function joinHeld(prev: string | undefined, text: string): string {
  const before = prev?.trim();
  return before ? `${before}\n\n${text}` : text;
}

/** What to do with a held first message now:
 *  - `none`: nothing is held, the empty chat is not on screen, or the chooser
 *    has the message in hand;
 *  - `restore`: hand it back to the composer (the chooser was left for a setup
 *    room, or something other than the engine can answer now);
 *  - `send`: the engine can answer the waiting message, so it goes;
 *  - `wait`: it waits on the First Seat (or on the first status read). */
export type HeldPlan = 'none' | 'wait' | 'send' | 'restore';

export function heldMessagePlan(s: {
  held?: Pick<HeldFirstMessage, 'untilReady'>;
  /** The chat room is on screen with no chat open. */
  emptyChat: boolean;
  /** The model chooser is open. */
  chooserOpen: boolean;
  /** The brain a new chat would start on is this computer's engine (its
   *  agent, or the free chat) and it can answer. Something else that can
   *  answer (a Stack built meanwhile) gets the words back instead, since the
   *  card promised DeepBlue. */
  engineReady: boolean;
  /** The engine's status has been read at least once. */
  statusKnown: boolean;
  /** The First Seat is up (waitsOnFirstSeat). */
  seatUp: boolean;
}): HeldPlan {
  if (!s.held || !s.emptyChat || s.chooserOpen) return 'none';
  if (!s.held.untilReady) return 'restore';
  if (s.engineReady) return 'send';
  if (!s.statusKnown || s.seatUp) return 'wait';
  return 'restore';
}
