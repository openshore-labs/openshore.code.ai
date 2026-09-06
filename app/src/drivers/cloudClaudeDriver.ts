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
import { frameLabel, videoContextHeader, VIDEO_FRAMES_SYSTEM_NOTE } from '../lib/videoAttach.js';
import { SWITCH_TO_LOCAL } from '../lib/usageFallback.js';
import { WORKSPACE_HINT, needsWorkspaceId } from '../lib/providers.js';
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

/** Build the user turn's content for the messages API. Plain image attachments
 *  become image blocks; video frames become image blocks too, each preceded by
 *  a short timestamp label and the whole set led by a one-line context header,
 *  so the model reads the stills as a clip in order. With no usable images the
 *  turn stays a plain string, unchanged. Pure and exported so the interleaving
 *  is testable without the network. `hasFrames` tells the caller whether to add
 *  the frame-reading system note. */
export function buildVisionContent(
  text: string,
  attachments?: Attachment[],
): {
  content: string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>;
  hasFrames: boolean;
} {
  const atts = (attachments ?? [])
    .map((a) => ({ a, parts: imageBlockParts(a) }))
    .filter((x): x is { a: Attachment; parts: { mediaType: string; base64: string } } =>
      Boolean(x.parts),
    );
  const hasFrames = atts.some((x) => x.a.frame);
  const content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];
  if (hasFrames) {
    const header = videoContextHeader(atts.map((x) => x.a));
    if (header) content.push({ type: 'text', text: header });
  }
  for (const { a, parts } of atts) {
    if (a.frame) content.push({ type: 'text', text: frameLabel(a.frame) });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: parts.mediaType as 'image/png', data: parts.base64 },
    });
  }
  if (!content.length) return { content: text, hasFrames: false };
  content.push({ type: 'text', text });
  return { content, hasFrames };
}

const SYSTEM_PROMPT = [
  'You are OpenShore, a warm, capable coding companion in a mobile and desktop app.',
  'Answer directly and concretely. Use markdown; fence code blocks with a language tag.',
  'You are running in chat mode without repo tools. When a task needs to read or edit files, run commands, or commit, say so and point the user to their desktop connection in this app.',
  'Whenever the person must paste something (a command, a query, a config line), put it in its own fenced code block, one per step, nothing else in the block. Never inline a command in a sentence.',
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
    /** The workspace an identity-linked key acts in (anthropic-workspace-id). */
    workspaceId?: string,
    /** Extra system context for this chat (the repositories it works with). */
    private readonly extraSystem?: string,
  ) {
    const ws = workspaceId?.trim();
    this.client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true,
      fetch: streamingFetch,
      ...(ws ? { defaultHeaders: { 'anthropic-workspace-id': ws } } : {}),
    });
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
    // Vision: fold image attachments (and video frames) into the user turn. See
    // buildVisionContent for the frame labeling and header.
    const { content, hasFrames } = buildVisionContent(text, attachments);
    this.history.push({ role: 'user', content });

    // Accumulate the streamed text so an abort can keep the visible partial in
    // model history (Claude's own apps re-feed the partial when you continue).
    let partial = '';
    try {
      const stream = this.client.messages.stream({
        model: this.model,
        max_tokens: 16000,
        system: [
          SYSTEM_PROMPT,
          effortDirective(),
          hasFrames ? VIDEO_FRAMES_SYSTEM_NOTE : undefined,
          this.extraSystem,
        ]
          .filter(Boolean)
          .join('\n'),
        messages: this.history,
      });
      this.activeStream = stream;
      stream.on('text', (delta) => {
        partial += delta;
        this.emitter.emit({ type: 'text-delta', text: delta });
      });
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
        if (partial.trim()) this.history.push({ role: 'assistant', content: partial });
        this.emitter.emit({ type: 'text-final', text: partial });
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
  if (err instanceof Anthropic.BadRequestError && needsWorkspaceId(err.message)) {
    return WORKSPACE_HINT;
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
