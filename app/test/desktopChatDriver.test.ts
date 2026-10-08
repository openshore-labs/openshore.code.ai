// The free desktop-chat driver: it streams the daemon's /chat SSE into the same
// DriverEvent shape the transcript renders, and keeps its own history since the
// endpoint is stateless.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopChatDriver, ipcFreeChat } from '../src/drivers/desktopChatDriver.js';
import { LOCAL_ONLY_STUB } from 'os-code/protocol';
import type { DriverEvent } from 'os-code/protocol';
import { isLocalOnlyFinal, seedText } from '../src/drivers/types.js';
import { reduceEvents } from '../src/state/transcript.js';
import { emptyThread, seedFromTranscript } from '../src/state/types.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function sseResponse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const f of frames) controller.enqueue(enc.encode(`data: ${f}\n\n`));
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

function collect(driver: DesktopChatDriver): DriverEvent[] {
  const events: DriverEvent[] = [];
  driver.subscribe((e) => events.push(e));
  return events;
}

describe('DesktopChatDriver', () => {
  it('streams text deltas into a final answer and completes', async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        JSON.stringify({ type: 'text', delta: 'Hel' }),
        JSON.stringify({ type: 'text', delta: 'lo.' }),
        JSON.stringify({ type: 'done' }),
      ]),
    ) as unknown as typeof fetch;

    const driver = new DesktopChatDriver({ baseUrl: 'http://desk', token: 't' });
    const events = collect(driver);
    driver.send('hi');
    await vi.waitFor(() => expect(events.some((e) => e.type === 'task-done')).toBe(true));

    const deltas = events.filter((e) => e.type === 'text-delta').map((e) => (e as any).text);
    expect(deltas.join('')).toBe('Hello.');
    const final = events.find((e) => e.type === 'text-final');
    expect(final && (final as any).text).toBe('Hello.');
    const done = events.find((e) => e.type === 'task-done');
    expect(done && (done as any).reason).toBe('complete');
  });

  it('posts to the daemon /chat endpoint with the bearer token', async () => {
    const spy = vi.fn(async () => sseResponse([JSON.stringify({ type: 'done' })]));
    globalThis.fetch = spy as unknown as typeof fetch;
    const driver = new DesktopChatDriver({ baseUrl: 'http://desk', token: 'secret' });
    collect(driver);
    driver.send('hi');
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('http://desk/chat');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as any).headers.authorization).toBe('Bearer secret');
  });

  it('surfaces a streamed error frame as a task-done error', async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([JSON.stringify({ type: 'error', message: 'no local model' })]),
    ) as unknown as typeof fetch;
    const driver = new DesktopChatDriver({ baseUrl: 'http://desk', token: 't' });
    const events = collect(driver);
    driver.send('hi');
    await vi.waitFor(() => expect(events.some((e) => e.type === 'task-done')).toBe(true));
    const done = events.find((e) => e.type === 'task-done');
    expect(done && (done as any).reason).toBe('error');
    expect(done && (done as any).message).toBe('no local model');
  });

  /** A context-pack line as the daemon streams it, marked or not. */
  const packLine = (localOnly: boolean) =>
    JSON.stringify({
      type: 'context-pack',
      seat: 'local',
      mode: 'current-state',
      tokens: 20,
      budgetTokens: 327,
      sources: [{ layer: 'pin', path: 'Private/Plan.md', title: 'Plan', project: true }],
      withheld: 0,
      cold: false,
      ...(localOnly ? { localOnly: true } : {}),
    });

  it('marks the reply local-only when the pack line says so, and a cloud seed gets the stub', async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        packLine(true),
        JSON.stringify({ type: 'text', delta: 'The launch word is marmot.' }),
        JSON.stringify({ type: 'done' }),
      ]),
    ) as unknown as typeof fetch;
    const driver = new DesktopChatDriver({ baseUrl: 'http://desk', token: 't' });
    const events = collect(driver);
    driver.send('what is the launch word?');
    await vi.waitFor(() => expect(events.some((e) => e.type === 'task-done')).toBe(true));
    const final = events.find((e) => e.type === 'text-final')!;
    expect(isLocalOnlyFinal(final)).toBe(true);
    // The card still renders, and the transcript carries the mark.
    expect(events.some((e) => e.type === 'context-pack')).toBe(true);
    const thread = reduceEvents(
      emptyThread(),
      events.map((event) => ({ event })),
    );
    const seed = seedFromTranscript(thread.items);
    const reply = seed.find((t) => t.role === 'assistant')!;
    expect(reply.localOnly).toBe(true);
    // A switch to a seat that leaves this network sends the stub, never the text.
    expect(seedText(reply, true)).toBe(LOCAL_ONLY_STUB);
    expect(seedText(reply, false)).toBe('The launch word is marmot.');
  });

  it('leaves the reply unmarked when the pack line does not say local-only', async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        packLine(false),
        JSON.stringify({ type: 'text', delta: 'Hello.' }),
        JSON.stringify({ type: 'done' }),
      ]),
    ) as unknown as typeof fetch;
    const driver = new DesktopChatDriver({ baseUrl: 'http://desk', token: 't' });
    const events = collect(driver);
    driver.send('hi');
    await vi.waitFor(() => expect(events.some((e) => e.type === 'task-done')).toBe(true));
    expect(isLocalOnlyFinal(events.find((e) => e.type === 'text-final')!)).toBe(false);
  });

  // Sign-off (sp-plan, D5): the computer's model reads the chat whole, so a
  // reply after a marked turn may quote it. It is marked too, the next send
  // as well as one after a seeded mark, so a later switch to a cloud model
  // gets the stub for the quote.
  it('marks every reply after a marked turn, seeded or written here', async () => {
    const reply = (frames: string[]) =>
      (globalThis.fetch = vi.fn(async () => sseResponse(frames)) as unknown as typeof fetch);
    const finals = (events: DriverEvent[]) =>
      events.filter((e) => e.type === 'text-final').map((e) => isLocalOnlyFinal(e));

    const driver = new DesktopChatDriver({ baseUrl: 'http://desk', token: 't' });
    const events = collect(driver);
    reply([packLine(true), JSON.stringify({ type: 'text', delta: 'Marmot.' }), '{"type":"done"}']);
    driver.send('the launch word?');
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'task-done')).toHaveLength(1));
    reply([JSON.stringify({ type: 'text', delta: 'It was marmot.' }), '{"type":"done"}']);
    driver.send('say it again');
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'task-done')).toHaveLength(2));
    expect(finals(events)).toEqual([true, true]);

    const seeded = new DesktopChatDriver({ baseUrl: 'http://desk', token: 't' }, undefined, [
      { role: 'user', text: 'the launch word?' },
      { role: 'assistant', text: 'Marmot.', localOnly: true },
    ]);
    const seededEvents = collect(seeded);
    reply([JSON.stringify({ type: 'text', delta: 'It was marmot.' }), '{"type":"done"}']);
    seeded.send('say it again');
    await vi.waitFor(() => expect(seededEvents.some((e) => e.type === 'task-done')).toBe(true));
    expect(finals(seededEvents)).toEqual([true]);
  });
});

// On the desktop itself the same driver reaches this computer's own engine
// over IPC (CTO ruling 8): frames arrive under the request's own id, a Stop
// asks main to stop the model, and a refusal is the turn's one error.
describe('DesktopChatDriver over IPC (the desktop window)', () => {
  type Payload = { requestId: string; event: Record<string, unknown> };
  function fakeBridge(
    script: (id: string, emit: (event: Record<string, unknown>) => void) => void,
  ) {
    const listeners = new Set<(p: Payload) => void>();
    const calls = { chats: [] as Array<Record<string, unknown>>, aborted: [] as string[] };
    const emitTo = (requestId: string) => (event: Record<string, unknown>) => {
      for (const l of [...listeners]) l({ requestId, event } as Payload);
    };
    return {
      calls,
      bridge: {
        freeChat: async (requestId: string, body: Record<string, unknown>) => {
          calls.chats.push(body);
          // Another request's frame is never this one's.
          emitTo('someone-else')({ type: 'text', delta: 'not yours' });
          script(requestId, emitTo(requestId));
        },
        freeChatAbort: async (requestId: string) => {
          calls.aborted.push(requestId);
        },
        onFreeChat: (cb: (p: Payload) => void) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
      },
    };
  }

  it('streams the engine frames into a final answer, and never touches the network', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { bridge, calls } = fakeBridge((_id, emit) => {
      emit({ type: 'text', delta: 'Hel' });
      emit({ type: 'text', delta: 'lo.' });
      emit({ type: 'done' });
    });
    const driver = new DesktopChatDriver(ipcFreeChat(bridge, 'qwen2.5:3b'));
    const events = collect(driver);
    driver.send('hi');
    await vi.waitFor(() => expect(events.some((e) => e.type === 'task-done')).toBe(true));
    expect((events.find((e) => e.type === 'text-final') as any).text).toBe('Hello.');
    expect((events.find((e) => e.type === 'task-done') as any).reason).toBe('complete');
    expect((events.find((e) => e.type === 'turn-start') as any).model).toBe('qwen2.5:3b');
    expect(calls.chats[0]!.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a refusal ends the turn with its reason', async () => {
    const { bridge } = fakeBridge((_id, emit) =>
      emit({ type: 'error', message: 'Free desktop chat runs your local models.' }),
    );
    const driver = new DesktopChatDriver(ipcFreeChat(bridge));
    const events = collect(driver);
    driver.send('hi');
    await vi.waitFor(() => expect(events.some((e) => e.type === 'task-done')).toBe(true));
    const done = events.find((e) => e.type === 'task-done') as any;
    expect(done.reason).toBe('error');
    expect(done.message).toMatch(/local models/);
  });

  it('Stop asks main to stop the model and keeps the partial answer', async () => {
    let emitLater: ((event: Record<string, unknown>) => void) | undefined;
    const { bridge, calls } = fakeBridge((_id, emit) => {
      emit({ type: 'text', delta: 'Partly' });
      emitLater = emit;
    });
    const driver = new DesktopChatDriver(ipcFreeChat(bridge));
    const events = collect(driver);
    driver.send('hi');
    await vi.waitFor(() => expect(events.some((e) => e.type === 'text-delta')).toBe(true));
    driver.abort();
    await vi.waitFor(() => expect(events.some((e) => e.type === 'task-done')).toBe(true));
    expect((events.find((e) => e.type === 'task-done') as any).reason).toBe('aborted');
    expect((events.find((e) => e.type === 'text-final') as any).text).toBe('Partly');
    expect(calls.aborted).toHaveLength(1);
    // A frame that arrives after the stop lands nowhere.
    emitLater?.({ type: 'text', delta: ' late' });
    expect(events.filter((e) => e.type === 'task-done')).toHaveLength(1);
  });

  it('an older shell without the channel says so plainly', async () => {
    const driver = new DesktopChatDriver(ipcFreeChat({}));
    const events = collect(driver);
    driver.send('hi');
    await vi.waitFor(() => expect(events.some((e) => e.type === 'task-done')).toBe(true));
    expect((events.find((e) => e.type === 'task-done') as any).message).toMatch(/Update/);
  });
});
