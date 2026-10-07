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

// The phone's own copy of the notice switches, as far as a test can see it.
const notices = vi.hoisted(() => ({ synced: [] as Array<Record<string, unknown>> }));
vi.mock('../src/lib/notices.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/notices.js')>()),
  syncNoticePrefs: async (prefs: Record<string, unknown>) => {
    notices.synced.push(prefs);
  },
}));

const sb = vi.hoisted(() => ({
  configured: true,
  remote: undefined as unknown,
  writes: [] as unknown[],
  failRead: false,
  deadRefresh: false,
  signOuts: [] as Array<{ token: string; scope: string }>,
  userId: 'u1',
}));
vi.mock('../src/lib/supabase.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/supabase.js')>();
  return {
    ...real,
    isConfigured: () => sb.configured,
    signInWithPassword: async () => live(),
    signOut: async (token: string, scope: string) => {
      sb.signOuts.push({ token, scope });
    },
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
  accountCopy,
  needsAccount,
} = await import('../src/lib/accountGate.js');
const {
  SETTINGS_REACH,
  FOLLOWING_KEYS,
  PREFS_RECORD_MAX_BYTES,
  mergePreferences,
  pickPreferences,
  readPreferences,
  readPreferencesRecord,
  recordBytes,
} = await import('../src/lib/settingsReach.js');
const { SIGNED_OUT_HERE, ownerPatch } = await import('../src/state/signinOps.js');
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
    user: { id: sb.userId, email: 'a@b.c' },
  };
}

type Record2 = { v: number; prefs: Record<string, { v: unknown; at: string }> };
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

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
  it('leaves exactly chat, the chat list, the Stack, Settings, and setup free', () => {
    const free = Object.entries(ROOM_ACCOUNT)
      .filter(([, f]) => f === null)
      .map(([v]) => v)
      .sort();
    // Stack Health left the list when it became part of Plus (founder,
    // 2026-09-30): buying needs an account.
    expect(free).toEqual(['chat', 'chats', 'onboarding', 'settings', 'stack']);
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

  // The account copy says only what is true for this build (CTO,
  // 2026-09-30): with the pay gates on, signing in never "opens" the Plus
  // rooms; with them off, nothing talks about buying.
  it('keeps the account copy true with the pay gates on and off', async () => {
    const { accountCopy } = await import('../src/lib/accountGate.js');
    const on = accountCopy(true);
    for (const line of [on.body, on.pitch, on.notice, on.signInSub]) {
      expect(line, line).not.toMatch(/opens? (building|Vault|Crew|pairing)/i);
      expect(line, line).not.toMatch(/\bto build\b/i);
    }
    expect(on.body).toMatch(/OpenShore Plus/);
    const off = accountCopy(false);
    for (const line of [off.body, off.pitch, off.notice, off.signInSub])
      expect(line, line).not.toMatch(/\bbuy|purchase|OpenShore Plus/i);
    // This suite runs with the gates off: the guide and Harbor Lite say
    // nothing about buying either.
    const { GUIDE_CARDS } = await import('../src/lib/guideCards.js');
    const account = GUIDE_CARDS.find((c) => c.id === 'account')!;
    expect(account.text).not.toMatch(/\bbuy|OpenShore Plus/i);
    const { HARBOR_MINI_PERSONA } = await import('../src/lib/harborMini.js');
    expect(HARBOR_MINI_PERSONA).not.toMatch(/OpenShore Plus/);
  });

  it('says what Plus holds in the guide and Harbor Lite once the gates are on', async () => {
    vi.stubEnv('VITE_PAY_GATES', '1');
    vi.resetModules();
    try {
      const { GUIDE_CARDS } = await import('../src/lib/guideCards.js');
      const account = GUIDE_CARDS.find((c) => c.id === 'account')!;
      expect(account.text).toMatch(/part of OpenShore Plus/);
      expect(account.text).not.toMatch(/opens building/);
      const { HARBOR_MINI_PERSONA } = await import('../src/lib/harborMini.js');
      expect(HARBOR_MINI_PERSONA).toMatch(/part of OpenShore Plus/);
      expect(HARBOR_MINI_PERSONA).not.toMatch(/stripe|on the web|checkout/i);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
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
    // D19 (founder, 2026-10-07): the pitch names the few that follow, never
    // "your settings", since the writing voice, the app icon, approvals, web
    // search and the vault stay on the device.
    expect(ACCOUNT_PITCH).toMatch(/take your theme and a few preferences to every device/);
    for (const pitch of [ACCOUNT_PITCH, accountCopy(true).pitch, accountCopy(false).pitch]) {
      expect(pitch, pitch).not.toMatch(/your settings/i);
      expect(pitch, pitch).toMatch(/Your chats stay on your devices\./);
    }
    // The theme it names is one of the keys that follow.
    expect(SETTINGS_REACH.theme).toBe('follows');
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

  // The theme follows a signed-in person (CMO, 2026-10-07), so Appearance
  // says so then, and says it stays here only while signed out.
  it('says Appearance follows a signed-in person, as the theme does', () => {
    expect(SETTINGS_REACH.theme).toBe('follows');
    expect(read('src', 'screens', 'SettingsScreen.tsx')).toContain(
      "sub={signedIn ? 'Follows you to every device you sign in on' : 'Stays on this device'}",
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
    // A newer shape than this build knows, and junk, are dropped whole.
    expect(readPreferencesRecord({ v: 3, prefs: {} })).toBeUndefined();
    expect(readPreferencesRecord({ v: 1, at: 'now', prefs: {} })).toBeUndefined();
    expect(readPreferencesRecord('junk')).toBeUndefined();
    // In a v: 2 record, each entry stands on its own shape.
    const at = '2026-09-28T10:00:00.000Z';
    expect(
      readPreferencesRecord({
        v: 2,
        prefs: {
          theme: { v: 'neon', at },
          effort: { v: 'low', at: 'yesterday' },
          chainOfThought: { v: true, at },
          voiceRate: 0.5,
          projects: { v: [{ id: 'p' }], at },
        },
      }),
    ).toEqual({ v: 2, prefs: { chainOfThought: { v: true, at } } });
  });

  it('reads a v: 1 record, its one time on every key', () => {
    const at = '2026-09-27T10:00:00.000Z';
    expect(
      readPreferencesRecord({ v: 1, at, prefs: { theme: 'dark', effort: 'low', junk: 1 } }),
    ).toEqual({ v: 2, prefs: { theme: { v: 'dark', at }, effort: { v: 'low', at } } });
  });

  it('lets the newer side of each key win, and a new device take the account', () => {
    const at = '2026-09-27T10:00:00.000Z';
    const remote = { v: 2 as const, prefs: { theme: { v: 'dark' as const, at } } };
    const stamped = (theme: 'light' | 'dark', when: string) =>
      base({ theme, prefsStamps: { theme: when } });
    // A new device takes the account's.
    expect(mergePreferences(base(), remote).patch).toMatchObject({ theme: 'dark' });
    // An older change here gives way; a newer one wins and is written back.
    expect(mergePreferences(stamped('light', '2026-09-27T09:00:00.000Z'), remote).patch).toEqual({
      theme: 'dark',
      prefsStamps: { theme: at },
      prefsUpdatedAt: undefined,
    });
    const newer = mergePreferences(stamped('light', '2026-09-27T11:00:00.000Z'), remote);
    expect(newer.patch).toBeUndefined();
    expect(newer.write).toBe(true);
    expect(newer.record.prefs.theme).toEqual({ v: 'light', at: '2026-09-27T11:00:00.000Z' });
    // The same on both sides: nothing to do either way.
    const same = mergePreferences(stamped('dark', at), remote);
    expect(same.write).toBe(false);
    expect(same.patch).toBeUndefined();
    // A value this device never stamped gives way to the account's.
    expect(mergePreferences(base({ theme: 'light' }), remote).patch).toMatchObject({
      theme: 'dark',
    });
    // An account with nothing yet takes this device's only if it has some.
    expect(mergePreferences(base(), undefined).write).toBe(false);
    const first = mergePreferences(base({ theme: 'light' }), undefined, Date.parse(at));
    expect(first.write).toBe(true);
    expect(first.record.prefs).toEqual({ theme: { v: 'light', at } });
  });

  it('keeps each key a device changed when two devices changed different ones', () => {
    const old = '2026-09-27T08:00:00.000Z';
    const both = { theme: old, effort: old };
    const laptop = base({ theme: 'dark', effort: 'high', prefsStamps: both });
    const phone = base({ theme: 'system', effort: 'low', prefsStamps: both });
    laptop.prefsStamps = { ...both, theme: '2026-09-27T10:00:00.000Z' };
    phone.prefsStamps = { ...both, effort: '2026-09-27T10:00:01.000Z' };
    // The laptop writes first; the phone merges onto what it wrote.
    const account = mergePreferences(laptop, undefined).record;
    const merged = mergePreferences(phone, account);
    expect(merged.record.prefs.theme?.v).toBe('dark');
    expect(merged.record.prefs.effort?.v).toBe('low');
    expect(merged.patch).toMatchObject({ theme: 'dark' });
    // The laptop's next read brings the phone's change, and loses nothing.
    expect(mergePreferences(laptop, merged.record).patch).toMatchObject({ effort: 'low' });
  });

  it('does not trust a time from the account more than five minutes ahead', () => {
    const now = Date.parse('2026-09-29T12:00:00.000Z');
    const ahead = new Date(now + 60 * 60_000).toISOString();
    const soon = new Date(now + 60_000).toISOString();
    const remote = {
      v: 2 as const,
      prefs: {
        theme: { v: 'dark' as const, at: ahead },
        effort: { v: 'low' as const, at: ahead },
        chainOfThought: { v: true, at: soon },
      },
    };
    const here = base({ theme: 'light', prefsStamps: { theme: '2026-09-29T11:00:00.000Z' } });
    const merged = mergePreferences(here, remote, now);
    // It never overrides a value here, and it is not applied here...
    expect(merged.record.prefs.theme).toEqual({ v: 'light', at: '2026-09-29T11:00:00.000Z' });
    expect(merged.patch).not.toHaveProperty('theme');
    expect(merged.patch).not.toHaveProperty('effort');
    // ...and with no value here, the account's entry is left as it is.
    expect(merged.record.prefs.effort).toEqual(remote.prefs.effort);
    // A clock a minute ahead is only a clock: that still counts.
    expect(merged.patch).toMatchObject({ chainOfThought: true });
  });

  it('writes a small record, and only the keys that follow', () => {
    const at = '2026-09-28T10:00:00.000Z';
    const all = base({
      theme: 'system',
      effort: 'medium',
      humanizeWriting: true,
      chainOfThought: false,
      noticeDownloads: true,
      noticeReplies: false,
      voiceReplies: true,
      voiceRate: 0.123456789,
      prefsStamps: Object.fromEntries(FOLLOWING_KEYS.map((k) => [k, at])),
      heldFirstMessage: { text: 'my secret prompt', at },
      projects: [],
    });
    const { record } = mergePreferences(all, {
      v: 2,
      prefs: { theme: { v: 'dark', at: '2026-09-28T09:00:00.000Z' } },
    });
    expect(Object.keys(record.prefs).sort()).toEqual([...FOLLOWING_KEYS].sort());
    expect(recordBytes(record)).toBeLessThan(PREFS_RECORD_MAX_BYTES);
    expect(JSON.stringify(record)).not.toMatch(/secret prompt/);
  });

  it('lets a different person signing in take their own account, not the last times', () => {
    const stamps = { theme: '2026-09-28T10:00:00.000Z' };
    expect(ownerPatch(base({ prefsOwner: 'u1', prefsStamps: stamps }), 'u1')).toBeUndefined();
    expect(ownerPatch(base({ prefsOwner: 'u1', prefsStamps: stamps }), 'u2')).toEqual({
      prefsOwner: 'u2',
      prefsStamps: undefined,
      prefsUpdatedAt: undefined,
    });
    // A device from an earlier build only learns whose it is.
    expect(ownerPatch(base({ prefsStamps: stamps }), 'u1')).toEqual({ prefsOwner: 'u1' });
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
    sb.signOuts = [];
    sb.userId = 'u1';
    notices.synced.length = 0;
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
    // A v: 1 record's one time stands for each of its keys.
    expect(useApp.getState().settings.prefsStamps).toEqual({
      theme: '2026-09-27T10:00:00.000Z',
      chainOfThought: '2026-09-27T10:00:00.000Z',
    });
  });

  it('sends a changed preference on while signed in, and only the allowlist', async () => {
    vi.useFakeTimers();
    try {
      useApp.setState({ authSession: live() });
      await useApp.getState().saveSettings({
        theme: 'light',
        heldFirstMessage: { text: 'my secret prompt', at: 'now' },
      });
      const at = useApp.getState().settings.prefsStamps?.theme;
      expect(at).toBeDefined();
      await vi.advanceTimersByTimeAsync(2000);
      expect(sb.writes).toHaveLength(1);
      const sent = sb.writes[0] as { v: number; prefs: Record<string, unknown> };
      expect(sent.v).toBe(2);
      expect(sent.prefs).toEqual({ theme: { v: 'light', at } });
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
    expect(useApp.getState().settings.prefsStamps).toBeUndefined();
  });

  it('hands a notice switch pulled from the account to the phone', async () => {
    sb.remote = {
      v: 2,
      prefs: { noticeDownloads: { v: false, at: '2026-09-28T10:00:00.000Z' } },
    };
    await useApp.getState().signIn('a@b.c', 'pw');
    await vi.waitFor(() => expect(useApp.getState().settings.noticeDownloads).toBe(false));
    // The native side reads its own copy on a background relaunch, with no
    // web layer to ask, so the pull reaches it too.
    expect(notices.synced.at(-1)).toMatchObject({ noticeDownloads: false });
  });

  it('a notice switch flipped in Settings reaches the phone once, through saveSettings', async () => {
    const before = notices.synced.length;
    await useApp.getState().saveSettings({ noticeDownloads: false });
    expect(notices.synced.length).toBe(before + 1);
    expect(notices.synced.at(-1)).toMatchObject({ noticeDownloads: false });
    // The Settings row leaves it to saveSettings (the cleanup package): a
    // second call there synced the same switch twice.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const screen = readFileSync(
      join(process.cwd(), 'src', 'screens', 'SettingsScreen.tsx'),
      'utf8',
    );
    expect(screen).not.toMatch(/syncNoticePrefs/);
  });

  it('keeps its own value over a time from the account far ahead of this clock', async () => {
    const ahead = new Date(Date.now() + 3_600_000).toISOString();
    const mine = minutesAgo(1);
    useApp.setState({
      settings: base({ theme: 'light', prefsOwner: 'u1', prefsStamps: { theme: mine } }),
    });
    sb.remote = { v: 2, prefs: { theme: { v: 'dark', at: ahead } } };
    await useApp.getState().signIn('a@b.c', 'pw');
    await vi.waitFor(() => expect(sb.writes).toHaveLength(1));
    expect(useApp.getState().settings.theme).toBe('light');
    expect((sb.remote as Record2).prefs.theme).toEqual({ v: 'light', at: mine });
  });

  it('writes the account only the keys that follow, and a small record', async () => {
    const at = '2026-09-28T10:00:00.000Z';
    sb.remote = {
      v: 2,
      padding: 'x'.repeat(10_000),
      prefs: {
        theme: { v: 'dark', at },
        projects: { v: [{ id: 'p', path: '/Users/me/secret' }], at },
        daemon: { v: HUB, at },
      },
    };
    vi.useFakeTimers();
    try {
      useApp.setState({
        authSession: live(),
        settings: base({ prefsOwner: 'u1', daemon: HUB, projects: [] }),
      });
      await useApp.getState().saveSettings({ effort: 'low', chainOfThought: true });
      await vi.advanceTimersByTimeAsync(2000);
      expect(sb.writes).toHaveLength(1);
      const written = sb.writes[0] as Record2;
      expect(Object.keys(written)).toEqual(['v', 'prefs']);
      expect(Object.keys(written.prefs).sort()).toEqual(['chainOfThought', 'effort', 'theme']);
      for (const k of Object.keys(written.prefs)) expect(FOLLOWING_KEYS).toContain(k);
      expect(recordBytes(written as never)).toBeLessThan(PREFS_RECORD_MAX_BYTES);
      expect(JSON.stringify(written)).not.toMatch(/secret|127\.0\.0\.1|tok-1/);
      // And the device took the account's theme on the way.
      expect(useApp.getState().settings.theme).toBe('dark');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a change saved while a pairing relinked the hub', async () => {
    // The pairing's save waits on the hub link; the theme's save lands in
    // that wait, and the pairing's must not write the older copy over it.
    const pairing = useApp
      .getState()
      .saveSettings({ daemon: { baseUrl: 'http://127.0.0.1:7', token: 'tok-7' } });
    await useApp.getState().saveSettings({ theme: 'dark' });
    await pairing;
    const saved = JSON.parse(mem.get(SETTINGS_KEY)!) as AppSettings;
    expect(saved.theme).toBe('dark');
    expect(saved.daemon?.baseUrl).toBe('http://127.0.0.1:7');
  });

  it('lets the next person to sign in here take their own preferences', async () => {
    // A device from before this build: it never recorded whose times these
    // are, so the sign-out records it.
    useApp.setState({
      authSession: live(),
      settings: base({ theme: 'dark', prefsStamps: { theme: minutesAgo(1) } }),
    });
    await useApp.getState().signOutAccount();
    expect(useApp.getState().settings.prefsOwner).toBe('u1');
    // Someone else signs in. Their account's theme is older than the last
    // person's change here, and still it is theirs that shows.
    sb.userId = 'u2';
    sb.remote = { v: 2, prefs: { theme: { v: 'light', at: minutesAgo(60) } } };
    await useApp.getState().signIn('x@y.z', 'pw');
    await vi.waitFor(() => expect(useApp.getState().settings.theme).toBe('light'));
    expect(useApp.getState().settings.prefsOwner).toBe('u2');
    expect(sb.writes).toHaveLength(0);
  });

  it('forgets a preference change still waiting to go when the session ends', async () => {
    vi.useFakeTimers();
    try {
      useApp.setState({ authSession: live() });
      await useApp.getState().saveSettings({ theme: 'dark' });
      const waiting = vi.getTimerCount();
      await useApp.getState().signOutAccount();
      // The push timer went (one less); the sign-out's toast set its own.
      expect(useApp.getState().toast).toBe(SIGNED_OUT_HERE);
      expect(vi.getTimerCount()).toBe(waiting - 1 + 1);
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

// Finding 16: the account's copy was one record with one time, so the device
// that wrote last took every key. Two real stores here, one account between
// them, each on its own debounced push.
describe('two devices on one account', () => {
  it('each keeps the preference the other changed in the same minute', async () => {
    mem.clear();
    sb.configured = true;
    sb.writes = [];
    sb.failRead = false;
    sb.userId = 'u1';
    vi.resetModules();
    const { useApp: phone } = await import('../src/state/store.js');
    const old = minutesAgo(60);
    const start = base({
      theme: 'system',
      effort: 'high',
      prefsOwner: 'u1',
      prefsStamps: { theme: old, effort: old },
    });
    sb.remote = {
      v: 2,
      prefs: { theme: { v: 'system', at: old }, effort: { v: 'high', at: old } },
    };
    useApp.setState({ authSession: live(), settings: start });
    phone.setState({ authSession: live(), settings: start });
    vi.useFakeTimers();
    try {
      // Half a second apart: the laptop changes the theme, the phone the effort.
      await useApp.getState().saveSettings({ theme: 'dark' });
      await vi.advanceTimersByTimeAsync(500);
      await phone.getState().saveSettings({ effort: 'low' });
      // The laptop's push goes first; the phone's merges onto it.
      await vi.advanceTimersByTimeAsync(1100);
      expect(sb.writes).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(sb.writes).toHaveLength(2);
      expect(phone.getState().settings.theme).toBe('dark');
      // The laptop's next sync (here, its next change) brings the phone's.
      await useApp.getState().saveSettings({ voiceReplies: true });
      await vi.advanceTimersByTimeAsync(2000);
      for (const device of [useApp, phone]) {
        expect(device.getState().settings.effort).toBe('low');
        expect(device.getState().settings.theme).toBe('dark');
      }
      const account = sb.remote as Record2;
      expect(account.prefs.theme?.v).toBe('dark');
      expect(account.prefs.effort?.v).toBe('low');
      expect(account.prefs.voiceReplies?.v).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
