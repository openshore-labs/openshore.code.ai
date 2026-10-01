// App actions and the shaping chat, apart from the store (the sibling-module
// rule). The store wires them into applyAppAction, startWritingVoiceChat and
// the composer seed the chat screen reads. Test: app/test/appActions.test.ts.
import { APP_ACTIONS, isAppActionKey } from '../lib/appActions.js';
import { WRITING_VOICE_CHAT_PROMPT } from '../lib/writingVoice.js';
import type { AppSettings } from './store.js';

/** Text handed to the next chat's composer, once. `seq` moves on every seed
 *  so the same text can be handed again. */
export interface ComposerSeed {
  seq: number;
  text: string;
}

export function nextComposerSeed(prev: ComposerSeed | undefined, text: string): ComposerSeed {
  return { seq: (prev?.seq ?? 0) + 1, text };
}

/** The seed for the writing voice's shaping chat. */
export function writingVoiceSeed(prev: ComposerSeed | undefined): ComposerSeed {
  return nextComposerSeed(prev, WRITING_VOICE_CHAT_PROMPT);
}

/** The settings change and the toast for a tapped proposal, or undefined for
 *  a key the app does not know or a value the setting does not take. */
export function appActionPlan(
  key: string,
  value: string,
): { patch: Partial<AppSettings>; toast: string } | undefined {
  if (!isAppActionKey(key)) return undefined;
  const spec = APP_ACTIONS[key];
  const patch = spec.apply(value);
  if (!patch) return undefined;
  return { patch, toast: `${spec.label} saved to ${spec.where}.` };
}
