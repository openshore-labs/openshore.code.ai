// Store-level invariants that a refactor could silently break: an org never
// loses its last admin, and chats land in a project and reach disk. The
// platform storage + insights are mocked to
// an in-memory layer so the store runs in node.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stackForProfile, type StackModelRef } from '../src/lib/stack.js';
import { autoProfile, effectiveProfile } from '../src/lib/profiles.js';

const mem = new Map<string, string>();
const secrets = new Map<string, string>();

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'web',
  isDesktop: () => false,
  isPhone: () => false,
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

const { useApp, isEntitled, personalUnlocked } = await import('../src/state/store.js');
const CONVERSATIONS_KEY = 'oscode.conversations.v1';
const SETTINGS_KEY = 'oscode.settings.v1';

function resetStore() {
  mem.clear();
  secrets.clear();
  useApp.setState({
    conversations: {},
    order: [],
    activeId: undefined,
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

  it('setProjectAccess stores per-email grants on the project', async () => {
    const s = useApp.getState();
    const id = await s.createProject('Alpha');
    await s.setProjectAccess(id, [
      { email: 'a@co.com', level: 'read', grantedAt: 't' },
      { email: 'b@co.com', level: 'edit', grantedAt: 't' },
    ]);
    const proj = useApp.getState().settings.projects!.find((p) => p.id === id)!;
    expect(proj.access).toHaveLength(2);
    expect(proj.access!.find((a) => a.email === 'b@co.com')!.level).toBe('edit');
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
