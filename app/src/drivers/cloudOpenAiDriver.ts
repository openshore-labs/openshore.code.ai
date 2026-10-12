// Cloud chat with any OpenAI-compatible provider (OpenAI, Gemini, Kimi,
// Perplexity) on the user's own key, straight from the app. It mirrors
// CloudClaudeDriver but speaks the /chat/completions shape, so a user can chat
// directly with any model their connected provider offers, the same models
// they would reach in that provider's own app. Billing rides the user's
// account; OpenShore prices nothing.
//
// The request rides the one provider client (providerClient.ts), so it streams
// on every shell: the guarded main-process channel on the desktop (these
// providers send no CORS headers), the WebView's own stream on the iPhone with
// one fall back to the native shim when a provider refuses the cross-origin
// call, and the streaming fetch on the web. Stop ends the turn at once on
// every branch (cloudChat.ts).
import type { ApprovalAnswer, DriverEvent } from 'os-code/protocol';
import type { AppVaultPack, ChatContext, ChatDriver, DriverEventSink } from './types.js';
import { packSeatFor } from '../lib/vaultSeat.js';
import {
  DriverEmitter,
  PlaceholderNotice,
  readChatContext,
  seedText,
  stubsReply,
} from './types.js';
import { effortDirective } from '../lib/effort.js';
import { chainOfThoughtLine, chainOfThoughtOn } from '../lib/chainOfThought.js';
import { imageBlockParts, type Attachment } from '../lib/attachments.js';
import { SWITCH_TO_LOCAL } from '../lib/usageFallback.js';
import type { SeedTurn } from '../state/types.js';
import {
  isAbortError,
  openAiCompatibleClient,
  ProviderUnavailable,
  type Citation,
  type ProviderEvent,
} from './providerClient.js';
import { CloudTurn, cloudHumanizer, type CloudChatOptions } from './cloudChat.js';
import { writingVoiceLine } from '../lib/writingVoice.js';

/** Fallback context window when the provider catalog carries none. */
const DEFAULT_CONTEXT_WINDOW = 200_000;

const SYSTEM_PROMPT = [
  'You are OpenShore, a warm, capable coding companion in a mobile and desktop app.',
  'Answer directly and concretely. Use markdown; fence code blocks with a language tag.',
  'You are running in chat mode without repo tools. When a task needs to read or edit files, run commands, or commit, say so and point the user to Computer in this app, which docks their computer or server.',
  'Whenever the person must paste something (a command, a query, a config line), put it in its own fenced code block, one per step, nothing else in the block. Never inline a command in a sentence.',
  'Never use em dashes. Use a period or a comma instead.',
].join('\n');

type OaiContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
/** A type alias, not an interface, so it passes as the client's plain
 *  record message. */
type OaiMessage = {
  role: 'system' | 'user' | 'assistant';
  content: OaiContent;
};

/** A rough token count for a message list, used only when the provider reports
 *  no usage of its own, so the context meter still fills instead of sitting
 *  empty. About four characters per token over the text; an estimate, and never
 *  billed (OpenShore prices nothing). */
function estimateTokens(messages: OaiMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') chars += m.content.length;
    else for (const part of m.content) if (part.type === 'text') chars += part.text.length;
  }
  return Math.ceil(chars / 4);
}

export class CloudOpenAiDriver implements ChatDriver {
  readonly kind = 'cloud' as const;
  private emitter = new DriverEmitter();
  private history: OaiMessage[] = [];
  /** The send in flight: Stop ends it, and only it. */
  private turn?: CloudTurn;
  private readonly vaultPack?: AppVaultPack;
  private readonly humanize?: boolean;
  private readonly writingVoice?: string;
  private readonly modelLabel: string;
  /** The history holds the placeholder for a marked reply, and the line
   *  that says so, once per chat for this model (F). */
  private stubbedReply = false;
  private readonly placeholder = new PlaceholderNotice();
  private readonly contextWindow: number;
  /** The window the provider's catalog lists for this model, if any: the
   *  pack sizes itself from it, else 128k (tech review J4). */
  private readonly listedWindow?: number;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    /** The provider's display name, for error copy. */
    private readonly providerLabel: string,
    seed?: SeedTurn[],
    /** Extra system context for this chat (the repositories it works with,
     *  the guided setup's step), read on every reply. */
    private readonly extraSystem?: ChatContext,
    contextWindow?: number,
    /** The conversation's vault pack (tech review J1), none with Memory off, and the
     *  Humanize Writing setting. */
    opts: CloudChatOptions = {},
  ) {
    this.listedWindow = contextWindow;
    this.contextWindow = contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    this.vaultPack = opts.vaultPack;
    this.humanize = opts.humanize;
    this.writingVoice = opts.writingVoice;
    this.modelLabel = opts.modelLabel ?? this.model;
    // A mid-chat switch seeds the prior turns so this model continues the thread.
    // A turn that drew on a local-only note reaches this cloud seat as the
    // stub, never the text (I5).
    if (seed) this.history = seed.map((t) => ({ role: t.role, content: seedText(t, true) }));
    this.stubbedReply = Boolean(seed?.some((t) => stubsReply(t, true)));
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
    const turn = new CloudTurn(this.emitter, (answer) =>
      this.history.push({ role: 'assistant', content: answer }),
    );
    this.turn = turn;
    turn.emit({ type: 'task-start', input: text });
    // The pack gathers once per send, beside the turn's own setup.
    const preparing = this.vaultPack?.prepare(text, turn.signal);
    turn.emit({ type: 'turn-start', turn: 1, model: this.modelLabel, providerKind: 'cloud' });
    this.history.push({ role: 'user', content: this.userContent(text, attachments) });
    // Chain of Thought, read once per turn. The client takes <think> text out
    // of the answer either way; it reaches the thinking block while on, and
    // nowhere while off. So does a reasoning field from the server.
    const cot = chainOfThoughtOn();
    try {
      await preparing;
      // Stopped while the pack gathered: nothing is sent.
      if (!turn.open) return;
      const pack = this.vaultPackFor();
      if (pack.event) turn.emit(pack.event);
      // The first request that carries the placeholder says so, once (F).
      const notice = this.placeholder.take(this.model, this.modelLabel, this.stubbedReply);
      if (notice) turn.emit(notice);
      const messages: OaiMessage[] = [
        {
          role: 'system',
          // Stable to volatile (tech review J16): the base prompt and the humanizer,
          // the chat's own context, then the per-send lines, the pack last.
          content: [
            SYSTEM_PROMPT,
            cloudHumanizer(this.humanize, this.seat()?.modelClass),
            writingVoiceLine(this.writingVoice),
            readChatContext(this.extraSystem),
            effortDirective(),
            chainOfThoughtLine(this.model, cot),
            pack.text,
          ]
            .filter(Boolean)
            .join('\n'),
        },
        ...this.history,
      ];
      // A local prompt-token estimate, used only if the provider omits usage.
      const estimatePrompt = estimateTokens(messages);
      let usage: Extract<ProviderEvent, { type: 'usage' }> | undefined;
      let sources: Citation[] = [];
      for await (const ev of this.reply(messages, turn.signal)) {
        // Stopped: whatever the request still says goes nowhere.
        if (!turn.open) return;
        if (ev.type === 'text') turn.text(ev.text);
        else if (ev.type === 'thinking') {
          if (cot) turn.emit({ type: 'thinking-delta', text: ev.text });
        } else if (ev.type === 'usage') usage = ev;
        else if (ev.type === 'sources') sources = ev.citations;
      }
      if (!turn.open) return;
      // Perplexity's sources, once; a provider with none says nothing.
      if (sources.length) turn.emit({ type: 'citations', citations: sources });
      this.emitUsage(turn, usage, estimatePrompt);
      turn.finish('complete');
    } catch (err) {
      if (turn.signal.aborted || isAbortError(err)) turn.finish('aborted');
      else turn.finish('error', this.describe(err));
    }
  }

  /** The reply's events. A streamed request asks for its usage in the last
   *  chunk, so the context meter reads the provider's own count; a provider
   *  that refuses the option answers 400 before a word, having generated
   *  nothing, and is asked once more without it. */
  private async *reply(messages: OaiMessage[], signal: AbortSignal): AsyncGenerator<ProviderEvent> {
    const seat = {
      label: this.providerLabel,
      baseUrl: this.baseUrl,
      key: this.apiKey,
      model: this.model,
    };
    const withUsage = openAiCompatibleClient({ ...seat, streamUsage: true });
    let started = false;
    try {
      for await (const ev of withUsage.stream(messages, [], signal)) {
        started = true;
        yield ev;
      }
      return;
    } catch (err) {
      const refusedOption =
        !started && !signal.aborted && err instanceof ProviderUnavailable && err.status === 400;
      if (!refusedOption) throw err;
    }
    yield* openAiCompatibleClient(seat).stream(messages, [], signal);
  }

  /** This chat's seat: a cloud provider on the person's key, served its
   *  listed window. */
  private seat() {
    return packSeatFor(
      { kind: 'cloud', provider: this.providerLabel, model: this.model, label: this.model },
      { ownTailnetSuffix: null, cloudContextTokens: () => this.listedWindow },
    );
  }

  /** This send's pack, rendered for this seat. */
  private vaultPackFor(): { text?: string; event?: DriverEvent } {
    if (!this.vaultPack) return {};
    const seat = this.seat();
    return seat ? this.vaultPack.render(seat) : {};
  }

  private emitUsage(
    turn: CloudTurn,
    usage: Extract<ProviderEvent, { type: 'usage' }> | undefined,
    estimatePrompt: number,
  ): void {
    // OpenShore does not price usage; billing rides the user's own account. The
    // honest signal we surface is the context meter, from the reported prompt
    // tokens, or a local estimate when the provider omits usage, so the meter
    // still fills for every provider (never a fabricated cost).
    const promptTokens = usage?.inputTokens || estimatePrompt;
    turn.emit({
      type: 'usage',
      promptTokens,
      completionTokens: usage?.outputTokens ?? 0,
      dollars: 0,
      contextPercent: Math.min(100, Math.round((promptTokens / this.contextWindow) * 100)),
    });
  }

  private describe(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    const status = err instanceof ProviderUnavailable ? err.status : undefined;
    if (status === 401 || status === 403 || /\b401\b|\b403\b/.test(msg)) {
      return `${this.providerLabel} rejected the API key. Update it under Connections.`;
    }
    if (status === 429 || /\b429\b/.test(msg)) {
      return `${this.providerLabel} has no usage available on your account right now. ${SWITCH_TO_LOCAL}`;
    }
    return msg;
  }

  abort(): void {
    // Stop answers at once (tech review ruling 7): the turn closes now with what
    // streamed so far, kept in the chat and in history.
    this.turn?.stop();
  }

  recordLine(turn: SeedTurn): void {
    // A marked line is the stub here, as a marked seed is (I5, D5).
    this.history.push({ role: turn.role, content: seedText(turn, true) });
    if (stubsReply(turn, true)) this.stubbedReply = true;
  }

  answerApproval(_approvalId: string, _answer: ApprovalAnswer): void {
    // Cloud chat has no tool approvals; nothing to answer.
  }

  dispose(): void {
    // Silent first: a teardown is not a Stop the chat should record.
    this.emitter.clear();
    this.turn?.stop();
  }
}
