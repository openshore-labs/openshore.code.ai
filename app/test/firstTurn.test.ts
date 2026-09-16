// B3 and B4 (chat review D3, D4, D5): the first turn is visible and durable,
// and a desktop chat reopens honestly.
//
// - A first message rides into newConversation and is parked on the chat
//   at once, so the bubble exists before the hub has answered.
// - A send to a paired computer paints the user bubble locally and the
//   working row says it is reaching the computer, before the hub echoes.
// - A fast send after reopen (driver still building) is parked, never dropped.
// - A build that times out becomes a plain sentence with a Retry, not a raw
//   TimeoutError; retryPending rebuilds the driver and the message goes out.
// - A message typed before any brain is ready is held in the store, persisted,
//   and offered back.
// - A desktop chat persists a bounded read-only snapshot; reopening keeps it
//   on screen until the journal replays, and the replay replaces it (no
//   duplicates); resumingId clears on the first journal frame or a timeout.
// - The hub's link state reaches the store for the honest banner.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';
import { emptyThread } from '../src/state/types.js';
import { reduceEvents } from '../src/state/transcript.js';

const mem = new Map<string, string>();
const secrets = new Map<string, string>();

type Sink = (event: DriverEvent, seq: number) => void;
type Link = 'live' | 'reconnecting' | 'away';
let nextJournal: Array<{ seq: number; event: DriverEvent }> = [];
const remoteInstances: FakeRemote[] = [];
// Set to make the next session create fail the way a dead hub does.
let failCreate: Error | undefined;
class FakeRemote {
  readonly kind = 'desktop' as const;
  closed = false;
  sent: string[] = [];
  onLink?: (state: Link) => void;
  private sinks = new Set<Sink>();
  private journal = nextJournal;
  readonly hubRoleReady = Promise.resolve(undefined);
  constructor(
    readonly sessionId: string,
    readonly target: { baseUrl: string; token: string },
    _resume: number,
    opts?: { onLink?: (state: Link) => void },
  ) {
    nextJournal = [];
    this.onLink = opts?.onLink;
    remoteInstances.push(this);
  }
  subscribe(sink: Sink) {
    this.sinks.add(sink);
    for (const j of this.journal) sink(j.event, j.seq);
    return () => this.sinks.delete(sink);
  }
  emit(event: DriverEvent, seq = 0) {
    for (const s of [...this.sinks]) s(event, seq);
  }
  send(text: string) {
    this.sent.push(text);
  }
  abort() {}
  answerApproval() {}
  dispose() {
    this.closed = true;
  }
}
vi.mock('../src/drivers/remoteDriver.js', () => ({
  RemoteDriver: FakeRemote,
  HUB_NO_ANSWER: 'Your computer did not answer in 10 seconds. Is it on and on the same network?',
  daemonCreateSession: vi.fn(async () => {
    if (failCreate) throw failCreate;
    return 'sess_1';
  }),
  daemonHealth: vi.fn(async () => ({ ok: false, detail: 'off' })),
  daemonApplyOutbox: vi.fn(),
  daemonVerifyCommit: vi.fn(),
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'web',
  isDesktop: () => false,
  isPhone: () => false,
  openExternal: () => {},
  dataUnlockState: async () => 'ok',
  storeGetJson: async (k: string) => {
    const v = mem.get(k);
    return v ? JSON.parse(v) : undefined;
  },
  storeSetJson: async (k: string, v: unknown) => {
    mem.set(k, JSON.stringify(v));
  },
  storeGet: async (k: string) => mem.get(k) ?? null,
  storeSet: async (k: string, v: string) => {
    mem.set(k, v);
  },
  storeDelete: async (k: string) => {
    mem.delete(k);
  },
  sealExistingKeys: async () => {},
  secretGet: async (k: string) => secrets.get(k) ?? null,
  secretSet: async (k: string, v: string) => {
    secrets.set(k, v);
  },
  secretDelete: async (k: string) => {
    secrets.delete(k);
  },
}));

vi.mock('../src/lib/insights.js', () => ({
  loadInsights: async () => {},
  logEvent: () => {},
  logOnce: () => {},
  setInsightsEnabled: () => {},
  insightsAsText: () => '',
  insightsCount: () => 0,
  clearInsights: async () => {},
}));

const { useApp, driverFor } = await import('../src/state/store.js');
const { REACHING_COMPUTER } = await import('../src/state/transcript.js');
const { HUB_NO_ANSWER } = await import('../src/drivers/remoteDriver.js');
const CONVERSATIONS_KEY = 'oscode.conversations.v1';
const SETTINGS_KEY = 'oscode.settings.v1';
const HUB = { baseUrl: 'http://127.0.0.1:1', token: 'tok-1' };
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = () => new Promise((r) => setTimeout(r, 30));

function resetStore() {
  mem.clear();
  secrets.clear();
  nextJournal = [];
  failCreate = undefined;
  remoteInstances.length = 0;
  useApp.setState({
    conversations: {},
    order: [],
    activeId: undefined,
    toast: undefined,
    hubRole: undefined,
    hubLink: undefined,
    resumingId: undefined,
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
  });
}

describe('the first turn is visible and durable (B3)', () => {
  beforeEach(resetStore);

  it('a first message rides into the new chat and is parked before the hub answers', async () => {
    await useApp.getState().saveHub(HUB);
    const done = useApp
      .getState()
      .newConversation(
        { kind: 'desktop', cwd: '/repo' },
        { firstMessage: { text: 'build the sign-in screen' } },
      );
    // Synchronously after the call the chat exists with the message parked.
    const conv = Object.values(useApp.getState().conversations)[0]!;
    expect(conv.pendingFirstMessage).toBe('build the sign-in screen');
    const id = await done;
    await tick();
    // Once the driver attached the message went out, with the bubble painted
    // locally and the working row naming the wait.
    const after = useApp.getState().conversations[id]!;
    expect(after.pendingFirstMessage).toBeUndefined();
    expect(remoteInstances.at(-1)!.sent).toEqual(['build the sign-in screen']);
    expect(after.thread.items[0]).toMatchObject({ kind: 'user', text: 'build the sign-in screen' });
    expect(after.thread.busy).toBe(true);
    expect(after.thread.stepNote).toBe(REACHING_COMPUTER);
  });

  it('the hub echo of the sent text folds into the local bubble', async () => {
    await useApp.getState().saveHub(HUB);
    const id = await useApp.getState().newConversation({ kind: 'desktop', cwd: '/repo' });
    useApp.getState().send('hello');
    const drv = remoteInstances.at(-1)!;
    // The store paints the user bubble locally; the hub then echoes its own
    // task-start for the same text, which must fold into that one bubble rather
    // than show a second. The reply is delivered as a final (streamed text is
    // held by the ethics screen until a boundary clears it, so a bare delta is
    // intentionally not shown; the turn has to complete to reveal the answer).
    drv.emit({ type: 'task-start', input: 'hello' }, 1);
    drv.emit({ type: 'text-final', text: 'hi' }, 2);
    drv.emit({ type: 'task-done', reason: 'complete' }, 3);
    await settle();
    const thread = useApp.getState().conversations[id]!.thread;
    expect(thread.items.filter((i) => i.kind === 'user')).toHaveLength(1);
    expect(thread.items.map((i) => i.kind)).toEqual(['user', 'assistant']);
  });

  it('a fast send after reopen is parked until the driver exists, never dropped', async () => {
    await useApp.getState().saveHub(HUB);
    const id = await useApp.getState().newConversation({ kind: 'desktop', cwd: '/repo' });
    // Simulate a relaunch: the driver map is empty, the chat is on disk.
    driverFor(id)?.dispose();
    useApp.setState({ activeId: undefined });
    useApp.getState().openConversation(id);
    // The driver is still building (async). A send right now must not vanish.
    useApp.getState().send('quick follow-up');
    expect(useApp.getState().toast).toBeUndefined();
    expect(useApp.getState().conversations[id]!.pendingFirstMessage).toBe('quick follow-up');
    await settle();
    expect(useApp.getState().conversations[id]!.pendingFirstMessage).toBeUndefined();
    expect(remoteInstances.at(-1)!.sent).toEqual(['quick follow-up']);
  });

  it('a hub that does not answer becomes a plain sentence with a Retry', async () => {
    await useApp.getState().saveHub(HUB);
    const timeout = new Error('signal timed out');
    timeout.name = 'TimeoutError';
    failCreate = timeout;
    const id = await useApp
      .getState()
      .newConversation({ kind: 'desktop', cwd: '/repo' }, { firstMessage: { text: 'hello?' } });
    await tick();
    const conv = useApp.getState().conversations[id]!;
    expect(conv.pendingFirstMessage).toBe('hello?');
    expect(conv.pendingFirstError).toBe(HUB_NO_ANSWER);
    expect(useApp.getState().toast).toBe(HUB_NO_ANSWER);
    // The error is not written to disk; the message is.
    const persisted = JSON.parse(mem.get(CONVERSATIONS_KEY)!);
    expect(persisted.conversations[id].pendingFirstMessage).toBe('hello?');
    expect(persisted.conversations[id].pendingFirstError).toBeUndefined();

    // The computer comes back: Retry rebuilds and the message goes out.
    failCreate = undefined;
    useApp.getState().retryPending(id);
    await settle();
    const after = useApp.getState().conversations[id]!;
    expect(after.pendingFirstMessage).toBeUndefined();
    expect(after.pendingFirstError).toBeUndefined();
    expect(remoteInstances.at(-1)!.sent).toEqual(['hello?']);
  });

  it('holds a message typed before any brain is ready, persisted, and offers it back', async () => {
    await useApp.getState().holdFirstMessage('fix the login bug');
    expect(useApp.getState().settings.heldFirstMessage?.text).toBe('fix the login bug');
    const persisted = JSON.parse(mem.get(SETTINGS_KEY)!);
    expect(persisted.heldFirstMessage.text).toBe('fix the login bug');
    const taken = useApp.getState().takeHeldFirstMessage();
    expect(taken?.text).toBe('fix the login bug');
    expect(useApp.getState().settings.heldFirstMessage).toBeUndefined();
    expect(useApp.getState().takeHeldFirstMessage()).toBeUndefined();
    await useApp.getState().holdFirstMessage('again');
    await useApp.getState().discardHeldFirstMessage();
    expect(useApp.getState().settings.heldFirstMessage).toBeUndefined();
  });
});

describe('reopen a desktop chat honestly (B4)', () => {
  beforeEach(resetStore);

  const fullJournal = (n: number): Array<{ seq: number; event: DriverEvent }> => [
    { seq: 1, event: { type: 'task-start', input: 'hello' } },
    ...Array.from({ length: n }, (_, i) => ({
      seq: i + 2,
      event: { type: 'status' as const, message: `s${i}` },
    })),
    { seq: n + 2, event: { type: 'task-done', reason: 'complete' } },
  ];

  it('persists a bounded read-only snapshot of a desktop thread', async () => {
    await useApp.getState().saveHub(HUB);
    nextJournal = fullJournal(80);
    const id = await useApp.getState().newConversation({ kind: 'desktop', cwd: '/repo' });
    await settle();
    const persisted = JSON.parse(mem.get(CONVERSATIONS_KEY)!);
    const saved = persisted.conversations[id];
    expect(saved.thread.items.length).toBe(50);
    expect(saved.thread.busy).toBe(false);
    expect(saved.thread.items.at(-1)).toMatchObject({ kind: 'status', text: 's79' });
    // The full thread had 81 items (a user turn plus 80 status lines; task-done
    // adds none), and the skeleton is sized to that, not to the event count.
    expect(saved.lastItemCount).toBe(81);
  });

  it('keeps the snapshot on screen and lets the journal replace it, without duplicates', async () => {
    await useApp.getState().saveHub(HUB);
    nextJournal = fullJournal(3);
    const id = await useApp.getState().newConversation({ kind: 'desktop', cwd: '/repo' });
    await settle();
    expect(useApp.getState().conversations[id]!.thread.items).toHaveLength(4);

    // Relaunch: the driver is gone; the chat reopens from its snapshot.
    driverFor(id)?.dispose();
    useApp.setState({ activeId: undefined });
    nextJournal = fullJournal(3);
    useApp.getState().openConversation(id);
    // Right away: the snapshot is what the screen shows, marked as resuming.
    expect(useApp.getState().resumingId).toBe(id);
    expect(useApp.getState().conversations[id]!.thread.items).toHaveLength(4);
    await settle();
    // The journal replayed over it, once, and resuming is over.
    const thread = useApp.getState().conversations[id]!.thread;
    expect(thread.items).toHaveLength(4);
    expect(thread.items.filter((i) => i.kind === 'user')).toHaveLength(1);
    expect(useApp.getState().resumingId).toBeUndefined();
  });

  it('a hub that never sends a frame stops the resume after the timeout', async () => {
    vi.useFakeTimers();
    try {
      await useApp.getState().saveHub(HUB);
      const id = await useApp.getState().newConversation({ kind: 'desktop', cwd: '/repo' });
      driverFor(id)?.dispose();
      useApp.setState({ activeId: undefined });
      useApp.getState().openConversation(id);
      await vi.advanceTimersByTimeAsync(50);
      expect(useApp.getState().resumingId).toBe(id);
      await vi.advanceTimersByTimeAsync(6100);
      expect(useApp.getState().resumingId).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a status from the driver before the journal does not wipe the snapshot', async () => {
    await useApp.getState().saveHub(HUB);
    nextJournal = fullJournal(2);
    const id = await useApp.getState().newConversation({ kind: 'desktop', cwd: '/repo' });
    await settle();
    driverFor(id)?.dispose();
    useApp.setState({ activeId: undefined });
    useApp.getState().openConversation(id);
    await settle();
    const drv = remoteInstances.at(-1)!;
    drv.emit({ type: 'status', message: 'This session no longer exists on the desktop.' }, 0);
    await tick();
    const items = useApp.getState().conversations[id]!.thread.items;
    expect(items.length).toBe(4);
    expect(items.at(-1)).toMatchObject({ kind: 'status' });
  });

  it('the hub link state reaches the store, with the last time the hub answered', async () => {
    await useApp.getState().saveHub(HUB);
    await useApp.getState().newConversation({ kind: 'desktop', cwd: '/repo' });
    const drv = remoteInstances.at(-1)!;
    expect(drv.onLink).toBeTypeOf('function');
    drv.onLink!('live');
    expect(useApp.getState().hubLink).toBeUndefined();
    expect(useApp.getState().settings.hubLastSeen?.[HUB.baseUrl]).toBeTypeOf('string');
    drv.onLink!('reconnecting');
    expect(useApp.getState().hubLink?.state).toBe('reconnecting');
    drv.onLink!('away');
    expect(useApp.getState().hubLink?.state).toBe('away');
    drv.onLink!('live');
    expect(useApp.getState().hubLink).toBeUndefined();
  });
});

// The reducer is what the snapshot and the replay both go through; a sanity
// check that a replayed journal reads the same as a live one.
describe('replay parity', () => {
  it('a journal folds to the same thread live or replayed', () => {
    const events = [
      { seq: 1, event: { type: 'task-start', input: 'x' } as DriverEvent },
      { seq: 2, event: { type: 'text-final', text: 'y' } as DriverEvent },
      { seq: 3, event: { type: 'task-done', reason: 'complete' } as DriverEvent },
    ];
    const a = reduceEvents(emptyThread(), events);
    expect(a.items.map((i) => i.kind)).toEqual(['user', 'assistant']);
    expect(a.lastSeq).toBe(3);
  });
});
