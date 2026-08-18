// Cloud Claude, straight from the app on the user's own key. The official
// SDK supports browser use (it sends the direct-browser-access CORS header
// for us); streaming rides the WebView's native fetch. Chat-only from the
// phone: repo tools need the desktop connection, and the UI says so.
import Anthropic from '@anthropic-ai/sdk';
import type { ApprovalAnswer } from 'os-code/protocol';
import type { ChatDriver, DriverEventSink } from './types.js';
import { DriverEmitter } from './types.js';

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', inPerM: 5, outPerM: 25 },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', inPerM: 3, outPerM: 15 },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', inPerM: 1, outPerM: 5 },
] as const;

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5';

const SYSTEM_PROMPT = [
  'You are OS Code, a warm, capable coding companion in a mobile and desktop app.',
  'Answer directly and concretely. Use markdown; fence code blocks with a language tag.',
  'You are running in chat mode without repo tools. When a task needs to read or edit files, run commands, or commit, say so and point the user to their desktop connection in this app.',
  'Never use em dashes. Use a period or a comma instead.',
].join('\n');

export class CloudClaudeDriver implements ChatDriver {
  readonly kind = 'cloud' as const;
  private emitter = new DriverEmitter();
  private history: Anthropic.MessageParam[] = [];
  private client: Anthropic;
  private activeStream?: { abort(): void };
  private price: { inPerM: number; outPerM: number };

  constructor(
    apiKey: string,
    private readonly model: string = DEFAULT_CLAUDE_MODEL,
  ) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const known = CLAUDE_MODELS.find((m) => m.id === model);
    this.price = known ?? { inPerM: 5, outPerM: 25 };
  }

  subscribe(sink: DriverEventSink): () => void {
    return this.emitter.subscribe(sink);
  }

  send(text: string): void {
    void this.run(text);
  }

  private async run(text: string): Promise<void> {
    this.emitter.emit({ type: 'task-start', input: text });
    this.emitter.emit({ type: 'turn-start', turn: 1, model: this.model, providerKind: 'cloud' });
    this.history.push({ role: 'user', content: text });

    try {
      const stream = this.client.messages.stream({
        model: this.model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        messages: this.history,
      });
      this.activeStream = stream;
      stream.on('text', (delta) => this.emitter.emit({ type: 'text-delta', text: delta }));
      const final = await stream.finalMessage();
      const answer = final.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      this.history.push({ role: 'assistant', content: final.content });

      const dollars =
        (final.usage.input_tokens * this.price.inPerM +
          final.usage.output_tokens * this.price.outPerM) /
        1_000_000;
      this.emitter.emit({
        type: 'usage',
        promptTokens: final.usage.input_tokens,
        completionTokens: final.usage.output_tokens,
        dollars,
        contextPercent: Math.min(100, Math.round((final.usage.input_tokens / 1_000_000) * 100)),
      });
      this.emitter.emit({ type: 'text-final', text: answer });
      if (final.stop_reason === 'refusal') {
        this.emitter.emit({
          type: 'note',
          message: 'Claude declined that request. Rephrase and try again.',
        });
      }
      this.emitter.emit({ type: 'task-done', reason: 'complete' });
    } catch (err) {
      this.activeStream = undefined;
      if (err instanceof Anthropic.APIUserAbortError) {
        this.emitter.emit({ type: 'task-done', reason: 'aborted', message: 'Stopped.' });
        return;
      }
      this.emitter.emit({
        type: 'task-done',
        reason: 'error',
        message: describeError(err),
      });
    } finally {
      this.activeStream = undefined;
    }
  }

  abort(): void {
    this.activeStream?.abort();
  }

  answerApproval(_approvalId: string, _answer: ApprovalAnswer): void {
    // Cloud chat has no tool approvals; nothing to answer.
  }

  dispose(): void {
    this.activeStream?.abort();
    this.emitter.clear();
  }
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'Claude rejected the API key. Update it under Connections.';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Claude is rate limiting this key right now. Give it a moment.';
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Could not reach Claude. Check the connection and try again.';
  }
  return err instanceof Error ? err.message : String(err);
}
