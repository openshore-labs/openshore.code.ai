// The Wayfinding Memory switch reaches the engine (plan 1.5, CTO F6). Off, it
// rides as `memory: false` into every engine session the app opens: the
// desktop's own in-process engine over the Electron bridge, a session a phone
// opens on its paired computer, and a Stack play's engine step. On (the
// default), nothing rides at all, so the project's config stays in charge:
// the app can only ever turn memory off, never back on over a project that
// turned it off. The engine applies it in one helper (memoryEnabled).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DriverEvent } from 'os-code/protocol';
import type { StackContext } from '../src/drivers/stackDriver.js';

const mem = new Map<string, string>();
const h = vi.hoisted(() => ({
  desktop: false,
  phoneCreates: [] as Array<{ cwd?: string; opts: Record<string, unknown> }>,
  desktopCreates: [] as Array<{ cwd?: string; opts: Record<string, unknown> }>,
  stackContexts: [] as StackContext[],
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

// A Stack chat's driver, as far as this test reads it: the context it opens
// its engine step with.
vi.mock('../src/drivers/stackDriver.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/drivers/stackDriver.js')>();
  class FakeStackDriver extends FakeDriver {
    constructor(_stack: unknown, _profile: unknown, context: StackContext) {
      super('stack');
      h.stackContexts.push(context);
    }
  }
  return { ...real, StackDriver: FakeStackDriver };
});

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
const CWD = '/work/my-app';

/** Open one engine session each way (the phone's, the desktop's) and one
 *  Stack chat, with the Memory switch as given (undefined leaves it unset). */
async function openEverySession(
  memory: boolean | undefined,
  vault: {
    vaultContext?: 'off';
    vaultHandoff?: 'off';
    vaultPackSize?: 'small' | 'normal' | 'large';
  } = {},
) {
  useApp.setState({
    conversations: {},
    order: [],
    activeId: undefined,
    settings: {
      onboarded: true,
      claudeModel: 'x',
      deviceModels: {},
      ...(memory === undefined ? {} : { wayfinding: { memory } }),
      ...vault,
    },
  });
  await useApp.getState().saveHub(HUB);
  h.desktop = false;
  await useApp.getState().newConversation({ kind: 'desktop', cwd: CWD });
  h.desktop = true;
  await useApp.getState().newConversation({ kind: 'desktop', cwd: CWD });
  h.desktop = false;
  await useApp.getState().newConversation({ kind: 'stack' });
  return {
    phone: h.phoneCreates.at(-1)!.opts,
    desktop: h.desktopCreates.at(-1)!.opts,
    stack: h.stackContexts.at(-1)!,
  };
}

describe('the Memory switch reaches every engine session the app opens', () => {
  afterEach(() => {
    h.desktop = false;
  });

  it('off sends memory: false to the paired computer, the desktop bridge, and a Stack engine step', async () => {
    const { phone, desktop, stack } = await openEverySession(false);
    expect(phone.memory).toBe(false);
    expect(desktop.memory).toBe(false);
    expect(stack.memory).toBe(false);
    // The Stack context turns into the engine step's session options.
    expect(engineStepSessionOpts(stack)).toMatchObject({ memory: false });
  });

  it('on, or never touched, sends nothing, so the project config stays in charge', async () => {
    for (const memory of [true, undefined]) {
      const { phone, desktop, stack } = await openEverySession(memory);
      // The phone's options go through daemonCreateSession, whose body leaves
      // an undefined memory out (the wire cases below); the bridge's options
      // cross IPC as they are, so they carry no memory key at all.
      expect(phone.memory).toBeUndefined();
      expect(desktop).not.toHaveProperty('memory');
      expect(stack.memory).toBeUndefined();
      expect(engineStepSessionOpts(stack)).not.toHaveProperty('memory');
    }
  });
});

// Vault M8 (M7 follow-up 35): a play's engine step opens its session with the
// device's vault switches, the same object a chat's session carries, so Notes
// in chats off, Handoff off and a smaller Room for notes hold there too.
describe('the vault switches reach a Stack engine step like every other session', () => {
  afterEach(() => {
    h.desktop = false;
  });

  it('off and a size ride to the phone, the desktop, and the play step alike', async () => {
    const { phone, desktop, stack } = await openEverySession(undefined, {
      vaultContext: 'off',
      vaultHandoff: 'off',
      vaultPackSize: 'small',
    });
    const want = { context: 'off', handoff: 'off', packSize: 'small' };
    expect(phone.vaultOverrides).toEqual(want);
    expect(desktop.vaultOverrides).toEqual(want);
    expect(engineStepSessionOpts(stack).vaultOverrides).toEqual(want);
  });

  it('every switch on and no size sends nothing, so the computer stays in charge', async () => {
    const { phone, desktop, stack } = await openEverySession(undefined);
    expect(phone.vaultOverrides).toBeUndefined();
    expect(desktop).not.toHaveProperty('vaultOverrides');
    expect(engineStepSessionOpts(stack)).not.toHaveProperty('vaultOverrides');
  });
});

describe('the wire to a paired computer', () => {
  async function bodyFor(memory: boolean | undefined) {
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
      await daemonCreateSession(HUB, CWD, { memory });
    } finally {
      globalThis.fetch = realFetch;
    }
    return sent!;
  }

  it('puts memory: false in the POST /sessions body', async () => {
    expect(await bodyFor(false)).toMatchObject({ cwd: CWD, memory: false });
  });

  it('never sends memory: true, and sends nothing when the switch is on', async () => {
    expect(await bodyFor(true)).not.toHaveProperty('memory');
    expect(await bodyFor(undefined)).not.toHaveProperty('memory');
  });
});

describe('the Electron bridge into the desktop engine', () => {
  // Read-tests, since registering real handlers needs a running Electron
  // (mainIpc.test.ts). engineHost.test.ts proves the host hands the value to
  // the engine's bootstrap.
  const main = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8');

  it("main's session validator keeps memory, as a checked boolean", () => {
    const validator = main.slice(main.indexOf('function sessionOpts'));
    expect(validator.slice(0, validator.indexOf('\n}\n'))).toMatch(
      /memory: optBool\(o\.memory, 'memory'\)/,
    );
  });
});
