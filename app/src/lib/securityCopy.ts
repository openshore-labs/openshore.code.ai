// The security package's words, each exactly as UX review ruled it, in one place so
// the tests hold them: the secrets safety cards (UX review 7) and the truncated
// window card (UX review 6). A card reads its lines from here, never its own copy.
import type { StageSecret } from 'os-code/protocol';

// ---- the secrets safety cards (UX review 7) ----

/** On every approval card while the chat can see the project's secrets. */
export const LOCKDOWN_LINE =
  "This chat can see your project's Tokens and Secrets, so OpenShore asks before every command and commit.";

/** The pill on a file that may hold a secret. */
export const SECRET_PILL = 'May hold a secret';

/** Why a file may hold a secret, one plain sentence per reason. */
export const SECRET_REASON: Record<StageSecret, string> = {
  env: 'A settings file that often holds keys.',
  pem: 'A certificate or private key.',
  'login-key': 'A private login key.',
  detected: 'Has text that looks like a key or password.',
};

/** Above the list, when any file is flagged. UX review's words are plural; a single
 *  file reads the same sentence in the singular. */
export function flaggedLine(n: number): string {
  return n === 1
    ? '1 file may hold a secret. It stays out of this commit unless you tick it.'
    : `${n} files may hold secrets. They stay out of this commit unless you tick them.`;
}

/** Under a flagged file the person ticked. The platform is named only when
 *  the commit pushes (the app's sync sends the branch there). */
export function tickedWarning(pushesTo?: string): string {
  return `This file will be saved in the project's history${pushesTo ? `, and sent to ${pushesTo}` : ''}.`;
}

// ---- the truncated window card (UX review 6) ----

export function windowCutTitle(model: string): string {
  return `${model} could not see the whole chat`;
}

export const WINDOW_CUT_BODY =
  'Your computer gave it less room than this chat needs, so the start of the task, maybe your instructions, fell out of view. Its answer may miss something you asked for.';

export const MORE_ROOM_ACTION = 'Give it more room';

/** What the action costs, said before the tap: in GB when the model says. */
export function moreRoomCost(gb?: number): string {
  return gb !== undefined
    ? `Uses about ${gb} GB more memory. Replies get slower.`
    : 'Uses more memory. Replies get slower.';
}

export function moreRoomGiven(model: string): string {
  return `${model} has more room from your next message, in every chat.`;
}

export const NO_ROOM_LINE = 'This computer has no memory to spare for more. A shorter chat helps.';

export const OPEN_STACK = 'Open Stack';
