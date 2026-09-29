// Accounts (founder + CX, 2026-09-27; docs/accounts-cx-memo.md): chatting needs
// no account, everything else is behind a free sign-in, nothing resets for a
// signed-out person, and signing in is worth something because a short list
// of preferences follows the person to every device they sign in on. Pure
// rules first, then the store against a mocked Supabase.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'web',
  isDesktop: () => false,
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
}));
vi.mock('../src/lib/supabase.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/supabase.js')>();
  return {
    ...real,
    isConfigured: () => sb.configured,
    signInWithPassword: async () => live(),
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

const { ROOM_ACCOUNT, ACCOUNT_GATE_TITLE, ACCOUNT_GATE_BODY, ACCOUNT_PITCH, needsAccount } =
  await import('../src/lib/accountGate.js');
const {
  SETTINGS_REACH,
  FOLLOWING_KEYS,
  pickPreferences,
  readPreferences,
  readPreferencesRecord,
  syncDirection,
} = await import('../src/lib/settingsReach.js');
const { useApp } = await import('../src/state/store.js');
type Session = import('../src/lib/supabase.js').Session;
type AppSettings = import('../src/state/store.js').AppSettings;

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
    // The old line said building needed no account; it is gone everywhere.
    for (const f of [
      ['src', 'components', 'SignInCard.tsx'],
      ['src', 'lib', 'egressManifest.ts'],
    ])
      expect(read(...f)).not.toMatch(/Chatting and building need no account/);
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
    useApp.setState({
      authSession: undefined,
      accountGate: undefined,
      view: 'chat',
      viewTrail: [],
      toast: undefined,
      paywall: undefined,
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
    const id = await useApp.getState().newConversation({ kind: 'desktop' });
    expect(useApp.getState().accountGate).toBe('coding');
    expect(id).toBe('');
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
});
