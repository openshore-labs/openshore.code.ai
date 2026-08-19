// The pocket brain: a model running fully on this device through the llama
// plugin. Chat-only by design in v1 (repo tools live on the desktop
// connection), private by construction: nothing ever leaves the phone.
import type { ApprovalAnswer } from 'os-code/protocol';
import { Llama } from '../lib/llamaPlugin.js';
import { buildHarborSystemPrompt, isHarbor } from '../lib/harbor.js';
import type { ChatDriver, DriverEventSink } from './types.js';
import { DriverEmitter } from './types.js';

const SYSTEM_PROMPT = [
  'You are OS Code, a friendly coding companion running fully on this device.',
  'Be concise and useful. Use markdown for code.',
  'You have no internet and no file access here. For repo work, the user can connect this app to their desktop.',
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
  private loaded = false;

  private readonly guide: boolean;

  constructor(
    private readonly modelId: string,
    private readonly modelName: string,
  ) {
    this.guide = isHarbor(modelId);
    this.listenersReady = this.attachListeners();
  }

  private async attachListeners(): Promise<void> {
    await Llama.addListener('token', ({ requestId, delta }) => {
      if (requestId !== this.activeRequestId) return;
      this.answer += delta;
      this.emitter.emit({ type: 'text-delta', text: delta });
    });
    await Llama.addListener('generationDone', ({ requestId, stopReason, detail }) => {
      if (requestId !== this.activeRequestId) return;
      this.activeRequestId = undefined;
      const text = this.answer.trim();
      if (text) this.history.push({ role: 'assistant', content: text });
      this.emitter.emit({ type: 'text-final', text });
      if (stopReason === 'error') {
        this.emitter.emit({
          type: 'task-done',
          reason: 'error',
          message: detail ?? 'The on-device model hit a problem. Try again, or re-download it from the marketplace.',
        });
      } else {
        this.emitter.emit({
          type: 'task-done',
          reason: stopReason === 'stopped' ? 'aborted' : 'complete',
        });
      }
    });
  }

  subscribe(sink: DriverEventSink): () => void {
    return this.emitter.subscribe(sink);
  }

  send(text: string): void {
    void this.run(text);
  }

  private async run(text: string): Promise<void> {
    await this.listenersReady;
    this.emitter.emit({ type: 'task-start', input: text });
    this.emitter.emit({
      type: 'turn-start',
      turn: 1,
      model: this.modelName,
      providerKind: 'local',
    });
    try {
      if (!this.loaded) {
        this.emitter.emit({ type: 'status', message: `Warming up ${this.modelName} on this device.` });
        // Harbor only writes short guidance, so a small context keeps the KV
        // cache and load time down; a chosen pocket model gets the full window.
        const load = await Llama.load({ id: this.modelId, contextSize: this.guide ? 2048 : 4096 });
        if (!load.ok) {
          this.emitter.emit({
            type: 'task-done',
            reason: 'error',
            message: load.detail ?? `${this.modelName} would not load. Re-download it from the marketplace.`,
          });
          return;
        }
        this.loaded = true;
      }
      this.history.push({ role: 'user', content: text });
      this.answer = '';
      this.activeRequestId = `req_${requestSeq++}`;
      await Llama.generate({
        requestId: this.activeRequestId,
        // Harbor gets its grounded guide persona; a chosen pocket model gets
        // the general companion prompt. Harbor answers short and cool so a
        // 0.5B stays accurate and on-rails.
        system: this.guide ? buildHarborSystemPrompt() : SYSTEM_PROMPT,
        messages: this.history,
        maxTokens: this.guide ? 512 : 1024,
        temperature: this.guide ? 0.4 : 0.7,
      });
    } catch (err) {
      this.activeRequestId = undefined;
      this.emitter.emit({
        type: 'task-done',
        reason: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  abort(): void {
    if (this.activeRequestId) void Llama.stop({ requestId: this.activeRequestId });
  }

  answerApproval(_approvalId: string, _answer: ApprovalAnswer): void {
    // On-device chat has no tools yet, so nothing ever asks.
  }

  dispose(): void {
    this.abort();
    this.emitter.clear();
  }
}
