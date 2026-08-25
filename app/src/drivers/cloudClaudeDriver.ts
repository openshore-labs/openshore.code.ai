// Cloud Claude, straight from the app on the user's own key. The official
// SDK supports browser use (it sends the direct-browser-access CORS header
// for us); streaming rides the WebView's native fetch. Chat-only from the
// phone: repo tools need the desktop connection, and the UI says so.
import Anthropic from '@anthropic-ai/sdk';
import type { ApprovalAnswer } from 'os-code/protocol';
import type { ChatDriver, DriverEventSink } from './types.js';
import { DriverEmitter } from './types.js';
import { effortDirective } from '../lib/effort.js';
import { imageBlockParts, type Attachment } from '../lib/attachments.js';
import type { SeedTurn } from '../state/types.js';

// contextWindow is the model's real token budget, used for the context meter.
// Claude's standard window is 200k tokens; keep these in step with the models.
export const CLAUDE_MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', inPerM: 5, outPerM: 25, contextWindow: 200_000 },
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    inPerM: 3,
    outPerM: 15,
    contextWindow: 200_000,
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    inPerM: 1,
    outPerM: 5,
    contextWindow: 200_000,
  },
] as const;

/** Fallback context window when a model id is not in the table above. */
const DEFAULT_CONTEXT_WINDOW = 200_000;

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5';

/** The model's real context window (P2-14: not a flat 1M, which read ~5x low). */
export function contextWindowFor(model: string): number {
  return CLAUDE_MODELS.find((m) => m.id === model)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}

/** The context meter reading: input tokens as a percent of the real window. */
export function contextPercentFor(model: string, inputTokens: number): number {
  return Math.min(100, Math.round((inputTokens / contextWindowFor(model)) * 100));
}

const SYSTEM_PROMPT = [
  'You are OpenShore, a warm, capable coding companion in a mobile and desktop app.',
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
    seed?: SeedTurn[],
  ) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const known = CLAUDE_MODELS.find((m) => m.id === model);
    this.price = known ?? { inPerM: 5, outPerM: 25 };
    // A mid-chat switch seeds the prior turns so this model continues the thread.
    if (seed) this.history = seed.map((t) => ({ role: t.role, content: t.text }));
  }

  subscribe(sink: DriverEventSink): () => void {
    return this.emitter.subscribe(sink);
  }

  send(text: string, attachments?: Attachment[]): void {
    void this.run(text, attachments);
  }

  private async run(text: string, attachments?: Attachment[]): Promise<void> {
    this.emitter.emit({ type: 'task-start', input: text });
    this.emitter.emit({ type: 'turn-start', turn: 1, model: this.model, providerKind: 'cloud' });
    // Vision: fold image attachments into the user turn as base64 image blocks
    // (the shape the Anthropic messages API takes). With no images it stays a
    // plain string, unchanged.
    const imageBlocks = (attachments ?? [])
      .map(imageBlockParts)
      .filter((p): p is { mediaType: string; base64: string } => Boolean(p))
      .map((p): Anthropic.ImageBlockParam => ({
        type: 'image',
        source: { type: 'base64', media_type: p.mediaType as 'image/png', data: p.base64 },
      }));
    if (imageBlocks.length) {
      this.history.push({
        role: 'user',
        content: [...imageBlocks, { type: 'text', text }],
      });
    } else {
      this.history.push({ role: 'user', content: text });
    }

    try {
      const stream = this.client.messages.stream({
        model: this.model,
        max_tokens: 16000,
        system: [SYSTEM_PROMPT, effortDirective()].join('\n'),
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
        contextPercent: contextPercentFor(this.model, final.usage.input_tokens),
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
