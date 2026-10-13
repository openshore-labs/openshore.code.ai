// The small model's true window, the loop's side (C1). Helpers the agent loop
// wires in, kept here so loop.ts only calls them: what one observation may
// carry for the seat, which failed calls
// count toward the cloud escalation offer, the notice that a server cut
// the prompt without a word, when a seat runs lean for its window, and the
// notice that even the lean prompt leaves little room (tech review 6).
import type { MoreRoom, Provider } from '../../providers/types.js';
import { looksTruncated } from '../../context/compaction.js';
import {
  OBSERVATION_MAX_CHARS,
  observationCapChars,
  type ModelClassProfile,
} from '../../harness/profile.js';
import type { AgentEvent } from './types.js';

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
 * A seat whose full fixed prompt (the system text and the tool menu) takes
 * more than this share of its served window gets the lean prompt and the
 * lean tool menu, whatever its class: the rest is the working margin the
 * chat, the files it reads and the answer need. A mid seat served Ollama's
 * default 4,096 carries about 7,000 tokens of full prompt, more than the
 * whole window. Placeholder until the eval, like the class fractions.
 */
export const WINDOW_LEAN_FRACTION = 0.4;

/** Past this share of the served window taken by the fixed prompt before the
 *  chat starts, even on the lean prompt, the person is told once per chat
 *  that the model has little room (the `window-tight` event). */
export const LITTLE_ROOM_FRACTION = 0.5;

/** Whether a fixed prompt of `fixedTokens` crowds a `windowTokens` window
 *  past `fraction`. An unknown window crowds nothing. */
export function crowds(fixedTokens: number, windowTokens: number, fraction: number): boolean {
  return windowTokens > 0 && fixedTokens > windowTokens * fraction;
}

/**
 * Watches each turn's served prompt against the loop's estimate and says,
 * once per chat per model, when the server cut it (UX review 6). The card offers
 * more room when the provider can serve it (tech review 5).
 */
export class WindowWatch {
  private noticed = new Set<string>();
  private tightNoticed = new Set<string>();

  /** The window-tight event when even the lean fixed prompt fills more than
   *  `LITTLE_ROOM_FRACTION` of the served window, once per chat per model;
   *  undefined otherwise. The same room offer as a cut. */
  async tight(
    provider: Provider,
    model: string,
    fixedTokens: number,
    windowTokens: number,
  ): Promise<AgentEvent | undefined> {
    if (!crowds(fixedTokens, windowTokens, LITTLE_ROOM_FRACTION)) return undefined;
    const key = `${provider.id}/${model}`;
    if (this.tightNoticed.has(key)) return undefined;
    this.tightNoticed.add(key);
    const room = await roomFor(provider, model);
    return {
      type: 'window-tight',
      model,
      provider: provider.id,
      fixedTokens,
      windowTokens,
      ...(room ? { room: room.room } : {}),
      ...(room?.room === 'more' && room.gb !== undefined ? { gb: room.gb } : {}),
    };
  }

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
    const room = await roomFor(provider, model);
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

/** What giving this model more room would do, or undefined when the
 *  provider cannot say. The offer is a courtesy; a notice stands without it. */
async function roomFor(provider: Provider, model: string): Promise<MoreRoom | undefined> {
  try {
    return await provider.moreRoom?.(model);
  } catch {
    return undefined;
  }
}

/** The little-room notice in plain lines, for the terminal clients, in the
 *  same words as the app's card. */
export function windowTightLines(event: Extract<AgentEvent, { type: 'window-tight' }>): string[] {
  const lines = [
    `${event.model} has little room left for this chat on this computer.`,
    'Its instructions and tools fill most of the room your computer gives it, so older messages get summarized sooner.',
  ];
  if (event.room === 'more') {
    const cost =
      event.gb !== undefined ? `Uses about ${event.gb} GB more memory.` : 'Uses more memory.';
    lines.push(
      `To give it more room, set "numCtx": "auto" on the ${event.provider} provider in your OS Code config. ${cost} Replies get slower.`,
    );
  }
  return lines;
}

/** The retrieval card in one plain line, for the terminal clients. */
export function retrievalLine(event: Extract<AgentEvent, { type: 'retrieval' }>): string {
  const places = event.sources.map((s) => `${s.path}:${s.line}`).join(', ');
  const n = event.sources.length;
  return `Started from ${n} place${n === 1 ? '' : 's'} in your code that match the task: ${places}.`;
}

/** The truncation card in plain lines, for the terminal clients (the app has
 *  its own card, with the action as a button). The words are the card's
 *  (UX review 6); the action names the setting, since a terminal has no button. */
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
