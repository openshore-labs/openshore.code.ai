// The Provider contract. One interface covers Ollama, LM Studio, llama.cpp,
// vLLM, and cloud Claude; the router only ever sees this shape.
import type { CapabilityCategory } from '../router/roles.js';
import { isOllamaCloudTag } from '../harness/locality.js';

export interface ContentPart {
  type: 'text' | 'image';
  text?: string;
  /** Base64 payload for image parts. */
  imageBase64?: string;
  mediaType?: string;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  /** Raw argument text as the model produced it; parsing happens in the bridge. */
  argsText: string;
  /** Parsed arguments when the transport already gave us JSON. */
  args?: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  /** Assistant messages may carry the tool calls they made. */
  toolCalls?: ToolCallRequest[];
  /** Tool messages answer a specific call. */
  toolCallId?: string;
  name?: string;
  /**
   * Claude's thinking blocks from this assistant turn (thinking with its
   * signature, or redacted_thinking), replayed verbatim before its tool calls
   * so a thinking turn that used a tool can continue. Opaque to everything but
   * the Anthropic provider; other providers ignore it.
   */
  thinkingBlocks?: unknown[];
  /**
   * Set on a tool message whose content came from a local-only vault note
   * (Vault M4, CTO I5). The loop swaps its content for a one-line stub
   * (`withholdLocalOnly` in harness/vault/privacy.ts) in what it sends on any
   * turn whose seat leaves this network, never in the kept history. Providers
   * ignore it.
   */
  localOnly?: true;
  /**
   * Cache breakpoints for a system message (Vault M5, CTO J17): the character
   * offsets in `content` where a stable prefix ends, recorded by
   * `systemPrompt` at the start of the vault pack. The Anthropic provider
   * splits `system` into text blocks there and marks the first when prompt
   * caching is on (`providers.<id>.promptCache: 'auto'`). Additive: every
   * other provider ignores it, and caching off sends the string unchanged.
   */
  cacheAt?: number[];
}

/** JSON Schema for a tool, produced from the zod definitions at the boundary. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  /**
   * When set and the backend supports grammar/structured decoding, the
   * response is constrained to this JSON schema (the tool-call bridge uses it).
   */
  jsonSchema?: Record<string, unknown>;
  /** Provider-specific keep-alive (Ollama) so the resource budget is honored. */
  keepAlive?: string;
  /**
   * Chain of Thought for this request. 'on' asks a native reasoner to think
   * (Claude's thinking parameter, Ollama's think flag); 'off' asks it not to
   * where the API allows. Undefined leaves the backend's own default, so
   * callers that predate the setting are unchanged.
   */
  reasoning?: 'on' | 'off';
}

export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  /** The finished thinking blocks of a Claude turn, for replay (see
   *  ChatMessage.thinkingBlocks). Sent once, before done. */
  | { type: 'thinking-blocks'; blocks: unknown[] }
  | { type: 'tool-call'; call: ToolCallRequest }
  | {
      type: 'usage';
      promptTokens: number;
      completionTokens: number;
      /** Prompt tokens served from a provider's prompt cache (Vault M5, CTO
       *  J17). Absent when the provider reports none. */
      cacheReadTokens?: number;
      /** Prompt tokens written to a provider's prompt cache this request. */
      cacheWriteTokens?: number;
    }
  | { type: 'done'; stopReason: 'end' | 'tool-calls' | 'length' | 'stop' | 'aborted' };

export type CostTier = 'free' | 'metered';
export type LatencyTier = 'fast' | 'standard' | 'slow';

export interface ProviderCapabilities {
  supportsTools: boolean;
  supportsVision: boolean;
  /** Grammar / structured-output constrained decoding. */
  supportsGrammar: boolean;
  /** The window this model is served. With a provider's `numCtx: 'auto'`
   *  (Vault M4, CTO I1) it is the served window, the lower of the model's own
   *  and the per-class ceiling. On Ollama without it, what Ollama serves a
   *  request that names no window (the Modelfile's `num_ctx`, else the server
   *  default), never more than the model's own. Elsewhere the model's own. */
  contextTokens: number;
  /** The model's own window as the server reports it, set when
   *  `contextTokens` holds a served window. Class derivation reads
   *  `nativeContextTokens ?? contextTokens`, so serving less never drops a
   *  seat a class. */
  nativeContextTokens?: number;
  costTier: CostTier;
  latencyTier: LatencyTier;
  /** Standard capability categories this model is strong in (see router/roles). */
  categories: CapabilityCategory[];
}

/** What giving a model more room would do on this computer, for the
 *  truncation card: 'more' with the larger window (and about how many GB it
 *  takes, when the model says enough), or 'full' when this computer's memory
 *  allows no larger window than it has now. */
export type MoreRoom = { room: 'more'; window: number; gb?: number } | { room: 'full' };

export interface Provider {
  id: string;
  label: string;
  kind: 'local' | 'cloud';
  /** True when requests leave this computer's own network (loopback, LAN, or
   *  the person's own tailnet), judged by the endpoint's address, never by a
   *  config label. Every 'cloud' provider is remote; an OpenAI-compatible
   *  server on the internet is too. What leaves asks first and never carries
   *  the project's secrets. */
  remote: boolean;
  capabilities(model: string): Promise<ProviderCapabilities>;
  chat(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent, void, void>;
  /** Models this endpoint can serve right now (empty when unknown). */
  listModels(): Promise<string[]>;
  /** One cheap round trip to prove the endpoint is alive. */
  health(): Promise<{ ok: boolean; detail: string }>;
  /** What serving `model` a larger window would do on this computer, for the
   *  truncation card's action (servedWindow.ts). Only a server whose window
   *  the harness sets (Ollama) answers; undefined elsewhere. */
  moreRoom?(model: string): Promise<MoreRoom | undefined>;
}

/** Embedding is a separate, tiny contract; the index layer uses it directly. */
export interface EmbeddingProvider {
  embed(model: string, texts: string[]): Promise<number[][]>;
}

/** Image generation is a TOOL, not a chat model; the diffusion path uses this. */
export interface ImageProvider {
  id: string;
  label: string;
  generate(
    prompt: string,
    opts?: { width?: number; height?: number; model?: string },
  ): Promise<{
    imageBase64: string;
    mediaType: string;
  }>;
  health(): Promise<{ ok: boolean; detail: string }>;
}

export class ProviderError extends Error {
  constructor(
    public readonly providerId: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** True when a provider's requests leave this computer's own network. This
 *  judges a server; a seat (a server answering as one model) is judged by
 *  seatLeaves. */
export function leavesThisNetwork(provider: Pick<Provider, 'kind' | 'remote'>): boolean {
  return provider.kind === 'cloud' || provider.remote;
}

/** True when a seat's requests leave this computer's own network: its
 *  server's address leaves (leavesThisNetwork), or its model is an Ollama
 *  cloud tag (isOllamaCloudTag), which a local Ollama passes on to
 *  ollama.com. Every check on where a model answers judges with this. */
export function seatLeaves(provider: Pick<Provider, 'kind' | 'remote'>, model: string): boolean {
  return leavesThisNetwork(provider) || isOllamaCloudTag(model);
}
