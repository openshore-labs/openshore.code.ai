// A session a phone opens on a paired computer carries the project the way a
// desktop-created session does: its name and its standing instructions. Without
// the name the engine falls back to the workspace folder's name, so one project
// kept its memory notes in two folders ("OpenShore Project My App MDs/" from the
// desktop, "OpenShore Project my-app MDs/" from the phone). The Stack's engine
// step carries both too, so a play's tool step works to the same instructions.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';
import { memorySegment } from 'os-code/dist/src/core/agent/projectMemory.js';
import { segmentForProject } from '../src/lib/projectMemoryRead.js';

const mem = new Map<string, string>();
const h = vi.hoisted(() => ({
  desktop: false,
  phoneCreates: [] as Array<{ cwd?: string; opts: Record<string, unknown> }>,
  desktopCreates: [] as Array<{ cwd?: string; opts: Record<string, unknown> }>,
}));

type Sink = (event: DriverEvent, seq: number) => void;
class FakeDriver {
  readonly kind = 'desktop' as const;
  private sinks = new Set<Sink>();
  constructor(readonly sessionId: string) {}
  subscribe(sink: Sink) {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }
  send() {}
  abort() {}
  answerApproval() {}
  dispose() {}
}

vi.mock('../src/drivers/remoteDriver.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/drivers/remoteDriver.js')>()),
  RemoteDriver: FakeDriver,
  daemonCreateSession: vi.fn(
    async (_target: unknown, cwd: string, opts: Record<string, unknown>) => {
      h.phoneCreates.push({ cwd, opts });
      return 'sess_phone';
    },
  ),
  daemonHealth: vi.fn(async () => ({ ok: false, detail: 'off' })),
}));

// The desktop's own engine, reached over the Electron bridge.
vi.mock('../src/lib/electronBridge.js', () => ({
  bridge: () =>
    h.desktop
      ? new Proxy(
          {
            createSession: async (cwd: string, opts: Record<string, unknown>) => {
              h.desktopCreates.push({ cwd, opts });
              return { id: 'sess_desk' };
            },
          } as Record<string, unknown>,
          { get: (target, key) => (key in target ? target[key as string] : async () => undefined) },
        )
      : undefined,
  requireBridge: () => {
    throw new Error('no bridge in this test');
  },
}));
vi.mock('../src/drivers/electronDriver.js', () => ({ ElectronDriver: FakeDriver }));

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

const { useApp } = await import('../src/state/store.js');
const { engineStepSessionOpts } = await import('../src/drivers/stackDriver.js');
const HUB = { baseUrl: 'http://127.0.0.1:1', token: 'tok-1' };
// The workspace folder's name differs from the project's, the case that split.
const CWD = '/work/my-app';

describe('a phone-driven session carries the project', () => {
  afterEach(() => {
    h.desktop = false;
  });

  it('a phone-created and a desktop-created session resolve the same memory folder', async () => {
    useApp.setState({
      conversations: {},
      order: [],
      activeId: undefined,
      settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
    });
    const projectId = await useApp.getState().createProject('My App');
    await useApp.getState().updateProject(projectId, { instructions: 'Keep every screen calm.' });
    await useApp.getState().saveHub(HUB);

    // The phone: the paired computer's hub opens the session.
    h.desktop = false;
    await useApp.getState().newConversation({ kind: 'desktop', cwd: CWD });
    // The desktop: its own in-process engine opens it.
    h.desktop = true;
    await useApp.getState().newConversation({ kind: 'desktop', cwd: CWD });

    const phone = h.phoneCreates.at(-1)!;
    const desktop = h.desktopCreates.at(-1)!;
    expect(phone.cwd).toBe(CWD);
    expect(desktop.cwd).toBe(CWD);
    expect(phone.opts.projectName).toBe('My App');
    expect(phone.opts.instructions).toBe(desktop.opts.instructions);
    expect(phone.opts.instructions).toContain('Keep every screen calm.');
    // Secrets for this device still never ride to another machine.
    expect(phone.opts).not.toHaveProperty('projectSecrets');

    const phoneFolder = memorySegment(phone.opts.projectName as string | undefined, CWD);
    expect(phoneFolder).toBe(memorySegment(desktop.opts.projectName as string | undefined, CWD));
    // ...the folder the app's project memory viewer reads...
    expect(phoneFolder).toBe(segmentForProject('My App'));
    // ...and not the workspace-named folder the phone used to write.
    expect(phoneFolder).not.toBe(memorySegment(undefined, CWD));
  });

  it('puts the project name on the wire to the hub', async () => {
    const { daemonCreateSession } = await vi.importActual<
      typeof import('../src/drivers/remoteDriver.js')
    >('../src/drivers/remoteDriver.js');
    const realFetch = globalThis.fetch;
    let sent: Record<string, unknown> | undefined;
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sent = init?.body ? JSON.parse(init.body as string) : undefined;
      return { ok: true, status: 201, json: async () => ({ id: 's1' }) } as unknown as Response;
    }) as unknown as typeof fetch;
    try {
      await daemonCreateSession(HUB, CWD, { projectName: 'My App', instructions: 'Calm.' });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(sent).toMatchObject({ cwd: CWD, projectName: 'My App', instructions: 'Calm.' });
  });

  it("the Stack's engine step opens its session with the project's name and instructions", () => {
    expect(
      engineStepSessionOpts({
        projectName: 'My App',
        projectInstructions: 'Keep every screen calm.',
        humanize: true,
      }),
    ).toEqual({
      permissionMode: 'acceptEdits',
      humanize: true,
      projectName: 'My App',
      instructions: 'Keep every screen calm.',
    });
  });

  // sp-claims2: Settings says the writing voice goes to the model that writes
  // for you, except the computer's coding agent. No session the app opens
  // there carries it: from a phone, from the desktop, or for a plan's step.
  it('a session on the computer carries no writing voice', async () => {
    const VOICE = 'Dry and brief. British spelling.';
    useApp.setState({
      conversations: {},
      order: [],
      activeId: undefined,
      settings: { onboarded: true, claudeModel: 'x', deviceModels: {}, writingVoice: VOICE },
    });
    await useApp.getState().saveHub(HUB);
    const before = { phone: h.phoneCreates.length, desktop: h.desktopCreates.length };
    h.desktop = false;
    await useApp.getState().newConversation({ kind: 'desktop', cwd: CWD });
    h.desktop = true;
    await useApp.getState().newConversation({ kind: 'desktop', cwd: CWD });
    expect(h.phoneCreates.length).toBe(before.phone + 1);
    expect(h.desktopCreates.length).toBe(before.desktop + 1);
    const opened = [
      h.phoneCreates.at(-1)!.opts,
      h.desktopCreates.at(-1)!.opts,
      engineStepSessionOpts({ humanize: true, writingVoice: VOICE }),
    ];
    for (const opts of opened) {
      expect(opts).not.toHaveProperty('writingVoice');
      expect(JSON.stringify(opts)).not.toContain(VOICE);
    }
  });
});
