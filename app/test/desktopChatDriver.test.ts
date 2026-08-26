// The free desktop-chat driver: it streams the daemon's /chat SSE into the same
// DriverEvent shape the transcript renders, and keeps its own history since the
// endpoint is stateless.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopChatDriver } from '../src/drivers/desktopChatDriver.js';
import type { DriverEvent } from 'os-code/protocol';

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
});
