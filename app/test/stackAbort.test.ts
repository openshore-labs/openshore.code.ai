// Stop answers at once, on every seat and every shell (build 2026-09-29, B1;
// CTO ruling 7). abort() closes the turn itself, now: task-done arrives within
// 250 ms whatever the seat is waiting on (a stream, the iPhone's native shim
// that cannot be cancelled, the Electron channel, Claude, a pocket model, a
// model load, a card, the search consent, the framing call), the partial
// answer stays in the chat and in history, late data is dropped, and the next
// message starts right away. A stream that drops, or a seat that fails after
// it began, keeps its partial too.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';

const h = vi.hoisted(() => ({
  platform: 'web' as 'web' | 'ios' | 'electron',
  stream: vi.fn(),
  native: vi.fn(),
  callbacks: {} as Record<string, (payload: any) => void>,
  generates: [] as Array<{ requestId: string; messages: unknown[] }>,
  stops: [] as string[],
  holdLoad: false,
  releaseLoad: undefined as undefined | (() => void),
  claude: 'hang' as 'hang' | 'fail',
  claudeCalls: 0,
  search: vi.fn(),
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => h.platform,
  secretGet: async (key: string) => (key.includes('.byom.') ? null : 'sk-test'),
  storeGetJson: async () => null,
}));
vi.mock('../src/lib/streamingFetch.js', () => ({ streamingFetch: h.stream }));
vi.mock('../src/lib/nativeFetch.js', () => ({ nativeFetch: h.native }));
vi.mock('../src/lib/webSearch.js', () => ({
  resolveSearchKey: async () => undefined,
  webSearch: h.search,
  formatSearchResults: (query: string) => `RESULTS for ${query}`,
}));
vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async (event: string, cb: (payload: any) => void) => {
      h.callbacks[event] = cb;
      return { remove: async () => {} };
    },
    ensureLocal: async () => ({ ready: true }),
    load: () =>
      h.holdLoad
        ? new Promise<{ ok: boolean }>((resolve) => {
            h.releaseLoad = () => resolve({ ok: true });
          })
        : Promise.resolve({ ok: true }),
    generate: async (opts: { requestId: string; messages: unknown[] }) => {
      h.generates.push(opts);
      return { started: true };
    },
    stop: async ({ requestId }: { requestId: string }) => {
      h.stops.push(requestId);
    },
  },
}));
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class Anthropic {
    static APIUserAbortError = class extends Error {};
    static AuthenticationError = class extends APIError {};
    static BadRequestError = class extends APIError {};
    static RateLimitError = class extends APIError {};
    static APIConnectionError = class extends APIError {};
    // An address in the Anthropic format rides the same SDK with its own
    // base (2026-10-09), so its words say which seat began.
    constructor(private readonly opts: { baseURL?: string } = {}) {}
    messages = {
      stream: () => {
        h.claudeCalls++;
        const handlers: Record<string, (delta: string) => void> = {};
        return {
          on: (event: string, cb: (delta: string) => void) => {
            handlers[event] = cb;
          },
          finalMessage: () => {
            handlers.text?.(this.opts.baseURL ? 'The gateway began' : 'Claude began');
            return h.claude === 'fail'
              ? Promise.reject(new Error('Claude went away.'))
              : new Promise(() => undefined);
          },
        };
      },
    };
  }
  return { default: Anthropic };
});

const { StackDriver } = await import('../src/drivers/stackDriver.js');
const { OnDeviceDriver } = await import('../src/drivers/onDeviceDriver.js');
const { DesktopChatDriver } = await import('../src/drivers/desktopChatDriver.js');
const { forgetDeviceModel } = await import('../src/drivers/deviceModel.js');
const { setSearchConsent } = await import('../src/lib/localSearch.js');
const { packSeatFor } = await import('../src/lib/vaultSeat.js');
import type { AppStack } from '../src/lib/stack.js';
import type { ChatStreamEvent } from '../src/lib/electronBridge.js';

const enc = new TextEncoder();
const delta = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

/** A reply that sends `parts`, then hangs (or drops, with `fail`). */
function sse(parts: string[], fail = false): Response {
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at < parts.length) controller.enqueue(enc.encode(parts[at++]!));
      else if (fail) controller.error(new TypeError('The network connection was lost.'));
      else return new Promise<void>(() => undefined);
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

const box = {
  kind: 'byom',
  id: 'box',
  label: 'Box',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'llama3.2:3b',
} as const;
const claude = {
  kind: 'cloud',
  provider: 'anthropic',
  model: 'claude-x',
  label: 'Claude',
} as const;
const pocket = { kind: 'device', modelId: 'pocket', modelName: 'Pocket' } as const;
const gateway = {
  kind: 'byom',
  id: 'gw',
  label: 'Gateway',
  baseUrl: 'http://192.168.1.30:4000',
  model: 'bedrock-claude',
  wire: 'anthropic',
  forwardsToCloud: true,
} as const;
const anchor = (reasoning: AppStack['reasoning'], active: AppStack['active'] = []): AppStack => ({
  reasoning,
  active,
  saved: {},
});

function stackChat(stack: AppStack) {
  const driver = new StackDriver(stack, 'offshore');
  const events: DriverEvent[] = [];
  driver.subscribe((e) => events.push(e));
  return { driver, events };
}

const dones = (events: DriverEvent[]) => events.filter((e) => e.type === 'task-done');
const finalText = (events: DriverEvent[]) =>
  (events.findLast((e) => e.type === 'text-final') as { text: string } | undefined)?.text;

/** Stop, then 250 ms on the clock: exactly one ending, and it is a stop. */
async function stopsAtOnce(driver: { abort(): void }, events: DriverEvent[]): Promise<void> {
  expect(dones(events)).toHaveLength(0);
  driver.abort();
  await vi.advanceTimersByTimeAsync(250);
  expect(dones(events)).toHaveLength(1);
  expect(dones(events)[0]).toMatchObject({ reason: 'aborted' });
}

/** The messages the model was sent on the request at `index`. */
const sentMessages = (index: number) =>
  JSON.parse((h.stream.mock.calls[index]![1] as RequestInit).body as string).messages as Array<{
    role: string;
    content: string;
  }>;

beforeEach(() => {
  vi.useFakeTimers();
  h.platform = 'web';
  h.stream.mockReset();
  h.native.mockReset();
  h.search.mockReset();
  h.generates.length = 0;
  h.stops.length = 0;
  h.holdLoad = false;
  h.claude = 'hang';
  h.claudeCalls = 0;
  forgetDeviceModel();
  setSearchConsent(async () => true);
  delete (globalThis as { window?: unknown }).window;
});
afterEach(() => {
  h.releaseLoad?.();
  vi.useRealTimers();
});

describe('Stop on a Stack seat', () => {
  it('your own model, streaming on the web: at once, the partial kept, the next turn free', async () => {
    h.stream.mockResolvedValueOnce(sse([delta('Hello wor')]));
    const { driver, events } = stackChat(anchor(box));
    driver.send('hi');
    await vi.waitFor(() => expect(events.some((e) => e.type === 'text-delta')).toBe(true));
    await stopsAtOnce(driver, events);
    expect(finalText(events)).toBe('Hello wor');
    // The next message goes straight out, and its history carries the partial.
    h.stream.mockResolvedValueOnce(sse([delta('ok')]));
    driver.send('go on');
    await vi.advanceTimersByTimeAsync(250);
    expect(h.stream).toHaveBeenCalledTimes(2);
    expect(sentMessages(1)).toContainEqual({ role: 'assistant', content: 'Hello wor' });
    driver.dispose();
  });

  it('your own model on the iPhone, streaming', async () => {
    h.platform = 'ios';
    h.stream.mockResolvedValueOnce(sse([delta('Part')]));
    const { driver, events } = stackChat(anchor(box));
    driver.send('hi');
    await vi.waitFor(() => expect(events.some((e) => e.type === 'text-delta')).toBe(true));
    await stopsAtOnce(driver, events);
    expect(finalText(events)).toBe('Part');
    expect(h.native).not.toHaveBeenCalled();
    driver.dispose();
  });

  it("your own model on the iPhone's native shim, which cannot be cancelled", async () => {
    h.platform = 'ios';
    h.stream.mockRejectedValue(new TypeError('Load failed'));
    h.native.mockReturnValueOnce(new Promise(() => undefined));
    const { driver, events } = stackChat(anchor(box));
    driver.send('hi');
    await vi.waitFor(() => expect(h.native).toHaveBeenCalledTimes(1));
    await stopsAtOnce(driver, events);
    // The shim's late answer goes nowhere, and the next message is not stuck
    // behind it.
    h.native.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Second.' } }] }),
    });
    driver.send('again');
    await vi.advanceTimersByTimeAsync(250);
    expect(events.filter((e) => e.type === 'task-start')).toHaveLength(2);
    expect(finalText(events)).toBe('Second.');
    driver.dispose();
  });

  it('your own model through the Electron channel, which main is told to end', async () => {
    h.platform = 'electron';
    let sink: ((e: ChatStreamEvent) => void) | undefined;
    const bridge = {
      platform: 'electron',
      chatStream: vi.fn(async () => ({ status: 200 })),
      chatStreamAbort: vi.fn(async () => undefined),
      onChatStream: (cb: (e: ChatStreamEvent) => void) => {
        sink = cb;
        return () => undefined;
      },
    };
    (globalThis as { window?: unknown }).window = { oscode: bridge };
    const { driver, events } = stackChat(anchor(box));
    driver.send('hi');
    await vi.waitFor(() => expect(bridge.chatStream).toHaveBeenCalledTimes(1));
    const id = (bridge.chatStream.mock.calls[0] as unknown as [{ id: string }])[0].id;
    sink!({ id, kind: 'data', chunk: delta('Streamed') });
    await vi.waitFor(() => expect(events.some((e) => e.type === 'text-delta')).toBe(true));
    await stopsAtOnce(driver, events);
    expect(bridge.chatStreamAbort).toHaveBeenCalledWith(id);
    // Late bytes for the stopped request are dropped by its id.
    sink!({ id, kind: 'data', chunk: delta(' late') });
    await vi.advanceTimersByTimeAsync(10);
    expect(finalText(events)).toBe('Streamed');
    expect(
      events
        .filter((e) => e.type === 'text-delta')
        .map((e) => (e as { text: string }).text)
        .join(''),
    ).toBe('Streamed');
    driver.dispose();
  });

  it('Claude', async () => {
    const { driver, events } = stackChat(anchor(claude));
    driver.send('hi');
    await vi.waitFor(() => expect(h.claudeCalls).toBe(1));
    await vi.advanceTimersByTimeAsync(5);
    await stopsAtOnce(driver, events);
    expect(finalText(events)).toBe('Claude began');
    driver.dispose();
  });

  // Bring your own keys, Part 2 (2026-10-09): a new wire is not done until
  // Stop answers at once on it, the partial kept, the next turn free.
  it('your own model in the Anthropic format', async () => {
    const { driver, events } = stackChat(anchor(gateway));
    driver.send('hi');
    await vi.waitFor(() => expect(h.claudeCalls).toBe(1));
    await vi.advanceTimersByTimeAsync(5);
    await stopsAtOnce(driver, events);
    expect(finalText(events)).toBe('The gateway began');
    // The next message goes straight out, with the partial in its history.
    driver.send('go on');
    await vi.waitFor(() => expect(h.claudeCalls).toBe(2));
    expect(events.filter((e) => e.type === 'task-start')).toHaveLength(2);
    driver.dispose();
  });

  it('your own model in the Anthropic format, framing a plan', async () => {
    const { driver, events } = stackChat(
      anchor(gateway, [{ ref: box, placement: { category: 'coding' } }]),
    );
    driver.send('build me a thing');
    await vi.waitFor(() => expect(h.claudeCalls).toBe(1));
    await stopsAtOnce(driver, events);
    driver.dispose();
  });

  it('a pocket model mid-reply, without waiting on the runner', async () => {
    const { driver, events } = stackChat(anchor(pocket));
    driver.send('hi');
    await vi.waitFor(() => expect(h.generates).toHaveLength(1));
    const { requestId } = h.generates[0]!;
    h.callbacks.token!({ requestId, delta: 'Half an ans' });
    await stopsAtOnce(driver, events);
    expect(h.stops).toEqual([requestId]);
    expect(finalText(events)).toBe('Half an ans');
    // The runner's own late words and ending are dropped by id.
    h.callbacks.token!({ requestId, delta: 'wer' });
    h.callbacks.generationDone!({ requestId, stopReason: 'stopped' });
    await vi.advanceTimersByTimeAsync(10);
    expect(dones(events)).toHaveLength(1);
    driver.dispose();
  });

  it('a pocket model still loading', async () => {
    h.holdLoad = true;
    const { driver, events } = stackChat(anchor(pocket));
    driver.send('hi');
    await vi.waitFor(() => expect(h.releaseLoad).toBeDefined());
    await stopsAtOnce(driver, events);
    h.releaseLoad!();
    await vi.advanceTimersByTimeAsync(10);
    expect(h.generates).toHaveLength(0);
    driver.dispose();
  });

  it('a card waiting on a tap', async () => {
    const { driver, events } = stackChat(anchor(pocket));
    driver.send('who is this?', [
      {
        id: 'a1',
        name: 'p.jpg',
        mime: 'image/jpeg',
        dataUrl: 'data:image/jpeg;base64,AA',
        isImage: true,
      },
    ]);
    await vi.waitFor(() => expect(events.some((e) => e.type === 'approval-request')).toBe(true));
    await stopsAtOnce(driver, events);
    expect(finalText(events)).toBe('');
    driver.dispose();
  });

  it('a search waiting on the consent sheet', async () => {
    setSearchConsent(() => new Promise<boolean>(() => undefined));
    // The model's first reply is a whole search line; then the search waits.
    h.stream.mockImplementationOnce(async () => {
      let sent = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(enc.encode(delta('SEARCH: tides')));
          } else controller.close();
        },
      });
      return { ok: true, status: 200, body } as unknown as Response;
    });
    const { driver, events } = stackChat(anchor(box));
    driver.send('when is high tide?');
    await vi.advanceTimersByTimeAsync(50);
    expect(h.stream).toHaveBeenCalledTimes(1);
    await stopsAtOnce(driver, events);
    // The search line never reached the chat.
    expect(events.some((e) => e.type === 'text-delta')).toBe(false);
    expect(finalText(events)).toBe('');
    driver.dispose();
  });

  it('the framing call on a stack with a specialist', async () => {
    const { driver, events } = stackChat(
      anchor(claude, [{ ref: box, placement: { category: 'coding' } }]),
    );
    driver.send('build me a thing');
    await vi.waitFor(() => expect(h.claudeCalls).toBe(1));
    await stopsAtOnce(driver, events);
    driver.dispose();
  });
});

describe('a turn that fails after it began keeps what it wrote', () => {
  it('a dropped stream: the error, and the partial in the chat and in history', async () => {
    h.stream.mockResolvedValueOnce(sse([delta('Hello wor')], true));
    const { driver, events } = stackChat(anchor(box));
    driver.send('hi');
    await vi.waitFor(() => expect(dones(events)).toHaveLength(1));
    expect(dones(events)[0]).toMatchObject({
      reason: 'error',
      message: 'The network connection was lost.',
    });
    expect(finalText(events)).toBe('Hello wor');
    h.stream.mockResolvedValueOnce(sse([delta('ok')]));
    driver.send('go on');
    await vi.advanceTimersByTimeAsync(50);
    expect(sentMessages(1)).toContainEqual({ role: 'assistant', content: 'Hello wor' });
    driver.dispose();
  });

  it('your own model in the Anthropic format failing mid-answer', async () => {
    h.claude = 'fail';
    const { driver, events } = stackChat(anchor(gateway));
    driver.send('hi');
    await vi.waitFor(() => expect(dones(events)).toHaveLength(1));
    // Said as the address's failure, never as Claude's.
    expect(dones(events)[0]).toMatchObject({
      reason: 'error',
      message: 'Could not reach Gateway.',
    });
    expect(finalText(events)).toBe('The gateway began');
    driver.dispose();
  });

  it('Claude failing mid-answer', async () => {
    h.claude = 'fail';
    const { driver, events } = stackChat(anchor(claude));
    driver.send('hi');
    await vi.waitFor(() => expect(dones(events)).toHaveLength(1));
    expect(dones(events)[0]).toMatchObject({ reason: 'error', message: 'Claude went away.' });
    expect(finalText(events)).toBe('Claude began');
    driver.dispose();
  });
});

// CX ruling 5: before the first word a model on your computer is named as
// warming up (its first request in the chat), and after 30 seconds with no
// word the chat says, once, that it can be slow to start and Stop works.
describe('the wait before the first word, on your computer', () => {
  const statuses = (events: DriverEvent[]) =>
    events.filter((e) => e.type === 'status').map((e) => (e as { message: string }).message);

  it('a Stack seat on your computer', async () => {
    h.stream.mockImplementation(async () => sse([]));
    const driver = new StackDriver(anchor(box), 'offshore', {}, undefined, {
      packSeat: (ref) => packSeatFor(ref, { ownTailnetSuffix: null }),
    });
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    driver.send('hi');
    await vi.advanceTimersByTimeAsync(10);
    expect(statuses(events)).toEqual(['Warming up Box on your computer.']);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(statuses(events)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(statuses(events)).toEqual([
      'Warming up Box on your computer.',
      'Models on your own computer can be slow to start. You can stop it any time.',
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(statuses(events)).toHaveLength(2);
    driver.abort();
    // A later message to the same, now warm, seat is not called warming up.
    driver.send('again');
    await vi.advanceTimersByTimeAsync(10);
    expect(statuses(events)).toHaveLength(2);
    driver.dispose();
  });

  it('a word in time means no slow-start line', async () => {
    h.stream.mockImplementation(async () => sse([delta('Quick.')]));
    const driver = new StackDriver(anchor(box), 'offshore', {}, undefined, {
      packSeat: (ref) => packSeatFor(ref, { ownTailnetSuffix: null }),
    });
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    driver.send('hi');
    await vi.advanceTimersByTimeAsync(40_000);
    expect(statuses(events)).toEqual(['Warming up Box on your computer.']);
    driver.dispose();
  });

  it("the desktop's free chat", async () => {
    h.stream.mockImplementation(async () => sse([]));
    const driver = new DesktopChatDriver({ baseUrl: 'http://desk', token: 't' }, 'qwen');
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    driver.send('hi');
    await vi.advanceTimersByTimeAsync(31_000);
    expect(statuses(events)).toEqual([
      'Warming up qwen on your computer.',
      'Models on your own computer can be slow to start. You can stop it any time.',
    ]);
    driver.dispose();
  });
});

describe('Stop in the other chat drivers', () => {
  it('a pocket model in its own chat, mid-reply', async () => {
    const driver = new OnDeviceDriver('pocket', 'Pocket');
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    await vi.advanceTimersByTimeAsync(1);
    driver.send('hi');
    await vi.waitFor(() => expect(h.generates).toHaveLength(1));
    const { requestId } = h.generates[0]!;
    h.callbacks.token!({ requestId, delta: 'Some words' });
    await stopsAtOnce(driver, events);
    expect(finalText(events)).toBe('Some words');
    h.callbacks.generationDone!({ requestId, stopReason: 'stopped' });
    await vi.advanceTimersByTimeAsync(10);
    expect(dones(events)).toHaveLength(1);
    driver.dispose();
  });

  it("the desktop's free chat, mid-stream", async () => {
    const frames = [`data: ${JSON.stringify({ type: 'text', delta: 'From the desk' })}\n\n`];
    h.stream.mockResolvedValueOnce(sse(frames));
    const driver = new DesktopChatDriver({ baseUrl: 'http://desk', token: 't' }, 'qwen');
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    driver.send('hi');
    await vi.waitFor(() => expect(events.some((e) => e.type === 'text-delta')).toBe(true));
    await stopsAtOnce(driver, events);
    expect(finalText(events)).toBe('From the desk');
    h.stream.mockResolvedValueOnce(sse([]));
    driver.send('more');
    await vi.advanceTimersByTimeAsync(10);
    expect(sentMessages(1)).toContainEqual({ role: 'assistant', content: 'From the desk' });
    driver.dispose();
  });
});
