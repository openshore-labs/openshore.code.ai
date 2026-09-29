// One provider client for every network seat (build 2026-09-29, B1): the same
// events (text, thinking, usage, the round's tool calls) from a streamed or a
// whole reply, on every shell's transport (CTO ruling 7): Electron's guarded
// IPC stream, the iPhone's WebView stream with one fall back to the native
// shim when a server refuses the cross-origin call (never after the first
// byte, never after a stop), and the web's streaming fetch.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  platform: 'web' as 'web' | 'ios' | 'electron',
  stream: vi.fn(),
  native: vi.fn(),
}));

vi.mock('../src/lib/platform.js', () => ({ platform: () => h.platform }));
vi.mock('../src/lib/streamingFetch.js', () => ({ streamingFetch: h.stream }));
vi.mock('../src/lib/nativeFetch.js', () => ({ nativeFetch: h.native }));

const {
  anthropicClient,
  isOllamaBase,
  openAiBody,
  openAiCompatibleClient,
  ProviderUnavailable,
  raceAbort,
} = await import('../src/drivers/providerClient.js');
import type { ProviderEvent } from '../src/drivers/providerClient.js';
import type { ChatStreamEvent } from '../src/lib/electronBridge.js';

const enc = new TextEncoder();

/** A streamed body from `parts`; `fail` errors the stream after them (a
 *  dropped connection), `hang` never ends it. */
function sseResponse(parts: string[], opts: { fail?: boolean; hang?: boolean } = {}): Response {
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    // Pulled one part at a time, so a failure lands after the parts were read.
    pull(controller) {
      if (at < parts.length) controller.enqueue(enc.encode(parts[at++]!));
      else if (opts.fail) controller.error(new TypeError('network connection was lost'));
      else if (opts.hang) return new Promise<void>(() => undefined);
      else controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

const data = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const delta = (d: Record<string, unknown>) => data({ choices: [{ delta: d }] });

const seat = { label: 'Box', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:3b' };

async function collect(it: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

beforeEach(() => {
  h.platform = 'web';
  h.stream.mockReset();
  h.native.mockReset();
  delete (globalThis as { window?: unknown }).window;
});

describe('an OpenAI-compatible reply', () => {
  it('streams text, thinking (a reasoning field or <think> tags), tool calls and usage', async () => {
    h.stream.mockResolvedValue(
      sseResponse([
        delta({ reasoning_content: 'Weighing it. ' }),
        delta({ content: '<think>hm</think>Hel' }),
        // A line split across two chunks still parses.
        'data: {"choices":[{"delta":{"content":"lo',
        '"}}]}\n\n',
        delta({
          tool_calls: [{ index: 0, id: 'c1', function: { name: 'vaultRead', arguments: '{"pa' } }],
        }),
        delta({ tool_calls: [{ index: 0, function: { arguments: 'th":"a.md"}' } }] }),
        data({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }),
        'data: [DONE]\n\n',
      ]),
    );
    const events = await collect(openAiCompatibleClient(seat).stream([], [{ type: 'function' }]));
    expect(events.filter((e) => e.type === 'thinking').map((e) => e.text)).toEqual([
      'Weighing it. ',
      'hm',
    ]);
    expect(
      events
        .filter((e) => e.type === 'text')
        .map((e) => e.text)
        .join(''),
    ).toBe('Hello');
    expect(events).toContainEqual({ type: 'usage', inputTokens: 12, outputTokens: 3 });
    const done = events.at(-1) as Extract<ProviderEvent, { type: 'done' }>;
    expect(done.text).toBe('Hello');
    expect(done.toolCalls).toEqual([{ id: 'c1', name: 'vaultRead', raw: '{"path":"a.md"}' }]);
    expect(done.replay).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'c1' }] });
    const body = JSON.parse((h.stream.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ model: 'qwen2.5:3b', stream: true });
    expect(body.tools).toHaveLength(1);
  });

  it('throws the server status as a seat that could not answer', async () => {
    h.stream.mockResolvedValue({ ok: false, status: 400, body: null } as unknown as Response);
    const err = await collect(openAiCompatibleClient(seat).stream([], [])).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderUnavailable);
    expect(err).toMatchObject({ status: 400, message: 'Box answered 400.' });
  });

  it('a dropped stream fails after the words that arrived, never retried', async () => {
    h.platform = 'ios';
    h.stream.mockResolvedValue(sseResponse([delta({ content: 'Hello wor' })], { fail: true }));
    const seen: string[] = [];
    const err = await (async () => {
      for await (const e of openAiCompatibleClient(seat).stream([], [])) {
        if (e.type === 'text') seen.push(e.text);
      }
    })().catch((e) => e);
    expect(seen.join('')).toBe('Hello wor');
    expect(err).toBeInstanceOf(TypeError);
    expect(h.native).not.toHaveBeenCalled();
  });
});

describe('the iPhone transport', () => {
  beforeEach(() => {
    h.platform = 'ios';
  });

  it('always declares a JSON body, so a refusal fails at the preflight', async () => {
    h.stream.mockResolvedValue(sseResponse([delta({ content: 'hi' })]));
    await collect(openAiCompatibleClient(seat).stream([], []));
    const init = h.stream.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('falls back once to the native shim, whole, when the server refuses the call', async () => {
    h.stream.mockRejectedValue(new TypeError('Load failed'));
    h.native.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '<think>t</think>Whole answer.', reasoning: 'r' } }],
      }),
    });
    const events = await collect(openAiCompatibleClient(seat).stream([], []));
    expect(h.native).toHaveBeenCalledTimes(1);
    const body = JSON.parse(h.native.mock.calls[0]![1].body as string);
    expect(body.stream).toBe(false);
    expect(events.filter((e) => e.type === 'text').map((e) => e.text)).toEqual(['Whole answer.']);
    expect(events.filter((e) => e.type === 'thinking').map((e) => e.text)).toEqual(['r', 't']);
  });

  it('never retries after a stop', async () => {
    const stop = new AbortController();
    h.stream.mockImplementation(async () => {
      stop.abort();
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
    const err = await collect(openAiCompatibleClient(seat).stream([], [], stop.signal)).catch(
      (e) => e,
    );
    expect(err).toMatchObject({ name: 'AbortError' });
    expect(h.native).not.toHaveBeenCalled();
  });
});

describe('the Electron transport', () => {
  function fakeBridge() {
    let sink: ((e: ChatStreamEvent) => void) | undefined;
    const b = {
      platform: 'electron',
      requests: [] as Array<{ id: string; url: string; body: string }>,
      aborted: [] as string[],
      chatStream: vi.fn(async (r: { id: string; url: string; body: string }) => {
        b.requests.push(r);
        return { status: 200 };
      }),
      chatStreamAbort: vi.fn(async (id: string) => {
        b.aborted.push(id);
      }),
      onChatStream: (cb: (e: ChatStreamEvent) => void) => {
        sink = cb;
        return () => undefined;
      },
      push: (e: ChatStreamEvent) => sink?.(e),
    };
    (globalThis as { window?: unknown }).window = { oscode: b };
    return b;
  }

  beforeEach(() => {
    h.platform = 'electron';
  });

  it('streams through the main-process channel, word by word', async () => {
    const b = fakeBridge();
    const it = openAiCompatibleClient(seat).stream([], [])[Symbol.asyncIterator]();
    const first = it.next();
    await vi.waitFor(() => expect(b.requests).toHaveLength(1));
    const id = b.requests[0]!.id;
    expect(b.requests[0]!.url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    b.push({ id, kind: 'data', chunk: delta({ content: 'Hel' }) });
    expect(await first).toEqual({ value: { type: 'text', text: 'Hel' }, done: false });
    b.push({ id, kind: 'data', chunk: delta({ content: 'lo' }) });
    expect((await it.next()).value).toEqual({ type: 'text', text: 'lo' });
    b.push({ id, kind: 'end' });
    const rest: ProviderEvent[] = [];
    for (let r = await it.next(); !r.done; r = await it.next()) rest.push(r.value);
    expect(rest.at(-1)).toMatchObject({ type: 'done', text: 'Hello' });
    expect(h.stream).not.toHaveBeenCalled();
    expect(h.native).not.toHaveBeenCalled();
  });

  it('a stop ends it at once, tells main, and drops the late bytes by id', async () => {
    const b = fakeBridge();
    const stop = new AbortController();
    const seen: string[] = [];
    const run = (async () => {
      for await (const e of openAiCompatibleClient(seat).stream([], [], stop.signal)) {
        if (e.type === 'text') seen.push(e.text);
      }
    })().catch((e) => e);
    await vi.waitFor(() => expect(b.requests).toHaveLength(1));
    const id = b.requests[0]!.id;
    b.push({ id, kind: 'data', chunk: delta({ content: 'Part' }) });
    await vi.waitFor(() => expect(seen).toEqual(['Part']));
    stop.abort();
    expect(await run).toMatchObject({ name: 'AbortError' });
    expect(b.aborted).toEqual([id]);
    b.push({ id, kind: 'data', chunk: delta({ content: 'late' }) });
    expect(seen).toEqual(['Part']);
  });

  it("says main's refusal in its own words", async () => {
    const b = fakeBridge();
    b.chatStream.mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'osc:chatStream': Error: blocked: plain http only reaches a server on your own network; use https for anything else",
      ),
    );
    const err = await collect(openAiCompatibleClient(seat).stream([], [])).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderUnavailable);
    expect(err.message).toBe(
      'plain http only reaches a server on your own network; use https for anything else',
    );
  });
});

describe('the request body', () => {
  it('sends num_ctx only to an Ollama endpoint, and only when it is set', () => {
    expect(isOllamaBase('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isOllamaBase('https://api.openai.com/v1')).toBe(false);
    // Nothing on the app side sets it today, so no request carries it (CTO 5).
    expect(JSON.parse(openAiBody(seat, [], [], true)).options).toBeUndefined();
    expect(JSON.parse(openAiBody({ ...seat, numCtx: 8192 }, [], [], true)).options).toEqual({
      num_ctx: 8192,
    });
    expect(
      JSON.parse(
        openAiBody({ ...seat, baseUrl: 'https://api.openai.com/v1', numCtx: 8192 }, [], [], true),
      ).options,
    ).toBeUndefined();
  });
});

describe('Claude', () => {
  it('yields the same events from the SDK stream, with its tool uses', async () => {
    const handlers: Record<string, (d: string) => void> = {};
    const client = {
      messages: {
        stream: vi.fn(() => ({
          on: (ev: string, cb: (d: string) => void) => {
            handlers[ev] = cb;
          },
          finalMessage: async () => {
            handlers.thinking?.('pondering');
            handlers.text?.('Reading it.');
            return {
              content: [
                { type: 'text', text: 'Reading it.' },
                { type: 'tool_use', id: 'u1', name: 'vaultRead', input: { path: 'a.md' } },
              ],
              usage: { input_tokens: 5, output_tokens: 2 },
            };
          },
        })),
      },
    };
    const events = await collect(
      anthropicClient(client as never, { model: 'claude-haiku-4-5', max_tokens: 64 }).stream(
        [{ role: 'user', content: 'hi' }],
        [],
      ),
    );
    expect(events.map((e) => e.type)).toEqual(['thinking', 'text', 'usage', 'done']);
    expect(events.at(-1)).toMatchObject({
      text: 'Reading it.',
      toolCalls: [{ id: 'u1', name: 'vaultRead', parsed: { path: 'a.md' } }],
    });
  });
});

describe('raceAbort', () => {
  it('unwinds a call that cannot be cancelled the moment Stop fires', async () => {
    const stop = new AbortController();
    const never = new Promise<string>(() => undefined);
    const raced = raceAbort(never, stop.signal);
    stop.abort();
    await expect(raced).rejects.toMatchObject({ name: 'AbortError' });
  });
});
