// The Provider contract. One interface covers Ollama, LM Studio, llama.cpp,
// vLLM, and cloud Claude; the router only ever sees this shape.
import type { CapabilityCategory } from '../router/roles.js';

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
}

export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool-call'; call: ToolCallRequest }
  | { type: 'usage'; promptTokens: number; completionTokens: number }
  | { type: 'done'; stopReason: 'end' | 'tool-calls' | 'length' | 'stop' | 'aborted' };

export type CostTier = 'free' | 'metered';
export type LatencyTier = 'fast' | 'standard' | 'slow';

export interface ProviderCapabilities {
  supportsTools: boolean;
  supportsVision: boolean;
  /** Grammar / structured-output constrained decoding. */
  supportsGrammar: boolean;
  contextTokens: number;
  costTier: CostTier;
  latencyTier: LatencyTier;
  /** Standard capability categories this model is strong in (see router/roles). */
  categories: CapabilityCategory[];
}

export interface Provider {
  id: string;
  label: string;
  kind: 'local' | 'cloud';
  capabilities(model: string): Promise<ProviderCapabilities>;
  chat(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent, void, void>;
  /** Models this endpoint can serve right now (empty when unknown). */
  listModels(): Promise<string[]>;
  /** One cheap round trip to prove the endpoint is alive. */
  health(): Promise<{ ok: boolean; detail: string }>;
}

/** Embedding is a separate, tiny contract; the index layer uses it directly. */
export interface EmbeddingProvider {
  embed(model: string, texts: string[]): Promise<number[][]>;
}

/** Image generation is a TOOL, not a chat model; the diffusion path uses this. */
export interface ImageProvider {
  id: string;
  label: string;
  generate(prompt: string, opts?: { width?: number; height?: number; model?: string }): Promise<{
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
