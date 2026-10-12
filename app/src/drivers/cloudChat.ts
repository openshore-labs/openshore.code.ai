// What the two direct cloud chats share (build 2026-09-29, package cloud): a
// Claude model or a connected provider's model, picked by itself rather than
// through the Stack. Both ride the one provider client (providerClient.ts), so
// they stream on every shell, and both keep the abort contract the Stack keeps
// (tech review ruling 7): Stop ends the turn at once, whatever the request is waiting
// on, with what arrived so far kept in the chat and in history; late data from
// a stopped request goes nowhere; a failure keeps its partial too.
import { humanizerStandardPrompt, type DriverEvent, type ModelClass } from 'os-code/protocol';
import type { DriverEmitter, DriverVaultOptions } from './types.js';

export interface CloudChatOptions extends DriverVaultOptions {
  /** Humanize Writing (Settings): false only when the person turned it off. */
  humanize?: boolean;
  /** Your writing voice (Settings, Writing; lib/writingVoice.ts). A cloud
   *  seat gets the voice, never the app actions contract (lib/appActions.ts). */
  writingVoice?: string;
  /** The model's display name for the reply label, such as Opus 5. The raw id
   *  when absent. */
  modelLabel?: string;
}

/** The Humanize Writing standard for a direct cloud chat, by the rule the
 *  Stack holds its seats to (stackDriver's `humanizerApplies` and
 *  `leanSeat`): on unless the person turned it off, and never on a seat too
 *  small to carry it. A cloud seat classes as large, so the setting decides;
 *  the class check keeps it one rule with the Stack's, and
 *  test/humanizeWriting.test.ts pins that the two agree. */
export function cloudHumanizer(
  humanize: boolean | undefined,
  modelClass: ModelClass | undefined,
): string | undefined {
  if (humanize === false || modelClass === 'tiny' || modelClass === 'small') return undefined;
  return humanizerStandardPrompt();
}

export type CloudTurnEnd = 'complete' | 'aborted' | 'error';

/**
 * One send in a direct cloud chat. Its events leave through here, and only
 * while it is open, so a stopped turn's late words, sources and usage are
 * dropped, and a run that unwinds after a new send began can never touch the
 * new turn. It ends exactly once.
 */
export class CloudTurn {
  private readonly controller = new AbortController();
  private closed = false;
  /** The answer so far: only what reached the screen. */
  answer = '';

  constructor(
    private readonly emitter: DriverEmitter,
    /** Keeps the turn's answer in the model's history: the whole reply (or
     *  the provider's own replay of it) when it completes, the partial when it
     *  is stopped or fails. */
    private readonly keep: (text: string, replay?: unknown) => void,
  ) {}

  /** Fires when the person presses Stop (or the chat closes). */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get open(): boolean {
    return !this.closed;
  }

  emit(event: DriverEvent): void {
    if (!this.closed) this.emitter.emit(event);
  }

  /** A slice of the answer, on screen now. */
  text(delta: string): void {
    if (this.closed || !delta) return;
    this.answer += delta;
    this.emitter.emit({ type: 'text-delta', text: delta });
  }

  /** End the turn once: the answer (or the part that arrived before a stop
   *  or a failure) goes to history and the chat, then the turn's ending. A
   *  `note` is said between the answer and the ending. */
  finish(reason: CloudTurnEnd, message?: string, end: { replay?: unknown; note?: string } = {}) {
    if (this.closed) return;
    const text = this.answer;
    // A whole reply is kept as it came; a partial only when it says something.
    if (reason === 'complete' || text.trim()) this.keep(text, end.replay);
    this.emitter.emit({ type: 'text-final', text });
    if (end.note) this.emitter.emit({ type: 'note', message: end.note });
    this.emitter.emit({ type: 'task-done', reason, message });
    this.closed = true;
  }

  /** Stop: the request is told to end, and the turn closes now, not when the
   *  request (or a native call that cannot be cancelled) comes back. */
  stop(): void {
    this.controller.abort();
    this.finish('aborted');
  }
}
