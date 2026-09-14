// Provider streams must fail loudly, never quietly. DAE-2: an Anthropic
// in-stream error event is a ProviderError with the same hint the HTTP status
// would carry, so the loop's transient retry sees it. DAE-3: a stream that
// stops delivering bytes trips an idle deadline (reset on every chunk) and
// rejects with a message that names the endpoint, instead of hanging until a
// manual abort. The stalled servers are real loopback http servers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import { OpenAICompatibleProvider } from '../src/providers/openaiCompatible.js';
import { _setProbeResult } from '../src/providers/capabilities.js';
import { _setStreamIdleMs, _setStreamFirstByteMs } from '../src/providers/streamIdle.js';
import type { ChatEvent } from '../src/providers/types.js';

const realFetch = globalThis.fetch;
const servers: Server[] = [];
afterEach(async () => {
  globalThis.fetch = realFetch;
  _setStreamIdleMs(undefined);
  _setStreamFirstByteMs(undefined);
  vi.restoreAllMocks();
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(() => r(undefined)));
  }
});

/** A server that answers 200 with headers, then writes no body at all: it
 *  holds the connection open with the model still prefilling. */
async function silentServer(): Promise<string> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    // Never writes a byte of body: the wait is entirely for the first token.
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  return `http://127.0.0.1:${addr.port}`;
}

function sse(obj: unknown): string {
  return 'data: ' + JSON.stringify(obj) + '\n';
}

/** A server that answers 200 with headers and one chunk, then stalls forever. */
async function stalledServer(firstChunk: string): Promise<string> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(firstChunk);
    // Never ends: the connection is held half-open until the client gives up.
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  return `http://127.0.0.1:${addr.port}`;
}

async function collect(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('Anthropic in-stream error events (DAE-2)', () => {
  it('an overloaded_error event rejects with the overloaded hint after a delta', async () => {
    const body =
      sse({ type: 'message_start', message: { usage: { input_tokens: 3, output_tokens: 0 } } }) +
      sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Half' } }) +
      sse({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
    globalThis.fetch = vi.fn(
      async () => new Response(body, { status: 200 }),
    ) as unknown as typeof fetch;
    const provider = new AnthropicProvider(
      'anthropic',
      { kind: 'anthropic', baseUrl: 'https://api.anthropic.test', auth: 'api-key', model: 'c' },
      () => 'sk-test',
    );
    const events: ChatEvent[] = [];
    await expect(
      (async () => {
        for await (const e of provider.chat({ model: 'c', messages: [] })) events.push(e);
      })(),
    ).rejects.toThrow(/overloaded/i);
    // The delta before the error still streamed; nothing pretended to finish.
    expect(events.some((e) => e.type === 'text')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(false);
  });
});

describe('idle deadline on provider streams (DAE-3)', () => {
  it('anthropic rejects when no bytes arrive within the window', async () => {
    _setStreamIdleMs(150);
    const baseUrl = await stalledServer(
      sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a' } }),
    );
    const provider = new AnthropicProvider(
      'anthropic',
      { kind: 'anthropic', baseUrl, auth: 'api-key', model: 'c' },
      () => 'sk-test',
    );
    const started = Date.now();
    await expect(collect(provider.chat({ model: 'c', messages: [] }))).rejects.toThrow(
      /no bytes for/i,
    );
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('openai-compatible (SSE) rejects and names the endpoint', async () => {
    _setStreamIdleMs(150);
    const baseUrl = await stalledServer(sse({ choices: [{ delta: { content: 'a' } }] }));
    _setProbeResult(baseUrl, { flavor: 'vllm', grammar: true, nativeTools: true, label: 'vLLM' });
    const provider = new OpenAICompatibleProvider('vllm', {
      kind: 'openai-compatible',
      baseUrl,
      label: 'vLLM box',
    });
    await expect(collect(provider.chat({ model: 'm', messages: [] }))).rejects.toThrow(
      /no bytes for .*vLLM box/i,
    );
  });

  it('ollama (NDJSON) rejects too', async () => {
    _setStreamIdleMs(150);
    const baseUrl = await stalledServer(JSON.stringify({ message: { content: 'a' } }) + '\n');
    _setProbeResult(baseUrl, {
      flavor: 'ollama',
      grammar: true,
      nativeTools: true,
      label: 'Ollama',
    });
    const provider = new OpenAICompatibleProvider('ollama', { kind: 'openai-compatible', baseUrl });
    await expect(collect(provider.chat({ model: 'm', messages: [] }))).rejects.toThrow(
      /no bytes for/i,
    );
  });

  it('waits on the generous first-byte window before the first token, not the tight inter-token one', async () => {
    // A short inter-token window must NOT kill a stream that has produced no
    // bytes yet: that wait is prefill, governed by the first-byte window. Here
    // the first byte never comes, but the tight 150ms inter-token window is not
    // what fires; the (longer) first-byte window governs, so a 400ms wait does
    // not trip at 150ms.
    _setStreamIdleMs(150);
    _setStreamFirstByteMs(60_000);
    const baseUrl = await silentServer();
    _setProbeResult(baseUrl, { flavor: 'vllm', grammar: true, nativeTools: true, label: 'vLLM' });
    const provider = new OpenAICompatibleProvider('vllm', {
      kind: 'openai-compatible',
      baseUrl,
      label: 'vLLM box',
    });
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 400);
    const events = await collect(provider.chat({ model: 'm', messages: [] }, abort.signal));
    // It was still waiting on prefill when the caller aborted: an abort, not a
    // stall. If the inter-token window had governed, it would have thrown at 150ms.
    const done = events.find((e) => e.type === 'done');
    expect(done && done.type === 'done' && done.stopReason).toBe('aborted');
  });

  it('the first-byte window does fire when prefill itself overruns, governing over the tight inter-token one', async () => {
    // Inter-token 50ms, first-byte 400ms. With no byte ever, the first-byte
    // window governs: it must NOT fire at 50ms (that is the inter-token wait,
    // which does not apply before the first byte) and must fire by 400ms.
    _setStreamIdleMs(50);
    _setStreamFirstByteMs(400);
    const baseUrl = await silentServer();
    _setProbeResult(baseUrl, { flavor: 'vllm', grammar: true, nativeTools: true, label: 'vLLM' });
    const provider = new OpenAICompatibleProvider('vllm', {
      kind: 'openai-compatible',
      baseUrl,
      label: 'vLLM box',
    });
    const started = Date.now();
    await expect(collect(provider.chat({ model: 'm', messages: [] }))).rejects.toThrow(
      /no bytes for/i,
    );
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThan(200); // did not fire at the 50ms inter-token window
    expect(elapsed).toBeLessThan(2000); // did fire on the 400ms first-byte window
  });

  it("the caller's abort still reads as aborted, not as a stall", async () => {
    _setStreamIdleMs(5000);
    const baseUrl = await stalledServer(sse({ choices: [{ delta: { content: 'a' } }] }));
    _setProbeResult(baseUrl, { flavor: 'vllm', grammar: true, nativeTools: true, label: 'vLLM' });
    const provider = new OpenAICompatibleProvider('vllm', { kind: 'openai-compatible', baseUrl });
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 50);
    const events = await collect(provider.chat({ model: 'm', messages: [] }, abort.signal));
    const done = events.find((e) => e.type === 'done');
    expect(done && done.type === 'done' && done.stopReason).toBe('aborted');
  });
});
