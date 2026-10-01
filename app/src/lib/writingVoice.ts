// Your writing voice (founder, 2026-10-01): the person's own words for how a
// model should write for them, typed under Settings, Writing. It stands on its
// own or layers on Humanize Writing: Humanize keeps text free of AI tells, the
// voice says whose voice it is. Every app-side seat reads it (the Stack, a
// direct cloud key, a pocket model), the way a project's standing
// instructions ride along; it is the person's own instruction, not app state,
// so it goes wherever the chat goes.
//
// Settings offers a way to shape one with a model: a new chat opens with
// WRITING_VOICE_CHAT_PROMPT in the composer, the person finishes the sentence,
// and a local model hands the result back as an app action
// (lib/appActions.ts) the person can add to Settings with one tap.

/** The most a voice may hold. A voice is a few lines of instruction, and it
 *  rides on every turn, so a pocket model's 4k window must still fit the chat. */
export const WRITING_VOICE_MAX = 1500;

/** The opening of the shaping chat, left open for the person to finish. */
export const WRITING_VOICE_CHAT_PROMPT =
  'Provide the OpenShore customized writing prompt so that written responses return in the style of ';

/** The voice as it is kept: trimmed and held to the cap. Empty reads as none. */
export function cleanWritingVoice(voice: string | undefined): string | undefined {
  const t = voice?.trim();
  if (!t) return undefined;
  return t.length > WRITING_VOICE_MAX ? t.slice(0, WRITING_VOICE_MAX).trimEnd() : t;
}

/** The system-prompt line for a voice, or undefined when none is set. */
export function writingVoiceLine(voice: string | undefined): string | undefined {
  const v = cleanWritingVoice(voice);
  if (!v) return undefined;
  return [
    'The person set their own writing voice. Write anything you write for them (replies, docs, messages, copy) in it, unless they ask otherwise in the chat:',
    v,
  ].join('\n');
}
