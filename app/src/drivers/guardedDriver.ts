// THE APP'S CHOKEPOINT.
//
// The engine makes the ethics layer unbypassable by handing out only guarded
// providers. The app does the same thing one level up: every conversation brain
// is a ChatDriver, every ChatDriver is built by one factory (buildDriver in
// state/store.ts), and that factory wraps each one in this decorator. So the
// cloud Claude path, every OpenAI-compatible provider, a bring-your-own-model
// endpoint, the on-device pocket models, the paired desktop, the free desktop
// chat, and the demo driver are all screened by construction, not by eight
// remembered edits.
//
// Both sides are covered. send() screens before anything reaches a model or the
// on-device runtime, and the event stream is screened before any answer reaches
// the transcript. Streamed text is held back until a screen clears it, so a
// blocked answer is never partially shown (see StreamScreener).
//
// A note on the engine-backed drivers. ElectronDriver and RemoteDriver reach an
// engine that guards itself, so they are screened twice. That is on purpose:
// the phone may be paired to a desktop running an older engine, and the app's
// own guarantee should not depend on the other machine's version.

import {
  StreamScreener,
  type DriverEvent,
  type ModelPath,
  type ScreenResult,
  type StreamStep,
} from 'os-code/protocol';
import type { Attachment } from '../lib/attachments.js';
import { appGuard, knownConsents, screenPrompt } from '../lib/ethics.js';
import type { ChatDriver, DriverEventSink } from './types.js';

/** What a driver talks to, for the record: on-device is local, the rest cloud. */
export function pathOfDriver(kind: ChatDriver['kind']): ModelPath {
  return kind === 'device' || kind === 'mock' ? 'local' : 'cloud';
}

class GuardedDriver {
  private sinks = new Set<DriverEventSink>();
  private seq = 0;
  private unsubscribe?: () => void;
  /** True while a screen is in flight; everything behind it waits in backlog. */
  private busy = false;
  private backlog: DriverEvent[] = [];
  private screener?: StreamScreener;
  private released = '';
  private blocked = false;

  constructor(
    private readonly inner: ChatDriver,
    private readonly modelPath: ModelPath,
  ) {}

  private emit(event: DriverEvent): void {
    const seq = ++this.seq;
    for (const sink of this.sinks) sink(event, seq);
  }

  subscribe(sink: DriverEventSink): () => void {
    this.sinks.add(sink);
    if (!this.unsubscribe) {
      this.unsubscribe = this.inner.subscribe((event) => this.accept(event));
    }
    return () => {
      this.sinks.delete(sink);
    };
  }

  /**
   * Take one event from the driver underneath, preserving order.
   *
   * Most events need no screening, and a text delta usually lands inside the
   * holdback without triggering one. Those are handled SYNCHRONOUSLY, which
   * matters: a journal replay arrives as hundreds of events in a single
   * synchronous burst, and awaiting each one would spread them across hundreds
   * of ticks and defeat the store's replay batching (APP-13).
   *
   * Only an event that actually needs a screen goes async, and while one is in
   * flight everything behind it waits in `backlog`, so ordering is never at the
   * mercy of promise scheduling.
   */
  private accept(event: DriverEvent): void {
    if (this.busy) {
      this.backlog.push(event);
      return;
    }
    const work = this.handle(event);
    if (!work) return;
    this.busy = true;
    void work
      .catch(() => undefined)
      .then(() => {
        this.busy = false;
        this.drain();
      });
  }

  /** Feed the backlog through once a screen has settled. */
  private drain(): void {
    while (!this.busy && this.backlog.length) {
      this.accept(this.backlog.shift()!);
    }
  }

  private newTask(): void {
    this.screener = new StreamScreener({
      guard: appGuard(),
      modelPath: this.modelPath,
      consents: knownConsents(),
    });
    this.released = '';
    this.blocked = false;
  }

  /**
   * Handle one event. Returns a promise ONLY when a screen has to run, so the
   * common cases stay synchronous. See accept() for why that matters.
   */
  private handle(event: DriverEvent): Promise<void> | undefined {
    if (event.type === 'task-start') {
      this.newTask();
      this.emit(event);
      return undefined;
    }
    if (this.blocked) {
      // After a block the rest of this answer is dropped. The lifecycle events
      // still pass so the composer does not sit spinning.
      if (event.type === 'task-done') this.emit(event);
      return undefined;
    }
    if (event.type === 'task-done') {
      // A turn can end WITHOUT a text-final: a journal replay is deltas then
      // task-done, and so is any driver that streams without a closing final.
      // Without this the holdback would never drain and the whole answer would
      // be silently lost, which is a worse failure than the one the holdback
      // prevents. Screen what is held, release it, then close the turn.
      if (this.screener?.text && this.screener.text !== this.released) {
        return this.drainThen(event);
      }
      this.emit(event);
      return undefined;
    }
    if (event.type === 'text-delta') {
      if (!this.screener) this.newTask();
      // Accept the text synchronously. It is held back either way; only the
      // delta that fills the holdback triggers a screen, and only that one
      // costs a tick.
      if (!this.screener!.offer(event.text)) return undefined;
      return this.screenStep(() => this.screener!.flush());
    }
    if (event.type === 'text-final') {
      if (!this.screener) this.newTask();
      // Some drivers deliver the whole answer as a final with no deltas. Feed
      // it in so the screen covers it either way.
      if (event.text && !this.screener!.text) this.screener!.offer(event.text);
      return this.finalize(event.text);
    }
    this.emit(event);
    return undefined;
  }

  /** Run one screen and release whatever it cleared. */
  private async screenStep(run: () => Promise<StreamStep>): Promise<void> {
    const step = await run();
    if (step.kind === 'blocked') {
      this.stopWith(step.result);
      return;
    }
    if (step.kind === 'release' && step.text) {
      this.released += step.text;
      this.emit({ type: 'text-delta', text: step.text });
    }
  }

  /** Release what the holdback still has, then pass the closing event on. */
  private async drainThen(event: DriverEvent): Promise<void> {
    const last = await this.screener!.finish();
    if (last.kind === 'blocked') {
      this.stopWith(last.result);
      return;
    }
    if (last.kind === 'release' && last.text) {
      this.released += last.text;
      this.emit({ type: 'text-delta', text: last.text });
    }
    this.emit(event);
  }

  /** Screen the complete answer, then close the turn out. */
  private async finalize(finalText: string): Promise<void> {
    const last = await this.screener!.finish();
    if (last.kind === 'blocked') {
      this.stopWith(last.result);
      return;
    }
    if (last.kind === 'release' && last.text) {
      this.released += last.text;
      this.emit({ type: 'text-delta', text: last.text });
    }
    this.emit({ type: 'text-final', text: this.released || finalText });
  }

  /** End the answer here: say what happened, keep what was already cleared. */
  private stopWith(result: ScreenResult): void {
    this.blocked = true;
    const message = result.decision.message ?? 'The rest of this answer was withheld.';
    this.emit({
      type: 'ethics-block',
      category: result.decision.category,
      tier: result.decision.tier,
      side: 'output',
      message,
    });
    this.emit({
      type: 'text-final',
      text: this.released ? `${this.released}\n\n${message}` : message,
    });
    this.emit({ type: 'task-done', reason: 'complete' });
    this.inner.abort();
  }

  send(text: string, attachments?: Attachment[]): void {
    void (async () => {
      // Attachments are images. They are not screened as text here, and the
      // layer does not claim to read them: what it screens is the instruction,
      // which is where a request to do something with an image is written.
      const result = await screenPrompt(text, this.modelPath);
      if (result.blocked) {
        const message = result.decision.message ?? 'This request was not sent.';
        this.newTask();
        this.blocked = true;
        this.emit({ type: 'task-start', input: text });
        this.emit({
          type: 'ethics-block',
          category: result.decision.category,
          tier: result.decision.tier,
          side: 'input',
          message,
        });
        this.emit({ type: 'text-final', text: message });
        this.emit({ type: 'task-done', reason: 'complete' });
        return;
      }
      this.inner.send(text, attachments);
    })();
  }

  abort(): void {
    this.inner.abort();
  }

  answerApproval(...args: Parameters<ChatDriver['answerApproval']>): void {
    this.inner.answerApproval(...args);
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.sinks.clear();
    this.inner.dispose();
  }
}

/**
 * Wrap a driver so nothing reaches a model, and nothing reaches the person,
 * without passing the ethics layer.
 *
 * The optional parts of the ChatDriver contract are forwarded only when the
 * inner driver actually has them, because the UI feature-detects them: a
 * decorator that answered to every method would light up a terminal button on a
 * cloud chat that has no terminal.
 */
export function guardDriver(inner: ChatDriver): ChatDriver {
  const guarded = new GuardedDriver(inner, pathOfDriver(inner.kind));
  const out: ChatDriver = {
    kind: inner.kind,
    // The driver underneath, for diagnostics and for tests that need to ask
    // "is this still the same driver, or was it dropped and rebuilt". Never a
    // route around the guard: nothing in the app reads this to send.
    wrapped: inner,
    send: (text, attachments) => guarded.send(text, attachments),
    abort: () => guarded.abort(),
    answerApproval: (id, answer) => guarded.answerApproval(id, answer),
    subscribe: (sink) => guarded.subscribe(sink),
    dispose: () => guarded.dispose(),
  };
  if (inner.setMode) out.setMode = (mode) => inner.setMode!(mode);
  if (inner.setInstructions) out.setInstructions = (text) => inner.setInstructions!(text);
  if (inner.compact) out.compact = (focus) => inner.compact!(focus);
  if (inner.listFiles) out.listFiles = (query) => inner.listFiles!(query);
  if (inner.runCommand) out.runCommand = (command) => inner.runCommand!(command);
  if (inner.sendStdin) out.sendStdin = (runId, data) => inner.sendStdin!(runId, data);
  if (inner.killCommand) out.killCommand = (runId) => inner.killCommand!(runId);
  if (inner.openTerminal) out.openTerminal = (opts) => inner.openTerminal!(opts);
  if (inner.terminalStream)
    out.terminalStream = (id, since, onChunk, signal) =>
      inner.terminalStream!(id, since, onChunk, signal);
  if (inner.terminalStdin) out.terminalStdin = (id, data) => inner.terminalStdin!(id, data);
  if (inner.terminalResize)
    out.terminalResize = (id, cols, rows) => inner.terminalResize!(id, cols, rows);
  if (inner.terminalKill) out.terminalKill = (id) => inner.terminalKill!(id);
  // Runtime flags some drivers set on themselves (a daemon that closed itself,
  // a terminated session). The store reads them off the driver it holds, which
  // is now this wrapper, so forward them live rather than copying once.
  for (const flag of ['closed', 'terminated'] as const) {
    Object.defineProperty(out, flag, {
      get: () => (inner as unknown as Record<string, unknown>)[flag],
      enumerable: false,
      configurable: true,
    });
  }
  return out;
}
