// Accounts (founder + CX, 2026-09-27; docs/accounts-cx-memo.md): chatting needs
// no account, everything else is behind a free sign-in, nothing resets for a
// signed-out person, and signing in is worth something because a short list
// of preferences follows the person to every device they sign in on. Pure
// rules first, then the store against a mocked Supabase.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';

const mem = new Map<string, string>();

// The desktop shell, for the sample project: off unless a test turns it on.
const shell = vi.hoisted(() => ({
  desktop: false,
  createSample: undefined as undefined | (() => Promise<{ path: string } | { error: string }>),
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'web',
  isDesktop: () => shell.desktop,
  isPhone: () => false,
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

vi.mock('../src/lib/electronBridge.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/electronBridge.js')>()),
  bridge: () => (shell.desktop ? { createSample: shell.createSample } : undefined),
}));

// A coding session on a paired computer, as far as the door is concerned:
// whether one was ever built, and what reached it.
type Sink = (event: DriverEvent, seq: number) => void;
const engine = vi.hoisted(() => ({ built: [] as Array<{ sessionId: string; sent: string[] }> }));
class FakeRemote {
  readonly kind = 'desktop' as const;
  readonly hubRoleReady = Promise.resolve(undefined);
  readonly record: { sessionId: string; sent: string[] };
  private sinks = new Set<Sink>();
  constructor(readonly sessionId: string) {
    this.record = { sessionId, sent: [] };
    engine.built.push(this.record);
  }
  subscribe(sink: Sink) {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }
  send(text: string) {
    this.record.sent.push(text);
  }
  abort() {}
  answerApproval() {}
  dispose() {}
}
vi.mock('../src/drivers/remoteDriver.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/drivers/remoteDriver.js')>()),
  RemoteDriver: FakeRemote,
  daemonCreateSession: vi.fn(async () => 'sess_new'),
  daemonHealth: vi.fn(async () => ({ ok: false, detail: 'off' })),
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

const sb = vi.hoisted(() => ({
  configured: true,
  remote: undefined as unknown,
  writes: [] as unknown[],
  failRead: false,
  deadRefresh: false,
}));
vi.mock('../src/lib/supabase.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/supabase.js')>();
  return {
    ...real,
    isConfigured: () => sb.configured,
    signInWithPassword: async () => live(),
    signOut: async () => {},
    refreshSession: async () => {
      // A revoked refresh token, the way GoTrue answers one.
      if (sb.deadRefresh) throw new real.SupabaseRequestError('invalid_grant', 400);
      return live();
    },
    select: async () => [],
    rpc: async () => null,
    readUserPrefs: async () => {
      if (sb.failRead) throw new Error('offline');
      return sb.remote;
    },
    writeUserPrefs: async (_token: string, record: unknown) => {
      sb.writes.push(record);
      sb.remote = record;
    },
  };
});

const {
  ROOM_ACCOUNT,
  ACCOUNT_GATE_TITLE,
  ACCOUNT_GATE_BODY,
  ACCOUNT_NOTICE,
  ACCOUNT_PITCH,
  needsAccount,
} = await import('../src/lib/accountGate.js');
const {
  SETTINGS_REACH,
  FOLLOWING_KEYS,
  pickPreferences,
  readPreferences,
  readPreferencesRecord,
  syncDirection,
} = await import('../src/lib/settingsReach.js');
const { useApp } = await import('../src/state/store.js');
const { emptyThread } = await import('../src/state/types.js');
const { SAMPLE_PROMPT } = await import('../src/lib/sampleProject.js');
type Session = import('../src/lib/supabase.js').Session;
type AppSettings = import('../src/state/store.js').AppSettings;
type Conversation = import('../src/state/types.js').Conversation;

function live(): Session {
  return {
    accessToken: 'tok',
    refreshToken: 'rt',
    expiresAt: Date.now() + 3_600_000,
    user: { id: 'u1', email: 'a@b.c' },
  };
}

const base = (extra: Partial<AppSettings> = {}): AppSettings => ({
  onboarded: true,
  claudeModel: 'x',
  deviceModels: {},
  ...extra,
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

const SETTINGS_KEY = 'oscode.settings.v1';
const HUB = { baseUrl: 'http://127.0.0.1:1', token: 'tok-1' };
// A vault the person placed, so nothing repoints it with a toast of its own.
const VAULT_FOLDER = {
  id: 'vault.personal',
  name: 'Vault',
  kind: 'vault' as const,
  providerId: 'files' as const,
  createdAt: '2026-09-01T00:00:00.000Z',
  chosenAt: '2026-09-01T00:00:00.000Z',
};

/** A coding chat made while signed in, as it sits on the device afterwards. */
function codingChat(id = 'code1'): Conversation {
  const at = '2026-09-28T10:00:00.000Z';
  return {
    id,
    title: 'Fix the header',
    source: { kind: 'desktop', sessionId: 'sess_1', cwd: '/repo' },
    repoIds: [],
    createdAt: at,
    updatedAt: at,
    thread: {
      ...emptyThread(),
      items: [
        { kind: 'user', id: 'u1', text: 'fix the header' },
        { kind: 'assistant', id: 'a1', text: 'Done. The header is fixed.', streaming: false },
      ],
    },
  };
}

/** Every source file under app/src, for the copy sweep. */
function sourceFiles(dir = join(process.cwd(), 'src'), out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe('the gate: chat is free, everything else is a free sign-in', () => {
  it('leaves exactly chat, the chat list, the Stack, its health, Settings, and setup free', () => {
    const free = Object.entries(ROOM_ACCOUNT)
      .filter(([, f]) => f === null)
      .map(([v]) => v)
      .sort();
    expect(free).toEqual(['chat', 'chats', 'onboarding', 'settings', 'stack', 'stackhealth']);
  });

  it('puts Projects, Terminal, Repositories, Vault, Crew, Connections, and pairing behind it', () => {
    for (const view of [
      'projects',
      'terminalroom',
      'repos',
      'vault',
      'crew',
      'connections',
      'pair',
    ])
      expect(ROOM_ACCOUNT[view as keyof typeof ROOM_ACCOUNT], view).not.toBeNull();
  });

  it('asks only when the build has accounts and nobody is signed in', () => {
    expect(needsAccount(true, false)).toBe(true);
    expect(needsAccount(true, true)).toBe(false);
    // A build without an account backend has nobody to sign in with.
    expect(needsAccount(false, false)).toBe(false);
  });

  it('says signing in is free, and that chatting needs no account', () => {
    for (const title of Object.values(ACCOUNT_GATE_TITLE))
      expect(title).toMatch(/needs? an account/);
    expect(ACCOUNT_GATE_BODY).toMatch(/Signing in is free/);
    expect(ACCOUNT_GATE_BODY).toMatch(/chatting needs no account/);
    expect(ACCOUNT_PITCH).toMatch(/take your settings to any device/);
  });

  it('never says, anywhere in the app, that building works signed out', () => {
    // Finding 10: the old line survived in Settings, a guide card, and Harbor
    // Lite's own persona after the gate shipped. Any wording of it fails here.
    const claims = [
      /building (?:need|needs|require|requires) no account/i,
      /building (?:works?|runs?) (?:signed out|without an account)/i,
      /chatting and building (?:need|work)/i,
      /(?:use|personal use) needs no account/i,
    ];
    const found: string[] = [];
    for (const file of sourceFiles()) {
      const text = readFileSync(file, 'utf8');
      for (const claim of claims) {
        const hit = text.match(claim);
        if (hit) found.push(`${file.slice(process.cwd().length + 1)}: ${hit[0]}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('mounts the sheet with the sign-in card inside it', () => {
    expect(read('src', 'App.tsx')).toMatch(/<AccountGateSheet \/>/);
    const sheet = read('src', 'components', 'AccountGateSheet.tsx');
    expect(sheet).toMatch(/<SignInCard \/>/);
    expect(sheet).toMatch(/Not now/);
  });
});

describe('where settings may go', () => {
  it('lets exactly eight plain preferences follow the person', () => {
    expect([...FOLLOWING_KEYS].sort()).toEqual(
      [
        'chainOfThought',
        'effort',
        'humanizeWriting',
        'noticeDownloads',
        'noticeReplies',
        'theme',
        'voiceRate',
        'voiceReplies',
      ].sort(),
    );
  });

  it('keeps prompts, work, addresses, keys, and consents on the device', () => {
    for (const k of [
      'heldFirstMessage',
      'projects',
      'crew',
      'daemon',
      'daemons',
      'byomModels',
      'currentConnections',
      'vaultPrivacy',
      'webSearchConsent',
      'insightsOptIn',
      'permissionMode',
      'terminalControl',
      'codemagicAccess',
      'deviceId',
      'onboarded',
      'harborReady',
    ] as const)
      expect(SETTINGS_REACH[k], k).toBe('device');
  });

  it('sends only the following keys this device has set', () => {
    const picked = pickPreferences(
      base({ theme: 'dark', chainOfThought: true, heldFirstMessage: { text: 'secret', at: 'x' } }),
    );
    expect(picked).toEqual({ theme: 'dark', chainOfThought: true });
  });

  it('applies nothing it does not recognize from the account', () => {
    expect(
      readPreferences({
        theme: 'neon',
        effort: 'high',
        voiceRate: 7,
        humanizeWriting: 'yes',
        chainOfThought: true,
        projects: [{ id: 'p' }],
      }),
    ).toEqual({ effort: 'high', chainOfThought: true });
    expect(readPreferencesRecord({ v: 2, at: 'now', prefs: {} })).toBeUndefined();
    expect(readPreferencesRecord('junk')).toBeUndefined();
  });

  it('lets the newer side win, and a new device take the account', () => {
    const remote = {
      v: 1 as const,
      at: '2026-09-27T10:00:00.000Z',
      prefs: { theme: 'dark' as const },
    };
    expect(syncDirection(base(), remote)).toBe('pull');
    expect(syncDirection(base({ prefsUpdatedAt: '2026-09-27T09:00:00.000Z' }), remote)).toBe(
      'pull',
    );
    expect(syncDirection(base({ prefsUpdatedAt: '2026-09-27T11:00:00.000Z' }), remote)).toBe(
      'push',
    );
    expect(syncDirection(base({ prefsUpdatedAt: remote.at }), remote)).toBe('none');
    // An account with nothing yet takes this device's only if it has some.
    expect(syncDirection(base(), undefined)).toBe('none');
    expect(syncDirection(base({ theme: 'light' }), undefined)).toBe('push');
  });

  it('never resets anything at launch for a signed-out person', () => {
    const store = read('src', 'state', 'store.ts');
    expect(store).not.toMatch(/resetSignedOut|signedOutReset/);
  });
});

describe('the store', () => {
  beforeEach(() => {
    mem.clear();
    sb.configured = true;
    sb.remote = undefined;
    sb.writes = [];
    sb.failRead = false;
    sb.deadRefresh = false;
    shell.desktop = false;
    shell.createSample = undefined;
    engine.built.length = 0;
    useApp.setState({
      authSession: undefined,
      accountGate: undefined,
      view: 'chat',
      viewTrail: [],
      toast: undefined,
      paywall: undefined,
      conversations: {},
      order: [],
      activeId: undefined,
      resumingId: undefined,
      settings: base(),
    });
  });

  it('opens the sign-in sheet instead of a gated room, and leaves chat where it was', () => {
    useApp.getState().setView('vault');
    const st = useApp.getState();
    expect(st.accountGate).toBe('vault');
    expect(st.view).toBe('chat');
  });

  it('lets the free rooms through signed out', () => {
    useApp.getState().setView('stack');
    expect(useApp.getState().view).toBe('stack');
    expect(useApp.getState().accountGate).toBeUndefined();
    useApp.getState().setView('settings');
    expect(useApp.getState().view).toBe('settings');
  });

  it('keeps the coding agent behind the sheet and opens no chat', async () => {
    useApp.setState({
      conversations: { code1: codingChat() },
      order: ['code1'],
      activeId: 'code1',
    });
    const id = await useApp.getState().newConversation({ kind: 'desktop' });
    expect(useApp.getState().accountGate).toBe('coding');
    // No chat opened, so the answer is nothing, never the chat already open.
    expect(id).toBeUndefined();
    expect(useApp.getState().order).toEqual(['code1']);
  });

  it('opens every room once signed in', () => {
    useApp.setState({ authSession: live() });
    useApp.getState().setView('vault');
    expect(useApp.getState().view).toBe('vault');
  });

  it('never gates a build that has no accounts', () => {
    sb.configured = false;
    useApp.getState().setView('projects');
    expect(useApp.getState().view).toBe('projects');
  });

  it('signing in from the sheet carries on to the room it was opened for', async () => {
    useApp.getState().setView('crew');
    expect(useApp.getState().accountGate).toBe('crew');
    await useApp.getState().signIn('a@b.c', 'pw');
    await tick();
    expect(useApp.getState().accountGate).toBeUndefined();
    expect(useApp.getState().view).toBe('crew');
  });

  it("brings the account's newer preferences to a device at sign-in", async () => {
    sb.remote = {
      v: 1,
      at: '2026-09-27T10:00:00.000Z',
      prefs: { theme: 'dark', chainOfThought: true },
    };
    await useApp.getState().signIn('a@b.c', 'pw');
    await vi.waitFor(() => expect(useApp.getState().settings.theme).toBe('dark'));
    expect(useApp.getState().settings.chainOfThought).toBe(true);
    expect(useApp.getState().settings.prefsUpdatedAt).toBe('2026-09-27T10:00:00.000Z');
  });

  it('sends a changed preference on while signed in, and only the allowlist', async () => {
    vi.useFakeTimers();
    try {
      useApp.setState({ authSession: live() });
      await useApp.getState().saveSettings({
        theme: 'light',
        heldFirstMessage: { text: 'my secret prompt', at: 'now' },
      });
      expect(useApp.getState().settings.prefsUpdatedAt).toBeDefined();
      await vi.advanceTimersByTimeAsync(2000);
      expect(sb.writes).toHaveLength(1);
      const sent = sb.writes[0] as { v: number; prefs: Record<string, unknown> };
      expect(sent.v).toBe(1);
      expect(sent.prefs).toEqual({ theme: 'light' });
      expect(JSON.stringify(sent)).not.toMatch(/secret prompt/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends nothing signed out, and keeps the change on the device', async () => {
    vi.useFakeTimers();
    try {
      await useApp.getState().saveSettings({ theme: 'dark' });
      await vi.advanceTimersByTimeAsync(2000);
      expect(sb.writes).toHaveLength(0);
      expect(useApp.getState().settings.theme).toBe('dark');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not stamp a change that is not a following preference', async () => {
    await useApp.getState().saveSettings({ libraryIntroSeen: true });
    expect(useApp.getState().settings.prefsUpdatedAt).toBeUndefined();
  });

  it('forgets a preference change still waiting to go when the session ends', async () => {
    vi.useFakeTimers();
    try {
      useApp.setState({ authSession: live() });
      await useApp.getState().saveSettings({ theme: 'dark' });
      const waiting = vi.getTimerCount();
      await useApp.getState().signOutAccount();
      expect(vi.getTimerCount()).toBe(waiting - 1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(sb.writes).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Finding 1: the gate lived only in setView and newConversation, so a coding
// chat reopened signed out rebuilt its session and sent. Every way to the
// engine now passes one door (state/gateOps.ts); reading stays free.
describe('one door to the coding agent', () => {
  beforeEach(() => {
    mem.clear();
    sb.configured = true;
    sb.remote = undefined;
    sb.writes = [];
    sb.failRead = false;
    sb.deadRefresh = false;
    shell.desktop = false;
    shell.createSample = undefined;
    engine.built.length = 0;
    useApp.setState({
      authSession: undefined,
      accountGate: undefined,
      view: 'chat',
      viewTrail: [],
      toast: undefined,
      paywall: undefined,
      conversations: { code1: codingChat() },
      order: ['code1'],
      activeId: undefined,
      resumingId: undefined,
      settings: base({ daemon: HUB }),
    });
  });

  it('reopens a coding chat signed out to read it, and drives nothing until sign-in', async () => {
    useApp.getState().openConversation('code1');
    await tick();
    // Reading is free: the chat is on screen, with no sheet and no session.
    expect(useApp.getState().activeId).toBe('code1');
    expect(useApp.getState().accountGate).toBeUndefined();
    expect(useApp.getState().resumingId).toBeUndefined();
    expect(useApp.getState().conversations.code1!.thread.items).toHaveLength(2);
    expect(engine.built).toHaveLength(0);

    // A send is kept on the chat, and the sheet opens.
    useApp.getState().send('now the footer');
    await tick();
    expect(engine.built).toHaveLength(0);
    expect(useApp.getState().accountGate).toBe('coding');
    expect(useApp.getState().conversations.code1!.pendingFirstMessage).toBe('now the footer');

    // Retry takes the same door.
    useApp.getState().closeAccountGate();
    useApp.getState().retryPending('code1');
    await tick();
    expect(engine.built).toHaveLength(0);
    expect(useApp.getState().accountGate).toBe('coding');

    // Signing in carries on: the session is built and the kept message goes.
    await useApp.getState().signIn('a@b.c', 'pw');
    await vi.waitFor(() => expect(engine.built[0]?.sent).toEqual(['now the footer']));
    expect(engine.built).toHaveLength(1);
    expect(useApp.getState().accountGate).toBeUndefined();
    expect(useApp.getState().conversations.code1!.pendingFirstMessage).toBeUndefined();
  });

  it('lets an attached coding session go at sign-out, so nothing typed after reaches it', async () => {
    // Its own chat, so no driver from another test is still attached to it.
    useApp.setState({
      authSession: live(),
      conversations: { code2: codingChat('code2') },
      order: ['code2'],
    });
    useApp.getState().openConversation('code2');
    await vi.waitFor(() => expect(engine.built).toHaveLength(1));
    await tick();
    await useApp.getState().signOutAccount();
    // The chat is still there to read, on its snapshot.
    expect(useApp.getState().conversations.code2!.thread.items).toHaveLength(2);
    expect(useApp.getState().conversations.code2!.thread.busy).toBe(false);
    useApp.getState().send('one more thing');
    await tick();
    expect(engine.built).toHaveLength(1);
    expect(engine.built[0]!.sent).toEqual([]);
    expect(useApp.getState().accountGate).toBe('coding');
    expect(useApp.getState().conversations.code2!.pendingFirstMessage).toBe('one more thing');
  });

  it('a sample tap signed out copies nothing and sends nothing anywhere', async () => {
    shell.desktop = true;
    const createSample = vi.fn(async () => ({ path: '/tmp/sample' }));
    shell.createSample = createSample;
    // A free chat is open: where the old code sent the sample prompt.
    const free: Conversation = { ...codingChat('free1'), source: { kind: 'stack' } };
    useApp.setState({ conversations: { free1: free }, order: ['free1'], activeId: 'free1' });
    await useApp.getState().trySampleProject();
    await tick();
    expect(createSample).not.toHaveBeenCalled();
    expect(useApp.getState().accountGate).toBe('coding');
    expect(useApp.getState().order).toEqual(['free1']);
    const after = useApp.getState().conversations.free1!;
    expect(after.pendingFirstMessage).toBeUndefined();
    expect(JSON.stringify(after.thread)).not.toContain(SAMPLE_PROMPT);
    expect(engine.built).toHaveLength(0);
  });

  it('the back arrow after a sign-out opens the sheet, never the Vault', async () => {
    useApp.setState({ authSession: live() });
    useApp.getState().setView('vault');
    useApp.getState().setView('settings');
    expect(useApp.getState().viewTrail).toEqual(['chat', 'vault']);
    await useApp.getState().signOutAccount();
    expect(useApp.getState().view).toBe('settings');
    useApp.getState().goBack();
    expect(useApp.getState().view).toBe('settings');
    expect(useApp.getState().accountGate).toBe('vault');
    // "Not now" spends the step: the next back goes on to chat.
    useApp.getState().closeAccountGate();
    useApp.getState().goBack();
    expect(useApp.getState().view).toBe('chat');
  });

  it('signing out in a room that needs an account lands on chat', async () => {
    useApp.setState({ authSession: live() });
    useApp.getState().setView('projects');
    useApp.getState().setView('vault');
    await useApp.getState().signOutAccount();
    expect(useApp.getState().view).toBe('chat');
    expect(useApp.getState().viewTrail).toEqual([]);
  });

  it('a sign-in that expires in Terminal lands on chat too', async () => {
    useApp.setState({ authSession: { ...live(), expiresAt: Date.now() - 1000 } });
    useApp.getState().setView('terminalroom');
    expect(useApp.getState().view).toBe('terminalroom');
    sb.deadRefresh = true;
    await useApp.getState().refreshEntitlement();
    expect(useApp.getState().authSession).toBeUndefined();
    expect(useApp.getState().view).toBe('chat');
  });
});

describe('the notice for people who used OpenShore before the gate', () => {
  beforeEach(() => {
    mem.clear();
    sb.configured = true;
    sb.remote = undefined;
    useApp.setState({
      authSession: undefined,
      accountGate: undefined,
      initStarted: false,
      ready: false,
      toast: undefined,
      conversations: {},
      order: [],
      activeId: undefined,
      settings: base(),
    });
  });

  it('reaches someone signed out whose only work is a vault folder, once', async () => {
    mem.set(SETTINGS_KEY, JSON.stringify(base({ gitosResources: [VAULT_FOLDER] })));
    await useApp.getState().init();
    expect(useApp.getState().toast).toBe(ACCOUNT_NOTICE);
    await vi.waitFor(() => expect(useApp.getState().settings.accountNoticeSeen).toBe(true));
  });

  it('never reaches someone who has signed in before', async () => {
    useApp.setState({ settings: base({ gitosResources: [VAULT_FOLDER] }) });
    await useApp.getState().signIn('a@b.c', 'pw');
    await vi.waitFor(() => expect(useApp.getState().settings.accountNoticeSeen).toBe(true));
    await useApp.getState().signOutAccount();
    useApp.setState({ initStarted: false, ready: false, toast: undefined });
    await useApp.getState().init();
    expect(useApp.getState().toast).not.toBe(ACCOUNT_NOTICE);
  });
});
