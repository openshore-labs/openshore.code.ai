// Free, read-only chat with the paired desktop's local models over the daemon's
// stateless /chat endpoint (the free tier the C-suite approved, built as the CTO
// ruled). No session, no tools, no command lane: this driver only streams a
// completion, so the surface physically cannot read, edit, run, or commit. It
// keeps the turn history itself, since /chat is stateless, and re-sends it each
// turn. Streaming rides streamingFetch, past Capacitor's native-HTTP patch.
import type { ApprovalAnswer } from 'os-code/protocol';
import type { ChatDriver, DriverEventSink } from './types.js';
import { DriverEmitter } from './types.js';
import type { DaemonTarget } from './remoteDriver.js';
import { streamingFetch } from '../lib/streamingFetch.js';
import type { SeedTurn } from '../state/types.js';

type Msg = { role: 'user' | 'assistant'; content: string };

export class DesktopChatDriver implements ChatDriver {
  readonly kind = 'desktop-chat' as const;
  private emitter = new DriverEmitter();
  private history: Msg[] = [];
  private abortController?: AbortController;
  private aborted = false;

  constructor(
    private readonly target: DaemonTarget,
    private readonly model?: string,
    seed?: SeedTurn[],
  ) {
    if (seed) this.history = seed.map((t) => ({ role: t.role, content: t.text }));
  }

  subscribe(sink: DriverEventSink): () => void {
    return this.emitter.subscribe(sink);
  }

  send(text: string): void {
    void this.run(text);
  }

  private async run(text: string): Promise<void> {
    this.aborted = false;
    this.abortController = new AbortController();
    this.emitter.emit({ type: 'task-start', input: text });
    this.emitter.emit({
      type: 'turn-start',
      turn: 1,
      model: this.model ?? 'your desktop',
      providerKind: 'local',
    });
    this.history.push({ role: 'user', content: text });

    let answer = '';
    try {
      const res = await streamingFetch(`${this.target.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.target.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ messages: this.history, model: this.model }),
        signal: this.abortController.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json?.().catch(() => ({}))) as { error?: string };
        this.emitter.emit({
          type: 'task-done',
          reason: 'error',
          message: body?.error ?? `The desktop answered ${res.status}.`,
        });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done || this.aborted) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let ev: { type?: string; delta?: string; message?: string };
          try {
            ev = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (ev.type === 'text' && ev.delta) {
            answer += ev.delta;
            this.emitter.emit({ type: 'text-delta', text: ev.delta });
          } else if (ev.type === 'error') {
            this.emitter.emit({ type: 'task-done', reason: 'error', message: ev.message });
            return;
          }
        }
      }
      if (this.aborted) {
        if (answer.trim()) this.history.push({ role: 'assistant', content: answer });
        this.emitter.emit({ type: 'text-final', text: answer });
        this.emitter.emit({ type: 'task-done', reason: 'aborted', message: 'Stopped.' });
        return;
      }
      this.history.push({ role: 'assistant', content: answer });
      this.emitter.emit({ type: 'text-final', text: answer });
      this.emitter.emit({ type: 'task-done', reason: 'complete' });
    } catch (err) {
      if (this.aborted) {
        this.emitter.emit({ type: 'task-done', reason: 'aborted', message: 'Stopped.' });
        return;
      }
      this.emitter.emit({
        type: 'task-done',
        reason: 'error',
        message: err instanceof Error ? err.message : 'Could not reach your desktop.',
      });
    }
  }

  abort(): void {
    this.aborted = true;
    this.abortController?.abort();
  }

  answerApproval(_approvalId: string, _answer: ApprovalAnswer): void {
    // Read-only chat has no tool approvals; nothing to answer.
  }

  dispose(): void {
    this.aborted = true;
    this.abortController?.abort();
    this.emitter.clear();
  }
}
