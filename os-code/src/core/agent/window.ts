// The small model's true window, the loop's side (C1). Helpers the agent loop
// wires in, kept here so loop.ts only calls them: the platform word in the
// prompt, what one observation may carry for the seat, which failed calls
// count toward the cloud escalation offer, and the notice that a server cut
// the prompt without a word.
import type { MoreRoom, Provider } from '../../providers/types.js';
import { looksTruncated } from '../../context/compaction.js';
import {
  OBSERVATION_MAX_CHARS,
  observationCapChars,
  type ModelClassProfile,
} from '../../harness/profile.js';
import type { AgentEvent } from './types.js';

/** The operating system in words a model knows, for the workspace line of
 *  the system prompt: a model told linux on a Mac reaches for the wrong
 *  commands. Linux stays "linux", the word the prompt has always carried. */
export function platformWord(platform: NodeJS.Platform = process.platform): string {
  switch (platform) {
    case 'darwin':
      return 'macOS';
    case 'win32':
      return 'Windows';
    default:
      return platform;
  }
}

/** The most characters one tool observation carries for the seat answering
 *  now: its class's share of the served window. No profile (harness profiles
 *  off) or no window yet keeps the fixed cap, as before. */
export function seatObservationCap(
  profile: ModelClassProfile | undefined,
  contextTokens: number,
): number {
  if (!profile || !contextTokens) return OBSERVATION_MAX_CHARS;
  return observationCapChars(profile.observationContextFraction, contextTokens);
}

/** Room left above the cap before the loop cuts an observation itself: a
 *  tool that sizes its own output to the cap (readFile at a line, a vault
 *  read at a section) adds a short header on top, and is left whole. */
export const OBSERVATION_SLACK_CHARS = 1_000;

/**
 * How one call ended, for the cloud escalation offer. 'failed' is the call
 * running and failing (the tool's own error, a crash); 'refused' is a call the
 * harness or the person did not let run (a decline, plan mode, a deny rule, a
 * path outside the workspace, a repeat answered from the record). Only a
 * failure says the model is struggling; a refusal is the person or the policy
 * speaking, and offering cloud spend for it would be the wrong answer.
 */
export type CallOutcome = 'ok' | 'failed' | 'refused';

/** The next count toward the escalation offer after one turn's calls: up on
 *  a failure or a parse problem, back to zero on a turn that ran cleanly,
 *  unchanged on a turn of refusals only. */
export function nextFailStreak(
  streak: number,
  outcomes: readonly CallOutcome[],
  parseProblems: number,
): number {
  if (parseProblems > 0 || outcomes.includes('failed')) return streak + 1;
  if (outcomes.includes('ok')) return 0;
  return streak;
}

/**
 * Watches each turn's served prompt against the loop's estimate and says,
 * once per chat per model, when the server cut it (CX 6). The card offers
 * more room when the provider can serve it (CTO 5).
 */
export class WindowWatch {
  private noticed = new Set<string>();

  /** The window-cut event for this turn, or undefined when the server read
   *  the prompt whole (or this model was already noticed in this chat).
   *  `read` is what the server took in, cache reads and writes included. */
  async check(
    provider: Provider,
    model: string,
    read: number,
    estimated: number,
  ): Promise<AgentEvent | undefined> {
    if (!looksTruncated(read, estimated)) return undefined;
    const key = `${provider.id}/${model}`;
    if (this.noticed.has(key)) return undefined;
    this.noticed.add(key);
    let room: MoreRoom | undefined;
    try {
      room = await provider.moreRoom?.(model);
    } catch {
      // The offer is a courtesy; the notice stands without it.
    }
    return {
      type: 'window-cut',
      model,
      provider: provider.id,
      read,
      estimated,
      ...(room ? { room: room.room } : {}),
      ...(room?.room === 'more' && room.gb !== undefined ? { gb: room.gb } : {}),
    };
  }
}

/** The truncation card in plain lines, for the terminal clients (the app has
 *  its own card, with the action as a button). The words are the card's
 *  (CX 6); the action names the setting, since a terminal has no button. */
export function windowCutLines(event: Extract<AgentEvent, { type: 'window-cut' }>): string[] {
  const lines = [
    `${event.model} could not see the whole chat.`,
    'Your computer gave it less room than this chat needs, so the start of the task, maybe your instructions, fell out of view. Its answer may miss something you asked for.',
  ];
  if (event.room === 'more') {
    const cost =
      event.gb !== undefined ? `Uses about ${event.gb} GB more memory.` : 'Uses more memory.';
    lines.push(
      `To give it more room, set "numCtx": "auto" on the ${event.provider} provider in your OS Code config. ${cost} Replies get slower.`,
    );
  } else if (event.room === 'full') {
    lines.push('This computer has no memory to spare for more. A shorter chat helps.');
  }
  return lines;
}
