// The CLI attach driver (osc attach) over a mocked daemon. DAE-13: a 401 or a
// repeated 404 must stop the reconnect loop with a status the person can act
// on, and an approval answer must forward every field the daemon accepts
// (alwaysInProject and reason were dropped on this path while the phone had
// them). No sockets: fetch is replaced with a scripted responder.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteDriver } from '../src/daemon/attach.js';
import type { DriverEvent } from '../src/daemon/session.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const target = { baseUrl: 'http://daemon.test', token: 'osc_t' };

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function scripted(status: number): ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response(JSON.stringify({ error: 'no' }), { status }));
}

describe('RemoteDriver stops instead of retrying forever (DAE-13)', () => {
  it('a 401 ends the stream loop after one attempt with a status', async () => {
    const fetchMock = scripted(401);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const driver = new RemoteDriver('s1', target, '/w', { initialBackoffMs: 5 });
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    await waitUntil(() => driver.isClosed);
    await new Promise((r) => setTimeout(r, 40));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const status = events.find((e) => e.type === 'status');
    expect(status && status.type === 'status' && status.message).toMatch(/credential/i);
  });

  it('a repeated 404 ends the loop; a blip still reconnects', async () => {
    const fetchMock = scripted(404);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const driver = new RemoteDriver('s2', target, '/w', { initialBackoffMs: 5 });
    await waitUntil(() => driver.isClosed);
    await new Promise((r) => setTimeout(r, 40));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const flaky = vi.fn(async () => new Response(JSON.stringify({}), { status: 500 }));
    globalThis.fetch = flaky as unknown as typeof fetch;
    const survivor = new RemoteDriver('s3', target, '/w', { initialBackoffMs: 5 });
    await waitUntil(() => flaky.mock.calls.length >= 4);
    expect(survivor.isClosed).toBe(false);
    survivor.close();
  });

  it('answerApproval forwards approve, alwaysThisSession, alwaysInProject, and reason', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body ?? '') });
      return new Response(JSON.stringify({}), { status: 404 });
    }) as unknown as typeof fetch;
    const driver = new RemoteDriver('s4', target, '/w', { initialBackoffMs: 5 });
    driver.answerApproval('ap1', {
      approve: false,
      alwaysThisSession: true,
      alwaysInProject: true,
      reason: 'not that file',
    });
    await waitUntil(() => calls.some((c) => c.url.endsWith('/approvals/ap1')));
    const body = JSON.parse(calls.find((c) => c.url.endsWith('/approvals/ap1'))!.body);
    expect(body).toEqual({
      approve: false,
      alwaysThisSession: true,
      alwaysInProject: true,
      reason: 'not that file',
    });
    driver.close();
  });
});
