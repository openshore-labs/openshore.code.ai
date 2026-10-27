// Runs on, in the store (2026-10-12): a device docked to several
// machines (a computer, a server at home, a rented server) opens a project's
// coding session on the machine that project names, whatever is active; the
// chat records that machine and always goes back to it; forgetting the
// machine sends the project back to the device's default and leaves the chat
// saying where it ran, never asking another machine for a session it has
// never heard of. On the desktop a project may also keep to this computer
// while the rest run elsewhere.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';

const mem = new Map<string, string>();
const h = vi.hoisted(() => ({
  desktop: false,
  creates: [] as Array<{ target: string; cwd?: string }>,
  remote: [] as Array<{ sessionId: string; target: string }>,
  local: [] as Array<{ cwd?: string }>,
  beats: [] as string[],
}));

type Sink = (event: DriverEvent, seq: number) => void;
class FakeRemote {
  readonly kind = 'desktop' as const;
  private sinks = new Set<Sink>();
  constructor(
    readonly sessionId: string,
    target: { baseUrl: string },
  ) {
    h.remote.push({ sessionId, target: target.baseUrl });
  }
  subscribe(sink: Sink) {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }
  send() {}
  abort() {}
  answerApproval() {}
  dispose() {}
}
class FakeLocal extends FakeRemote {
  constructor(sessionId: string) {
    super(sessionId, { baseUrl: 'local' });
  }
}

vi.mock('../src/drivers/remoteDriver.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/drivers/remoteDriver.js')>()),
  RemoteDriver: FakeRemote,
  daemonCreateSession: vi.fn(async (target: { baseUrl: string }, cwd: string) => {
    h.creates.push({ target: target.baseUrl, cwd });
    return `sess_${h.creates.length}`;
  }),
  daemonHealth: vi.fn(async () => ({ ok: false, detail: 'off' })),
}));

vi.mock('../src/lib/electronBridge.js', () => ({
  bridge: () =>
    h.desktop
      ? new Proxy(
          {
            createSession: async (cwd: string) => {
              h.local.push({ cwd });
              return { id: `local_${h.local.length}` };
            },
            resumeSession: async () => ({}),
          } as Record<string, unknown>,
          { get: (target, key) => (key in target ? target[key as string] : async () => undefined) },
        )
      : undefined,
  requireBridge: () => {
    throw new Error('no bridge in this test');
  },
}));
vi.mock('../src/drivers/electronDriver.js', () => ({ ElectronDriver: FakeLocal }));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => (h.desktop ? 'desktop' : 'web'),
  isDesktop: () => h.desktop,
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
  secretGet: async () => null,
  secretSet: async () => {},
  secretDelete: async () => {},
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

const { useApp, conversationWhere } = await import('../src/state/store.js');
const { THIS_COMPUTER } = await import('../src/lib/runsOn.js');

const HOME = { baseUrl: 'http://127.0.0.1:1', token: 'a', kind: 'desktop' as const };
const VPS = { baseUrl: 'http://127.0.0.1:2', token: 'b', kind: 'server' as const };
const BOX = { baseUrl: 'http://127.0.0.1:3', token: 'c', kind: 'server' as const };
const CWD = '/var/lib/openshore/OSCode/app';

const settle = () => new Promise((r) => setTimeout(r, 0));

async function fresh(): Promise<string> {
  useApp.setState({
    conversations: {},
    order: [],
    activeId: undefined,
    toast: undefined,
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
  });
  const app = useApp.getState();
  await app.saveHub(HOME, { role: 'admin' });
  await app.saveHub(VPS, { role: 'admin' });
  await app.saveHub(BOX, { role: 'admin' });
  // The phone's active machine is the computer at home.
  await app.selectHub(HOME.baseUrl);
  const projectId = await app.createProject('Shop');
  await app.setActiveProject(projectId);
  return projectId;
}

beforeEach(() => {
  h.desktop = false;
  h.creates.length = 0;
  h.remote.length = 0;
  h.local.length = 0;
});

afterEach(() => {
  h.desktop = false;
});

describe('a project runs on the machine it names', () => {
  it('opens on the rented server while the computer at home is active, and says so', async () => {
    const projectId = await fresh();
    await useApp.getState().setProjectRunsOn(projectId, VPS.baseUrl);
    const id = await useApp.getState().newConversation({ kind: 'desktop', cwd: CWD });
    expect(h.creates).toEqual([{ target: VPS.baseUrl, cwd: CWD }]);
    expect(h.remote.at(-1)).toEqual({ sessionId: 'sess_1', target: VPS.baseUrl });
    const conv = useApp.getState().conversations[id!]!;
    expect(conv.source).toMatchObject({ kind: 'desktop', sessionId: 'sess_1', hub: VPS.baseUrl });
    // The device's active machine is untouched: the Vault, Crew and the
    // Stack stay where they were.
    expect(useApp.getState().settings.daemon?.baseUrl).toBe(HOME.baseUrl);
  });

  it('a project that names nothing runs where the device runs, as before', async () => {
    await fresh();
    await useApp.getState().newConversation({ kind: 'desktop', cwd: CWD });
    expect(h.creates.at(-1)?.target).toBe(HOME.baseUrl);
  });

  it('refuses a machine this device has not docked to', async () => {
    const projectId = await fresh();
    await useApp.getState().setProjectRunsOn(projectId, 'http://127.0.0.1:9');
    expect(useApp.getState().settings.projects?.find((p) => p.id === projectId)?.runsOn).toBe(
      undefined,
    );
    // And a phone cannot keep a project to "this computer".
    await useApp.getState().setProjectRunsOn(projectId, THIS_COMPUTER);
    expect(useApp.getState().settings.projects?.find((p) => p.id === projectId)?.runsOn).toBe(
      undefined,
    );
  });
});

describe('a chat goes back to the machine it opened on', () => {
  it('after the active machine and the project both change', async () => {
    const projectId = await fresh();
    await useApp.getState().setProjectRunsOn(projectId, BOX.baseUrl);
    const id = (await useApp.getState().newConversation({ kind: 'desktop', cwd: CWD }))!;
    await useApp.getState().selectHub(VPS.baseUrl);
    await useApp.getState().setProjectRunsOn(projectId, HOME.baseUrl);
    const conv = useApp.getState().conversations[id]!;
    const where = conversationWhere(useApp.getState().settings, conv);
    expect(where).toMatchObject({ kind: 'docked', target: { baseUrl: BOX.baseUrl } });

    // A relaunch: the chat comes back from disk with no driver and reopens.
    useApp.setState({
      conversations: { [`${id}-again`]: { ...conv, id: `${id}-again` } },
      order: [`${id}-again`],
    });
    const before = h.remote.length;
    useApp.getState().openConversation(`${id}-again`);
    await settle();
    expect(h.remote.length).toBe(before + 1);
    expect(h.remote.at(-1)).toEqual({
      sessionId: conv.source.kind === 'desktop' ? conv.source.sessionId! : '',
      target: BOX.baseUrl,
    });
    // No second session was opened anywhere.
    expect(h.creates).toHaveLength(1);
  });

  it('forgetting the machine frees the project, and the chat never lands elsewhere', async () => {
    const projectId = await fresh();
    await useApp.getState().setProjectRunsOn(projectId, VPS.baseUrl);
    const id = (await useApp.getState().newConversation({ kind: 'desktop', cwd: CWD }))!;
    const conv = useApp.getState().conversations[id]!;
    await useApp.getState().removeHub(VPS.baseUrl);
    expect(useApp.getState().settings.projects?.find((p) => p.id === projectId)?.runsOn).toBe(
      undefined,
    );
    expect(conversationWhere(useApp.getState().settings, conv)).toEqual({
      kind: 'gone',
      key: VPS.baseUrl,
    });
    useApp.setState({ conversations: { again: { ...conv, id: 'again' } }, order: ['again'] });
    const before = h.remote.length;
    useApp.getState().openConversation('again');
    await settle();
    expect(h.remote.length).toBe(before);
    expect(useApp.getState().toast).toMatch(/no longer docks to/);
  });

  it('a session listed from a machine opens on that machine', async () => {
    await fresh();
    await useApp.getState().openDesktopSession({ id: 'sess_listed', cwd: CWD, hub: BOX.baseUrl });
    expect(h.remote.at(-1)).toEqual({ sessionId: 'sess_listed', target: BOX.baseUrl });
    expect(h.creates).toHaveLength(0);
  });
});

describe('on the desktop', () => {
  it('one project keeps to this computer while the rest run on the server', async () => {
    const projectId = await fresh();
    h.desktop = true;
    await useApp.getState().setPreferRemoteHub(true);
    await useApp.getState().selectHub(VPS.baseUrl);
    await useApp.getState().newConversation({ kind: 'desktop', cwd: CWD });
    expect(h.creates.at(-1)?.target).toBe(VPS.baseUrl);

    await useApp.getState().setProjectRunsOn(projectId, THIS_COMPUTER);
    useApp.getState().startProjectChat(projectId);
    const id = (await useApp.getState().newConversation({ kind: 'desktop', cwd: '/home/me/app' }))!;
    expect(h.local.at(-1)).toEqual({ cwd: '/home/me/app' });
    expect(useApp.getState().conversations[id]!.source).toMatchObject({ hub: THIS_COMPUTER });
  });

  it('a project on a server runs there while this computer runs the rest', async () => {
    const projectId = await fresh();
    h.desktop = true;
    await useApp.getState().setPreferRemoteHub(false);
    await useApp.getState().setProjectRunsOn(projectId, BOX.baseUrl);
    await useApp.getState().newConversation({ kind: 'desktop', cwd: CWD });
    expect(h.creates.at(-1)?.target).toBe(BOX.baseUrl);
    expect(h.local).toHaveLength(0);
  });
});
