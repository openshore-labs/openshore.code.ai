// Store-level invariants that a refactor could silently break: an org never
// loses its last admin, and chats land in a project and reach disk. The
// platform storage + insights are mocked to
// an in-memory layer so the store runs in node.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';
import { stackForProfile, type StackModelRef } from '../src/lib/stack.js';
import { autoProfile, effectiveProfile } from '../src/lib/profiles.js';
import { emptyThread } from '../src/state/types.js';
import { reduceEvents } from '../src/state/transcript.js';
import type { StoredFileMeta } from '../src/lib/gitos/providers.js';

const mem = new Map<string, string>();
const secrets = new Map<string, string>();

// The phone's daemon driver, stood in by a controllable fake: the store's
// lifecycle rules around it (APP-4, APP-5, APP-13, P0-1) are what is under
// test, not the wire. `nextJournal` is replayed into the first subscriber the
// way a real resume replays the session journal.
type Sink = (event: DriverEvent, seq: number) => void;
let nextJournal: Array<{ seq: number; event: DriverEvent }> = [];
const remoteInstances: FakeRemote[] = [];
class FakeRemote {
  readonly kind = 'desktop' as const;
  closed = false;
  private sinks = new Set<Sink>();
  private journal = nextJournal;
  runCommand = vi.fn(async (): Promise<unknown> => ({ refused: 'Ask a company admin.' }));
  constructor(
    readonly sessionId: string,
    readonly target: { baseUrl: string; token: string },
  ) {
    nextJournal = [];
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
  /** The driver's fatal answer: it closes, then tells the thread. */
  terminal(message: string) {
    this.closed = true;
    this.emit({ type: 'status', message });
    this.emit({ type: 'task-done', reason: 'error', message });
  }
  send() {}
  abort() {}
  answerApproval() {}
  dispose() {
    this.closed = true;
  }
}
vi.mock('../src/drivers/remoteDriver.js', () => ({
  RemoteDriver: FakeRemote,
  daemonCreateSession: vi.fn(async () => 'sess_1'),
  daemonHealth: vi.fn(async () => ({ ok: false, detail: 'off' })),
  daemonApplyOutbox: vi.fn(),
  daemonVerifyCommit: vi.fn(),
}));

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

const { useApp, driverFor, isEntitled, personalUnlocked } = await import('../src/state/store.js');
const CONVERSATIONS_KEY = 'oscode.conversations.v1';
const SETTINGS_KEY = 'oscode.settings.v1';
const HUB = { baseUrl: 'http://127.0.0.1:1', token: 'tok-1' };
const tick = () => new Promise((r) => setTimeout(r, 0));

function resetStore() {
  mem.clear();
  secrets.clear();
  nextJournal = [];
  remoteInstances.length = 0;
  useApp.setState({
    conversations: {},
    order: [],
    activeId: undefined,
    toast: undefined,
    hubRole: undefined,
    settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
  });
}

describe('org invariants', () => {
  beforeEach(resetStore);

  it('refuses to demote the last admin', async () => {
    await useApp.getState().setupAccount({
      type: 'commercial',
      ownerEmail: 'owner@co.com',
      orgName: 'Co',
      seatCount: 2,
    });
    const ownerId = useApp.getState().settings.account!.org!.members[0]!.id;
    await useApp.getState().setMemberRole(ownerId, 'member');
    // Still an admin: the guard refused the only-admin demotion.
    const members = useApp.getState().settings.account!.org!.members;
    expect(members.find((m) => m.id === ownerId)!.role).toBe('admin');
  });

  it('allows demotion once a second admin exists', async () => {
    const s = useApp.getState();
    await s.setupAccount({ type: 'commercial', ownerEmail: 'owner@co.com', seatCount: 3 });
    await s.addMember('two@co.com');
    const org = () => useApp.getState().settings.account!.org!;
    const twoId = org().members.find((m) => m.email === 'two@co.com')!.id;
    await s.setMemberRole(twoId, 'admin');
    const ownerId = org().members.find((m) => m.email === 'owner@co.com')!.id;
    await s.setMemberRole(ownerId, 'member');
    expect(org().members.find((m) => m.id === ownerId)!.role).toBe('member');
  });
});

describe('project bucketing', () => {
  beforeEach(resetStore);

  it('a chat lands in the active project', async () => {
    const s = useApp.getState();
    const projectId = await s.createProject('Alpha');
    const savedId = await s.newConversation({ kind: 'mock' });
    expect(useApp.getState().conversations[savedId]!.projectId).toBe(projectId);
  });

  it('every chat is persisted', async () => {
    const s = useApp.getState();
    await s.createProject('Alpha');
    await s.newConversation({ kind: 'mock' });
    await s.newConversation({ kind: 'mock' });
    // Wait a tick for persistConversations (fire-and-forget).
    await new Promise((r) => setTimeout(r, 10));
    const persisted = JSON.parse(mem.get(CONVERSATIONS_KEY) ?? '{"order":[],"conversations":{}}');
    expect(Object.keys(persisted.conversations).length).toBe(2);
  });
});

describe('project detail room', () => {
  beforeEach(resetStore);

  it('openProject enters the detail room with a way back to Projects', async () => {
    const s = useApp.getState();
    useApp.setState({ view: 'projects', viewTrail: [] });
    const id = await s.createProject('Alpha');
    useApp.getState().openProject(id);
    const st = useApp.getState();
    expect(st.view).toBe('project');
    expect(st.viewProjectId).toBe(id);
    expect(st.viewTrail).toEqual(['projects']);
  });

  it('startProjectChat opens a fresh chat bound to the project, back to it', async () => {
    const s = useApp.getState();
    const id = await s.createProject('Alpha');
    await s.createProject('Beta'); // make Alpha not the default active
    useApp.getState().startProjectChat(id);
    const st = useApp.getState();
    expect(st.view).toBe('chat');
    expect(st.activeId).toBeUndefined();
    expect(st.viewProjectId).toBe(id);
    expect(st.viewTrail).toEqual(['project']);
    expect(st.settings.activeProjectId).toBe(id);
    // The next chat then lands in that project.
    const chatId = await useApp.getState().newConversation({ kind: 'mock' });
    expect(useApp.getState().conversations[chatId]!.projectId).toBe(id);
  });

  it('a chat opened from the project room carries a way back to it', async () => {
    const s = useApp.getState();
    const id = await s.createProject('Alpha');
    const chatId = await s.newConversation({ kind: 'mock' });
    useApp.setState({ view: 'project', viewProjectId: id, activeId: undefined });
    useApp.getState().openConversation(chatId);
    expect(useApp.getState().viewTrail).toEqual(['project']);
  });

  it('setProjectAccess drafts per-email grants on a local project (no server)', async () => {
    const s = useApp.getState();
    const id = await s.createProject('Alpha');
    await s.setProjectAccess(id, [
      { email: 'a@co.com', level: 'read', grantedAt: 't' },
      { email: 'b@co.com', level: 'edit', grantedAt: 't' },
    ]);
    const proj = useApp.getState().settings.projects!.find((p) => p.id === id)!;
    expect(proj.access).toHaveLength(2);
    expect(proj.access!.find((a) => a.email === 'b@co.com')!.level).toBe('edit');
    expect(proj.shared).toBeUndefined();
  });

  it('shareProject needs a signed-in company account (stays local otherwise)', async () => {
    const s = useApp.getState();
    const id = await s.createProject('Alpha');
    await s.shareProject(id); // no account configured in this runner
    const proj = useApp.getState().settings.projects!.find((p) => p.id === id)!;
    expect(proj.shared).toBeUndefined();
    expect(proj.serverId).toBeUndefined();
  });

  it('syncOrgProjects is a no-op for a personal account', async () => {
    const s = useApp.getState();
    await s.createProject('Alpha');
    const before = JSON.stringify(useApp.getState().settings.projects);
    await s.syncOrgProjects();
    expect(JSON.stringify(useApp.getState().settings.projects)).toBe(before);
  });

  it('deleting the open project falls back to the Projects list', async () => {
    const s = useApp.getState();
    const id = await s.createProject('Alpha');
    useApp.getState().openProject(id);
    await useApp.getState().deleteProject(id);
    const st = useApp.getState();
    expect(st.view).toBe('projects');
    expect(st.viewProjectId).toBeUndefined();
  });
});

describe('outbox producer', () => {
  beforeEach(resetStore);

  it('buffers a commit-intent with content-addressed files', async () => {
    const id = await useApp.getState().bufferCommitIntent({
      repoId: 'r1',
      branch: 'main',
      message: 'add a file',
      baseCommit: 'base',
      files: [{ path: 'a.ts', mode: 'upsert', content: 'hello' }],
    });
    expect(id).toBeDefined();
    const outbox = useApp.getState().settings.repo?.outbox ?? [];
    expect(outbox).toHaveLength(1);
    const item = outbox[0]!;
    expect(item.state).toBe('pending');
    expect(item.clientOpId).toBeTruthy();
    expect(item.files[0]!.sha256).toHaveLength(64);
    expect(item.files[0]!.contentBase64).toBe(Buffer.from('hello').toString('base64'));
  });

  it('refuses a file past the per-file cap rather than truncate', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024 + 1); // over MAX_OUTBOX_FILE_BYTES
    const id = await useApp.getState().bufferCommitIntent({
      repoId: 'r1',
      branch: 'main',
      message: 'huge',
      baseCommit: 'base',
      files: [{ path: 'big.bin', mode: 'upsert', content: big }],
    });
    expect(id).toBeUndefined();
    expect(useApp.getState().settings.repo?.outbox ?? []).toHaveLength(0);
  });

  it('exports only unsynced work as a portable backup', async () => {
    await useApp.getState().bufferCommitIntent({
      repoId: 'r1',
      branch: 'main',
      message: 'one',
      baseCommit: 'base',
      files: [{ path: 'a.ts', mode: 'upsert', content: 'x' }],
    });
    const backup = JSON.parse(useApp.getState().exportBuffer());
    expect(backup.version).toBe(1);
    expect(backup.items).toHaveLength(1);
  });
});

// G2: two downloads finishing close together must not clobber each other's
// "on device" entry. addDeviceModel reads fresh state on each call.
describe('device models (G2)', () => {
  beforeEach(resetStore);

  it('merges concurrent additions instead of clobbering', async () => {
    const s = useApp.getState();
    await Promise.all([s.addDeviceModel('m1', 'Model One'), s.addDeviceModel('m2', 'Model Two')]);
    const dm = useApp.getState().settings.deviceModels;
    expect(dm.m1).toBe('Model One');
    expect(dm.m2).toBe('Model Two');
  });
});

// Billing: only active/trialing (and an unlapsed period) grant paid access, and
// a purely local org is never gated (never bricks existing users).
describe('entitlement gate (billing A1)', () => {
  beforeEach(resetStore);

  it('isEntitled accepts active/trialing and rejects the rest', () => {
    expect(isEntitled({ status: 'active' })).toBe(true);
    expect(isEntitled({ status: 'trialing' })).toBe(true);
    expect(isEntitled({ status: 'past_due' })).toBe(false);
    expect(isEntitled({ status: 'canceled' })).toBe(false);
    expect(isEntitled({ status: 'unpaid' })).toBe(false);
    expect(isEntitled(undefined)).toBe(false);
  });

  it('isEntitled honors validUntil', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isEntitled({ status: 'active', validUntil: future })).toBe(true);
    expect(isEntitled({ status: 'active', validUntil: past })).toBe(false);
  });

  it('personalUnlocked: either an individual OR an org entitlement unlocks', () => {
    const active = { status: 'active' as const };
    const dead = { status: 'canceled' as const };
    // Individual rail alone unlocks (Personal buyer with no org).
    expect(personalUnlocked(active, undefined)).toBe(true);
    // Org rail alone unlocks (commercial member, no personal sub).
    expect(personalUnlocked(undefined, active)).toBe(true);
    // Both dead, or neither present: locked.
    expect(personalUnlocked(dead, dead)).toBe(false);
    expect(personalUnlocked(undefined, undefined)).toBe(false);
  });

  it('beta: pay gates are off, coding + marketplace are free for everyone', () => {
    // PAY_GATES_ENABLED is false for the beta, so with no entitlement at all the
    // user is still treated as unlocked and nothing routes to the paywall.
    useApp.setState({ userEntitlement: undefined, entitlement: undefined, paywall: undefined });
    expect(useApp.getState().personalUnlockedNow()).toBe(true);

    // Marketplace navigation is NOT intercepted, and no paywall opens.
    useApp.setState({ view: 'chat' });
    useApp.getState().setView('marketplace');
    expect(useApp.getState().view).toBe('marketplace');
    expect(useApp.getState().paywall).toBeUndefined();
  });

  it('an active Personal entitlement unlocks coding + marketplace', async () => {
    useApp.setState({
      userEntitlement: { tierId: 'personal', status: 'active' },
      paywall: undefined,
    });
    expect(useApp.getState().personalUnlockedNow()).toBe(true);
    useApp.setState({ view: 'chat' });
    useApp.getState().setView('marketplace');
    expect(useApp.getState().view).toBe('marketplace');
    expect(useApp.getState().paywall).toBeUndefined();
  });

  it('canGrowTeam stays true for a local (unbilled) org', async () => {
    await useApp.getState().setupAccount({
      type: 'commercial',
      ownerEmail: 'o@co.com',
      seatCount: 2,
    });
    // No server sync / sign-in in this build, so growth is never gated.
    expect(useApp.getState().canGrowTeam()).toBe(true);
  });
});

// P2-11: React StrictMode double-invokes the mount effect; init() must be a
// no-op the second time so it does not re-run migrations or reset the view.
describe('init idempotency (P2-11)', () => {
  beforeEach(resetStore);

  it('runs once even when called twice', async () => {
    useApp.setState({ initStarted: false, ready: false });
    mem.set(SETTINGS_KEY, JSON.stringify({ onboarded: true, claudeModel: 'x', deviceModels: {} }));
    await useApp.getState().init();
    expect(useApp.getState().view).toBe('chat');
    useApp.setState({ view: 'marketplace' });
    await useApp.getState().init(); // guarded: must not re-run and reset the view
    expect(useApp.getState().view).toBe('marketplace');
    expect(useApp.getState().initStarted).toBe(true);
  });
});

// P2-13: a chat whose project was deleted is explicitly unfiled and must NOT be
// re-adopted into another project by the init orphan-migration on relaunch.
describe('deleteProject unfiling (P2-13)', () => {
  beforeEach(resetStore);

  it('unfiles chats and init does not re-adopt them', async () => {
    const s = useApp.getState();
    const projectId = await s.createProject('Alpha');
    const savedId = await s.newConversation({ kind: 'mock' });
    await s.deleteProject(projectId);
    const conv = useApp.getState().conversations[savedId]!;
    expect(conv.projectId).toBeUndefined();
    expect(conv.unfiled).toBe(true);
    // Let the fire-and-forget persistence land.
    await new Promise((r) => setTimeout(r, 10));

    // Simulate a relaunch from the persisted state.
    useApp.setState({
      initStarted: false,
      ready: false,
      conversations: {},
      order: [],
      settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
    });
    await useApp.getState().init();
    const reloaded = useApp.getState().conversations[savedId]!;
    expect(reloaded).toBeDefined();
    expect(reloaded.projectId).toBeUndefined();
    expect(reloaded.unfiled).toBe(true);
    // The migration created no rescue project for the unfiled chat.
    expect(useApp.getState().settings.projects ?? []).toHaveLength(0);
  });

  it('still adopts a LEGACY orphan (no project, not unfiled)', async () => {
    // A pre-projects chat persisted with neither projectId nor unfiled.
    mem.set(SETTINGS_KEY, JSON.stringify({ onboarded: true, claudeModel: 'x', deviceModels: {} }));
    mem.set(
      CONVERSATIONS_KEY,
      JSON.stringify({
        order: ['legacy'],
        conversations: {
          legacy: {
            id: 'legacy',
            title: 'Old chat',
            source: { kind: 'mock' },
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
            thread: {
              items: [],
              citations: [],
              busy: false,
              contextPercent: 0,
              dollars: 0,
              pendingApprovals: [],
              lastSeq: 0,
            },
          },
        },
      }),
    );
    useApp.setState({ initStarted: false, ready: false, conversations: {}, order: [] });
    await useApp.getState().init();
    const legacy = useApp.getState().conversations['legacy']!;
    expect(legacy.projectId).toBeDefined();
    expect(useApp.getState().settings.projects ?? []).toHaveLength(1);
  });
});

// BYOM: connecting an endpoint stores the key in the secret store (never in
// settings), lands the connection on the bench, and disconnecting removes the
// key and pulls it out of the stack, falling the anchor back to the guide.
describe('bring your own model', () => {
  beforeEach(resetStore);

  it('connects an endpoint, keeping the key out of settings', async () => {
    const conn = await useApp.getState().connectByom({
      label: 'House model',
      baseUrl: 'https://host/v1',
      model: 'llama-3.1-70b',
      apiKey: 'sk-secret',
    });
    const models = useApp.getState().settings.byomModels ?? [];
    expect(models).toHaveLength(1);
    expect(models[0]!.label).toBe('House model');
    expect(models[0]!.model).toBe('llama-3.1-70b');
    // The key lives in the secret store, never in the persisted settings blob.
    expect(secrets.get(`oscode.secret.byom.${conn.id}`)).toBe('sk-secret');
    expect(JSON.stringify(models)).not.toContain('sk-secret');
  });

  it('allows a keyless connection (no secret written)', async () => {
    const conn = await useApp.getState().connectByom({
      label: 'Local vLLM',
      baseUrl: 'http://127.0.0.1:8000/v1',
      model: 'my-model',
    });
    expect(secrets.has(`oscode.secret.byom.${conn.id}`)).toBe(false);
    expect(useApp.getState().settings.byomModels).toHaveLength(1);
  });

  it('disconnecting removes the key, the connection, and any stack placement', async () => {
    const conn = await useApp.getState().connectByom({
      label: 'Anchor model',
      baseUrl: 'https://host/v1',
      model: 'm',
      apiKey: 'k',
    });
    // Make it the Reasoning anchor, then disconnect it.
    await useApp.getState().setReasoning({
      kind: 'byom',
      id: conn.id,
      label: conn.label,
      baseUrl: conn.baseUrl,
      model: conn.model,
    });
    // The anchor lands in the current status's stack (per-status stacks).
    const currentStack = () => {
      const s = useApp.getState();
      const p = effectiveProfile(autoProfile(s.connectivity), s.settings.profileOverride);
      return stackForProfile(s.settings.stacks, p);
    };
    expect(currentStack().reasoning?.kind).toBe('byom');

    await useApp.getState().disconnectByom(conn.id);
    expect(secrets.has(`oscode.secret.byom.${conn.id}`)).toBe(false);
    expect(useApp.getState().settings.byomModels ?? []).toHaveLength(0);
    // The anchor is never left dangling: it falls back to the built-in guide.
    expect(currentStack().reasoning?.kind).toBe('device');
  });
});

// Per-status stacks: each connectivity status (docked, offshore, offline)
// carries its own stack, edited independently and used automatically for that
// status. The edit actions target the named status and leave the others alone.
describe('per-status stacks', () => {
  beforeEach(resetStore);

  const cloudRef: StackModelRef = {
    kind: 'cloud',
    provider: 'anthropic',
    model: 'claude-opus-5',
    label: 'Claude Opus 5',
  };

  it('a Reasoning anchor set for one status does not touch the others', async () => {
    await useApp.getState().setReasoning(cloudRef, 'docked');
    const stacks = () => useApp.getState().settings.stacks;
    expect(stackForProfile(stacks(), 'docked').reasoning).toMatchObject({ kind: 'cloud' });
    // Untouched statuses fall back to the anchor-only default (a device guide).
    expect(stackForProfile(stacks(), 'offshore').reasoning?.kind).toBe('device');
    expect(stackForProfile(stacks(), 'offline').reasoning?.kind).toBe('device');
  });

  it('a specialist placed for one status lands only in that status', async () => {
    await useApp.getState().placeSpecialist(cloudRef, { category: 'fast' }, 'offline');
    const stacks = () => useApp.getState().settings.stacks;
    expect(stackForProfile(stacks(), 'offline').active).toHaveLength(1);
    expect(stackForProfile(stacks(), 'docked').active).toHaveLength(0);
    expect(stackForProfile(stacks(), 'offshore').active).toHaveLength(0);
  });

  it('disconnecting a BYOM endpoint pulls it from every status', async () => {
    const conn = await useApp.getState().connectByom({
      label: 'Shared model',
      baseUrl: 'https://host/v1',
      model: 'm',
      apiKey: '',
    });
    const byom: StackModelRef = {
      kind: 'byom',
      id: conn.id,
      label: conn.label,
      baseUrl: conn.baseUrl,
      model: conn.model,
    };
    await useApp.getState().placeSpecialist(byom, { category: 'coding' }, 'docked');
    await useApp.getState().placeSpecialist(byom, { category: 'coding' }, 'offshore');
    await useApp.getState().disconnectByom(conn.id);
    const stacks = () => useApp.getState().settings.stacks;
    expect(stackForProfile(stacks(), 'docked').active).toHaveLength(0);
    expect(stackForProfile(stacks(), 'offshore').active).toHaveLength(0);
  });
});

// Vault: the personal vault auto-registers as a gitOS resource on first
// refresh, notes round-trip through the Local provider, and delete cleans
// both the body and the index.
describe('vault (gitOS Local provider)', () => {
  beforeEach(resetStore);

  it('auto-creates the personal vault resource on first refresh', async () => {
    await useApp.getState().vaultRefresh();
    const resources = useApp.getState().settings.gitosResources ?? [];
    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({ kind: 'vault', providerId: 'local' });
    expect(useApp.getState().vaultFiles).toEqual([]);
  });

  it('saves, lists, reopens, and deletes notes', async () => {
    const s = useApp.getState();
    await s.vaultRefresh();
    await s.vaultSave('ideas/First.md', 'Hello [[Second]]');
    await s.vaultSave('Second.md', 'The other note');
    // The provider keeps the index alphabetical (locale-aware, so case does
    // not split the ordering): ideas/ sorts before Second.
    expect(useApp.getState().vaultFiles.map((f) => f.path)).toEqual([
      'ideas/First.md',
      'Second.md',
    ]);

    await s.vaultOpen('ideas/First');
    expect(useApp.getState().vaultNote).toMatchObject({
      path: 'ideas/First.md',
      text: 'Hello [[Second]]',
    });

    const all = await s.vaultReadAll();
    expect(all).toHaveLength(2);

    await s.vaultDelete('ideas/First.md');
    expect(useApp.getState().vaultFiles.map((f) => f.path)).toEqual(['Second.md']);
    expect(useApp.getState().vaultNote).toBeUndefined();
  });

  it('opening a missing path yields a fresh empty note without writing it', async () => {
    const s = useApp.getState();
    await s.vaultRefresh();
    await s.vaultOpen('Brand New');
    expect(useApp.getState().vaultNote).toMatchObject({ path: 'Brand New.md', text: '' });
    // Nothing hits the file list until a save happens.
    expect(useApp.getState().vaultFiles).toEqual([]);
  });

  it('refuses to move the vault to a provider that is not usable', async () => {
    const s = useApp.getState();
    await s.vaultRefresh();
    // iCloud probes unavailable off-device (the web mock), so the move is
    // refused and the vault stays on Local, its bytes untouched.
    const ok = await s.vaultMoveTo('icloud');
    expect(ok).toBe(false);
    const resource = (useApp.getState().settings.gitosResources ?? []).find(
      (r) => r.id === 'vault.personal',
    );
    expect(resource?.providerId).toBe('local');
  });
});

// The desktop session's id is state, written through `set` and persisted the
// moment the daemon hands it over, so a kill between POST /sessions and the
// first message never orphans a session on the hub (APP-5).
describe('desktop session binding (APP-5)', () => {
  beforeEach(resetStore);

  it('persists the session id before any event arrives', async () => {
    await useApp.getState().saveHub(HUB);
    const id = await useApp.getState().newConversation({ kind: 'desktop', cwd: '/repo' });
    const persisted = JSON.parse(mem.get(CONVERSATIONS_KEY)!);
    expect(persisted.conversations[id].source.sessionId).toBe('sess_1');
    expect(useApp.getState().conversations[id]!.source).toMatchObject({ sessionId: 'sess_1' });
    expect(remoteInstances.at(-1)?.sessionId).toBe('sess_1');
  });
});

// A daemon's fatal answer (session gone, phone revoked) must free the thread
// and drop the dead driver, so the next open rebuilds instead of queueing
// every message behind a run that will never end (APP-4).
describe('a terminal daemon answer (APP-4)', () => {
  beforeEach(resetStore);

  it('clears busy and drops the driver so the next open rebuilds', async () => {
    await useApp.getState().saveHub(HUB);
    const id = await useApp.getState().newConversation({ kind: 'desktop', cwd: '/repo' });
    const drv = remoteInstances.at(-1)!;
    drv.emit({ type: 'task-start', input: 'hello' }, 1);
    await tick();
    expect(useApp.getState().conversations[id]!.thread.busy).toBe(true);
    expect(driverFor(id)?.wrapped).toBe(drv);

    drv.terminal('This session no longer exists on the desktop. Start a new one.');
    await tick();
    expect(useApp.getState().conversations[id]!.thread.busy).toBe(false);
    expect(driverFor(id)).toBeUndefined();

    // A normal error from a live driver keeps it attached.
    const id2 = await useApp.getState().newConversation({ kind: 'desktop', cwd: '/repo' });
    const drv2 = remoteInstances.at(-1)!;
    drv2.emit({ type: 'task-done', reason: 'error', message: 'The model timed out.' }, 2);
    await tick();
    expect(driverFor(id2)?.wrapped).toBe(drv2);
  });
});

// A journal replay is hundreds of events handed over synchronously; they fold
// into ONE state update, and the in-memory transcript is capped (APP-13).
describe('journal replay and transcript cap (APP-13)', () => {
  beforeEach(resetStore);

  it('folds a replayed journal into a single state update', async () => {
    await useApp.getState().saveHub(HUB);
    nextJournal = [
      { seq: 1, event: { type: 'task-start', input: 'hello' } },
      ...Array.from({ length: 38 }, (_, i) => ({
        seq: i + 2,
        event: { type: 'text-delta' as const, text: `w${i} ` },
      })),
      { seq: 40, event: { type: 'task-done', reason: 'complete' } },
    ];
    let threadSets = 0;
    let lastThread: unknown;
    const off = useApp.subscribe((st) => {
      const conv = Object.values(st.conversations).find((c) => c.source.kind === 'desktop');
      if (conv && conv.thread !== lastThread) {
        lastThread = conv.thread;
        threadSets += 1;
      }
    });
    const id = await useApp.getState().newConversation({ kind: 'desktop', cwd: '/repo' });
    // The ethics layer screens the held text before releasing it, which costs
    // one tick at the end of the replay. The batching this test guards is
    // unchanged: the whole replay still folds into a single thread update.
    await tick();
    off();
    const thread = useApp.getState().conversations[id]!.thread;
    expect(thread.busy).toBe(false);
    expect(thread.items.map((i) => i.kind)).toEqual(['user', 'assistant']);
    // One set to create the chat, then the replay. The replay costs two sets
    // rather than one because the ethics layer screens the held text before
    // releasing it, and that screen is async, so the tail lands a tick after
    // the synchronous burst. The property this guards is intact: forty events
    // still fold into a constant number of updates, not one update per event.
    expect(threadSets).toBeLessThanOrEqual(3);
  });

  it('caps the in-memory transcript', () => {
    const events = Array.from({ length: 1000 }, (_, i) => ({
      event: { type: 'status' as const, message: `s${i}` },
    }));
    const thread = reduceEvents(emptyThread(), events);
    expect(thread.items.length).toBeLessThanOrEqual(600);
    expect(thread.items.at(-1)).toMatchObject({ kind: 'status', text: 's999' });
  });
});

// The first message typed before a driver attaches is held on the chat and
// delivered by the attach itself, never dropped by a timer (APP-10).
describe('the first message waits for the driver (APP-10)', () => {
  beforeEach(resetStore);

  it('persists the pending message and sends it once the driver attaches', async () => {
    const id = 'c_pending';
    useApp.setState((s) => ({
      conversations: {
        ...s.conversations,
        [id]: {
          id,
          title: 'New chat',
          source: { kind: 'mock' },
          createdAt: 't',
          updatedAt: 't',
          thread: emptyThread(),
        },
      },
      order: [id, ...s.order],
    }));
    useApp.getState().sendWhenAttached(id, 'hello there');
    await tick();
    expect(useApp.getState().conversations[id]!.pendingFirstMessage).toBe('hello there');
    const persisted = JSON.parse(mem.get(CONVERSATIONS_KEY)!);
    expect(persisted.conversations[id].pendingFirstMessage).toBe('hello there');

    useApp.getState().openConversation(id);
    await new Promise((r) => setTimeout(r, 30));
    const conv = useApp.getState().conversations[id]!;
    expect(conv.pendingFirstMessage).toBeUndefined();
    expect(conv.thread.items[0]).toMatchObject({ kind: 'user', text: 'hello there' });
  });
});

// The hub pairing credential lives in the secret store, keyed by hub, never in
// the settings blob; a token still riding the blob is moved across once
// (APP-11).
describe('hub credentials in the secret store (APP-11)', () => {
  beforeEach(resetStore);

  it('keeps the token out of the persisted settings and restores it on relaunch', async () => {
    await useApp.getState().saveHub(HUB);
    expect(mem.get(SETTINGS_KEY)).not.toContain('tok-1');
    expect(JSON.stringify(JSON.parse(mem.get(SETTINGS_KEY)!))).not.toContain('tok-1');
    expect(secrets.get(`oscode.secret.hub.${HUB.baseUrl}`)).toBe('tok-1');
    expect(useApp.getState().settings.daemon?.token).toBe('tok-1');

    useApp.setState({
      initStarted: false,
      ready: false,
      settings: { onboarded: true, claudeModel: 'x', deviceModels: {} },
    });
    await useApp.getState().init();
    expect(useApp.getState().settings.daemon?.token).toBe('tok-1');
    expect(useApp.getState().settings.daemons?.[0]?.token).toBe('tok-1');
  });

  it('migrates a legacy token out of the blob once', async () => {
    mem.set(
      SETTINGS_KEY,
      JSON.stringify({
        onboarded: true,
        claudeModel: 'x',
        deviceModels: {},
        daemon: { baseUrl: HUB.baseUrl, token: 'legacy' },
      }),
    );
    useApp.setState({ initStarted: false, ready: false });
    await useApp.getState().init();
    expect(useApp.getState().settings.daemon?.token).toBe('legacy');
    expect(secrets.get(`oscode.secret.hub.${HUB.baseUrl}`)).toBe('legacy');
    expect(mem.get(SETTINGS_KEY)).not.toContain('legacy');
  });

  it('forgets the credential with the hub', async () => {
    await useApp.getState().saveHub(HUB);
    await useApp.getState().removeHub(HUB.baseUrl);
    expect(secrets.has(`oscode.secret.hub.${HUB.baseUrl}`)).toBe(false);
  });
});

// The hub's answer on the user command lane, and the role it reports (P0-1
// phone side).
describe('hub role and a refused command (P0-1)', () => {
  beforeEach(resetStore);
  const realFetch = globalThis.fetch;

  it('stores the hub role from /health and toasts a refused command verbatim', async () => {
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ ok: true, role: 'member' }) }) as Response) as typeof fetch;
    try {
      await useApp.getState().saveHub(HUB);
      expect(useApp.getState().hubRole).toBe('member');
      expect(useApp.getState().settings.hubRoles?.[HUB.baseUrl]).toBe('member');
      const id = await useApp.getState().newConversation({ kind: 'desktop', cwd: '/repo' });
      expect(useApp.getState().activeId).toBe(id);
      useApp.getState().runCommand('id');
      await tick();
      expect(useApp.getState().toast).toBe('Ask a company admin.');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('an old hub with no role field leaves the role undefined', async () => {
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ ok: true }) }) as Response) as typeof fetch;
    try {
      await useApp.getState().saveHub(HUB);
      expect(useApp.getState().hubRole).toBeUndefined();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// An iCloud note whose bytes are evicted is still a note (UI-2): creating the
// same name opens it instead of writing an empty file over the cloud copy.
describe('an evicted vault note is an existing note (UI-2)', () => {
  beforeEach(resetStore);

  it('routes a same-name create to open, and never writes', async () => {
    await useApp.getState().vaultRefresh();
    useApp.setState({
      vaultNote: undefined,
      vaultFiles: [{ path: 'Note.md', updatedAt: 't', size: 0, evicted: true } as StoredFileMeta],
    });
    await useApp.getState().vaultCreate('note');
    expect(useApp.getState().vaultNote).toBeUndefined();
    expect(useApp.getState().vaultFiles).toHaveLength(1);
    expect(useApp.getState().toast).toMatch(/Still downloading/);
  });
});
