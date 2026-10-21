// Cloud Claude, straight from the app on the user's own key. The official
// SDK supports browser use (it sends the direct-browser-access CORS header
// for us, and Anthropic answers cross-origin calls), so the reply streams
// through the WebView's own fetch on every shell, the same way the Stack's
// Claude seat does; the request rides the one provider client
// (providerClient.ts), and Stop ends the turn at once (cloudChat.ts).
// Chat-only from the phone: repo tools need the desktop connection, and the
// UI says so.
import type Anthropic from '@anthropic-ai/sdk';
import { loadAnthropic, loadedAnthropic } from './anthropicSdk.js';
import type { ApprovalAnswer, DriverEvent } from 'os-code/protocol';
import type { AppVaultPack, ChatContext, ChatDriver, DriverEventSink } from './types.js';
import {
  DriverEmitter,
  PlaceholderNotice,
  readChatContext,
  seedText,
  stubsReply,
} from './types.js';
import { claudeHistoryCache, claudeSystem, promptCacheOn } from '../lib/claudeCache.js';
import { claudeContextTokens, packSeatFor } from '../lib/vaultSeat.js';
import { effortDirective } from '../lib/effort.js';
import { chainOfThoughtOn, claudeRequestThinking } from '../lib/chainOfThought.js';
import { streamingFetch } from '../lib/streamingFetch.js';
import { imageBlockParts, type Attachment } from '../lib/attachments.js';
import { frameLabel, videoContextHeader, VIDEO_FRAMES_SYSTEM_NOTE } from '../lib/videoAttach.js';
import { SWITCH_TO_LOCAL } from '../lib/usageFallback.js';
import { WORKSPACE_HINT, needsWorkspaceId } from '../lib/providers.js';
import type { SeedTurn } from '../state/types.js';
import { anthropicClient, isAbortError, type ProviderEvent } from './providerClient.js';
import { CloudTurn, cloudHumanizer, type CloudChatOptions } from './cloudChat.js';
import { writingVoiceLine } from '../lib/writingVoice.js';

// The model catalog (ids, labels, context) lives in one leaf module so the
// driver, the model sheet, and sourceLabel all agree. Imported for the driver's
// own use and re-exported for the existing importers.
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from '../lib/claudeModels.js';
export { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL };

/** The model's real context window (P2-14: not a flat 1M, which read ~5x low),
 *  from the catalog, else 200k. The vault pack sizes itself from the same
 *  number (lib/vaultSeat.ts). */
export function contextWindowFor(model: string): number {
  return claudeContextTokens(model);
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
  'You are running in chat mode without repo tools. When a task needs to read or edit files, run commands, or commit, say so and point the user to Computer in this app, which docks their computer or server.',
  'Whenever the person must paste something (a command, a query, a config line), put it in its own fenced code block, one per step, nothing else in the block. Never inline a command in a sentence.',
  'Never use em dashes. Use a period or a comma instead.',
].join('\n');

/**
 * Claude's `system` for one request (tech review J16). With caching on: blocks,
 * stable to volatile, the head (the base prompt and the chat's own context,
 * its project and repositories) byte-identical from send to send and carrying
 * the one cache marker; the effort line, the frame-reading note and the vault
 * pack ride the tail, the pack last. With caching off: one plain string,
 * byte-identical to the request before M5 (the base, the effort line, the
 * frame note, the context, joined by newlines), the pack appended last.
 */
export function claudeRequestSystem(
  base: string,
  tail: {
    context?: string;
    effort?: string;
    hasFrames?: boolean;
    pack?: string;
    cache: boolean;
  },
): string | Anthropic.TextBlockParam[] {
  const frames = tail.hasFrames ? VIDEO_FRAMES_SYSTEM_NOTE : undefined;
  if (!tail.cache) {
    return [base, tail.effort, frames, tail.context, tail.pack].filter(Boolean).join('\n');
  }
  return claudeSystem(
    [base, tail.context].filter(Boolean).join('\n'),
    [tail.effort, frames, tail.pack],
    true,
  );
}

/** The user turn a Claude request opens with when the chat itself opened on
 *  the app's own words (the guided setup's greeting). */
export const CHAT_OPENER = '(This chat began with the message below.)';

/** The Messages API takes a user turn first. A chat that opens on the app's
 *  greeting (the setup walk's chat, switched to Claude) gets a short neutral
 *  opener in front, sent with the request and never stored. */
export function opensOnUser(history: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  return history[0]?.role === 'assistant'
    ? [{ role: 'user', content: CHAT_OPENER }, ...history]
    : history;
}

export class CloudClaudeDriver implements ChatDriver {
  readonly kind = 'cloud' as const;
  private emitter = new DriverEmitter();
  private history: Anthropic.MessageParam[] = [];
  /** Built on the first send, once the SDK has loaded (anthropicSdk.ts). */
  private readonly client: () => Promise<Anthropic>;
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

  constructor(
    apiKey: string,
    private readonly model: string = DEFAULT_CLAUDE_MODEL,
    seed?: SeedTurn[],
    /** The workspace an identity-linked key acts in (anthropic-workspace-id). */
    workspaceId?: string,
    /** Extra system context for this chat (the repositories it works with,
     *  the guided setup's step), read on every reply. */
    private readonly extraSystem?: ChatContext,
    /** The conversation's vault pack (tech review J1), none with Memory off, and the
     *  Humanize Writing setting. */
    opts: CloudChatOptions = {},
  ) {
    this.vaultPack = opts.vaultPack;
    this.humanize = opts.humanize;
    this.writingVoice = opts.writingVoice;
    this.modelLabel = opts.modelLabel ?? this.model;
    const ws = workspaceId?.trim();
    let client: Promise<Anthropic> | undefined;
    this.client = () =>
      (client ??= loadAnthropic().then(
        (Sdk) =>
          new Sdk({
            apiKey,
            dangerouslyAllowBrowser: true,
            fetch: streamingFetch,
            ...(ws ? { defaultHeaders: { 'anthropic-workspace-id': ws } } : {}),
          }),
      ));
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

  private async run(text: string, attachments?: Attachment[]): Promise<void> {
    // The answer goes back into history as Claude sent it (its content
    // blocks) when whole, and as the visible partial when stopped or cut off
    // (Claude's own apps re-feed the partial when you continue).
    const turn = new CloudTurn(this.emitter, (answer, replay) =>
      this.history.push({
        role: 'assistant',
        content: (replay as Anthropic.ContentBlockParam[] | undefined) ?? answer,
      }),
    );
    this.turn = turn;
    turn.emit({ type: 'task-start', input: text });
    // The pack gathers once per send, beside the turn's own setup.
    const preparing = this.vaultPack?.prepare(text, turn.signal);
    turn.emit({ type: 'turn-start', turn: 1, model: this.modelLabel, providerKind: 'cloud' });
    // Vision: fold image attachments (and video frames) into the user turn. See
    // buildVisionContent for the frame labeling and header.
    const { content, hasFrames } = buildVisionContent(text, attachments);
    this.history.push({ role: 'user', content });

    // Chain of Thought on: Claude thinks through its own API and the summary
    // streams into the thinking block. Read once per turn, so a flip mid-reply
    // cannot half-apply.
    const cot = chainOfThoughtOn();
    // Prompt caching, pinned for this send like Chain of Thought.
    const cache = promptCacheOn();
    try {
      await preparing;
      // Stopped while the pack gathered: nothing is sent.
      if (!turn.open) return;
      const pack = this.vaultPackFor();
      if (pack.event) turn.emit(pack.event);
      // The first request that carries the placeholder says so, once (F).
      const notice = this.placeholder.take(this.model, this.modelLabel, this.stubbedReply);
      if (notice) turn.emit(notice);
      const client = anthropicClient(await this.client(), {
        model: this.model,
        ...claudeRequestThinking(this.model, 16000, cot),
        system: claudeRequestSystem(this.basePrompt(), {
          context: readChatContext(this.extraSystem),
          effort: effortDirective(),
          hasFrames,
          pack: pack.text,
          cache,
        }),
        ...claudeHistoryCache(cache),
      });
      let usage: Extract<ProviderEvent, { type: 'usage' }> | undefined;
      let done: Extract<ProviderEvent, { type: 'done' }> | undefined;
      for await (const ev of client.stream([...opensOnUser(this.history)], [], turn.signal)) {
        // Stopped: whatever the request still says goes nowhere.
        if (!turn.open) return;
        if (ev.type === 'text') turn.text(ev.text);
        else if (ev.type === 'thinking') {
          if (cot) turn.emit({ type: 'thinking-delta', text: ev.text });
        } else if (ev.type === 'usage') usage = ev;
        else if (ev.type === 'done') done = ev;
      }
      if (!turn.open) return;
      // OpenShore does not price usage; billing rides the user's own account.
      // The shared usage event still carries a dollars field for the CLI, so
      // send 0 rather than fabricate a cost. The context meter is the honest
      // signal we do surface.
      if (usage) {
        turn.emit({
          type: 'usage',
          promptTokens: usage.inputTokens,
          completionTokens: usage.outputTokens,
          dollars: 0,
          contextPercent: contextPercentFor(this.model, usage.inputTokens),
        });
      }
      turn.finish('complete', undefined, {
        replay: done?.replay,
        note:
          done?.stopReason === 'refusal'
            ? 'Claude declined that request. Rephrase and try again.'
            : undefined,
      });
    } catch (err) {
      if (turn.signal.aborted || isAbortError(err) || isSdkError(err, 'APIUserAbortError')) {
        turn.finish('aborted');
      } else turn.finish('error', describeError(err));
    }
  }

  /** The base prompt, with the Humanize Writing standard beside it while it
   *  applies: both are fixed for the chat, so they sit in the stable head. */
  private basePrompt(): string {
    return [
      SYSTEM_PROMPT,
      cloudHumanizer(this.humanize, this.seat()?.modelClass),
      writingVoiceLine(this.writingVoice),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  /** This chat's seat: Claude on the person's key, a cloud seat, served the
   *  model's own window. */
  private seat() {
    return packSeatFor(
      { kind: 'cloud', provider: 'anthropic', model: this.model, label: this.model },
      { ownTailnetSuffix: null },
    );
  }

  /** This send's pack, rendered for this seat. */
  private vaultPackFor(): { text?: string; event?: DriverEvent } {
    if (!this.vaultPack) return {};
    const seat = this.seat();
    return seat ? this.vaultPack.render(seat) : {};
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

// Billing lives on the user's own Anthropic account, so when it is out of usage
// (depleted pay-as-you-go credits, or a plan usage cap) OpenShore does not try
// to explain the charge. It says the account is out of Claude usage and points
// at a local model, which keeps working with no account behind it. The exact
// fallback line lives in usageFallback so the transcript can offer the tap.
/** Whether `err` is the SDK's error of that name. Nothing is, before the SDK
 *  has loaded. */
function isSdkError(
  err: unknown,
  name:
    | 'APIUserAbortError'
    | 'AuthenticationError'
    | 'BadRequestError'
    | 'RateLimitError'
    | 'APIConnectionError',
): boolean {
  const Sdk = loadedAnthropic();
  return Sdk ? err instanceof Sdk[name] : false;
}

function isOutOfUsage(err: unknown): boolean {
  // Depleted credits come back as a 400 whose message names the balance.
  if (isSdkError(err, 'BadRequestError') && err instanceof Error) {
    return /credit balance|billing|quota/i.test(err.message);
  }
  return false;
}

export function describeError(err: unknown): string {
  if (isSdkError(err, 'AuthenticationError')) {
    return 'Claude rejected the API key. Update it under Connections.';
  }
  if (isSdkError(err, 'BadRequestError') && err instanceof Error && needsWorkspaceId(err.message)) {
    return WORKSPACE_HINT;
  }
  if (isOutOfUsage(err)) {
    return `No more Claude usage on your account right now. ${SWITCH_TO_LOCAL}`;
  }
  if (isSdkError(err, 'RateLimitError')) {
    // A usage cap and a transient burst both surface as 429; either way, a
    // local model is the way through without waiting on the account.
    return `Claude has no usage available on your account right now. ${SWITCH_TO_LOCAL} You can also try again in a moment.`;
  }
  if (isSdkError(err, 'APIConnectionError')) {
    return 'Could not reach Claude. Check the connection and try again.';
  }
  return err instanceof Error ? err.message : String(err);
}
