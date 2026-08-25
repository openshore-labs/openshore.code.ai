// Vault data-safety invariants at the store level: a failed provider write
// never loses the typed text (it is stashed and replayed), a failed list shows
// an offline state rather than the first-run empty greeting, a note whose bytes
// are not downloaded yet is never opened as an empty editable note (which a
// keystroke would then save back as empty), and a freshly created note is
// written immediately so it cannot evaporate on back-out. The gitOS provider is
// mocked so its read/write/list can be forced to fail on demand.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredFile, StoredFileMeta } from '../src/lib/gitos/providers.js';

const mem = new Map<string, string>();

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'web',
  isDesktop: () => false,
  isPhone: () => false,
  openExternal: () => {},
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

// A controllable in-memory provider. Each op can be flipped to throw to
// simulate an offline or token-expired cloud vault.
const files = new Map<string, string>();
const fail = { list: false, read: false, write: false };
let leaseHolder = 'me';
const mockProvider = {
  id: 'local' as const,
  label: 'Local',
  blurb: '',
  ready: true,
  async list(): Promise<StoredFileMeta[]> {
    if (fail.list) throw new Error('offline');
    return [...files.keys()].map((path) => ({
      path,
      updatedAt: 'x',
      size: files.get(path)!.length,
    }));
  },
  async stat(_r: string, path: string): Promise<StoredFileMeta | undefined> {
    return files.has(path) ? { path, updatedAt: 'x', size: files.get(path)!.length } : undefined;
  },
  async read(_r: string, path: string): Promise<StoredFile | undefined> {
    if (fail.read) throw new Error('offline');
    const text = files.get(path);
    return text === undefined ? undefined : { path, text, updatedAt: 'x' };
  },
  async write(_r: string, path: string, text: string): Promise<StoredFile> {
    if (fail.write) throw new Error('offline');
    files.set(path, text);
    return { path, text, updatedAt: 'x' };
  },
  async remove(_r: string, path: string): Promise<void> {
    files.delete(path);
  },
  async acquireLease(_r: string, holder: string) {
    // A foreign holder keeps its lease; otherwise the caller takes it.
    if (leaseHolder !== 'me' && leaseHolder !== holder) {
      return { holder: leaseHolder, expiresAt: new Date(Date.now() + 90_000).toISOString() };
    }
    leaseHolder = holder;
    return { holder, expiresAt: new Date(Date.now() + 90_000).toISOString() };
  },
  async releaseLease() {
    leaseHolder = 'me';
  },
};

vi.mock('../src/lib/gitos/index.js', () => ({
  providerFor: (id: string) => (id === 'local' ? mockProvider : undefined),
  probeReady: async () => true,
  connectGdrive: async () => ({ ok: true }),
  disconnectGdrive: async () => {},
  setOrgVaultAuth: () => {},
  resetOrgVault: () => {},
}));

const { useApp } = await import('../src/state/store.js');

function reset() {
  mem.clear();
  files.clear();
  fail.list = fail.read = fail.write = false;
  leaseHolder = 'me';
  useApp.setState({
    settings: {
      onboarded: true,
      claudeModel: 'x',
      deviceModels: {},
      gitosResources: [],
      deviceId: 'this-device',
    },
    vaultScope: 'personal',
    vaultFiles: [],
    vaultNote: undefined,
    vaultError: undefined,
    vaultLeaseHeldByOther: undefined,
  });
}

describe('vault data safety', () => {
  beforeEach(reset);

  it('creates a note by writing an empty file immediately (does not evaporate)', async () => {
    await useApp.getState().vaultCreate('ideas/first');
    expect(files.has('ideas/first.md')).toBe(true);
    expect(useApp.getState().vaultNote?.path).toBe('ideas/first.md');
    expect(useApp.getState().vaultNote?.fresh).toBe(true);
    expect(useApp.getState().vaultFiles.some((f) => f.path === 'ideas/first.md')).toBe(true);
  });

  it('stashes and replays a draft when the provider write fails', async () => {
    await useApp.getState().vaultCreate('note');
    fail.write = true;
    await useApp.getState().vaultSave('note.md', 'precious words');
    // The failed write did not reach the provider, but the draft is not lost.
    expect(files.get('note.md')).toBe('');
    expect(useApp.getState().vaultError).toBe('save');
    // The provider recovers; the next successful save replays the stash.
    fail.write = false;
    await useApp.getState().vaultSave('note.md', 'precious words');
    expect(files.get('note.md')).toBe('precious words');
    expect(useApp.getState().vaultError).toBeUndefined();
  });

  it('replays a stranded draft on the next successful refresh', async () => {
    await useApp.getState().vaultCreate('note');
    fail.write = true;
    await useApp.getState().vaultSave('note.md', 'typed offline');
    expect(files.get('note.md')).toBe('');
    fail.write = false;
    await useApp.getState().vaultRefresh();
    expect(files.get('note.md')).toBe('typed offline');
  });

  it('shows an offline load error, not an empty vault, when list fails', async () => {
    await useApp.getState().vaultCreate('a');
    await useApp.getState().vaultRefresh();
    const before = useApp.getState().vaultFiles.length;
    expect(before).toBeGreaterThan(0);
    fail.list = true;
    await useApp.getState().vaultRefresh();
    expect(useApp.getState().vaultError).toBe('load');
    // The last-known file list is preserved rather than cleared to empty.
    expect(useApp.getState().vaultFiles.length).toBe(before);
  });

  it('never opens an undownloaded known note as an empty editable note', async () => {
    // The file is listed in the vault, but its bytes are not present (an iCloud
    // placeholder). read() returning undefined for a known path must not turn
    // into a blank note that a keystroke saves back as empty.
    useApp.setState({ vaultFiles: [{ path: 'synced.md', updatedAt: 'x', size: 10 }] });
    // files map does NOT contain 'synced.md' body, so read() returns undefined.
    await useApp.getState().vaultOpen('synced.md');
    expect(useApp.getState().vaultNote).toBeUndefined();
  });

  it('opens a genuinely new (unlisted) path as a fresh empty note', async () => {
    await useApp.getState().vaultOpen('brand-new');
    expect(useApp.getState().vaultNote?.path).toBe('brand-new.md');
    expect(useApp.getState().vaultNote?.text).toBe('');
  });

  it('flags the vault read-only when another device holds the lease (FD-3)', async () => {
    // A foreign device already holds a live lease.
    leaseHolder = 'other-device';
    await useApp.getState().vaultAcquireLease();
    expect(useApp.getState().vaultLeaseHeldByOther).toBe(true);
    // When it releases, this device can take the lease and edit again.
    leaseHolder = 'me';
    await useApp.getState().vaultAcquireLease();
    expect(useApp.getState().vaultLeaseHeldByOther).toBe(false);
  });

  it('does not lease the team vault (server resolves concurrency)', async () => {
    leaseHolder = 'other-device';
    useApp.setState({ vaultScope: 'team' });
    await useApp.getState().vaultAcquireLease();
    expect(useApp.getState().vaultLeaseHeldByOther).toBe(false);
  });

  it('drops a stashed draft when its note is deleted (no resurrection)', async () => {
    await useApp.getState().vaultCreate('doomed');
    fail.write = true;
    await useApp.getState().vaultSave('doomed.md', 'about to be deleted');
    fail.write = false;
    await useApp.getState().vaultDelete('doomed.md');
    // Nothing should replay the deleted note back into existence.
    await useApp.getState().vaultRefresh();
    expect(files.has('doomed.md')).toBe(false);
  });
});
