// The pocket brain: a model running fully on this device through the llama
// plugin. Chat-only by design in v1 (repo tools live on the desktop
// connection), private by construction: nothing ever leaves the phone, except
// a web search Harbor explicitly asks for, which the user can point at their
// own key instead of the DuckDuckGo default.
import type { PluginListenerHandle } from '@capacitor/core';
import type { ApprovalAnswer } from 'os-code/protocol';
import { Llama } from '../lib/llamaPlugin.js';
import { buildHarborSystemPrompt, isHarbor, HARBOR_SEARCH_PREFIX } from '../lib/harbor.js';
import { buildHarborMiniSystemPrompt, isHarborMini } from '../lib/harborMini.js';
import { formatSearchResults, loadSearchKey, webSearch } from '../lib/webSearch.js';
import type { ChatDriver, DriverEventSink } from './types.js';
import { DriverEmitter } from './types.js';

const SYSTEM_PROMPT = [
  'You are OS Code, a friendly coding companion running fully on this device.',
  'Be concise and useful. Use markdown for code.',
  'You have no internet and no file access here. For repo work, the user can connect this app to their desktop.',
  'Never use em dashes. Use a period or a comma instead.',
].join('\n');

// The whole response must be exactly this one line for it to count as a
// search request, not just a mention of the word "search" mid-answer.
const SEARCH_LINE = new RegExp(`^${HARBOR_SEARCH_PREFIX}\\s*(.+)$`, 'i');

let requestSeq = 0;

export class OnDeviceDriver implements ChatDriver {
  readonly kind = 'device' as const;
  private emitter = new DriverEmitter();
  private history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private answer = '';
  private activeRequestId?: string;
  private listenersReady: Promise<void>;
  private deviceListeners: PluginListenerHandle[] = [];
  private loaded = false;
  private turn = 1;
  /** At most one search per user message, so a confused model can't loop. */
  private searchedThisTurn = false;

  private readonly guide: boolean;
  private readonly searchable: boolean;

  constructor(
    private readonly modelId: string,
    private readonly modelName: string,
  ) {
    this.searchable = isHarbor(modelId);
    this.guide = isHarborMini(modelId) || this.searchable;
    this.listenersReady = this.attachListeners();
  }

  private systemPrompt(): string {
    if (isHarborMini(this.modelId)) return buildHarborMiniSystemPrompt();
    if (this.searchable) return buildHarborSystemPrompt();
    return SYSTEM_PROMPT;
  }

  private async attachListeners(): Promise<void> {
    // G3: keep the handles so dispose() can remove them. Without this, every
    // opened device chat leaks two Llama listeners (retaining the driver and
    // its history) for the life of the app.
    this.deviceListeners.push(
      await Llama.addListener('token', ({ requestId, delta }) => {
        if (requestId !== this.activeRequestId) return;
        this.answer += delta;
        this.emitter.emit({ type: 'text-delta', text: delta });
      }),
    );
    this.deviceListeners.push(
      await Llama.addListener('generationDone', ({ requestId, stopReason, detail }) => {
        if (requestId !== this.activeRequestId) return;
        this.activeRequestId = undefined;
        void this.handleDone(stopReason, detail);
      }),
    );
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
      if (!this.loaded) {
        this.emitter.emit({
          type: 'status',
          message: `Warming up ${this.modelName} on this device.`,
        });
        // Harbor Mini only writes short guidance, so a small context keeps
        // the KV cache and load time down. Harbor is bigger and does an
        // extra search round-trip, so it gets the full window like a chosen
        // pocket model does.
        const load = await Llama.load({
          id: this.modelId,
          contextSize: this.guide && !this.searchable ? 2048 : 4096,
        });
        if (!load.ok) {
          this.emitter.emit({
            type: 'task-done',
            reason: 'error',
            message:
              load.detail ??
              `${this.modelName} would not load. Re-download it from the marketplace.`,
          });
          return;
        }
        this.loaded = true;
      }
      this.history.push({ role: 'user', content: text });
      await this.generate();
    } catch (err) {
      this.activeRequestId = undefined;
      this.emitter.emit({
        type: 'task-done',
        reason: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async generate(): Promise<void> {
    this.answer = '';
    this.activeRequestId = `req_${requestSeq++}`;
    await Llama.generate({
      requestId: this.activeRequestId,
      system: this.systemPrompt(),
      messages: this.history,
      maxTokens: this.guide ? (this.searchable ? 768 : 512) : 1024,
      temperature: this.guide ? 0.4 : 0.7,
    });
  }

  private async handleDone(
    stopReason: 'end' | 'stopped' | 'error',
    detail?: string,
  ): Promise<void> {
    const text = this.answer.trim();
    if (stopReason === 'error') {
      if (text) this.history.push({ role: 'assistant', content: text });
      this.emitter.emit({ type: 'text-final', text });
      this.emitter.emit({
        type: 'task-done',
        reason: 'error',
        message:
          detail ??
          'The on-device model hit a problem. Try again, or re-download it from the marketplace.',
      });
      return;
    }

    const searchMatch = this.searchable && !this.searchedThisTurn ? text.match(SEARCH_LINE) : null;
    if (searchMatch) {
      this.searchedThisTurn = true;
      const query = searchMatch[1]!.trim();
      // The search line itself is a control message, not a real reply: leave
      // it out of the visible transcript and out of history, so the model
      // does not later "remember" having already announced it.
      this.emitter.emit({ type: 'status', message: `Searching the web for "${query}".` });
      let resultText: string;
      try {
        const key = await loadSearchKey();
        const results = await webSearch(query, key);
        resultText = formatSearchResults(query, results);
        if (results.length) {
          this.emitter.emit({
            type: 'citations',
            citations: results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
          });
        }
      } catch (err) {
        resultText = `Search failed: ${err instanceof Error ? err.message : String(err)}. Answer from what you already know instead, and say you could not search.`;
      }
      this.history.push({ role: 'user', content: resultText });
      this.turn += 1;
      this.emitter.emit({
        type: 'turn-start',
        turn: this.turn,
        model: this.modelName,
        providerKind: 'local',
      });
      await this.generate();
      return;
    }

    if (text) this.history.push({ role: 'assistant', content: text });
    this.emitter.emit({ type: 'text-final', text });
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
    for (const h of this.deviceListeners) void h.remove();
    this.deviceListeners = [];
    this.emitter.clear();
  }
}
