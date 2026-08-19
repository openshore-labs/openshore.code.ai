// Store-level invariants that a refactor could silently break: an org never
// loses its last admin, saved chats land in a project (quick chats do not), and
// quick chats never reach disk. The platform storage + insights are mocked to
// an in-memory layer so the store runs in node.
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const { useApp } = await import('../src/state/store.js');
const CONVERSATIONS_KEY = 'oscode.conversations.v1';

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

describe('project bucketing and quick chats', () => {
  beforeEach(resetStore);

  it('a saved chat lands in the active project; a quick chat does not', async () => {
    const s = useApp.getState();
    const projectId = await s.createProject('Alpha');
    const savedId = await s.newConversation({ kind: 'mock' });
    const quickId = await s.newConversation({ kind: 'mock' }, { ephemeral: true });
    const convs = useApp.getState().conversations;
    expect(convs[savedId]!.projectId).toBe(projectId);
    expect(convs[quickId]!.projectId).toBeUndefined();
    expect(convs[quickId]!.ephemeral).toBe(true);
  });

  it('quick chats are never persisted', async () => {
    const s = useApp.getState();
    await s.createProject('Alpha');
    await s.newConversation({ kind: 'mock' }); // saved
    await s.newConversation({ kind: 'mock' }, { ephemeral: true }); // quick
    // Wait a tick for persistConversations (fire-and-forget).
    await new Promise((r) => setTimeout(r, 10));
    const persisted = JSON.parse(mem.get(CONVERSATIONS_KEY) ?? '{"order":[],"conversations":{}}');
    const kinds = Object.values(persisted.conversations as Record<string, { ephemeral?: boolean }>);
    expect(kinds.every((c) => !c.ephemeral)).toBe(true);
    expect(kinds.length).toBe(1);
  });

  it('opening a saved chat prunes a lingering quick chat', async () => {
    const s = useApp.getState();
    await s.createProject('Alpha');
    const savedId = await s.newConversation({ kind: 'mock' });
    const quickId = await s.quickChat();
    expect(useApp.getState().conversations[quickId]).toBeDefined();
    s.openConversation(savedId);
    expect(useApp.getState().conversations[quickId]).toBeUndefined();
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
