// The direct cloud chat with an OpenAI-compatible provider (a cloud model
// picked by itself, not through the Stack; build 2026-09-29, package cloud).
// It rides the one provider client and its transport (tech review ruling 7): the
// Electron main-process channel, the iPhone's WebView stream with one fall
// back to the native shim when a provider refuses the cross-origin call, and
// the web's streaming fetch. Stop closes the turn at once on every branch,
// keeps the partial in the chat and in history, and drops late data; a
// failure keeps the partial too. Everything the driver did before still holds:
// Perplexity Sonar's sources, the context meter, vision, Chain of Thought, the
// humanizer, and the amber cloud turn. The network is mocked throughout.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';

const h = vi.hoisted(() => ({
  platform: 'ios' as 'web' | 'ios' | 'electron',
  stream: vi.fn(),
  native: vi.fn(),
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => h.platform,
  isDesktop: () => h.platform === 'electron',
}));
vi.mock('../src/lib/streamingFetch.js', () => ({ streamingFetch: h.stream }));
vi.mock('../src/lib/nativeFetch.js', () => ({ nativeFetch: h.native }));

const { CloudOpenAiDriver } = await import('../src/drivers/cloudOpenAiDriver.js');
const { setChainOfThought } = await import('../src/lib/chainOfThought.js');
import type { ChatStreamEvent } from '../src/lib/electronBridge.js';
import type { AppVaultPack } from '../src/drivers/types.js';

const enc = new TextEncoder();
const data = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const delta = (d: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  data({ choices: [{ delta: d }], ...extra });
const words = (content: string) => delta({ content });

/** A streamed reply from `parts`: it then ends, drops (`fail`), or hangs. */
function sse(parts: string[], end: 'close' | 'fail' | 'hang' = 'close'): Response {
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at < parts.length) controller.enqueue(enc.encode(parts[at++]!));
      else if (end === 'fail') controller.error(new TypeError('The network connection was lost.'));
      else if (end === 'hang') return new Promise<void>(() => undefined);
      else controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

/** The native shim's whole answer. */
function whole(body: Record<string, unknown>, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => '',
  };
}

/** The Electron preload's chat channel, with a hand on the main side. */
function fakeBridge() {
  let sink: ((e: ChatStreamEvent) => void) | undefined;
  const b = {
    platform: 'electron',
    requests: [] as Array<{
      id: string;
      url: string;
      headers: Record<string, string>;
      body: string;
    }>,
    chatStream: vi.fn(
      async (r: { id: string; url: string; headers: Record<string, string>; body: string }) => {
        b.requests.push(r);
        return { status: 200 };
      },
    ),
    chatStreamAbort: vi.fn(async (_id: string) => undefined),
    onChatStream: (cb: (e: ChatStreamEvent) => void) => {
      sink = cb;
      return () => undefined;
    },
    push: (e: ChatStreamEvent) => sink?.(e),
  };
  (globalThis as { window?: unknown }).window = { oscode: b };
  return b;
}

type Opts = ConstructorParameters<typeof CloudOpenAiDriver>[7];

function chat(opts: { base?: string; label?: string; model?: string } & Opts = {}) {
  const { base, label, model, ...rest } = opts ?? {};
  const driver = new CloudOpenAiDriver(
    base ?? 'https://api.openai.com/v1',
    'sk-test',
    model ?? 'gpt-5',
    label ?? 'OpenAI',
    undefined,
    undefined,
    400_000,
    rest,
  );
  const events: DriverEvent[] = [];
  driver.subscribe((e) => events.push(e));
  return { driver, events };
}

const dones = (events: DriverEvent[]) => events.filter((e) => e.type === 'task-done');
const deltas = (events: DriverEvent[]) =>
  events.filter((e) => e.type === 'text-delta').map((e) => (e as { text: string }).text);
const finalText = (events: DriverEvent[]) =>
  (events.findLast((e) => e.type === 'text-final') as { text: string } | undefined)?.text;
const settled = (events: DriverEvent[], n = 1) =>
  vi.waitFor(() => expect(dones(events)).toHaveLength(n));

/** The body the streaming fetch sent on its call at `index`. */
const streamedBody = (index = 0) =>
  JSON.parse((h.stream.mock.calls[index]![1] as RequestInit).body as string) as {
    model: string;
    stream: boolean;
    stream_options?: unknown;
    messages: Array<{ role: string; content: unknown }>;
  };
const shimBody = (index = 0) =>
  JSON.parse(h.native.mock.calls[index]![1].body as string) as {
    stream: boolean;
    stream_options?: unknown;
    messages: Array<{ role: string; content: unknown }>;
  };

beforeEach(() => {
  h.platform = 'ios';
  h.stream.mockReset();
  h.native.mockReset();
  setChainOfThought(false);
  delete (globalThis as { window?: unknown }).window;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('it streams on every shell', () => {
  it('on Electron, through the main-process channel, word by word', async () => {
    h.platform = 'electron';
    const b = fakeBridge();
    const { driver, events } = chat();
    driver.send('hello');
    await vi.waitFor(() => expect(b.requests).toHaveLength(1));
    const req = b.requests[0]!;
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(req.headers.authorization).toBe('Bearer sk-test');
    const body = JSON.parse(req.body);
    expect(body).toMatchObject({ model: 'gpt-5', stream: true });
    // Usage rides the stream's last chunk, so the meter reads the real count.
    expect(body.stream_options).toEqual({ include_usage: true });

    b.push({ id: req.id, kind: 'data', chunk: words('Hi ') });
    await vi.waitFor(() => expect(deltas(events)).toEqual(['Hi ']));
    // The first words are on screen while the reply is still coming.
    expect(dones(events)).toHaveLength(0);
    b.push({ id: req.id, kind: 'data', chunk: words('from GPT.') });
    b.push({
      id: req.id,
      kind: 'data',
      chunk: data({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 20 } }),
    });
    b.push({ id: req.id, kind: 'end' });
    await settled(events);
    expect(deltas(events)).toEqual(['Hi ', 'from GPT.']);
    expect(finalText(events)).toBe('Hi from GPT.');
    expect(events.find((e) => e.type === 'usage')).toMatchObject({
      promptTokens: 1000,
      completionTokens: 20,
      dollars: 0,
    });
    expect(dones(events)[0]).toMatchObject({ reason: 'complete' });
    expect(h.stream).not.toHaveBeenCalled();
    expect(h.native).not.toHaveBeenCalled();
    driver.dispose();
  });

  it('on the iPhone, through the WebView fetch, with a JSON body so a refusal fails first', async () => {
    const release: Array<() => void> = [];
    let at = 0;
    const parts = [words('Hi '), words('there.')];
    h.stream.mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          // Hold the reply after its first word, to see it on screen early.
          if (at === 1) {
            return new Promise<void>((r) => release.push(r)).then(() => {
              controller.enqueue(enc.encode(parts[at++]!));
            });
          }
          if (at < parts.length) controller.enqueue(enc.encode(parts[at++]!));
          else controller.close();
        },
      }),
    });
    const { driver, events } = chat();
    driver.send('hello');
    await vi.waitFor(() => expect(deltas(events)).toEqual(['Hi ']));
    expect(dones(events)).toHaveLength(0);
    release.forEach((r) => r());
    await settled(events);
    expect(finalText(events)).toBe('Hi there.');
    const init = h.stream.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(streamedBody()).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(h.native).not.toHaveBeenCalled();
    driver.dispose();
  });

  it('marks every turn as a cloud turn (the amber pill)', async () => {
    h.stream.mockResolvedValue(sse([words('ok')]));
    const { driver, events } = chat();
    driver.send('hello');
    await settled(events);
    expect(events.find((e) => e.type === 'turn-start')).toMatchObject({
      model: 'gpt-5',
      providerKind: 'cloud',
    });
    driver.dispose();
  });
});

describe('a provider that refuses the cross-origin call on the iPhone', () => {
  it('goes once through the native shim, whole, and never generates twice', async () => {
    h.stream.mockRejectedValue(new TypeError('Load failed'));
    h.native.mockResolvedValue(
      whole({
        choices: [{ message: { content: 'Hi from GPT.' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 20 },
      }),
    );
    const { driver, events } = chat();
    driver.send('hello');
    await settled(events);
    expect(h.stream).toHaveBeenCalledTimes(1);
    expect(h.native).toHaveBeenCalledTimes(1);
    expect(h.native.mock.calls[0]![0]).toBe('https://api.openai.com/v1/chat/completions');
    // The shim cannot stream: one whole answer, and no stream options (a
    // provider refuses those on a request that does not stream).
    expect(shimBody().stream).toBe(false);
    expect(shimBody().stream_options).toBeUndefined();
    expect(deltas(events)).toEqual(['Hi from GPT.']);
    expect(finalText(events)).toBe('Hi from GPT.');
    expect(events.find((e) => e.type === 'usage')).toMatchObject({ promptTokens: 1000 });
    expect(dones(events)[0]).toMatchObject({ reason: 'complete' });
    driver.dispose();
  });

  it('estimates prompt tokens locally when the provider omits usage', async () => {
    // Gemini and Kimi may not report usage. The meter should still fill from a
    // local estimate rather than sit at zero.
    h.stream.mockRejectedValue(new TypeError('Load failed'));
    h.native.mockResolvedValue(whole({ choices: [{ message: { content: 'ok' } }] }));
    const { driver, events } = chat();
    driver.send('a fairly long prompt to estimate tokens over');
    await settled(events);
    const usage = events.find((e) => e.type === 'usage') as { promptTokens: number } | undefined;
    expect(usage?.promptTokens).toBeGreaterThan(0);
    driver.dispose();
  });

  it('a stream that drops after its first byte is never sent again', async () => {
    h.stream.mockResolvedValue(sse([words('Hello wor')], 'fail'));
    const { driver, events } = chat();
    driver.send('hello');
    await settled(events);
    expect(h.stream).toHaveBeenCalledTimes(1);
    expect(h.native).not.toHaveBeenCalled();
    driver.dispose();
  });
});

describe('the usage option on a streamed request', () => {
  const refused = { ok: false, status: 400, body: null };

  it('a provider that refuses it is asked once more without it, and answers', async () => {
    h.stream.mockResolvedValueOnce(refused).mockResolvedValueOnce(sse([words('ok')]));
    const { driver, events } = chat();
    driver.send('hi');
    await settled(events);
    expect(h.stream).toHaveBeenCalledTimes(2);
    expect(streamedBody(0).stream_options).toEqual({ include_usage: true });
    expect(streamedBody(1).stream_options).toBeUndefined();
    expect(finalText(events)).toBe('ok');
    expect(dones(events)[0]).toMatchObject({ reason: 'complete' });
    driver.dispose();
  });

  it('a request refused for another reason ends as an error after that one more try', async () => {
    h.stream.mockResolvedValue(refused);
    const { driver, events } = chat();
    driver.send('hi');
    await settled(events);
    expect(h.stream).toHaveBeenCalledTimes(2);
    expect(dones(events)[0]).toMatchObject({ reason: 'error', message: 'OpenAI answered 400.' });
    driver.dispose();
  });
});

describe('Stop closes the turn at once, on every branch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  /** Stop, then 250 ms on the clock: exactly one ending, and it is a stop. */
  async function stopsAtOnce(driver: { abort(): void }, events: DriverEvent[]): Promise<void> {
    expect(dones(events)).toHaveLength(0);
    driver.abort();
    await vi.advanceTimersByTimeAsync(250);
    expect(dones(events)).toHaveLength(1);
    expect(dones(events)[0]).toMatchObject({ reason: 'aborted' });
  }

  it('the web, mid-stream: the partial kept in the chat and in history, the next turn free', async () => {
    h.platform = 'web';
    h.stream.mockResolvedValueOnce(sse([words('Hello wor')], 'hang'));
    const { driver, events } = chat();
    driver.send('hi');
    await vi.waitFor(() => expect(deltas(events)).toEqual(['Hello wor']));
    await stopsAtOnce(driver, events);
    expect(finalText(events)).toBe('Hello wor');
    h.stream.mockResolvedValueOnce(sse([words('ok')]));
    driver.send('go on');
    await vi.advanceTimersByTimeAsync(250);
    expect(h.stream).toHaveBeenCalledTimes(2);
    expect(streamedBody(1).messages).toContainEqual({ role: 'assistant', content: 'Hello wor' });
    expect(dones(events)).toHaveLength(2);
    driver.dispose();
  });

  it('the iPhone, mid-stream', async () => {
    h.stream.mockResolvedValueOnce(sse([words('Part')], 'hang'));
    const { driver, events } = chat();
    driver.send('hi');
    await vi.waitFor(() => expect(deltas(events)).toEqual(['Part']));
    await stopsAtOnce(driver, events);
    expect(finalText(events)).toBe('Part');
    expect(h.native).not.toHaveBeenCalled();
    driver.dispose();
  });

  it('the iPhone, before the first byte, and a stop is never retried on the shim', async () => {
    h.stream.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted.');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const { driver, events } = chat();
    driver.send('hi');
    await vi.waitFor(() => expect(h.stream).toHaveBeenCalledTimes(1));
    await stopsAtOnce(driver, events);
    expect(finalText(events)).toBe('');
    expect(h.native).not.toHaveBeenCalled();
    driver.dispose();
  });

  it("the iPhone's native shim, which cannot be cancelled: its late answer goes nowhere", async () => {
    h.stream.mockRejectedValue(new TypeError('Load failed'));
    let late: ((v: unknown) => void) | undefined;
    h.native.mockReturnValueOnce(new Promise((resolve) => (late = resolve)));
    const { driver, events } = chat();
    driver.send('hi');
    await vi.waitFor(() => expect(h.native).toHaveBeenCalledTimes(1));
    await stopsAtOnce(driver, events);
    // The next message is not stuck behind it.
    h.native.mockResolvedValueOnce(whole({ choices: [{ message: { content: 'Second.' } }] }));
    driver.send('again');
    await vi.advanceTimersByTimeAsync(250);
    expect(finalText(events)).toBe('Second.');
    late!(whole({ choices: [{ message: { content: 'Too late.' } }] }));
    await vi.advanceTimersByTimeAsync(50);
    expect(deltas(events)).not.toContain('Too late.');
    expect(dones(events)).toHaveLength(2);
    expect(dones(events)[1]).toMatchObject({ reason: 'complete' });
    driver.dispose();
  });

  it('Electron, mid-stream: main is told to end it, and late bytes are dropped by id', async () => {
    h.platform = 'electron';
    const b = fakeBridge();
    const { driver, events } = chat();
    driver.send('hi');
    await vi.waitFor(() => expect(b.requests).toHaveLength(1));
    const id = b.requests[0]!.id;
    b.push({ id, kind: 'data', chunk: words('Streamed') });
    await vi.waitFor(() => expect(deltas(events)).toEqual(['Streamed']));
    await stopsAtOnce(driver, events);
    expect(b.chatStreamAbort).toHaveBeenCalledWith(id);
    b.push({ id, kind: 'data', chunk: words(' late') });
    b.push({ id, kind: 'end' });
    await vi.advanceTimersByTimeAsync(10);
    expect(deltas(events)).toEqual(['Streamed']);
    expect(finalText(events)).toBe('Streamed');
    expect(dones(events)).toHaveLength(1);
    driver.dispose();
  });

  it('Electron, before the response head arrives', async () => {
    h.platform = 'electron';
    const b = fakeBridge();
    b.chatStream.mockImplementationOnce(() => new Promise(() => undefined));
    const { driver, events } = chat();
    driver.send('hi');
    await vi.waitFor(() => expect(b.chatStream).toHaveBeenCalledTimes(1));
    await stopsAtOnce(driver, events);
    expect(b.chatStreamAbort).toHaveBeenCalledTimes(1);
    driver.dispose();
  });

  it('while the vault pack is still being prepared', async () => {
    const pack: AppVaultPack = {
      prepare: () => new Promise<void>(() => undefined),
      render: () => ({ text: 'PACK' }),
    };
    const { driver, events } = chat({ vaultPack: pack });
    driver.send('hi');
    await vi.advanceTimersByTimeAsync(5);
    await stopsAtOnce(driver, events);
    expect(h.stream).not.toHaveBeenCalled();
    expect(h.native).not.toHaveBeenCalled();
    driver.dispose();
  });

  it('a pack that settles after the stop never sends the request, even once a new turn began', async () => {
    let settlePack: (() => void) | undefined;
    const pack: AppVaultPack = {
      prepare: () =>
        settlePack
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              settlePack = resolve;
            }),
      render: () => ({}),
    };
    const { driver, events } = chat({ vaultPack: pack });
    driver.send('first');
    await vi.advanceTimersByTimeAsync(5);
    await stopsAtOnce(driver, events);
    h.stream.mockResolvedValueOnce(sse([words('Second.')]));
    driver.send('second');
    await vi.advanceTimersByTimeAsync(50);
    settlePack!();
    await vi.advanceTimersByTimeAsync(50);
    // Only the second message went out, and it closed once.
    expect(h.stream).toHaveBeenCalledTimes(1);
    expect(streamedBody(0).messages.at(-1)).toMatchObject({ role: 'user', content: 'second' });
    expect(dones(events)).toHaveLength(2);
    driver.dispose();
  });
});

describe('a turn that fails after it began keeps what it wrote', () => {
  it('a dropped stream on the iPhone: the error, and the partial in the chat and in history', async () => {
    h.stream.mockResolvedValueOnce(sse([words('Hello wor')], 'fail'));
    const { driver, events } = chat();
    driver.send('hi');
    await settled(events);
    expect(dones(events)[0]).toMatchObject({
      reason: 'error',
      message: 'The network connection was lost.',
    });
    expect(finalText(events)).toBe('Hello wor');
    h.stream.mockResolvedValueOnce(sse([words('ok')]));
    driver.send('go on');
    await settled(events, 2);
    expect(streamedBody(1).messages).toContainEqual({ role: 'assistant', content: 'Hello wor' });
    driver.dispose();
  });

  it("Electron: main's error after the first words keeps them", async () => {
    h.platform = 'electron';
    const b = fakeBridge();
    const { driver, events } = chat();
    driver.send('hi');
    await vi.waitFor(() => expect(b.requests).toHaveLength(1));
    const id = b.requests[0]!.id;
    b.push({ id, kind: 'data', chunk: words('Half') });
    b.push({ id, kind: 'error', message: 'the model went quiet for 2 minutes' });
    await settled(events);
    expect(dones(events)[0]).toMatchObject({
      reason: 'error',
      message: 'the model went quiet for 2 minutes',
    });
    expect(finalText(events)).toBe('Half');
    driver.dispose();
  });

  it('a refused key says where to fix it', async () => {
    h.stream.mockResolvedValue({ ok: false, status: 401, body: null });
    const { driver, events } = chat();
    driver.send('hi');
    await settled(events);
    expect(dones(events)[0]).toMatchObject({
      reason: 'error',
      message: 'OpenAI rejected the API key. Update it under Connections.',
    });
    expect(h.native).not.toHaveBeenCalled();
    driver.dispose();
  });
});

describe('Perplexity Sonar sources still arrive', () => {
  const sonar = (extra: Record<string, unknown> = {}) =>
    chat({ base: 'https://api.perplexity.ai', label: 'Perplexity', model: 'sonar', ...extra });

  it('from a streamed reply, once, with title, url and snippet', async () => {
    h.stream.mockResolvedValue(
      sse([
        delta(
          { content: 'A sourced ' },
          { search_results: [{ title: 'Doc', url: 'https://ex.com/a' }] },
        ),
        delta(
          { content: 'answer.' },
          { search_results: [{ title: 'Doc', url: 'https://ex.com/a', snippet: 'S' }] },
        ),
        data({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      ]),
    );
    const { driver, events } = sonar();
    driver.send('what is new?');
    await settled(events);
    const cites = events.filter((e) => e.type === 'citations');
    expect(cites).toHaveLength(1);
    expect((cites[0] as { citations: unknown }).citations).toEqual([
      { title: 'Doc', url: 'https://ex.com/a', snippet: 'S' },
    ]);
    expect(finalText(events)).toBe('A sourced answer.');
    driver.dispose();
  });

  it('through the shim, from search_results or bare citation URLs titled by host', async () => {
    h.stream.mockRejectedValue(new TypeError('Load failed'));
    h.native.mockResolvedValueOnce(
      whole({
        choices: [{ message: { content: 'A sourced answer.' } }],
        search_results: [{ title: 'Doc', url: 'https://ex.com/a', snippet: 'S' }],
      }),
    );
    let { driver, events } = sonar();
    driver.send('what is new?');
    await settled(events);
    expect(events.find((e) => e.type === 'citations')).toMatchObject({
      citations: [{ title: 'Doc', url: 'https://ex.com/a', snippet: 'S' }],
    });
    driver.dispose();

    h.native.mockResolvedValueOnce(
      whole({ choices: [{ message: { content: 'ok' } }], citations: ['https://example.com/x'] }),
    );
    ({ driver, events } = sonar());
    driver.send('q');
    await settled(events);
    expect(events.find((e) => e.type === 'citations')).toMatchObject({
      citations: [{ title: 'example.com', url: 'https://example.com/x', snippet: '' }],
    });
    driver.dispose();
  });

  it('through the Electron channel', async () => {
    h.platform = 'electron';
    const b = fakeBridge();
    const { driver, events } = sonar();
    driver.send('q');
    await vi.waitFor(() => expect(b.requests).toHaveLength(1));
    const id = b.requests[0]!.id;
    b.push({
      id,
      kind: 'data',
      chunk: delta({ content: 'ok' }, { citations: ['https://example.com/x'] }),
    });
    b.push({ id, kind: 'end' });
    await settled(events);
    expect(events.find((e) => e.type === 'citations')).toMatchObject({
      citations: [{ title: 'example.com', url: 'https://example.com/x' }],
    });
    driver.dispose();
  });

  it('a provider with no sources emits no citations event', async () => {
    h.stream.mockResolvedValue(sse([words('plain')]));
    const { driver, events } = chat();
    driver.send('q');
    await settled(events);
    expect(events.some((e) => e.type === 'citations')).toBe(false);
    driver.dispose();
  });

  it('a stopped Sonar turn shows no sources', async () => {
    vi.useFakeTimers();
    h.stream.mockResolvedValue(
      sse([delta({ content: 'Half' }, { citations: ['https://example.com/x'] })], 'hang'),
    );
    const { driver, events } = sonar();
    driver.send('q');
    await vi.waitFor(() => expect(deltas(events)).toEqual(['Half']));
    driver.abort();
    await vi.advanceTimersByTimeAsync(250);
    expect(events.some((e) => e.type === 'citations')).toBe(false);
    driver.dispose();
  });
});

describe('what the request carries', () => {
  it('images ride the user turn as image_url parts', async () => {
    h.stream.mockResolvedValue(sse([words('A cat.')]));
    const { driver, events } = chat();
    driver.send('what is this?', [
      {
        id: 'a1',
        name: 'p.png',
        mime: 'image/png',
        dataUrl: 'data:image/png;base64,AAAA',
        isImage: true,
      },
    ]);
    await settled(events);
    expect(streamedBody().messages.at(-1)).toEqual({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        { type: 'text', text: 'what is this?' },
      ],
    });
    driver.dispose();
  });

  it('Chain of Thought: streamed reasoning shows only while it is on, and never in the answer', async () => {
    const reply = () =>
      sse([delta({ reasoning_content: 'Weighing it. ' }), words('<think>hm</think>Blue.')]);
    const thinking = (events: DriverEvent[]) =>
      events
        .filter((e) => e.type === 'thinking-delta')
        .map((e) => (e as { text: string }).text)
        .join('');
    h.stream.mockResolvedValueOnce(reply());
    let { driver, events } = chat();
    driver.send('why?');
    await settled(events);
    expect(thinking(events)).toBe('');
    expect(finalText(events)).toBe('Blue.');
    driver.dispose();

    setChainOfThought(true);
    h.stream.mockResolvedValueOnce(reply());
    ({ driver, events } = chat());
    driver.send('why?');
    await settled(events);
    expect(thinking(events)).toBe('Weighing it. hm');
    expect(finalText(events)).toBe('Blue.');
    driver.dispose();
  });

  it('the humanizer rides the system prompt unless Humanize Writing is off', async () => {
    const system = (index: number) =>
      streamedBody(index).messages.find((m) => m.role === 'system')!.content as string;
    h.stream.mockImplementation(async () => sse([words('ok')]));
    let { driver, events } = chat();
    driver.send('hi');
    await settled(events);
    expect(system(0)).toContain('HUMANIZER STANDARD');
    expect(system(0)).toContain('fenced code block');
    driver.dispose();

    ({ driver, events } = chat({ humanize: false }));
    driver.send('hi');
    await settled(events);
    expect(system(1)).not.toContain('HUMANIZER STANDARD');
    driver.dispose();
  });
});
