// Where a voice conversation pauses, and whether that pause is answered by voice
// or hands you back to the screen. This is the core of the founder's ask: keep
// the talking flowing where it is safe (a clarifying question, approving a
// plan), but the moment the model needs you to authorize your machine, spend
// money, or pick from a list, close voice, show the card, and reopen once you
// have tapped.
//
// A pure module on purpose: the hook, the overlay, and the tests all read the
// same rules from here, and the policy lives in one obvious table. No em dashes.
import type { ApprovalRequest } from 'os-code/protocol';
import type { ThreadItem } from '../../state/types.js';

export type VoiceBreakKind = 'clarify' | 'plan' | 'approval-tool' | 'approval-spend' | 'stopped';

/** Answer the break by voice (read it out, take a spoken reply), or break to the
 *  screen (exit voice, show the card, reopen after the tap). */
export type VoiceBreakWhere = 'voice' | 'screen';

/** The single source of truth for the founder's policy (2026-09-06): the
 *  conversational decisions stay in voice; authorizing the machine, spending
 *  money, and picking from a visual list hand you back to the screen. Change a
 *  row here and every surface follows. */
export const VOICE_BREAK_POLICY: Record<VoiceBreakKind, VoiceBreakWhere> = {
  clarify: 'voice',
  plan: 'voice',
  'approval-tool': 'screen',
  'approval-spend': 'screen',
  stopped: 'screen',
};

export interface VoiceBreak {
  kind: VoiceBreakKind;
  /** What the voice reads to the person at the break. */
  say: string;
  where: VoiceBreakWhere;
  /** For a clarify break answered by voice: the offered options, so a spoken
   *  reply can be matched to one before falling back to sending it verbatim. */
  options?: string[];
}

/** The minimum a voice session needs to know about a thread to find its break. */
export interface VoiceThreadView {
  items: ThreadItem[];
  pendingApprovals: ApprovalRequest[];
}

/** The break the conversation is sitting on right now, or null if it is free to
 *  keep going. Approvals win over a trailing card, because an approval blocks the
 *  run and can arrive mid-answer. */
export function detectVoiceBreak(thread: VoiceThreadView): VoiceBreak | null {
  const approval = thread.pendingApprovals[0];
  if (approval) {
    const spend = approval.kind === 'cloud-spend';
    const kind: VoiceBreakKind = spend ? 'approval-spend' : 'approval-tool';
    const say = spend
      ? `This step wants to spend on the cloud: ${approval.summary}. I have brought up the approval on screen for you.`
      : `This step needs your approval to ${approval.summary}. I have brought it up on screen for you.`;
    return { kind, say, where: VOICE_BREAK_POLICY[kind] };
  }

  const last = thread.items[thread.items.length - 1];
  if (!last) return null;

  if (last.kind === 'plan' && last.status === 'proposed') {
    return {
      kind: 'plan',
      say: 'I have a plan ready. Say "start building" to go ahead, or "change something" to revise it.',
      where: VOICE_BREAK_POLICY.plan,
    };
  }

  if (last.kind === 'clarify') {
    const first = last.questions[0];
    const options = first?.options;
    const optionLine = options && options.length ? ` You can say: ${options.join(', ')}.` : '';
    return {
      kind: 'clarify',
      say: `${last.summary} ${first?.question ?? ''}${optionLine}`.trim(),
      where: VOICE_BREAK_POLICY.clarify,
      options: options,
    };
  }

  if (last.kind === 'stopped') {
    return {
      kind: 'stopped',
      say: `The turn stopped. ${last.message} I have brought the chat back up so you can retry or switch models.`,
      where: VOICE_BREAK_POLICY.stopped,
    };
  }

  return null;
}

/** Match a spoken reply to one of the offered options, so "the second one" or a
 *  near-quote of an option lands on that option rather than being sent verbatim.
 *  Returns the option string, or null to send the transcript as free text (which
 *  the clarify flow already accepts). */
export function matchOption(transcript: string, options: string[] | undefined): string | null {
  if (!options || !options.length) return null;
  const said = transcript.trim().toLowerCase();
  if (!said) return null;
  // A near-exact or containment match, either direction, is the option.
  for (const opt of options) {
    const o = opt.trim().toLowerCase();
    if (o && (said === o || said.includes(o) || o.includes(said))) return opt;
  }
  // Ordinal words and bare digits map to the option at that position. The plain
  // number words (one, two) are deliberately left out: "the second one" contains
  // "one" and must land on the second option, not the first.
  const ordinals: Array<[RegExp, number]> = [
    [/\bfirst\b/, 0],
    [/\bsecond\b/, 1],
    [/\bthird\b/, 2],
    [/\bfourth\b/, 3],
    [/\b1\b/, 0],
    [/\b2\b/, 1],
    [/\b3\b/, 2],
    [/\b4\b/, 3],
  ];
  for (const [re, idx] of ordinals) {
    if (re.test(said) && idx < options.length) return options[idx]!;
  }
  return null;
}

/** A spoken answer to a proposed plan: go ahead, revise it, or unclear. Kept
 *  generous on the "go" side because that is the common case, and cautious about
 *  reading a bare "no" as anything but "change it". */
export function planIntent(transcript: string): 'approve' | 'revise' | null {
  const said = transcript.trim().toLowerCase();
  if (!said) return null;
  if (
    /\b(start|build|building|go ahead|go|proceed|do it|yes|yep|yeah|approve|sounds good|looks good|ok|okay)\b/.test(
      said,
    )
  ) {
    return 'approve';
  }
  if (/\b(change|revise|edit|adjust|different|not quite|wait|hold on|no|nope|stop)\b/.test(said)) {
    return 'revise';
  }
  return null;
}
