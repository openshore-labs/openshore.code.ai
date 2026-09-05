// The phone's SSE wire format: frames in, protocol events out.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RemoteDriver,
  daemonApplyOutbox,
  daemonCloneRepo,
  daemonCreateSession,
  daemonHealth,
  daemonListSessions,
  daemonStack,
  daemonVerifyCommit,
  daemonWorkspaces,
  parseSseFrame,
} from '../src/drivers/remoteDriver.js';
import { emptyThread } from '../src/state/types.js';
import { reduceEvents } from '../src/state/transcript.js';
import type { DriverEvent } from 'os-code/protocol';

/** A Response whose body streams the given SSE text once, then closes. */
function sseResponse(text: string, status = 200): Response {
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return { ok: status < 400, status, body } as unknown as Response;
}

interface FetchCall {
  url: string;
  method: string;
  body?: unknown;
}

describe('SSE frame parsing', () => {
  it('parses id and data into a sequenced event', () => {
    const parsed = parseSseFrame('id: 42\ndata: {"type":"text-delta","text":"hello"}');
    expect(parsed).toEqual({ seq: 42, event: { type: 'text-delta', text: 'hello' } });
  });

  it('ignores keepalive comments and malformed frames', () => {
    expect(parseSseFrame(':ka')).toBeNull();
    expect(parseSseFrame('data: not-json')).toBeNull();
    expect(parseSseFrame('')).toBeNull();
  });

  it('survives a missing id (seq 0)', () => {
    const parsed = parseSseFrame('data: {"type":"task-done","reason":"complete"}');
    expect(parsed?.seq).toBe(0);
    expect(parsed?.event.type).toBe('task-done');
  });
});

// G5: an outage adds the "Connection blipped" status row exactly once, however
// many reconnect attempts it takes, and the reconnect loop backs off instead of
// spinning at zero delay.
describe('RemoteDriver reconnect (G5)', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });

  it('emits one blip per outage across many failed reconnects', async () => {
    vi.useFakeTimers();
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      throw new Error('daemon down');
    }) as unknown as typeof fetch;

    const blips: string[] = [];
    const driver = new RemoteDriver('s1', { baseUrl: 'http://desktop', token: 't' }, 0);
    driver.subscribe((event) => {
      if (event.type === 'status') blips.push(event.message);
    });

    // Let several backoff cycles elapse (600 + 1200 + 2400 + ... ms).
    await vi.advanceTimersByTimeAsync(6000);
    driver.dispose();

    expect(calls).toBeGreaterThan(1); // it retried
    expect(blips).toHaveLength(1); // but blipped only once for the outage
  });

  it('stops retrying on a 401 and tells the user to re-pair (TS-P2-1)', async () => {
    vi.useFakeTimers();
    let calls = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      // Only the event stream counts; the attach-time /health probe is separate.
      if (String(url).includes('/events')) calls++;
      return { ok: false, status: 401, body: null } as unknown as Response;
    }) as unknown as typeof fetch;

    const messages: string[] = [];
    const driver = new RemoteDriver('s1', { baseUrl: 'http://desktop', token: 't' }, 0);
    driver.subscribe((event) => {
      if (event.type === 'status') messages.push(event.message);
    });

    await vi.advanceTimersByTimeAsync(6000);
    driver.dispose();

    expect(calls).toBe(1); // no retry loop on a fatal answer
    expect(messages.some((m) => /re-pair/i.test(m))).toBe(true);
  });

  it('ends the run when the session is gone, so the thread is not stuck busy (APP-4)', async () => {
    vi.useFakeTimers();
    let streams = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (!String(url).includes('/events')) {
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      }
      streams++;
      // The replayed journal ended mid-run, then the session vanished.
      if (streams === 1) return sseResponse('id: 1\ndata: {"type":"task-start","input":"go"}\n\n');
      return { ok: false, status: 404, body: null } as unknown as Response;
    }) as unknown as typeof fetch;

    const events: Array<{ event: DriverEvent; seq: number }> = [];
    const driver = new RemoteDriver('s1', { baseUrl: 'http://desktop', token: 't' }, 0);
    driver.subscribe((event, seq) => events.push({ event, seq }));

    await vi.advanceTimersByTimeAsync(20_000);
    driver.dispose();

    expect(events.some((e) => e.event.type === 'task-start')).toBe(true);
    const done = events.filter((e) => e.event.type === 'task-done');
    expect(done).toHaveLength(1);
    expect(done[0]!.event).toMatchObject({ reason: 'error' });
    expect((done[0]!.event as { message?: string }).message).toMatch(/no longer exists/);
    const thread = reduceEvents(emptyThread(), events);
    expect(thread.busy).toBe(false);
  });
});

// APP-9: every daemon helper carries a deadline, so a blackholed tailnet can
// never pin the repo picker or the outbox sync forever.
describe('daemon helpers carry request timeouts (APP-9)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('passes an AbortSignal on every helper call', async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          live: [],
          stored: [],
          workspaces: [],
          cwd: '/x',
          ok: true,
          exists: true,
          onBranch: true,
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const target = { baseUrl: 'http://desktop', token: 't' };
    await daemonListSessions(target);
    await daemonWorkspaces(target);
    await daemonStack(target);
    await daemonCloneRepo(target, 'https://example.com/r.git');
    await daemonVerifyCommit(target, '/x', 'abc');
    await daemonApplyOutbox(target, {
      cwd: '/x',
      clientOpId: 'o',
      itemId: 'i',
      deviceId: 'd',
      branch: 'main',
      message: 'm',
      baseCommit: 'b',
      files: [],
    });
    expect(signals).toHaveLength(6);
    for (const s of signals) expect(s).toBeInstanceOf(AbortSignal);
  });
});

// P0-1 (driver side): the daemon refuses a member's shell with a 403
// {error:'restricted', message}; the phone carries that message through
// instead of reading it as "no terminal here". The hub's role rides /health
// and lands on the driver so the composer can hide terminal mode for members.
describe('RemoteDriver command lane and hub role (P0-1)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function mockRoutes(
    routes: (url: string, init?: RequestInit) => { status: number; body?: unknown } | undefined,
  ) {
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const r = routes(u, init) ?? { status: 500 };
      if (u.includes('/events'))
        return { ok: false, status: 500, body: null } as unknown as Response;
      return {
        ok: r.status < 400,
        status: r.status,
        json: async () => r.body ?? {},
      } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  it('returns the daemon message verbatim when the command lane is restricted', async () => {
    mockRoutes((u) =>
      u.endsWith('/commands')
        ? { status: 403, body: { error: 'restricted', message: 'Ask a company admin.' } }
        : undefined,
    );
    const driver = new RemoteDriver('s1', { baseUrl: 'http://desktop', token: 't' }, 0);
    const res = await driver.runCommand('id');
    driver.dispose();
    expect(res).toEqual({ refused: 'Ask a company admin.' });
  });

  it('returns the runId on success and undefined on any other failure', async () => {
    mockRoutes((u) =>
      u.endsWith('/commands') ? { status: 201, body: { runId: 'r1' } } : undefined,
    );
    const a = new RemoteDriver('s1', { baseUrl: 'http://desktop', token: 't' }, 0);
    expect(await a.runCommand('ls')).toEqual({ runId: 'r1' });
    a.dispose();
    mockRoutes((u) => (u.endsWith('/commands') ? { status: 500 } : undefined));
    const b = new RemoteDriver('s1', { baseUrl: 'http://desktop', token: 't' }, 0);
    expect(await b.runCommand('ls')).toBeUndefined();
    b.dispose();
  });

  it('reads the hub role from /health at attach; an old daemon leaves it undefined', async () => {
    mockRoutes((u) =>
      u.endsWith('/health') ? { status: 200, body: { role: 'member' } } : undefined,
    );
    const member = new RemoteDriver('s1', { baseUrl: 'http://desktop', token: 't' }, 0);
    expect(await member.hubRoleReady).toBe('member');
    expect(member.hubRole).toBe('member');
    member.dispose();

    mockRoutes((u) => (u.endsWith('/health') ? { status: 200, body: {} } : undefined));
    const old = new RemoteDriver('s1', { baseUrl: 'http://desktop', token: 't' }, 0);
    expect(await old.hubRoleReady).toBeUndefined();
    expect(old.hubRole).toBeUndefined();
    old.dispose();

    const health = await daemonHealth({ baseUrl: 'http://desktop', token: 't' });
    expect(health.ok).toBe(true);
    expect(health.role).toBeUndefined();
  });
});

// The Phase 2 terminal routes: the driver talks to its own PTY endpoints,
// carries bytes as base64, and surfaces "no PTY on this machine" cleanly.
describe('RemoteDriver terminal (Phase 2)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function mockFetch(termResponse: Partial<Response> & { jsonBody?: unknown }): FetchCall[] {
    const calls: FetchCall[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url: u, method, body });
      // The constructor's event stream loop hits /events: keep it inert.
      if (u.includes('/events')) {
        return { ok: false, status: 500, body: null } as unknown as Response;
      }
      return {
        ok: termResponse.status ? termResponse.status < 400 : true,
        status: termResponse.status ?? 200,
        json: async () => termResponse.jsonBody ?? {},
      } as unknown as Response;
    }) as unknown as typeof fetch;
    return calls;
  }

  it('opens a terminal and returns its id and size', async () => {
    mockFetch({ status: 201, jsonBody: { termId: 'tm1', cols: 100, rows: 30 } });
    const driver = new RemoteDriver('s1', { baseUrl: 'http://desktop', token: 't' }, 0);
    const opened = await driver.openTerminal({ cols: 100, rows: 30 });
    driver.dispose();
    expect(opened).toEqual({ termId: 'tm1', cols: 100, rows: 30 });
  });

  it('reports unavailable when the desktop has no PTY support (503)', async () => {
    mockFetch({ status: 503, jsonBody: { error: 'Terminal support is not installed.' } });
    const driver = new RemoteDriver('s1', { baseUrl: 'http://desktop', token: 't' }, 0);
    const opened = await driver.openTerminal({ cols: 80, rows: 24 });
    driver.dispose();
    expect(opened).toEqual({ unavailable: true, error: 'Terminal support is not installed.' });
  });

  it('sends stdin as base64 and kills over DELETE', async () => {
    const calls = mockFetch({ status: 200, jsonBody: {} });
    const driver = new RemoteDriver('s1', { baseUrl: 'http://desktop', token: 't' }, 0);
    driver.terminalStdin('tm1', 'ls\n');
    driver.terminalKill('tm1');
    driver.dispose();
    const stdin = calls.find((c) => c.url.endsWith('/term/tm1/stdin'));
    expect(stdin?.method).toBe('POST');
    // "ls\n" utf8 -> base64.
    expect((stdin?.body as { dataBase64: string }).dataBase64).toBe(btoa('ls\n'));
    const kill = calls.find((c) => c.url.endsWith('/term/tm1') && c.method === 'DELETE');
    expect(kill).toBeTruthy();
  });

  it('surfaces the final exit frame and stops reading (DAE-5)', async () => {
    const chunks: string[] = [];
    let exit: { exit: number; offset: number } | undefined;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/events'))
        return { ok: false, status: 500, body: null } as unknown as Response;
      return sseResponse(
        `data: {"b64":"${btoa('bye\n')}","offset":4}\n\n` +
          'data: {"exit":0,"offset":4}\n\n' +
          `data: {"b64":"${btoa('never')}","offset":9}\n\n`,
      );
    }) as unknown as typeof fetch;
    const driver = new RemoteDriver('s1', { baseUrl: 'http://desktop', token: 't' }, 0);
    await driver.terminalStream(
      'tm1',
      0,
      (bytes) => chunks.push(new TextDecoder().decode(bytes)),
      new AbortController().signal,
      (info) => {
        exit = info;
      },
    );
    driver.dispose();
    expect(chunks).toEqual(['bye\n']);
    expect(exit).toEqual({ exit: 0, offset: 4 });
  });

  it('reads a 409 on stdin as "the shell exited", not as a missing terminal (DAE-5)', async () => {
    mockFetch({ status: 409, jsonBody: { error: 'shell exited' } });
    const driver = new RemoteDriver('s1', { baseUrl: 'http://desktop', token: 't' }, 0);
    const res = await driver.terminalStdin('tm1', 'y');
    driver.dispose();
    expect(res).toEqual({ ok: false, exited: true, error: 'shell exited' });
    mockFetch({ status: 200, jsonBody: {} });
    const ok = new RemoteDriver('s1', { baseUrl: 'http://desktop', token: 't' }, 0);
    expect(await ok.terminalStdin('tm1', 'y')).toEqual({ ok: true });
    ok.dispose();
  });
});

describe('daemonCreateSession never forwards project secrets', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('drops projectSecrets from the wire body even if a caller passes it', async () => {
    let sentBody: Record<string, unknown> | undefined;
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sentBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return { ok: true, status: 200, json: async () => ({ id: 's1' }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const id = await daemonCreateSession({ baseUrl: 'http://desktop', token: 't' }, '/repo', {
      instructions: 'hi',
      permissionMode: 'default',
      projectSecrets: 'TOP-SECRET-VALUE',
    } as never);

    expect(id).toBe('s1');
    expect(sentBody).toBeDefined();
    expect(sentBody).not.toHaveProperty('projectSecrets');
    expect(JSON.stringify(sentBody)).not.toContain('TOP-SECRET-VALUE');
  });
});
