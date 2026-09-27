// The free desktop-chat driver: it streams the daemon's /chat SSE into the same
// DriverEvent shape the transcript renders, and keeps its own history since the
// endpoint is stateless.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopChatDriver } from '../src/drivers/desktopChatDriver.js';
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
});
