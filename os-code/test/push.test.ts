// The completion-push trigger logic: approvals always notify, a finished run
// notifies only when the session is truly idle (not mid-batch), a fresh phone
// beat suppresses (the user is watching), and an unregistered daemon is silent.
// The network and the sealed on-disk grant store are both injected, so this is a
// pure test of the decision, not of APNs or the filesystem.
import { describe, expect, it, vi } from 'vitest';
import { PushNotifier, type PushConfig } from '../src/daemon/push.js';

const CONFIG: PushConfig = {
  grant: 'g_test',
  sendUrl: 'https://x.functions.supabase.co/push-send',
};

function fakeEgress() {
  const fetch = vi.fn(async () => ({ ok: true, body: { cancel: async () => {} } }));
  return { fetch } as unknown as Parameters<typeof makeNotifier>[0]['egress'] & {
    fetch: typeof fetch;
  };
}

function makeNotifier(opts: {
  egress: ConstructorParameters<typeof PushNotifier>[0];
  now?: () => number;
  resolveConfig?: (id?: string) => PushConfig | null;
}) {
  return new PushNotifier(opts.egress, { now: opts.now, resolveConfig: opts.resolveConfig });
}

// A driver stub whose onEvent captures the listener so the test can drive events.
function fakeDriver(id: string, idle: boolean, owner?: string) {
  let listener: ((event: { type: string }, seq: number) => void) | undefined;
  const onEvent = vi.fn((l: (event: { type: string }, seq: number) => void) => {
    listener = l;
    return () => {};
  });
  return {
    driver: { id, idle, owner, onEvent },
    emit: (type: string, seq: number) => listener?.({ type }, seq),
    onEvent,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('PushNotifier', () => {
  it('fires a content-free push on an approval request', async () => {
    const egress = fakeEgress();
    const n = makeNotifier({ egress, resolveConfig: () => CONFIG });
    const d = fakeDriver('s1', true, 'u1');
    n.watch(d.driver);
    d.emit('approval-request', 7);
    await tick();
    expect(egress.fetch).toHaveBeenCalledTimes(1);
    const [url, purpose, init] = egress.fetch.mock.calls[0];
    expect(url).toBe(CONFIG.sendUrl);
    expect(purpose).toBe('cloud-api');
    const body = JSON.parse((init as { body: string }).body);
    expect(body).toMatchObject({ grant: 'g_test', sessionId: 's1', kind: 'approval', seq: 7 });
  });

  it('fires on a finished run only when the session is idle', async () => {
    const egress = fakeEgress();
    const n = makeNotifier({ egress, resolveConfig: () => CONFIG });
    const busy = fakeDriver('s2', false, 'u1'); // another queued task is running
    n.watch(busy.driver);
    busy.emit('task-done', 3);
    await tick();
    expect(egress.fetch).not.toHaveBeenCalled();

    const idle = fakeDriver('s3', true, 'u1');
    n.watch(idle.driver);
    idle.emit('task-done', 4);
    await tick();
    expect(egress.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(egress.fetch.mock.calls[0][2].body).kind).toBe('done');
  });

  it('suppresses when a fresh phone beat says the user is watching', async () => {
    const egress = fakeEgress();
    let clock = 1_000_000;
    const n = makeNotifier({ egress, now: () => clock, resolveConfig: () => CONFIG });
    const d = fakeDriver('s4', true, 'u1');
    n.watch(d.driver);
    n.recordBeat('s4');
    clock += 5_000; // within the freshness window
    d.emit('approval-request', 1);
    await tick();
    expect(egress.fetch).not.toHaveBeenCalled();

    clock += 60_000; // beat now stale
    d.emit('approval-request', 2);
    await tick();
    expect(egress.fetch).toHaveBeenCalledTimes(1);
  });

  it('is silent when no grant is registered', async () => {
    const egress = fakeEgress();
    const n = makeNotifier({ egress, resolveConfig: () => null });
    const d = fakeDriver('s5', true, 'u1');
    n.watch(d.driver);
    d.emit('approval-request', 1);
    await tick();
    expect(egress.fetch).not.toHaveBeenCalled();
  });

  it('attaches to a driver only once', () => {
    const egress = fakeEgress();
    const n = makeNotifier({ egress, resolveConfig: () => CONFIG });
    const d = fakeDriver('s6', true, 'u1');
    n.watch(d.driver);
    n.watch(d.driver);
    expect(d.onEvent).toHaveBeenCalledTimes(1);
  });
});
