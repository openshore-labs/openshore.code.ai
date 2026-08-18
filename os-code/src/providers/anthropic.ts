// Cloud Claude over the Anthropic Messages API. Two auth modes:
//   - 'api-key': bring your own Anthropic API key. Real, dependable, the
//     documented path. This is what `osc login` sets up.
//   - 'subscription': EXPERIMENTAL STUB. Driving a consumer Claude
//     subscription from a third-party client is a terms-of-service gray area
//     and can break overnight, so OS Code ships it disabled, labeled, and off
//     every marketing surface. The app fully works on the API-key path alone.
import type {
  ChatEvent,
  ChatMessage,
  ChatRequest,
  ContentPart,
  Provider,
  ProviderCapabilities,
  ToolCallRequest,
} from './types.js';
import { ProviderError } from './types.js';
import type { AnthropicEndpoint } from '../config/schema.js';

const API_VERSION = '2023-06-01';

export class AnthropicProvider implements Provider {
  readonly kind = 'cloud' as const;

  constructor(
    readonly id: string,
    private readonly endpoint: AnthropicEndpoint,
    /** Injected so the provider layer stays free of credential-store imports. */
    private readonly getApiKey: () => string | undefined,
  ) {}

  get label(): string {
    return this.endpoint.label ?? 'Claude (cloud)';
  }

  private get baseUrl(): string {
    return this.endpoint.baseUrl.replace(/\/$/, '');
  }

  private requireKey(): string {
    if (this.endpoint.auth === 'subscription') {
      throw new ProviderError(
        this.id,
        'Claude subscription sign-in is an experimental stub and is not wired to the API yet. Use an API key instead: run osc login.',
      );
    }
    const key = this.getApiKey();
    if (!key) {
      throw new ProviderError(
        this.id,
        'No Anthropic API key is connected. Run osc login to add one; it stays on this machine.',
      );
    }
    return key;
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': this.requireKey(),
      'anthropic-version': API_VERSION,
    };
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models?limit=1`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 401)
        return {
          ok: false,
          detail: 'The Anthropic API key was rejected. Run osc login to replace it.',
        };
      if (!res.ok) return { ok: false, detail: `Anthropic API answered ${res.status}.` };
      return { ok: true, detail: `Claude connected (${this.endpoint.model})` };
    } catch (err) {
      if (err instanceof ProviderError) return { ok: false, detail: err.message };
      return { ok: false, detail: `Could not reach the Anthropic API: ${(err as Error).message}` };
    }
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/v1/models?limit=100`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new ProviderError(this.id, `GET /v1/models returned ${res.status}`);
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    return (body.data ?? []).map((m) => m.id);
  }

  async capabilities(_model: string): Promise<ProviderCapabilities> {
    return {
      supportsTools: true,
      supportsVision: true,
      supportsGrammar: false, // validate-and-repair applies; Claude rarely needs it
      contextTokens: 200_000,
      costTier: 'metered',
      latencyTier: 'standard',
      categories: ['reasoning', 'coding', 'vision'],
    };
  }

  async *chat(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent, void, void> {
    const { system, messages } = toAnthropicMessages(request.messages);
    const body: Record<string, unknown> = {
      model: request.model || this.endpoint.model,
      max_tokens: request.maxTokens ?? 8192,
      stream: true,
      messages,
    };
    if (system) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.stop?.length) body.stop_sequences = request.stop;
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: signal ?? null,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ProviderError(this.id, anthropicErrorHint(res.status, text));
    }

    // Streamed content blocks; tool_use inputs arrive as JSON fragments.
    const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
    let stopReason: string | undefined;
    let sawToolUse = false;

    if (!res.body) {
      yield { type: 'done', stopReason: 'end' };
      return;
    }
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
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          let evt: any;
          try {
            evt = JSON.parse(data);
          } catch {
            continue;
          }
          switch (evt.type) {
            case 'message_start':
              if (evt.message?.usage) {
                yield {
                  type: 'usage',
                  promptTokens: Number(evt.message.usage.input_tokens ?? 0),
                  completionTokens: Number(evt.message.usage.output_tokens ?? 0),
                };
              }
              break;
            case 'content_block_start':
              if (evt.content_block?.type === 'tool_use') {
                sawToolUse = true;
                toolBlocks.set(evt.index, {
                  id: evt.content_block.id,
                  name: evt.content_block.name,
                  json: '',
                });
              }
              break;
            case 'content_block_delta': {
              const d = evt.delta;
              if (d?.type === 'text_delta' && d.text) yield { type: 'text', delta: d.text };
              if (d?.type === 'thinking_delta' && d.thinking)
                yield { type: 'thinking', delta: d.thinking };
              if (d?.type === 'input_json_delta') {
                const slot = toolBlocks.get(evt.index);
                if (slot) slot.json += d.partial_json ?? '';
              }
              break;
            }
            case 'message_delta':
              if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
              if (evt.usage?.output_tokens !== undefined) {
                yield {
                  type: 'usage',
                  promptTokens: 0,
                  completionTokens: Number(evt.usage.output_tokens),
                };
              }
              break;
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }

    for (const [, slot] of [...toolBlocks.entries()].sort((a, b) => a[0] - b[0])) {
      const call: ToolCallRequest = { id: slot.id, name: slot.name, argsText: slot.json };
      yield { type: 'tool-call', call };
    }
    yield {
      type: 'done',
      stopReason: signal?.aborted
        ? 'aborted'
        : stopReason === 'max_tokens'
          ? 'length'
          : sawToolUse || stopReason === 'tool_use'
            ? 'tool-calls'
            : 'end',
    };
  }
}

function anthropicErrorHint(status: number, text: string): string {
  if (status === 401) return 'The Anthropic API key was rejected. Run osc login to replace it.';
  if (status === 429)
    return 'The Anthropic API is rate limiting this key right now. Give it a moment, or check your plan limits at console.anthropic.com.';
  if (status === 529 || status === 503)
    return 'The Anthropic API is overloaded right now. The local stack still works; try the cloud step again shortly.';
  return `Anthropic API error ${status}: ${text.slice(0, 300)}`;
}

// ---------------------------------------------------------------------------
// Message conversion: our transcript shape into Anthropic content blocks.
// ---------------------------------------------------------------------------

function toBlocks(content: string | ContentPart[]): unknown {
  if (typeof content === 'string') return content;
  return content.map((p) =>
    p.type === 'image'
      ? {
          type: 'image',
          source: { type: 'base64', media_type: p.mediaType ?? 'image/png', data: p.imageBase64 },
        }
      : { type: 'text', text: p.text ?? '' },
  );
}

export function toAnthropicMessages(messages: ChatMessage[]): {
  system?: string;
  messages: Array<Record<string, unknown>>;
} {
  let system: string | undefined;
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === 'system') {
      const text =
        typeof m.content === 'string'
          ? m.content
          : (m.content.find((p) => p.type === 'text')?.text ?? '');
      system = system ? `${system}\n\n${text}` : text;
      continue;
    }
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId ?? 'unknown',
            content: typeof m.content === 'string' ? m.content : toBlocks(m.content),
          },
        ],
      });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const blocks: unknown[] = [];
      const text =
        typeof m.content === 'string'
          ? m.content
          : (m.content.find((p) => p.type === 'text')?.text ?? '');
      if (text) blocks.push({ type: 'text', text });
      for (const c of m.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: c.id,
          name: c.name,
          input: c.args ?? tryParse(c.argsText) ?? {},
        });
      }
      out.push({ role: 'assistant', content: blocks });
      continue;
    }
    out.push({ role: m.role, content: toBlocks(m.content) });
  }
  return { system, messages: out };
}

function tryParse(text: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(text);
    return typeof v === 'object' && v !== null ? v : undefined;
  } catch {
    return undefined;
  }
}
