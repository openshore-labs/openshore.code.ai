// The pocket brain: a model running fully on this device through the llama
// plugin. Chat-only by design in v1 (repo tools live on the desktop
// connection), private by construction: nothing ever leaves the phone, except
// a web search the model explicitly asks for, which the user can point at
// their own key instead of the DuckDuckGo default.
import type { PluginListenerHandle } from '@capacitor/core';
import { SEARCH_PROTOCOL_NOTE, SearchLineFilter, type ApprovalAnswer } from 'os-code/protocol';
import { Llama } from '../lib/llamaPlugin.js';
import {
  DEVICE_CONTEXT_TOKENS,
  STALL_TIMEOUT_MS,
  emptyReplyMessage,
  ensureDeviceModel,
  fitDeviceHistory,
  forgetDeviceModel,
} from './deviceModel.js';
import { buildHarborSystemPrompt, isHarbor } from '../lib/harbor.js';
import { buildHarborMiniSystemPrompt, isHarborMini } from '../lib/harborMini.js';
import { sanitizeGuideText } from '../lib/guideHarness.js';
import { prepareGuideTurn, searchForModel } from '../lib/localSearch.js';
import type { ChatDriver, DriverEventSink } from './types.js';
import { DriverEmitter } from './types.js';
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
  private turn = 1;
  /** At most one search per user message, so a confused model can't loop. */
  private searchedThisTurn = false;
  /** Keeps a SEARCH: request off the screen while the reply streams. */
  private searchFilter = new SearchLineFilter(false);

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
      ? (this.turnPrompt ?? buildHarborMiniSystemPrompt())
      : isHarbor(this.modelId)
        ? buildHarborSystemPrompt()
        : SYSTEM_PROMPT;
    const extra = this.extraSystem?.trim();
    return extra ? `${base}\n\n${extra}` : base;
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
        const shown = this.guideTurn
          ? delta.split(EM_DASH).join(',')
          : this.searchFilter.push(delta);
        this.answer += delta;
        if (shown) this.emitter.emit({ type: 'text-delta', text: shown });
      }),
    );
    this.deviceListeners.push(
      await Llama.addListener('generationDone', ({ requestId, stopReason, detail }) => {
        if (requestId !== this.activeRequestId) return;
        this.clearWatchdog();
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
    void this.run(text);
  }

  private async run(text: string): Promise<void> {
    await this.listenersReady;
    this.turn = 1;
    this.searchedThisTurn = false;
    this.emitter.emit({ type: 'task-start', input: text });
    this.emitter.emit({
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
        (message) => this.emitter.emit({ type: 'status', message }),
      );
      if (!ready.ok) {
        this.emitter.emit({ type: 'task-done', reason: 'error', message: ready.detail });
        return;
      }
      if (isHarborMini(this.modelId)) await this.prepareGuideTurn(text);
      this.history.push({ role: 'user', content: text });
      await this.generate();
    } catch (err) {
      this.clearWatchdog();
      this.activeRequestId = undefined;
      this.emitter.emit({
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
    const turn = await prepareGuideTurn(text, this.researchOn, (e) => this.emitter.emit(e));
    this.afterNote = turn.after;
    this.turnPrompt = turn.prompt;
  }

  private async generate(): Promise<void> {
    this.answer = '';
    this.searchFilter = new SearchLineFilter(this.searchable && !this.searchedThisTurn);
    const requestId = `req_${requestSeq++}`;
    this.activeRequestId = requestId;
    const system = this.systemPrompt();
    const maxTokens = this.guide ? (this.searchable ? 768 : 512) : 1024;
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
    const text = this.guideTurn ? sanitizeGuideText(this.answer).trim() : this.answer.trim();
    const { query, flush } = this.searchFilter.end();
    if (stopReason === 'error') {
      // Whatever the slot holds after an error is suspect; reload next time.
      forgetDeviceModel();
      if (text) this.history.push({ role: 'assistant', content: text });
      this.emitter.emit({ type: 'text-final', text });
      this.emitter.emit({
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
      const resultText = await searchForModel(query, this.researchOn, (e) => this.emitter.emit(e));
      this.history.push({ role: 'user', content: resultText });
      this.turn += 1;
      this.emitter.emit({
        type: 'turn-start',
        turn: this.turn,
        model: this.modelName,
        providerKind: 'local',
      });
      try {
        await this.generate();
      } catch (err) {
        this.activeRequestId = undefined;
        this.emitter.emit({
          type: 'task-done',
          reason: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    if (flush) this.emitter.emit({ type: 'text-delta', text: flush });
    if (text) this.history.push({ role: 'assistant', content: text });
    this.emitter.emit({ type: 'text-final', text });
    const after = this.afterNote;
    this.afterNote = undefined;
    if (after && text && stopReason === 'end') {
      this.emitter.emit({ type: 'note', message: after });
    }
    // A finished reply with no words is a failure, not a quiet success: say
    // so, rather than leaving the chat on its "Warming up" line.
    if (!text && stopReason === 'end') {
      this.emitter.emit({
        type: 'task-done',
        reason: 'error',
        message: emptyReplyMessage(this.modelName),
      });
      return;
    }
    this.emitter.emit({
      type: 'task-done',
      reason: stopReason === 'stopped' ? 'aborted' : 'complete',
    });
  }

  abort(): void {
    if (this.activeRequestId) void Llama.stop({ requestId: this.activeRequestId });
  }

  answerApproval(_approvalId: string, _answer: ApprovalAnswer): void {
    // On-device chat has no user-approved tools: search runs unprompted, the
    // same way it would for a person typing a question into a search engine.
  }

  dispose(): void {
    this.abort();
    this.clearWatchdog();
    for (const h of this.deviceListeners) void h.remove();
    this.deviceListeners = [];
    this.emitter.clear();
  }
}
