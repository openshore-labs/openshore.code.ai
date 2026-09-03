// Cloud chat with any OpenAI-compatible provider (OpenAI, Gemini, Kimi) on the
// user's own key, straight from the app. It mirrors CloudClaudeDriver but speaks
// the /chat/completions shape, so a user can chat directly with any model their
// connected provider offers, the same models they would reach in that provider's
// own app. Billing rides the user's account; OpenShore prices nothing.
//
// Streaming rides the WebView's native fetch on the web. On device and the
// desktop shell these providers send no CORS headers, so the request goes
// through the native shim, which cannot stream: there we ask for the whole
// answer and emit it once, the same split stackDriver's cloud path uses.
import type { ApprovalAnswer } from 'os-code/protocol';
import type { ChatDriver, DriverEventSink } from './types.js';
import { DriverEmitter } from './types.js';
import { effortDirective } from '../lib/effort.js';
import { streamingFetch } from '../lib/streamingFetch.js';
import { nativeFetch } from '../lib/nativeFetch.js';
import { platform } from '../lib/platform.js';
import { imageBlockParts, type Attachment } from '../lib/attachments.js';
import { SWITCH_TO_LOCAL } from '../lib/usageFallback.js';
import type { SeedTurn } from '../state/types.js';

/** Fallback context window when the provider catalog carries none. */
const DEFAULT_CONTEXT_WINDOW = 200_000;

const SYSTEM_PROMPT = [
  'You are OpenShore, a warm, capable coding companion in a mobile and desktop app.',
  'Answer directly and concretely. Use markdown; fence code blocks with a language tag.',
  'You are running in chat mode without repo tools. When a task needs to read or edit files, run commands, or commit, say so and point the user to their desktop connection in this app.',
  'Whenever the person must paste something (a command, a query, a config line), put it in its own fenced code block, one per step, nothing else in the block. Never inline a command in a sentence.',
  'Never use em dashes. Use a period or a comma instead.',
].join('\n');

type OaiContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
interface OaiMessage {
  role: 'system' | 'user' | 'assistant';
  content: OaiContent;
}
interface OaiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

export class CloudOpenAiDriver implements ChatDriver {
  readonly kind = 'cloud' as const;
  private emitter = new DriverEmitter();
  private history: OaiMessage[] = [];
  private aborted = false;
  private controller?: AbortController;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    /** The provider's display name, for error copy. */
    private readonly providerLabel: string,
    seed?: SeedTurn[],
    /** Extra system context for this chat (the repositories it works with). */
    private readonly extraSystem?: string,
    private readonly contextWindow: number = DEFAULT_CONTEXT_WINDOW,
  ) {
    // A mid-chat switch seeds the prior turns so this model continues the thread.
    if (seed) this.history = seed.map((t) => ({ role: t.role, content: t.text }));
  }

  subscribe(sink: DriverEventSink): () => void {
    return this.emitter.subscribe(sink);
  }

  send(text: string, attachments?: Attachment[]): void {
    void this.run(text, attachments);
  }

  /** Fold image attachments into the user turn as image_url data URLs (the
   *  OpenAI-compatible vision shape). With no images it stays a plain string. */
  private userContent(text: string, attachments?: Attachment[]): OaiContent {
    const images = (attachments ?? [])
      .map(imageBlockParts)
      .filter((p): p is { mediaType: string; base64: string } => Boolean(p))
      .map((p) => ({
        type: 'image_url' as const,
        image_url: { url: `data:${p.mediaType};base64,${p.base64}` },
      }));
    return images.length ? [...images, { type: 'text', text }] : text;
  }

  private async run(text: string, attachments?: Attachment[]): Promise<void> {
    this.aborted = false;
    this.emitter.emit({ type: 'task-start', input: text });
    this.emitter.emit({ type: 'turn-start', turn: 1, model: this.model, providerKind: 'cloud' });
    this.history.push({ role: 'user', content: this.userContent(text, attachments) });
    const messages: OaiMessage[] = [
      {
        role: 'system',
        content: [SYSTEM_PROMPT, effortDirective(), this.extraSystem].filter(Boolean).join('\n'),
      },
      ...this.history,
    ];
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
    };

    let answer = '';
    try {
      if (platform() === 'ios' || platform() === 'electron') {
        // The native shim buffers the whole response; ask for one answer.
        const res = await nativeFetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: this.model, stream: false, messages }),
          responseType: 'json',
        });
        if (!res.ok) throw new Error(`${this.providerLabel} answered ${res.status}.`);
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: OaiUsage;
        };
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content === 'string' && content && !this.aborted) {
          answer = content;
          this.emitter.emit({ type: 'text-delta', text: content });
        }
        this.emitUsage(data.usage);
      } else {
        this.controller = new AbortController();
        const res = await streamingFetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: this.model,
            stream: true,
            stream_options: { include_usage: true },
            messages,
          }),
          signal: this.controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`${this.providerLabel} answered ${res.status}.`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let usage: OaiUsage | undefined;
        for (;;) {
          const { value, done } = await reader.read();
          if (done || this.aborted) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const json = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
                usage?: OaiUsage;
              };
              const delta = json?.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta) {
                answer += delta;
                this.emitter.emit({ type: 'text-delta', text: delta });
              }
              if (json?.usage) usage = json.usage;
            } catch {
              // a partial line or a non-JSON keepalive: skip it
            }
          }
        }
        this.emitUsage(usage);
      }

      if (this.aborted) {
        if (answer) this.history.push({ role: 'assistant', content: answer });
        this.emitter.emit({ type: 'text-final', text: answer });
        this.emitter.emit({ type: 'task-done', reason: 'aborted', message: 'Stopped.' });
        return;
      }
      this.history.push({ role: 'assistant', content: answer });
      this.emitter.emit({ type: 'text-final', text: answer });
      this.emitter.emit({ type: 'task-done', reason: 'complete' });
    } catch (err) {
      if (this.aborted) {
        this.emitter.emit({ type: 'text-final', text: answer });
        this.emitter.emit({ type: 'task-done', reason: 'aborted', message: 'Stopped.' });
        return;
      }
      this.emitter.emit({ type: 'task-done', reason: 'error', message: this.describe(err) });
    } finally {
      this.controller = undefined;
    }
  }

  private emitUsage(usage: OaiUsage | undefined): void {
    // OpenShore does not price usage; billing rides the user's own account. The
    // honest signal we surface is the context meter, from the reported prompt
    // tokens (providers that omit usage read as 0, never a fabricated cost).
    const promptTokens = usage?.prompt_tokens ?? 0;
    this.emitter.emit({
      type: 'usage',
      promptTokens,
      completionTokens: usage?.completion_tokens ?? 0,
      dollars: 0,
      contextPercent: Math.min(100, Math.round((promptTokens / this.contextWindow) * 100)),
    });
  }

  private describe(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    if (/\b401\b|\b403\b/.test(msg)) {
      return `${this.providerLabel} rejected the API key. Update it under Connections.`;
    }
    if (/\b429\b/.test(msg)) {
      return `${this.providerLabel} has no usage available on your account right now. ${SWITCH_TO_LOCAL}`;
    }
    return msg;
  }

  abort(): void {
    this.aborted = true;
    this.controller?.abort();
  }

  answerApproval(_approvalId: string, _answer: ApprovalAnswer): void {
    // Cloud chat has no tool approvals; nothing to answer.
  }

  dispose(): void {
    this.aborted = true;
    this.controller?.abort();
    this.emitter.clear();
  }
}
