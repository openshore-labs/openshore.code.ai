// The local workhorse. One provider speaks to Ollama, LM Studio, llama.cpp,
// and vLLM. Ollama gets its native /api/chat (tools, images, structured
// output, keep_alive); everything else gets /v1/chat/completions with SSE.
import type {
  ChatEvent,
  ChatMessage,
  ChatRequest,
  ContentPart,
  EmbeddingProvider,
  Provider,
  ProviderCapabilities,
  ToolCallRequest,
} from './types.js';
import { ProviderError } from './types.js';
import type { OpenAICompatibleEndpoint } from '../config/schema.js';
import {
  defaultContextTokens,
  looksVisionCapable,
  probeBackend,
  type BackendProfile,
} from './capabilities.js';
import type { CapabilityCategory } from '../router/roles.js';
import { logger } from '../util/log.js';

const log = logger('openai-compatible');

interface ShowInfo {
  contextTokens?: number;
  vision?: boolean;
  toolCapable?: boolean;
}

export class OpenAICompatibleProvider implements Provider, EmbeddingProvider {
  readonly kind = 'local' as const;
  private showCache = new Map<string, ShowInfo>();
  /** Models observed to reject native tools; the bridge falls back to JSON-in-text. */
  private toolRejects = new Set<string>();

  constructor(
    readonly id: string,
    private readonly endpoint: OpenAICompatibleEndpoint,
    /** Optional category tags from the stack config / catalog. */
    private readonly categoriesByModel: Record<string, CapabilityCategory[]> = {},
  ) {}

  get label(): string {
    return this.endpoint.label ?? this.id;
  }

  private get baseUrl(): string {
    return this.endpoint.baseUrl.replace(/\/$/, '');
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.endpoint.apiKeyEnv) {
      const key = process.env[this.endpoint.apiKeyEnv];
      if (key) headers.authorization = `Bearer ${key}`;
    }
    return headers;
  }

  async backend(): Promise<BackendProfile> {
    return probeBackend(this.baseUrl);
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const backend = await this.backend();
      const models = await this.listModels();
      return {
        ok: true,
        detail: `${backend.label} at ${this.baseUrl}, ${models.length} model${models.length === 1 ? '' : 's'} available`,
      };
    } catch (err) {
      return { ok: false, detail: this.connectHint(err) };
    }
  }

  private connectHint(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ECONNREFUSED|fetch failed|network|abort/i.test(msg)) {
      return `Nothing is answering at ${this.baseUrl}. If this is Ollama, start it with: ollama serve`;
    }
    return `${this.label} at ${this.baseUrl} answered with an error: ${msg}`;
  }

  async listModels(): Promise<string[]> {
    const backend = await this.backend();
    if (backend.flavor === 'ollama') {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new ProviderError(this.id, `GET /api/tags returned ${res.status}`);
      const body = (await res.json()) as { models?: Array<{ name: string }> };
      return (body.models ?? []).map((m) => m.name);
    }
    const res = await fetch(`${this.baseUrl}/v1/models`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new ProviderError(this.id, `GET /v1/models returned ${res.status}`);
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    return (body.data ?? []).map((m) => m.id);
  }

  /** Ollama /api/show enriches context length and vision detection. Best effort. */
  private async showInfo(model: string): Promise<ShowInfo> {
    const cached = this.showCache.get(model);
    if (cached) return cached;
    const info: ShowInfo = {};
    try {
      const backend = await this.backend();
      if (backend.flavor === 'ollama') {
        const res = await fetch(`${this.baseUrl}/api/show`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ model }),
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const body = (await res.json()) as {
            model_info?: Record<string, unknown>;
            capabilities?: string[];
            details?: { families?: string[] };
          };
          const modelInfo = body.model_info ?? {};
          for (const [k, v] of Object.entries(modelInfo)) {
            if (k.endsWith('.context_length') && typeof v === 'number') info.contextTokens = v;
          }
          const caps = body.capabilities ?? [];
          const families = body.details?.families ?? [];
          if (caps.includes('vision') || families.includes('clip') || families.includes('mllama')) {
            info.vision = true;
          }
          if (caps.length > 0) info.toolCapable = caps.includes('tools');
        }
      }
    } catch (err) {
      log.debug('show probe failed', { model, err: String(err) });
    }
    this.showCache.set(model, info);
    return info;
  }

  async capabilities(model: string): Promise<ProviderCapabilities> {
    const backend = await this.backend();
    const show = await this.showInfo(model);
    return {
      supportsTools:
        !this.toolRejects.has(model) && backend.nativeTools && show.toolCapable !== false,
      supportsVision: show.vision ?? looksVisionCapable(model),
      supportsGrammar: backend.grammar,
      contextTokens: show.contextTokens ?? defaultContextTokens(model),
      costTier: 'free',
      latencyTier: 'standard',
      categories: this.categoriesByModel[model] ?? ['reasoning', 'coding'],
    };
  }

  /** Called by the bridge when a backend rejects native tools for a model. */
  noteToolReject(model: string): void {
    this.toolRejects.add(model);
  }

  async *chat(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent, void, void> {
    const backend = await this.backend();
    try {
      if (backend.flavor === 'ollama') {
        yield* this.chatOllama(request, signal);
      } else {
        yield* this.chatOpenAI(request, backend, signal);
      }
    } catch (err) {
      if (signal?.aborted) {
        yield { type: 'done', stopReason: 'aborted' };
        return;
      }
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(this.id, this.connectHint(err), err);
    }
  }

  // -------------------------------------------------------------------------
  // Ollama native path: NDJSON streaming over /api/chat.
  // -------------------------------------------------------------------------

  private async *chatOllama(
    request: ChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatEvent, void, void> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map(toOllamaMessage),
      stream: true,
    };
    if (request.tools?.length && !this.toolRejects.has(request.model)) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    if (request.jsonSchema) body.format = request.jsonSchema;
    if (request.keepAlive) body.keep_alive = request.keepAlive;
    const options: Record<string, unknown> = {};
    if (request.temperature !== undefined) options.temperature = request.temperature;
    if (request.maxTokens !== undefined) options.num_predict = request.maxTokens;
    if (request.stop?.length) options.stop = request.stop;
    if (Object.keys(options).length) body.options = options;

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: signal ?? null,
    });
    if (!res.ok) {
      const text = await res.text();
      if (/does not support tools/i.test(text)) {
        this.noteToolReject(request.model);
        throw new ProviderError(
          this.id,
          `TOOLS_UNSUPPORTED: ${request.model} does not support native tool calls; retrying with the text bridge.`,
        );
      }
      throw new ProviderError(this.id, `Ollama answered ${res.status}: ${truncate(text, 300)}`);
    }

    let sawToolCall = false;
    let callSeq = 0;
    for await (const line of ndjsonLines(res, signal)) {
      let chunk: any;
      try {
        chunk = JSON.parse(line);
      } catch {
        continue;
      }
      const msg = chunk.message;
      if (msg?.content) yield { type: 'text', delta: String(msg.content) };
      if (msg?.thinking) yield { type: 'thinking', delta: String(msg.thinking) };
      if (Array.isArray(msg?.tool_calls)) {
        for (const tc of msg.tool_calls) {
          sawToolCall = true;
          const args = tc.function?.arguments ?? {};
          const call: ToolCallRequest = {
            id: tc.id ?? `call_${callSeq++}`,
            name: tc.function?.name ?? '',
            argsText: typeof args === 'string' ? args : JSON.stringify(args),
            args: typeof args === 'object' && args !== null ? args : undefined,
          };
          yield { type: 'tool-call', call };
        }
      }
      if (chunk.done) {
        yield {
          type: 'usage',
          promptTokens: Number(chunk.prompt_eval_count ?? 0),
          completionTokens: Number(chunk.eval_count ?? 0),
        };
        yield { type: 'done', stopReason: sawToolCall ? 'tool-calls' : 'end' };
        return;
      }
    }
    yield { type: 'done', stopReason: signal?.aborted ? 'aborted' : 'end' };
  }

  // -------------------------------------------------------------------------
  // OpenAI-compatible path: SSE streaming over /v1/chat/completions.
  // -------------------------------------------------------------------------

  private async *chatOpenAI(
    request: ChatRequest,
    backend: BackendProfile,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatEvent, void, void> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map(toOpenAIMessage),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (request.tools?.length && !this.toolRejects.has(request.model)) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (request.stop?.length) body.stop = request.stop;
    if (request.jsonSchema) {
      // llama.cpp, vLLM, and LM Studio all take OpenAI-style json_schema.
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'osc_constrained', schema: request.jsonSchema, strict: true },
      };
    }

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: signal ?? null,
    });
    if (!res.ok) {
      const text = await res.text();
      if (/tool|function/i.test(text) && res.status === 400 && request.tools?.length) {
        this.noteToolReject(request.model);
        throw new ProviderError(
          this.id,
          `TOOLS_UNSUPPORTED: ${request.model} on ${backend.label} rejected native tools; retrying with the text bridge.`,
        );
      }
      throw new ProviderError(
        this.id,
        `${backend.label} answered ${res.status}: ${truncate(text, 300)}`,
      );
    }

    // Accumulate streamed tool-call fragments by index.
    const pending = new Map<number, { id: string; name: string; args: string }>();
    let sawToolCall = false;
    let finish: string | undefined;

    for await (const data of sseData(res, signal)) {
      if (data === '[DONE]') break;
      let chunk: any;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.usage) {
        yield {
          type: 'usage',
          promptTokens: Number(chunk.usage.prompt_tokens ?? 0),
          completionTokens: Number(chunk.usage.completion_tokens ?? 0),
        };
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finish = choice.finish_reason;
      const delta = choice.delta ?? {};
      if (delta.content) yield { type: 'text', delta: String(delta.content) };
      if (delta.reasoning_content)
        yield { type: 'thinking', delta: String(delta.reasoning_content) };
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const slot = pending.get(idx) ?? { id: tc.id ?? `call_${idx}`, name: '', args: '' };
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
          pending.set(idx, slot);
        }
      }
    }

    for (const [, slot] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
      sawToolCall = true;
      yield {
        type: 'tool-call',
        call: { id: slot.id, name: slot.name, argsText: slot.args },
      };
    }
    const stopReason =
      finish === 'length'
        ? 'length'
        : sawToolCall || finish === 'tool_calls'
          ? 'tool-calls'
          : 'end';
    yield { type: 'done', stopReason };
  }

  // -------------------------------------------------------------------------
  // Embeddings (the Embedder role rides the same endpoint).
  // -------------------------------------------------------------------------

  async embed(model: string, texts: string[]): Promise<number[][]> {
    const backend = await this.backend();
    if (backend.flavor === 'ollama') {
      const res = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok)
        throw new ProviderError(this.id, `Embedding failed: ${res.status} ${await res.text()}`);
      const body = (await res.json()) as { embeddings: number[][] };
      return body.embeddings;
    }
    const res = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model, input: texts }),
    });
    if (!res.ok)
      throw new ProviderError(this.id, `Embedding failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return body.data.map((d) => d.embedding);
  }
}

// ---------------------------------------------------------------------------
// Message conversion
// ---------------------------------------------------------------------------

function partsText(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n');
}

function toOllamaMessage(m: ChatMessage): Record<string, unknown> {
  const out: Record<string, unknown> = { role: m.role, content: partsText(m.content) };
  if (Array.isArray(m.content)) {
    const images = m.content
      .filter((p) => p.type === 'image' && p.imageBase64)
      .map((p) => p.imageBase64);
    if (images.length) out.images = images;
  }
  if (m.toolCalls?.length) {
    out.tool_calls = m.toolCalls.map((c) => ({
      function: { name: c.name, arguments: c.args ?? safeParse(c.argsText) ?? {} },
    }));
  }
  if (m.role === 'tool' && m.name) out.tool_name = m.name;
  return out;
}

function toOpenAIMessage(m: ChatMessage): Record<string, unknown> {
  const out: Record<string, unknown> = { role: m.role };
  if (Array.isArray(m.content)) {
    out.content = m.content.map((p) =>
      p.type === 'image'
        ? {
            type: 'image_url',
            image_url: { url: `data:${p.mediaType ?? 'image/png'};base64,${p.imageBase64}` },
          }
        : { type: 'text', text: p.text ?? '' },
    );
  } else {
    out.content = m.content;
  }
  if (m.toolCalls?.length) {
    out.tool_calls = m.toolCalls.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: c.argsText || JSON.stringify(c.args ?? {}) },
    }));
  }
  if (m.role === 'tool' && m.toolCallId) out.tool_call_id = m.toolCallId;
  return out;
}

function safeParse(text: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(text);
    return typeof v === 'object' && v !== null ? v : undefined;
  } catch {
    return undefined;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}

// ---------------------------------------------------------------------------
// Stream readers
// ---------------------------------------------------------------------------

async function* ndjsonLines(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  yield* splitStream(res, '\n', signal);
}

async function* sseData(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  for await (const line of splitStream(res, '\n', signal)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data:')) yield trimmed.slice(5).trim();
  }
}

async function* splitStream(
  res: Response,
  sep: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf(sep)) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + sep.length);
        if (line.trim()) yield line;
      }
    }
    if (buffer.trim()) yield buffer;
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}
