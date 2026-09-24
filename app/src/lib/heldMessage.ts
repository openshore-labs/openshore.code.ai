// A first message typed before any brain can answer is held while the model
// chooser opens. If the chooser closes without a pick, the message goes back
// into the composer, never into the void (brand sweep 2026-09-24, wave 1 #7).
import type { Attachment } from './attachments.js';

/** The toast that tells the person their words are still there. */
export const HELD_MESSAGE_KEPT = "Kept your message. Pick a model when you're ready.";

/** A held message to put back in the composer; a new `seq` restores again. */
export interface ComposerRestore {
  seq: number;
  text: string;
  attachments?: Attachment[];
}

export interface HeldMessage {
  text: string;
  attachments?: Attachment[];
}

/** The restore to hand the composer for a held message, one seq past the last
 *  so the same text can be handed back more than once. */
export function restoreFromHeld(held: HeldMessage, prev?: ComposerRestore): ComposerRestore {
  return {
    seq: (prev?.seq ?? 0) + 1,
    text: held.text,
    ...(held.attachments?.length ? { attachments: held.attachments } : {}),
  };
}
