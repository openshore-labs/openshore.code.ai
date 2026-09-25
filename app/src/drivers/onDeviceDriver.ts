// The pocket brain: a model running fully on this device through the llama
// plugin. Chat-only by design in v1 (repo tools live on the desktop
// connection), private by construction: nothing ever leaves the phone, except
// a web search the model explicitly asks for, which the user can point at
// their own key instead of the DuckDuckGo default.
import type { PluginListenerHandle } from '@capacitor/core';
import {
  SEARCH_PROTOCOL_NOTE,
  SearchLineFilter,
  ThinkTagSplitter,
  type ApprovalAnswer,
  type ThoughtPiece,
} from 'os-code/protocol';
import { Llama } from '../lib/llamaPlugin.js';
import {
  ABORT_BEAT_MS,
  DEVICE_CONTEXT_TOKENS,
  STALL_TIMEOUT_MS,
  emptyReplyMessage,
  ensureDeviceModel,
  fitDeviceHistory,
  forgetDeviceModel,
} from './deviceModel.js';
import { buildHarborSystemPrompt, isHarbor } from '../lib/harbor.js';
import { buildHarborMiniSystemPrompt, guidedSetupLine, isHarborMini } from '../lib/harborMini.js';
import { sanitizeGuideText } from '../lib/guideHarness.js';
import { prepareGuideTurn, searchForModel } from '../lib/localSearch.js';
import type { ChatDriver, DriverEventSink } from './types.js';
import { DriverEmitter } from './types.js';
import { chainOfThoughtLine, chainOfThoughtOn } from '../lib/chainOfThought.js';
import type { SeedTurn } from '../state/types.js';

const EM_DASH = String.fromCharCode(8212);

const SYSTEM_PROMPT = [
  'You are OpenShore, a friendly coding companion running fully on this device.',
  'Be concise and useful. Use markdown for code.',
  'You have no file access here. For repo work, the user can connect this app to their computer.',
  SEARCH_PROTOCOL_NOTE,
  'Whenever the person must paste something (a command, a query, a config line), put it in its own fenced code block, one per step, nothing else in the block. Never inline a command in a sentence.',
  'Never use em dashes. Use a period or a comma instead.',
].join('\n');

let requestSeq = 0;

export class OnDeviceDriver implements ChatDriver {
  readonly kind = 'device' as const;
  private emitter = new DriverEmitter();
  private history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private answer = '';
  private activeRequestId?: string;
  private listenersReady: Promise<void>;
  private deviceListeners: PluginListenerHandle[] = [];
  /** UI-1: ends the task from this side when the native runner goes quiet. */
  private watchdog?: ReturnType<typeof setTimeout>;
  /** Ends a stopped reply from this side when the runner never confirms the
   *  stop, so Stop always unsticks the chat (the stack's beat, here too). */
  private abortBeat?: ReturnType<typeof setTimeout>;
  /** Stop was pressed for the turn in flight. */
  private aborted = false;
  /** No turn is open: none has started, or it already ended (a Stop while
   *  the model loads or a search runs closes it at once), so whatever the
   *  unwinding run still says is dropped. */
  private settled = true;
  /** The run in flight, so a message sent after a Stop waits for it to unwind
   *  (a model load cannot be cancelled) instead of racing it. */
  private running: Promise<void> = Promise.resolve();
  private turn = 1;
  /** At most one search per user message, so a confused model can't loop. */
  private searchedThisTurn = false;
  /** Keeps a SEARCH: request off the screen while the reply streams. */
  private searchFilter = new SearchLineFilter(false);
  /** Chain of Thought for the reply in flight (read once per generation), and
   *  the splitter that keeps <think> text out of the answer either way. */
  private cot = false;
  private thinkSplitter = new ThinkTagSplitter();

  private readonly guide: boolean;
  /** Every pocket model searches by asking with a SEARCH: line, except Harbor
   *  Lite, whose guide harness searches for it before it writes a word. */
  private readonly searchable: boolean;
  /** Harbor Lite's prompt for the live turn, built by the guide harness from
   *  the question (only the facts it needs, any web results, any setup fit). */
  private turnPrompt?: string;
  /** The fixed line the chat shows after Harbor Lite's reply, whatever the
   *  model wrote: the past-my-size note, or the worked-out setup size. */
  private afterNote?: string;
  /** This chat's model is Harbor Lite, so the guide harness shapes its turns. */
  private readonly guideTurn: boolean;

  constructor(
    private readonly modelId: string,
    private readonly modelName: string,
    seed?: SeedTurn[],
    /** Research (default off): ground this local model's web search in
     *  Perplexity on the connected Perplexity key. Off falls back to the
     *  configured backend (Brave/Tavily) or DuckDuckGo. */
    private readonly researchOn = false,
    /** The project's standing instructions and the chat's repo context, so
     *  the pocket model works from the same brief as every other brain. */
    private readonly extraSystem?: string,
    /** The chat this driver answers for, so the guided setup's line reaches
     *  only the walk's own chat, whichever chat is on screen. */
    private readonly conversationId?: string,
  ) {
    this.searchable = !isHarborMini(modelId);
    this.guide = isHarborMini(modelId) || isHarbor(modelId);
    this.guideTurn = isHarborMini(modelId);
    // A mid-chat switch seeds the prior turns so this model continues the thread.
    if (seed) this.history = seed.map((t) => ({ role: t.role, content: t.text }));
    this.listenersReady = this.attachListeners();
  }

  private systemPrompt(): string {
    const base = isHarborMini(this.modelId)
      ? (this.turnPrompt ?? buildHarborMiniSystemPrompt('', this.conversationId))
      : isHarbor(this.modelId)
        ? buildHarborSystemPrompt()
        : SYSTEM_PROMPT;
    // Mid-walk, a model switched in from Harbor Lite still needs to know where
    // setup stands (Harbor Lite reads it inside its own prompt).
    const walk = isHarborMini(this.modelId) ? undefined : guidedSetupLine(this.conversationId);
    // Chain of Thought: Harbor Lite's scripted guide turns are left alone (a
    // 512-token reply and a card harness cannot carry a thought); any other
    // pocket model is asked to think in tags while the setting is on.
    const cot = this.guideTurn ? undefined : chainOfThoughtLine(this.modelId, this.cot);
    return [base, this.extraSystem?.trim(), walk, cot].filter(Boolean).join('\n\n');
  }

  /** Send the answer part of a reply on, and its thinking to the thinking
   *  block while Chain of Thought is on (nowhere while it is off). */
  private route(pieces: ThoughtPiece[]): void {
    for (const p of pieces) {
      if (p.kind === 'text') {
        this.answer += p.text;
        const shown = this.searchFilter.push(p.text);
        if (shown) this.emit({ type: 'text-delta', text: shown });
      } else if (this.cot) this.emit({ type: 'thinking-delta', text: p.text });
    }
  }

  private async attachListeners(): Promise<void> {
    // G3: keep the handles so dispose() can remove them. Without this, every
    // opened device chat leaks two Llama listeners (retaining the driver and
    // its history) for the life of the app.
    this.deviceListeners.push(
      await Llama.addListener('token', ({ requestId, delta }) => {
        if (requestId !== this.activeRequestId) return;
        this.armWatchdog(requestId);
        // Harbor Lite never shows an em dash (house rule); the final text
        // gets the full clean-up, the live stream just swaps the character.
        if (this.guideTurn) {
          const shown = delta.split(EM_DASH).join(',');
          this.answer += delta;
          if (shown) this.emit({ type: 'text-delta', text: shown });
          return;
        }
        this.route(this.thinkSplitter.push(delta));
      }),
    );
    this.deviceListeners.push(
      await Llama.addListener('generationDone', ({ requestId, stopReason, detail }) => {
        if (requestId !== this.activeRequestId) return;
        this.clearWatchdog();
        this.clearAbortBeat();
        this.activeRequestId = undefined;
        void this.handleDone(stopReason, detail);
      }),
    );
  }

  // A started reply that produces no token for STALL_TIMEOUT_MS is over as far
  // as this chat is concerned: the native side lost it (another chat's load
  // unloaded the model mid-reply, or the runner wedged). Tell it to stop, drop
  // the slot claim so the next send reloads, and end the task honestly.
  private armWatchdog(requestId: string): void {
    this.clearWatchdog();
    this.watchdog = setTimeout(() => {
      this.watchdog = undefined;
      if (this.activeRequestId !== requestId) return;
      this.activeRequestId = undefined;
      void Llama.stop({ requestId }).catch(() => {});
      forgetDeviceModel();
      void this.handleDone('error', 'The on-device model stopped answering. Try again.');
    }, STALL_TIMEOUT_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = undefined;
  }

  subscribe(sink: DriverEventSink): () => void {
    return this.emitter.subscribe(sink);
  }

  send(text: string): void {
    this.running = this.running.then(() => this.run(text)).catch(() => undefined);
  }

  /** Every event leaves through here: nothing after a turn has ended. */
  private emit(event: Parameters<DriverEmitter['emit']>[0]): void {
    if (event.type === 'task-start') this.settled = false;
    else if (this.settled) return;
    if (event.type === 'task-done') this.settled = true;
    this.emitter.emit(event);
  }

  private async run(text: string): Promise<void> {
    await this.listenersReady;
    this.turn = 1;
    this.searchedThisTurn = false;
    this.aborted = false;
    this.emit({ type: 'task-start', input: text });
    this.emit({
      type: 'turn-start',
      turn: this.turn,
      model: this.modelName,
      providerKind: 'local',
    });
    try {
      // The phone has one model slot shared by every device chat (APP-3), so
      // confirm this chat's model is the one loaded before every reply.
      // Every device model gets the same window: Harbor Lite's system prompt
      // alone outgrew the 2048 it used to load with.
      const ready = await ensureDeviceModel(
        {
          id: this.modelId,
          name: this.modelName,
          contextSize: DEVICE_CONTEXT_TOKENS,
        },
        (message) => this.emit({ type: 'status', message }),
      );
      // Stopped while the model loaded: the turn is already closed. The
      // message stays in history, the way it stays on screen.
      if (this.aborted) {
        this.history.push({ role: 'user', content: text });
        return;
      }
      if (!ready.ok) {
        this.emit({ type: 'task-done', reason: 'error', message: ready.detail });
        return;
      }
      if (isHarborMini(this.modelId)) await this.prepareGuideTurn(text);
      this.history.push({ role: 'user', content: text });
      if (this.aborted) return; // stopped during the guide's web search
      await this.generate();
    } catch (err) {
      this.clearWatchdog();
      this.activeRequestId = undefined;
      this.emit({
        type: 'task-done',
        reason: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // The guide harness does the mechanical work before Harbor Lite writes a
  // word: it picks the facts this question needs, searches the web when the
  // app facts do not cover a factual question, and works out any setup fit.
  // A search that fails (offline, rate limited) is said plainly, never faked.
  private async prepareGuideTurn(text: string): Promise<void> {
    const turn = await prepareGuideTurn(
      text,
      this.researchOn,
      (e) => this.emit(e),
      true,
      this.conversationId,
    );
    this.afterNote = turn.after;
    this.turnPrompt = turn.prompt;
  }

  private async generate(): Promise<void> {
    this.answer = '';
    this.searchFilter = new SearchLineFilter(this.searchable && !this.searchedThisTurn);
    this.cot = chainOfThoughtOn();
    this.thinkSplitter = new ThinkTagSplitter();
    const requestId = `req_${requestSeq++}`;
    this.activeRequestId = requestId;
    const system = this.systemPrompt();
    // A thought needs room beside the answer, so a reasoning reply gets more.
    const base = this.guide ? (this.searchable ? 768 : 512) : 1024;
    const maxTokens = this.cot && !this.guideTurn ? base * 2 : base;
    const res = await Llama.generate({
      requestId,
      system,
      // Only the newest turns that fit the window beside the prompt, so a long
      // chat never overflows it and comes back empty.
      messages: fitDeviceHistory(system, this.history, maxTokens),
      maxTokens,
      temperature: this.guide ? 0.4 : 0.7,
    });
    // A refused start already reported generationDone; only a started reply
    // needs the watchdog.
    if (res?.started === false) return;
    this.armWatchdog(requestId);
  }

  private async handleDone(
    stopReason: 'end' | 'stopped' | 'error',
    detail?: string,
  ): Promise<void> {
    if (!this.guideTurn) this.route(this.thinkSplitter.end());
    const text = this.guideTurn ? sanitizeGuideText(this.answer).trim() : this.answer.trim();
    const { query, flush } = this.searchFilter.end();
    if (stopReason === 'error') {
      // Whatever the slot holds after an error is suspect; reload next time.
      forgetDeviceModel();
      if (text) this.history.push({ role: 'assistant', content: text });
      this.emit({ type: 'text-final', text });
      this.emit({
        type: 'task-done',
        reason: 'error',
        message:
          detail ??
          'The on-device model hit a problem. Try again, or download it again from Settings, Harbor.',
      });
      return;
    }

    if (query && stopReason === 'end') {
      this.searchedThisTurn = true;
      // The search line itself is a control message, not a real reply: leave
      // it out of the visible transcript and out of history, so the model
      // does not later "remember" having already announced it.
      const resultText = await searchForModel(query, this.researchOn, (e) => this.emit(e));
      // Stopped during the search: the turn is already closed.
      if (this.aborted) return;
      this.history.push({ role: 'user', content: resultText });
      this.turn += 1;
      this.emit({
        type: 'turn-start',
        turn: this.turn,
        model: this.modelName,
        providerKind: 'local',
      });
      try {
        await this.generate();
      } catch (err) {
        this.activeRequestId = undefined;
        this.emit({
          type: 'task-done',
          reason: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    if (flush) this.emit({ type: 'text-delta', text: flush });
    if (text) this.history.push({ role: 'assistant', content: text });
    this.emit({ type: 'text-final', text });
    const after = this.afterNote;
    this.afterNote = undefined;
    if (after && text && stopReason === 'end') {
      this.emit({ type: 'note', message: after });
    }
    // A finished reply with no words is a failure, not a quiet success: say
    // so, rather than leaving the chat on its "Warming up" line.
    if (!text && stopReason === 'end') {
      this.emit({
        type: 'task-done',
        reason: 'error',
        message: emptyReplyMessage(this.modelName),
      });
      return;
    }
    this.emit({
      type: 'task-done',
      reason: stopReason === 'stopped' ? 'aborted' : 'complete',
    });
  }

  abort(): void {
    this.aborted = true;
    const requestId = this.activeRequestId;
    if (requestId) {
      void Llama.stop({ requestId }).catch(() => {});
      // The runner answers a stop with generationDone('stopped'); when it
      // does not (the request was already lost), end the turn a beat later.
      this.clearAbortBeat();
      this.abortBeat = setTimeout(() => {
        this.abortBeat = undefined;
        if (this.activeRequestId !== requestId) return;
        this.activeRequestId = undefined;
        this.clearWatchdog();
        forgetDeviceModel();
        void this.handleDone('stopped');
      }, ABORT_BEAT_MS);
      return;
    }
    // Nothing is generating yet (the model is loading, or a web search is
    // running): close the turn now so Stop answers at once. The run notices
    // the flag when its wait ends and never starts the reply. With no turn
    // open there is nothing to stop.
    if (this.settled) return;
    // No words of this turn's reply exist yet (a streamed search line is a
    // control message, not a reply), so the final text is empty.
    this.emit({ type: 'text-final', text: '' });
    this.emit({ type: 'task-done', reason: 'aborted', message: 'Stopped.' });
  }

  private clearAbortBeat(): void {
    if (this.abortBeat) clearTimeout(this.abortBeat);
    this.abortBeat = undefined;
  }

  recordLine(turn: SeedTurn): void {
    this.history.push({ role: turn.role, content: turn.text });
  }

  answerApproval(_approvalId: string, _answer: ApprovalAnswer): void {
    // On-device chat has no user-approved tools: search runs unprompted, the
    // same way it would for a person typing a question into a search engine.
  }

  dispose(): void {
    // Silent first: a teardown is not a Stop the chat should record.
    this.emitter.clear();
    this.abort();
    this.clearWatchdog();
    this.clearAbortBeat();
    for (const h of this.deviceListeners) void h.remove();
    this.deviceListeners = [];
  }
}
