// App actions (founder, 2026-10-01): a model on this person's own hardware can
// offer to change a piece of the app for them, and the person taps to apply
// it. The model never changes anything itself. It proposes one exact value in
// a fenced block tagged `openshore-set:<key>`, the chat renders that block as
// a card (components/AppActionCard.tsx) with Add to Settings and Copy, and
// only the tap writes the setting.
//
// Local seats only. The contract that tells a model it may propose an action
// rides only into a seat whose requests stay on this network (judged by
// address, `leavesNetwork`, never by a provider's label), so a cloud provider
// is never told about the app's controls (the founder's privacy line). A cloud
// seat still answers; the person copies its answer in by hand.
//
// And only when the chat asks for one (2026-10-02). Riding on every turn, the
// contract read to a 4B seat as the task itself: asked for a briefing, Harbor
// wrote an empty `writingVoice` fence and the closing question instead. Now a
// key is offered only once a person's turn in this chat asks for it (`asks`),
// so the shaping chat carries it from its first line on and any other chat
// never does.
//
// Every key a model may set is listed in APP_ACTIONS, with its own check of
// the value. A new piece of the app joins by adding an entry here: the
// contract, the parser and the card all read this one list.

import type { AppSettings } from '../state/store.js';
import { WRITING_VOICE_MAX, cleanWritingVoice } from './writingVoice.js';

/** The fence language a proposal is tagged with: `openshore-set:<key>`. */
export const APP_ACTION_FENCE = 'openshore-set';

export interface AppActionSpec {
  /** What the card calls the setting. */
  label: string;
  /** A person's turn that asks for this setting's value. */
  asks: RegExp;
  /** One line for the model: what the setting is and what a good value is. */
  forModel: string;
  /** Where the card says the value lands, for the toast and the button. */
  where: string;
  /** The settings change for a proposed value, or undefined when the value
   *  is not one this setting takes (the card then offers Copy only). */
  apply(value: string): Partial<AppSettings> | undefined;
}

export const APP_ACTIONS = {
  writingVoice: {
    label: 'Your writing voice',
    // The shaping chat's own opening, or a person naming the setting.
    asks: /\bwriting (?:voice|prompt)\b|\bcustomi[sz]ed writing\b/i,
    forModel: `writingVoice: the person's own writing voice, plain instructions a model follows when it writes for them (tone, rhythm, words to use and avoid), at most ${WRITING_VOICE_MAX} characters.`,
    where: 'Settings, Writing',
    apply(value: string) {
      const v = cleanWritingVoice(value);
      return v ? { writingVoice: v } : undefined;
    },
  },
} satisfies Record<string, AppActionSpec>;

export type AppActionKey = keyof typeof APP_ACTIONS;

export function isAppActionKey(key: string): key is AppActionKey {
  return Object.prototype.hasOwnProperty.call(APP_ACTIONS, key);
}

/** The keys a person's turns in this chat ask for, in list order. */
export function appActionsAsked(userTurns: readonly string[]): AppActionKey[] {
  return (Object.keys(APP_ACTIONS) as AppActionKey[]).filter((k) =>
    userTurns.some((t) => APP_ACTIONS[k].asks.test(t)),
  );
}

/** The contract for a seat, or undefined for one whose requests leave this
 *  network or a chat that has not asked for a setting. Short on purpose, and
 *  it names only the settings asked for. */
export function appActionsContract(
  leavesNetwork: boolean,
  userTurns: readonly string[],
): string | undefined {
  if (leavesNetwork) return undefined;
  const asked = appActionsAsked(userTurns);
  if (asked.length === 0) return undefined;
  const first = asked[0]!;
  return [
    'You run on hardware this person controls, and they asked for a value for one of their OpenShore settings (listed below). Only when your answer is that value: put the whole value, written out in full, alone in a fenced block tagged `' +
      APP_ACTION_FENCE +
      ':<key>`, then ask whether they want it added to their Settings or would rather copy it in themselves. For example:',
    '```' + APP_ACTION_FENCE + ':' + first,
    '<the full value you wrote for them>',
    '```',
    'For any other request, just answer it, with no such block. The app shows the block with an Add to Settings button; nothing changes until they tap it. Never claim you changed a setting.',
    'Settings they asked for:',
    ...asked.map((k) => `- ${APP_ACTIONS[k].forModel}`),
  ].join('\n');
}

/** The key a code element's class names, when it is an app action fence:
 *  `language-openshore-set:writingVoice` reads as `writingVoice`. A small
 *  model sometimes drops the prefix, so a fence tagged with a listed key
 *  alone (`language-writingVoice`, any case) reads the same. */
export function appActionKeyFromClass(className: string | undefined): AppActionKey | undefined {
  const cls = className ?? '';
  const m = /(?:^|\s)language-openshore-set:([A-Za-z]+)/.exec(cls);
  if (m) return isAppActionKey(m[1]) ? m[1] : undefined;
  const bare = /(?:^|\s)language-([A-Za-z]+)(?:\s|$)/.exec(cls)?.[1]?.toLowerCase();
  return bare
    ? (Object.keys(APP_ACTIONS) as AppActionKey[]).find((k) => k.toLowerCase() === bare)
    : undefined;
}

export interface AppActionProposal {
  key: AppActionKey;
  value: string;
}

/** Every proposal in a reply, in order. Unknown keys are left as plain code. */
export function parseAppActions(markdown: string): AppActionProposal[] {
  const out: AppActionProposal[] = [];
  const re = /^```openshore-set:([A-Za-z]+)[^\n]*\n([\s\S]*?)^```/gm;
  for (let m = re.exec(markdown); m; m = re.exec(markdown)) {
    if (isAppActionKey(m[1])) out.push({ key: m[1], value: m[2].replace(/\n$/, '') });
  }
  return out;
}
