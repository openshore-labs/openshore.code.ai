// The served window (Vault M4, CTO I1). With `numCtx: 'auto'` an Ollama
// endpoint sends `options.num_ctx` on every request, the lower of the model's
// own window and the per-class ceiling for this computer's memory. Off or
// unset, and every non-Ollama backend, leaves the request body as it was.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { totalmem } from 'node:os';
import { OpenAICompatibleProvider } from '../src/providers/openaiCompatible.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { hostRamGB } from '../src/providers/hostMemory.js';
import { _setProbeResult } from '../src/providers/capabilities.js';
import { ConfigSchema, type OpenAICompatibleEndpoint } from '../src/config/schema.js';
import { deriveModelClass, servedContextTokens } from '../src/harness/profile.js';
import type { ChatEvent } from '../src/providers/types.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

async function collect(gen: AsyncGenerator<ChatEvent, void, void>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

let seq = 0;

/** A fake server of the given flavor that reports `nativeCtx` from /api/show
 *  and records every chat body it is sent. */
function mockServer(flavor: 'ollama' | 'vllm', nativeCtx = 131072) {
  const baseUrl = `http://numctx-${flavor}-${seq++}.test`;
  _setProbeResult(baseUrl, {
    flavor,
    grammar: true,
    nativeTools: true,
    label: flavor === 'ollama' ? 'Ollama' : 'vLLM',
    ...(flavor === 'ollama' ? { version: '0.12.3' } : {}),
  });
  const chats: Array<Record<string, any>> = [];
  let shows = 0;
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).endsWith('/api/show')) {
      shows++;
      return new Response(
        JSON.stringify({
          model_info: { 'llama.context_length': nativeCtx },
          capabilities: ['completion', 'tools'],
        }),
        { status: 200 },
      );
    }
    chats.push(JSON.parse(String(init?.body)));
    if (flavor === 'ollama') {
      return new Response(JSON.stringify({ message: { content: 'ok' }, done: true }) + '\n', {
        status: 200,
      });
    }
    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  }) as unknown as typeof fetch;
  return { baseUrl, chats, shows: () => shows };
}

function provider(
  baseUrl: string,
  numCtx: OpenAICompatibleEndpoint['numCtx'],
  ramGB = 16,
): OpenAICompatibleProvider {
  const endpoint: OpenAICompatibleEndpoint = { kind: 'openai-compatible', baseUrl };
  if (numCtx !== undefined) endpoint.numCtx = numCtx;
  return new OpenAICompatibleProvider('local', endpoint, {}, { ramGB: () => ramGB });
}

describe('num_ctx on an Ollama endpoint', () => {
  // 16 GB sits in the under-24 band: tiny/small 16384, mid 8192, large 4096.
  const byClass: Array<[string, string, number]> = [
    ['qwen2.5-coder:1.5b', 'tiny', 16384],
    ['qwen2.5-coder:7b', 'small', 16384],
    ['qwen2.5-coder:14b', 'mid', 8192],
    ['llama3.3:70b', 'large', 4096],
  ];

  it.each(byClass)('sends the class ceiling for %s (%s) when auto', async (model, cls, want) => {
    expect(deriveModelClass({ model, kind: 'local' })).toBe(cls);
    const server = mockServer('ollama');
    await collect(provider(server.baseUrl, 'auto').chat({ model, messages: [] }));
    expect(server.chats[0]!.options.num_ctx).toBe(want);
    expect(want).toBe(servedContextTokens(131072, deriveModelClass({ model, kind: 'local' }), 16));
  });

  it('never serves more than the model has', async () => {
    const server = mockServer('ollama', 4096);
    await collect(
      provider(server.baseUrl, 'auto').chat({ model: 'qwen2.5-coder:7b', messages: [] }),
    );
    expect(server.chats[0]!.options.num_ctx).toBe(4096);
  });

  it('follows the memory band', async () => {
    const small = mockServer('ollama');
    await collect(
      provider(small.baseUrl, 'auto', 8).chat({ model: 'qwen2.5-coder:14b', messages: [] }),
    );
    expect(small.chats[0]!.options.num_ctx).toBe(4096);
    const big = mockServer('ollama');
    await collect(
      provider(big.baseUrl, 'auto', 64).chat({ model: 'qwen2.5-coder:14b', messages: [] }),
    );
    expect(big.chats[0]!.options.num_ctx).toBe(32768);
  });

  it('keeps the other options beside it', async () => {
    const server = mockServer('ollama');
    await collect(
      provider(server.baseUrl, 'auto').chat({
        model: 'qwen2.5-coder:7b',
        messages: [],
        temperature: 0.2,
      }),
    );
    expect(server.chats[0]!.options).toEqual({ temperature: 0.2, num_ctx: 16384 });
  });

  it('is absent when off', async () => {
    const server = mockServer('ollama');
    await collect(
      provider(server.baseUrl, 'off').chat({ model: 'qwen2.5-coder:7b', messages: [] }),
    );
    expect(server.chats[0]!.options).toBeUndefined();
  });

  it('is absent when unset, and the body is what it always was', async () => {
    const server = mockServer('ollama');
    await collect(
      provider(server.baseUrl, undefined).chat({
        model: 'qwen2.5-coder:7b',
        messages: [],
        temperature: 0.2,
      }),
    );
    expect(server.chats[0]!.options).toEqual({ temperature: 0.2 });
    expect(JSON.stringify(server.chats[0])).not.toContain('num_ctx');
  });

  it('holds one value across requests, with no fresh probe', async () => {
    const server = mockServer('ollama');
    const p = provider(server.baseUrl, 'auto');
    const shownBefore = server.shows();
    for (let i = 0; i < 3; i++) {
      await collect(p.chat({ model: 'qwen2.5-coder:7b', messages: [] }));
    }
    expect(server.chats.map((c) => c.options.num_ctx)).toEqual([16384, 16384, 16384]);
    expect(server.shows() - shownBefore).toBeLessThanOrEqual(1);
  });

  it('two providers on the same computer ask for the same window (engine and /chat)', async () => {
    const server = mockServer('ollama');
    const engine = provider(server.baseUrl, 'auto');
    const chat = provider(server.baseUrl, 'auto');
    await collect(engine.chat({ model: 'qwen2.5-coder:14b', messages: [] }));
    await collect(chat.chat({ model: 'qwen2.5-coder:14b', messages: [] }));
    expect(server.chats[0]!.options.num_ctx).toBe(server.chats[1]!.options.num_ctx);
  });
});

describe('num_ctx elsewhere', () => {
  it('is never sent to a non-Ollama backend, even when auto', async () => {
    const server = mockServer('vllm');
    await collect(
      provider(server.baseUrl, 'auto').chat({ model: 'qwen2.5-coder:7b', messages: [] }),
    );
    expect(JSON.stringify(server.chats[0])).not.toContain('num_ctx');
    expect(server.chats[0]!.options).toBeUndefined();
  });

  it('a non-Ollama backend reports only its own window', async () => {
    const server = mockServer('vllm');
    const caps = await provider(server.baseUrl, 'auto').capabilities('qwen2.5-coder:7b');
    expect(caps.nativeContextTokens).toBeUndefined();
  });
});

describe('capabilities report both numbers', () => {
  it('auto: contextTokens is the served window, nativeContextTokens the model own', async () => {
    const server = mockServer('ollama');
    const caps = await provider(server.baseUrl, 'auto').capabilities('qwen2.5-coder:14b');
    expect(caps.contextTokens).toBe(8192);
    expect(caps.nativeContextTokens).toBe(131072);
    // Serving less never drops the seat a class.
    expect(deriveModelClass({ model: 'mystery', kind: 'local', caps })).toBe('mid');
  });

  it('capabilities and the request agree', async () => {
    const server = mockServer('ollama');
    const p = provider(server.baseUrl, 'auto');
    const caps = await p.capabilities('llama3.3:70b');
    await collect(p.chat({ model: 'llama3.3:70b', messages: [] }));
    expect(server.chats[0]!.options.num_ctx).toBe(caps.contextTokens);
  });

  it('off: contextTokens is the window Ollama serves by default, native the model own (C1)', async () => {
    const server = mockServer('ollama');
    const caps = await provider(server.baseUrl, 'off').capabilities('qwen2.5-coder:14b');
    expect(caps.contextTokens).toBe(4096);
    expect(caps.nativeContextTokens).toBe(131072);
  });
});

describe('host memory and the registry', () => {
  it('reads memory once, rounded the way hardwareFacts rounds it', () => {
    const first = hostRamGB();
    expect(first).toBe(Math.round(totalmem() / 1024 ** 3));
    expect(hostRamGB()).toBe(first);
  });

  it('a configured auto endpoint sends num_ctx through the registry', async () => {
    const server = mockServer('ollama');
    const config = ConfigSchema.parse({
      providers: {
        local: { kind: 'openai-compatible', baseUrl: server.baseUrl, numCtx: 'auto' },
      },
    });
    const registry = new ProviderRegistry(config, () => undefined);
    await collect(registry.get('local').chat({ model: 'qwen2.5-coder:7b', messages: [] }));
    expect(server.chats[0]!.options.num_ctx).toBe(
      servedContextTokens(131072, 'small', hostRamGB()),
    );
  });
});
