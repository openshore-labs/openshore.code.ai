// Cloud Claude, straight from the app on the user's own key. The official
// SDK supports browser use (it sends the direct-browser-access CORS header
// for us); streaming rides the WebView's native fetch. Chat-only from the
// phone: repo tools need the desktop connection, and the UI says so.
import Anthropic from '@anthropic-ai/sdk';
import type { ApprovalAnswer } from 'os-code/protocol';
import type { ChatDriver, DriverEventSink } from './types.js';
import { DriverEmitter } from './types.js';
import { effortDirective } from '../lib/effort.js';
import { streamingFetch } from '../lib/streamingFetch.js';
import { imageBlockParts, type Attachment } from '../lib/attachments.js';
import { SWITCH_TO_LOCAL } from '../lib/usageFallback.js';
import type { SeedTurn } from '../state/types.js';

// The model catalog (ids, labels, context) lives in one leaf module so the
// driver, the model sheet, and sourceLabel all agree. Imported for the driver's
// own use and re-exported for the existing importers.
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from '../lib/claudeModels.js';
export { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL };

/** Fallback context window when a model id is not in the catalog. */
const DEFAULT_CONTEXT_WINDOW = 200_000;

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

  constructor(
    apiKey: string,
    private readonly model: string = DEFAULT_CLAUDE_MODEL,
    seed?: SeedTurn[],
  ) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, fetch: streamingFetch });
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

      // OpenShore does not price usage; billing rides the user's own account.
      // The shared usage event still carries a dollars field for the CLI, so
      // send 0 rather than fabricate a cost. The context meter is the honest
      // signal we do surface.
      this.emitter.emit({
        type: 'usage',
        promptTokens: final.usage.input_tokens,
        completionTokens: final.usage.output_tokens,
        dollars: 0,
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

// Billing lives on the user's own Anthropic account, so when it is out of usage
// (depleted pay-as-you-go credits, or a plan usage cap) OpenShore does not try
// to explain the charge. It says the account is out of Claude usage and points
// at a local model, which keeps working with no account behind it. The exact
// fallback line lives in usageFallback so the transcript can offer the tap.
function isOutOfUsage(err: unknown): boolean {
  // Depleted credits come back as a 400 whose message names the balance.
  if (err instanceof Anthropic.BadRequestError) {
    return /credit balance|billing|quota/i.test(err.message);
  }
  return false;
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'Claude rejected the API key. Update it under Connections.';
  }
  if (isOutOfUsage(err)) {
    return `No more Claude usage on your account right now. ${SWITCH_TO_LOCAL}`;
  }
  if (err instanceof Anthropic.RateLimitError) {
    // A usage cap and a transient burst both surface as 429; either way, a
    // local model is the way through without waiting on the account.
    return `Claude has no usage available on your account right now. ${SWITCH_TO_LOCAL} You can also try again in a moment.`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Could not reach Claude. Check the connection and try again.';
  }
  return err instanceof Error ? err.message : String(err);
}
