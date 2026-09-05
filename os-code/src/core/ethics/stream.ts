// Screening a streamed completion without giving up streaming.
//
// The rule the layer has to honor is "nothing is shown or saved before it has
// been screened." The naive way to get that is to buffer the whole answer,
// screen it once, and then print it, which turns every reply into a wait.
//
// This does it differently, and the guarantee is exact: text is released only
// after a screen that covered it came back clean. New tokens accumulate in a
// holdback buffer; every few hundred characters the accumulated text is
// screened, and only then does the buffer drain to the caller. When a screen
// blocks, the holdback is discarded and nothing further is released, so the
// tokens that completed the violation never reach the person.
//
// Cost: the incremental screens run over a trailing window rather than the
// whole transcript, which is sound because every co-occurrence rule in
// classify.ts uses a proximity window far smaller than this one. The final
// screen, before the last of the text is released, covers the complete answer.

import type { EthicsGuard, ModelPath, ScreenResult } from './chokepoint.js';

/** Characters of accumulated text each incremental screen looks back over. */
export const SCREEN_WINDOW = 4000;
/** Characters that accumulate before an incremental screen runs. */
export const SCREEN_BATCH = 400;

export interface StreamScreenerDeps {
  guard: EthicsGuard;
  modelPath: ModelPath;
  consents?: Parameters<EthicsGuard['screenOutput']>[0]['consents'];
}

export type StreamStep =
  /** Safe to show: release exactly this text. */
  | { kind: 'release'; text: string }
  /** Nothing to release yet; it is being held back until a screen clears it. */
  | { kind: 'hold' }
  /** Screened and blocked. Release nothing more; show the message instead. */
  | { kind: 'blocked'; result: ScreenResult };

export class StreamScreener {
  /** Everything the model has produced, released or not. */
  private full = '';
  /** Produced but not yet cleared for release. */
  private pending = '';
  private blocked = false;

  constructor(private readonly deps: StreamScreenerDeps) {}

  /** The complete text so far, including the part still held back. */
  get text(): string {
    return this.full;
  }

  /**
   * Take one delta from the provider. Returns what may now be shown, which is
   * nothing until a screen clears it.
   */
  async push(delta: string): Promise<StreamStep> {
    if (this.blocked) return { kind: 'hold' };
    if (!this.offer(delta)) return { kind: 'hold' };
    return this.screenAndDrain(this.tailWindow());
  }

  /**
   * Accept a delta WITHOUT screening, and say whether a screen is now due.
   *
   * This is the synchronous half of push(). It exists because a caller that
   * awaits every delta turns a synchronously delivered burst (a journal replay
   * is hundreds of events handed over in one go) into hundreds of separate
   * ticks, which defeats any batching downstream. A caller can offer deltas
   * synchronously and only go async on the delta that actually triggers a
   * screen, or at finish().
   *
   * Returns false while the text is still inside the holdback, true when
   * enough has accumulated that it must be screened before any of it is shown.
   * Nothing is released either way: the holdback rule is unchanged.
   */
  offer(delta: string): boolean {
    if (this.blocked) return false;
    this.full += delta;
    this.pending += delta;
    return this.pending.length >= SCREEN_BATCH;
  }

  /** Screen what has accumulated and release it if it is clean. Pairs with offer(). */
  async flush(): Promise<StreamStep> {
    if (this.blocked) return { kind: 'hold' };
    return this.screenAndDrain(this.tailWindow());
  }

  /**
   * The stream ended. Screens the COMPLETE text, then releases whatever is
   * left. Always call this: without it the holdback never drains.
   */
  async finish(): Promise<StreamStep> {
    if (this.blocked) return { kind: 'hold' };
    if (!this.full) return { kind: 'release', text: '' };
    return this.screenAndDrain(this.full);
  }

  private tailWindow(): string {
    return this.full.length <= SCREEN_WINDOW ? this.full : this.full.slice(-SCREEN_WINDOW);
  }

  private async screenAndDrain(text: string): Promise<StreamStep> {
    const result = await this.deps.guard.screenOutput({
      text,
      modelPath: this.deps.modelPath,
      consents: this.deps.consents,
    });
    if (result.decision.action === 'block') {
      // Discard the holdback. The tokens that completed the violation are in
      // here, and they do not get out.
      this.blocked = true;
      this.pending = '';
      return { kind: 'blocked', result };
    }
    const release = this.pending;
    this.pending = '';
    return { kind: 'release', text: release };
  }
}
