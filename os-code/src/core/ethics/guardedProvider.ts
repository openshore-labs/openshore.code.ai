// The engine-side wrapper that makes the ethics layer unbypassable.
//
// Every model in the engine is reached through the Provider interface, and
// every Provider is handed out by ProviderRegistry. The registry wraps each one
// in a GuardedProvider before anyone can hold it, so the agent loop, the
// router's specialist delegation, the summarizer, the daemon's free chat
// endpoint, and the eval harness are all covered by construction rather than by
// five remembered call sites.
//
// The wrapper is model-agnostic on purpose. It sees messages and text. It does
// not know or care whether the bytes are going to llama.cpp on this machine or
// to a cloud endpoint, and it applies the same rules either way. For a cloud
// call, the provider's own policy is an additional fence on top of this one,
// never a substitute for it.

import type {
  ChatEvent,
  ChatRequest,
  ContentPart,
  ImageProvider,
  Provider,
  ProviderCapabilities,
} from '../../providers/types.js';
import type { ConsentAssertion } from './classify.js';
import { ethicsGuard, type EthicsGuard, type ModelPath, type ScreenResult } from './chokepoint.js';
import { StreamScreener } from './stream.js';
import { labelGeneratedImage } from './provenance.js';

export interface GuardContext {
  /** Authorization assertions on file for this account, read fresh each call. */
  consents?: () => ConsentAssertion[] | undefined;
  /** Persist a new assertion the person made in this very message. */
  onAssertion?: (assertion: ConsentAssertion) => void;
  /** Told about every block, so the host can surface and record it. */
  onBlock?: (result: ScreenResult) => void;
}

/** Flatten a chat request into the text the layer screens. */
export function screenableText(messages: ChatRequest['messages']): string {
  const parts: string[] = [];
  for (const message of messages) {
    // The system prompt is ours, not the person's, and screening it would only
    // ever produce a false positive on our own instructions. Everything the
    // person or a tool contributed is screened.
    if (message.role === 'system') continue;
    if (typeof message.content === 'string') {
      parts.push(message.content);
      continue;
    }
    for (const part of message.content as ContentPart[]) {
      if (part.type === 'text' && part.text) parts.push(part.text);
    }
  }
  return parts.join('\n');
}

export class GuardedProvider implements Provider {
  constructor(
    private readonly inner: Provider,
    private readonly context: GuardContext = {},
    private readonly guard: EthicsGuard = ethicsGuard(),
  ) {}

  get id(): string {
    return this.inner.id;
  }

  get label(): string {
    return this.inner.label;
  }

  get kind(): 'local' | 'cloud' {
    return this.inner.kind;
  }

  /** The provider being wrapped. For diagnostics only; never to route around. */
  get wrapped(): Provider {
    return this.inner;
  }

  capabilities(model: string): Promise<ProviderCapabilities> {
    return this.inner.capabilities(model);
  }

  listModels(): Promise<string[]> {
    return this.inner.listModels();
  }

  health(): Promise<{ ok: boolean; detail: string }> {
    return this.inner.health();
  }

  async *chat(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent, void, void> {
    const modelPath: ModelPath = this.inner.kind;
    const consents = this.context.consents?.();

    // ---- input side -------------------------------------------------------
    const inbound = await this.guard.screenInput({
      text: screenableText(request.messages),
      modelPath,
      consents,
    });
    if (inbound.newAssertion) this.context.onAssertion?.(inbound.newAssertion);
    if (inbound.decision.action === 'block') {
      this.context.onBlock?.(inbound);
      // The refusal takes the place of the model's answer. Nothing was sent.
      yield { type: 'text', delta: inbound.decision.message ?? 'This request was not sent.' };
      yield { type: 'done', stopReason: 'stop' };
      return;
    }

    // ---- output side ------------------------------------------------------
    const screener = new StreamScreener({ guard: this.guard, modelPath, consents });
    let sawDone = false;
    for await (const event of this.inner.chat(request, signal)) {
      if (event.type !== 'text') {
        if (event.type === 'done') sawDone = true;
        // Thinking, tool calls, and usage pass through. Tool calls are executed
        // by the loop under its own permission engine, and their arguments come
        // back through this same screen on the next turn's messages.
        yield event;
        if (event.type === 'done') break;
        continue;
      }
      const step = await screener.push(event.delta);
      if (step.kind === 'blocked') {
        this.context.onBlock?.(step.result);
        yield { type: 'text', delta: blockedTail(step.result) };
        yield { type: 'done', stopReason: 'stop' };
        return;
      }
      if (step.kind === 'release' && step.text) {
        yield { type: 'text', delta: step.text };
      }
    }
    // Drain the holdback through a screen of the complete answer.
    const last = await screener.finish();
    if (last.kind === 'blocked') {
      this.context.onBlock?.(last.result);
      yield { type: 'text', delta: blockedTail(last.result) };
      yield { type: 'done', stopReason: 'stop' };
      return;
    }
    if (last.kind === 'release' && last.text) {
      yield { type: 'text', delta: last.text };
    }
    if (!sawDone) yield { type: 'done', stopReason: 'end' };
  }
}

/** What replaces an answer that was stopped part way through. */
function blockedTail(result: ScreenResult): string {
  const message = result.decision.message ?? 'The rest of this answer was withheld.';
  return `\n\n${message}`;
}

/**
 * The image path. The prompt is screened like any other, and anything that comes
 * back is labeled with provenance before it can be written to disk.
 */
export class GuardedImageProvider implements ImageProvider {
  constructor(
    private readonly inner: ImageProvider,
    private readonly context: GuardContext = {},
    private readonly guard: EthicsGuard = ethicsGuard(),
  ) {}

  get id(): string {
    return this.inner.id;
  }

  get label(): string {
    return this.inner.label;
  }

  health(): Promise<{ ok: boolean; detail: string }> {
    return this.inner.health();
  }

  async generate(
    prompt: string,
    opts: { width?: number; height?: number; model?: string } = {},
  ): Promise<{ imageBase64: string; mediaType: string }> {
    const consents = this.context.consents?.();
    const screened = await this.guard.screenInput({
      text: prompt,
      // A local diffusion server is local compute, same as a local model.
      modelPath: 'local',
      consents,
    });
    if (screened.newAssertion) this.context.onAssertion?.(screened.newAssertion);
    if (screened.decision.action === 'block') {
      this.context.onBlock?.(screened);
      throw new EthicsBlocked(screened);
    }
    const image = await this.inner.generate(prompt, opts);
    // Provenance on every generated image, not only the Tier 2 ones. The
    // subject rides along when an authorization assertion allowed this.
    const bytes = base64ToBytes(image.imageBase64);
    const requiresProvenance = screened.decision.requiresProvenance === true;
    const labeled = labelGeneratedImage(bytes, {
      model: opts.model ?? this.inner.label,
      modelPath: 'local',
      format: image.mediaType,
      likenessSubject: requiresProvenance ? screened.decision.subject : undefined,
    });
    // The consent gate's promise is that a likeness output carries provenance.
    // If it could not be attached (a non-PNG format, or an image the server
    // already stamped), that promise is not kept, so the output is NOT emitted
    // silently. It is refused with a plain reason. An ordinary (non-likeness)
    // image stays best-effort: it is returned even if labeling was a no-op,
    // because there was no accountability promise to break.
    if (requiresProvenance && !labeled.embedded) {
      const failed: ScreenResult = {
        decision: {
          action: 'block',
          tier: 2,
          category: 'likeness',
          reason: `authorized likeness output could not be provenance-labeled (${labeled.reason})`,
          message:
            'This authorized likeness could not be labeled with provenance in this image format, so it was not produced. Use a PNG-capable image server.',
          signals: screened.decision.signals,
          subject: screened.decision.subject,
        },
      };
      this.context.onBlock?.(failed);
      throw new EthicsBlocked(failed);
    }
    return {
      imageBase64: labeled.embedded ? bytesToBase64(labeled.bytes) : image.imageBase64,
      mediaType: image.mediaType,
    };
  }
}

/** Thrown when the layer stops an image generation. Carries the decision. */
export class EthicsBlocked extends Error {
  constructor(readonly result: ScreenResult) {
    super(result.decision.message ?? 'This request was not sent.');
    this.name = 'EthicsBlocked';
  }
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(base64, 'base64'));
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}
