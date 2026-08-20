// C3: an abort during provider streaming must report 'aborted' and skip the
// truncated tool-call flush (which otherwise emits a phantom tool-call built
// from partial, unparseable JSON). Covers both cloud Claude (anthropic.ts) and
// the OpenAI-compatible path (openaiCompatible.ts), mirroring the ollama path.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import { OpenAICompatibleProvider } from '../src/providers/openaiCompatible.js';
import { _setProbeResult } from '../src/providers/capabilities.js';
import type { ChatEvent } from '../src/providers/types.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((r) => setTimeout(r, 2));
  }
}

/**
 * A body that emits `firstChunk`, then blocks the next read on `gate` and
 * closes when it resolves. That gives the test a deterministic seam to abort
 * mid-stream: the provider has processed the first chunk (so its tool-block
 * accumulator is populated) and is parked on the second read.
 */
function gatedBody(firstChunk: string, gate: Promise<void>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let step = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      step += 1;
      if (step === 1) {
        controller.enqueue(enc.encode(firstChunk));
      } else {
        await gate;
        controller.close();
      }
    },
  });
}

function sse(obj: unknown): string {
  return 'data: ' + JSON.stringify(obj);
}

describe('provider abort mid-stream (C3)', () => {
  it('anthropic reports aborted and does not flush a truncated tool-call', async () => {
    const abort = new AbortController();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const firstChunk =
      [
        sse({ type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 0 } } }),
        sse({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'toolu_1', name: 'readFile' },
        }),
        sse({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"path":"a' },
        }),
      ].join('\n') + '\n';

    globalThis.fetch = vi.fn(
      async () => new Response(gatedBody(firstChunk, gate), { status: 200 }),
    ) as unknown as typeof fetch;

    const provider = new AnthropicProvider(
      'anthropic',
      {
        kind: 'anthropic',
        baseUrl: 'https://api.anthropic.test',
        auth: 'api-key',
        model: 'claude-x',
      },
      () => 'sk-test',
    );

    const events: ChatEvent[] = [];
    const consume = (async () => {
      for await (const e of provider.chat(
        { model: 'claude-x', messages: [{ role: 'user', content: 'hi' }] },
        abort.signal,
      )) {
        events.push(e);
      }
    })();

    await waitUntil(() => events.some((e) => e.type === 'usage'));
    abort.abort();
    release();
    await consume;

    const done = events.find((e) => e.type === 'done');
    expect(done && done.type === 'done' && done.stopReason).toBe('aborted');
    expect(events.some((e) => e.type === 'tool-call')).toBe(false);
  });

  it('openai-compatible reports aborted and does not flush a truncated tool-call', async () => {
    const baseUrl = 'http://vllm.test';
    _setProbeResult(baseUrl, { flavor: 'vllm', grammar: true, nativeTools: true, label: 'vLLM' });

    const abort = new AbortController();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const firstChunk =
      [
        sse({ choices: [{ delta: { content: 'thinking' } }] }),
        sse({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    function: { name: 'readFile', arguments: '{"path":"a' },
                  },
                ],
              },
            },
          ],
        }),
      ].join('\n') + '\n';

    globalThis.fetch = vi.fn(
      async () => new Response(gatedBody(firstChunk, gate), { status: 200 }),
    ) as unknown as typeof fetch;

    const provider = new OpenAICompatibleProvider('vllm', {
      kind: 'openai-compatible',
      baseUrl,
    });

    const events: ChatEvent[] = [];
    const consume = (async () => {
      for await (const e of provider.chat(
        { model: 'mini', messages: [{ role: 'user', content: 'hi' }] },
        abort.signal,
      )) {
        events.push(e);
      }
    })();

    await waitUntil(() => events.some((e) => e.type === 'text'));
    abort.abort();
    release();
    await consume;

    const done = events.find((e) => e.type === 'done');
    expect(done && done.type === 'done' && done.stopReason).toBe('aborted');
    expect(events.some((e) => e.type === 'tool-call')).toBe(false);
  });
});
