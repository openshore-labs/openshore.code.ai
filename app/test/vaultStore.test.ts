// Vault data-safety invariants at the store level: a failed provider write
// never loses the typed text (it is stashed and replayed, or held when retrying
// cannot help), saves to one note never race each other, a stale stash never
// replays over newer work or onto another provider, a failed list shows an
// offline state rather than the first-run empty greeting, a note whose bytes
// are not downloaded yet is never opened as an empty editable note (which a
// keystroke would then save back as empty), a create never truncates a note
// the list has not caught up with, notes open and delete by their exact listed
// path, a vault move never drops a note and names every fork, a scheduled save
// keeps the vault it was scheduled for, team text belongs to the account that
// typed it (a sign-out forgets it, an expiry keeps it for the same person), and
// a Google Drive vault is read-only. The personal providers are in-memory fakes
// whose ops can be forced to fail; the team vault is the real provider over a
// fake Supabase, and the auth cases run the store's own token getter.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredFile, StoredFileMeta } from '../src/lib/gitos/providers.js';
import { isNotePath } from '../src/lib/gitos/providers.js';
import { backlinksTo, normalizeNotePath } from '../src/lib/vault.js';

const mem = new Map<string, string>();
// Sealed-store keys whose writes throw, as a full localStorage quota would.
const failKeys = new Set<string>();
// Sealed-store keys this launch cannot open (P0-3, a locked device key): they
// read as absent, a write over them does nothing, and a delete still deletes,
// the way platform.ts behaves.
const lockedKeys = new Set<string>();

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'web',
  isDesktop: () => false,
  isPhone: () => false,
  openExternal: () => {},
  dataUnlockState: async () => 'ok',
  storeGetJson: async (k: string) => {
    if (lockedKeys.has(k)) return undefined;
    const v = mem.get(k);
    return v ? JSON.parse(v) : undefined;
  },
  storeSetJson: async (k: string, v: unknown) => {
    if (failKeys.has(k)) throw new Error('QuotaExceededError');
    if (lockedKeys.has(k) && mem.has(k)) return;
    mem.set(k, JSON.stringify(v));
  },
  storeGet: async (k: string) => (lockedKeys.has(k) ? null : (mem.get(k) ?? null)),
  storeSet: async (k: string, v: string) => {
    if (lockedKeys.has(k) && mem.has(k)) return;
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
// simulate an offline or token-expired cloud vault; `evicted` paths list as
// iCloud placeholders whose bytes are not here; `failPaths` fail to read;
// `hideFromList` paths are written but not listed (a copy that did not land);
// `writesLeft` lets that many writes through and fails the rest.
// Every write, by the store or by a test standing in for another writer,
// takes a fresh version, so two texts of the same length never share one.
let clock = 0;
class VersionedFiles extends Map<string, string> {
  readonly versions = new Map<string, string>();
  override set(path: string, text: string) {
    super.set(path, text);
    this.versions.set(path, `v${++clock}`);
    return this;
  }
  override delete(path: string) {
    this.versions.delete(path);
    return super.delete(path);
  }
  override clear() {
    this.versions.clear();
    super.clear();
  }
}
function makeProvider(id: string) {
  const files = new VersionedFiles();
  const evicted = new Set<string>();
  const failPaths = new Set<string>();
  const hideFromList = new Set<string>();
  const fail = { list: false, read: false, write: false, stat: false, remove: false };
  const limits = { writesLeft: undefined as number | undefined };
  const counts = { reads: 0 };
  const version = (path: string) => files.versions.get(path)!;
  // updatedAt changes with every write, so the body cache invalidates on edit.
  const meta = (path: string): StoredFileMeta =>
    evicted.has(path)
      ? { path, updatedAt: 'cloud', size: 10, evicted: true }
      : { path, updatedAt: version(path), size: files.get(path)!.length };
  const provider = {
    id,
    label: id,
    blurb: '',
    ready: true,
    async list(): Promise<StoredFileMeta[]> {
      if (fail.list) throw new Error('offline');
      return [...new Set([...files.keys(), ...evicted])]
        .filter((p) => !hideFromList.has(p))
        .map(meta);
    },
    async stat(_r: string, path: string): Promise<StoredFileMeta | undefined> {
      if (fail.stat) throw new Error('offline');
      return files.has(path) || evicted.has(path) ? meta(path) : undefined;
    },
    async read(_r: string, path: string): Promise<StoredFile | undefined> {
      if (fail.read || failPaths.has(path)) throw new Error('offline');
      counts.reads++;
      if (evicted.has(path)) return undefined;
      const text = files.get(path);
      return text === undefined ? undefined : { path, text, updatedAt: version(path) };
    },
    async write(_r: string, path: string, text: string): Promise<StoredFile> {
      if (fail.write) throw new Error('offline');
      if (limits.writesLeft !== undefined && limits.writesLeft-- <= 0) throw new Error('disk full');
      files.set(path, text);
      return { path, text, updatedAt: version(path) };
    },
    async remove(_r: string, path: string): Promise<void> {
      if (fail.remove) throw new Error('offline');
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
  const reset = () => {
    files.clear();
    evicted.clear();
    failPaths.clear();
    hideFromList.clear();
    Object.assign(fail, { list: false, read: false, write: false, stat: false, remove: false });
    limits.writesLeft = undefined;
    counts.reads = 0;
  };
  return {
    provider,
    files,
    evicted,
    failPaths,
    hideFromList,
    fail,
    limits,
    counts,
    version,
    reset,
  };
}

let leaseHolder = 'me';
const local = makeProvider('local');
const folder = makeProvider('files');
const drive = makeProvider('gdrive');
const byId: Record<string, ReturnType<typeof makeProvider>> = {
  local,
  files: folder,
  gdrive: drive,
};
// The personal vault's default provider, under the names the older cases use.
const files = local.files;
const fail = local.fail;

// The team vault: the real provider, over a fake Supabase that keeps one org's
// rows in memory. `teamNet.fail` makes every request throw; `beforePut` runs
// ahead of each org_vault_put (hold it, or throw); `puts` records what each
// one sent. Like org_vault_put, a write whose base is not the note's rev sets
// the existing body aside as a conflict copy first.
const ORG = 'org-1';
const team = new Map<string, { body: string; rev: number }>();
const teamNet = {
  fail: undefined as Error | undefined,
  beforePut: undefined as ((args: Record<string, unknown>) => Promise<void>) | undefined,
  puts: [] as Array<{ token: string; path: string; body: string; base: number }>,
};
let teamToken: string | undefined = 'tok';
// The account the fake auth server hands out: refreshSession answers with
// `refresh` (or throws it), and signInWithPassword signs in `nextUser`.
const auth = {
  refresh: undefined as Error | undefined,
  nextUser: { id: 'u1', email: 'me@example.com' },
};
const session = (user = auth.nextUser, ttl = 3_600_000) => ({
  accessToken: `tok-${user.id}`,
  refreshToken: `r-${user.id}`,
  expiresAt: Date.now() + ttl,
  user,
});
// The store's own team-token getter, captured when init() registers it, and
// the real provider module, so a case can run the store's getter end to end.
const wiring = vi.hoisted(() => ({
  storeToken: undefined as (() => Promise<string | undefined>) | undefined,
  org: undefined as typeof import('../src/lib/gitos/orgVault.js') | undefined,
}));

vi.mock('../src/lib/supabase.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/supabase.js')>();
  const row = (path: string) => {
    const r = team.get(path)!;
    return { path, body: r.body, updated_at: `r${r.rev}`, rev: r.rev, size: r.body.length };
  };
  return {
    ...actual,
    isConfigured: () => true,
    select: async (table: string, _token: string, query: string) => {
      if (teamNet.fail) throw teamNet.fail;
      // An active member of ORG; no org to pull, no projects, no entitlement.
      if (table === 'org_members' && query.startsWith('select=role')) {
        return [{ role: 'member', status: 'active' }];
      }
      if (table !== 'org_vault_notes') return [];
      const m = /path=eq\.([^&]+)/.exec(query);
      const only = m ? (JSON.parse(decodeURIComponent(m[1]!)) as string) : undefined;
      return [...team.keys()].filter((p) => only === undefined || p === only).map(row);
    },
    rpc: async (fn: string, token: string, args: Record<string, unknown>) => {
      if (!fn.startsWith('org_vault_')) return null;
      if (teamNet.fail) throw teamNet.fail;
      const path = args.p_path as string;
      if (fn === 'org_vault_delete') {
        team.delete(path);
        return null;
      }
      await teamNet.beforePut?.(args);
      const body = args.p_body as string;
      const base = args.p_base_rev as number;
      teamNet.puts.push({ token, path, body, base });
      const prev = team.get(path);
      if (prev && prev.rev !== base && prev.body !== body) {
        team.set(path.replace(/\.md$/, ' (conflict server).md'), { body: prev.body, rev: 1 });
      }
      team.set(path, { body, rev: (prev?.rev ?? 0) + 1 });
      return row(path);
    },
    refreshSession: async (refreshToken: string) => {
      if (auth.refresh) throw auth.refresh;
      const id = refreshToken.replace(/^r-/, '');
      return session({ id, email: `${id}@example.com` });
    },
    signInWithPassword: async () => session(),
    signOut: async () => {},
  };
});

vi.mock('../src/lib/gitos/index.js', async () => {
  const providers = await vi.importActual<typeof import('../src/lib/gitos/providers.js')>(
    '../src/lib/gitos/providers.js',
  );
  const org = await vi.importActual<typeof import('../src/lib/gitos/orgVault.js')>(
    '../src/lib/gitos/orgVault.js',
  );
  wiring.org = org;
  org.setOrgVaultAuth(
    async () => teamToken,
    () => true,
  );
  return {
    isNotePath: providers.isNotePath,
    providerFor: (id: string) => (id === 'org' ? org.orgVaultProvider : byId[id]?.provider),
    probeReady: async () => true,
    connectGdrive: async () => ({ ok: true }),
    disconnectGdrive: async () => {},
    setOrgVaultAuth: (token: () => Promise<string | undefined>) => {
      wiring.storeToken = token;
    },
    resetOrgVault: org.resetOrgVault,
    orgVaultBaseRev: org.orgVaultBaseRev,
    seedOrgVaultBaseRev: org.seedOrgVaultBaseRev,
  };
});

const { useApp } = await import('../src/state/store.js');
const { SupabaseRequestError } = await import('../src/lib/supabase.js');

// init() registers the store's own team-token getter (captured above).
await useApp.getState().init();

const PENDING = 'oscode.vault.pending';
const HELD = 'oscode.vault.held';
const pending = () =>
  (mem.has(PENDING) ? JSON.parse(mem.get(PENDING)!) : {}) as Record<
    string,
    { providerId: string; resourceId: string; path: string; text: string; base?: string }
  >;
const personalOn = (providerId: string) => [
  { id: 'vault.personal', name: 'Vault', kind: 'vault' as const, providerId, createdAt: 'x' },
];
const conflictCopy = (base: string) =>
  new RegExp(
    `^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(conflict \\d{4}-\\d{2}-\\d{2} \\d{4}( \\d+)?\\)\\.md$`,
  );

function reset() {
  mem.clear();
  failKeys.clear();
  lockedKeys.clear();
  for (const p of Object.values(byId)) p.reset();
  team.clear();
  teamNet.fail = undefined;
  teamNet.beforePut = undefined;
  teamNet.puts = [];
  teamToken = 'tok';
  auth.refresh = undefined;
  auth.nextUser = { id: 'u1', email: 'me@example.com' };
  wiring.org!.setOrgVaultAuth(
    async () => teamToken,
    () => true,
  );
  leaseHolder = 'me';
  useApp.setState({
    settings: {
      onboarded: true,
      claudeModel: 'x',
      deviceModels: {},
      gitosResources: [],
      deviceId: 'this-device',
    },
    authSession: undefined,
    vaultScope: 'personal',
    vaultFiles: [],
    vaultNote: undefined,
    vaultError: undefined,
    vaultHeld: [],
    vaultLeaseHeldByOther: undefined,
    toast: undefined,
  });
}

// Signed in as a member of ORG, with the team vault on screen.
function teamScope(user = auth.nextUser) {
  const st = useApp.getState();
  useApp.setState({
    vaultScope: 'team',
    vaultFiles: [],
    vaultNote: undefined,
    authSession: session(user),
    settings: {
      ...st.settings,
      account: {
        type: 'commercial',
        org: {
          id: 'o',
          name: 'Acme',
          seatCount: 2,
          tierId: 'micro',
          priceYear: 0,
          members: [],
          createdAt: 'x',
          serverId: ORG,
        },
      },
    } as typeof st.settings,
  });
}

// The team vault runs on the store's own token getter (the one init()
// registered), not the fixed test token, so a case sees what a refresh does.
function useStoreToken() {
  wiring.org!.setOrgVaultAuth(wiring.storeToken!, () => true);
}
const tick = () => new Promise((r) => setTimeout(r, 0));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
const teamHeld = () => useApp.getState().vaultHeld.filter((h) => h.providerId === 'org');

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

  it('caches note bodies so a second read pass re-reads only changed files (R-8)', async () => {
    await useApp.getState().vaultCreate('a');
    await useApp.getState().vaultCreate('b');
    await useApp.getState().vaultRefresh();
    local.counts.reads = 0;
    await useApp.getState().vaultReadAll();
    expect(local.counts.reads).toBe(2); // cold: both bodies read
    local.counts.reads = 0;
    await useApp.getState().vaultReadAll();
    expect(local.counts.reads).toBe(0); // warm: nothing changed, no re-reads
    // Editing one note invalidates only that entry.
    await useApp.getState().vaultSave('a.md', 'changed body');
    local.counts.reads = 0;
    await useApp.getState().vaultReadAll();
    expect(local.counts.reads).toBe(0); // the save primed the cache for 'a'
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

// 0.1: each stash entry names its provider, its resource, and the provider's
// version the text was typed against, so a replay can never put older words
// over newer ones or land on a different provider.
describe('a stale draft never replays over a newer save (0.1)', () => {
  beforeEach(reset);

  it('a newer save is not clobbered by its own stale stash', async () => {
    await useApp.getState().vaultCreate('note');
    fail.write = true;
    await useApp.getState().vaultSave('note.md', 'old words typed offline');
    fail.write = false;
    await useApp.getState().vaultSave('note.md', 'old words typed offline, then newer words');
    expect(files.get('note.md')).toBe('old words typed offline, then newer words');
    // The save cleared its own stale stash before any replay: replaying it
    // would have kept both, so a stray conflict copy is the tell.
    expect([...files.keys()]).toEqual(['note.md']);
    // The superseded stash is gone, so a later refresh cannot replay it either.
    expect(pending()).toEqual({});
    await useApp.getState().vaultRefresh();
    expect(files.get('note.md')).toBe('old words typed offline, then newer words');
    expect(useApp.getState().vaultError).toBeUndefined();
  });

  it("records the provider's version the text was typed against, never a device clock", async () => {
    await useApp.getState().vaultCreate('note');
    const typedAgainst = local.version('note.md');
    fail.write = true;
    await useApp.getState().vaultSave('note.md', 'typed offline');
    expect(Object.values(pending())).toEqual([
      expect.objectContaining({
        providerId: 'local',
        resourceId: 'vault.personal',
        path: 'note.md',
        base: typedAgainst,
      }),
    ]);
    // A note the provider does not hold yet has no version to record.
    fail.write = false;
    await useApp.getState().vaultOpen('unsaved');
    expect(useApp.getState().vaultNote).toMatchObject({ path: 'unsaved.md', updatedAt: '' });
    fail.write = true;
    await useApp.getState().vaultSave('unsaved.md', 'first words');
    expect(pending()['local::vault.personal::unsaved.md']).not.toHaveProperty('base');
  });

  it('a stale stash becomes a conflict copy, never an overwrite, and the person is told', async () => {
    await useApp.getState().vaultCreate('note');
    fail.write = true;
    await useApp.getState().vaultSave('note.md', 'my offline words');
    // Meanwhile the note changes elsewhere (the agent, Obsidian, a device).
    files.set('note.md', 'their newer words from elsewhere');
    fail.write = false;
    await useApp.getState().vaultRefresh();
    expect(files.get('note.md')).toBe('their newer words from elsewhere');
    const copy = [...files.keys()].find((p) => conflictCopy('note').test(p));
    expect(copy).toBeDefined();
    expect(files.get(copy!)).toBe('my offline words');
    // A name the app can open, link, and delete, and that lists as a note.
    expect(normalizeNotePath(copy!)).toBe(copy);
    expect(isNotePath(copy!)).toBe(true);
    expect(useApp.getState().vaultFiles.some((f) => f.path === copy)).toBe(true);
    expect(useApp.getState().toast).toMatch(/both are kept/);
    expect(pending()).toEqual({});
  });

  it('a second conflict copy in the same minute never lands on the first', async () => {
    const stale = async (mine: string, theirs: string) => {
      await useApp.getState().vaultOpen('note.md');
      fail.write = true;
      await useApp.getState().vaultSave('note.md', mine);
      files.set('note.md', theirs);
      fail.write = false;
      await useApp.getState().vaultRefresh();
    };
    files.set('note.md', 'v1');
    await useApp.getState().vaultRefresh();
    await stale('first offline words', 'second writer was here');
    await stale('second offline words, longer', 'third writer was here, too');
    const copies = [...files.keys()].filter((p) => conflictCopy('note').test(p));
    expect(copies).toHaveLength(2);
    expect(copies.map((p) => files.get(p)).sort()).toEqual([
      'first offline words',
      'second offline words, longer',
    ]);
  });

  it('a stash never replays onto another provider', async () => {
    await useApp.getState().vaultCreate('note');
    fail.write = true;
    await useApp.getState().vaultSave('note.md', 'typed against the local vault');
    fail.write = false;
    // The vault now points at a different provider (by any route).
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('files') },
    });
    await useApp.getState().vaultRefresh();
    expect(folder.files.has('note.md')).toBe(false);
    // The draft stays tied to the provider it was typed against.
    expect(Object.keys(pending())).toEqual(['local::vault.personal::note.md']);
  });

  it('an older save finishing late never deletes a newer stash', async () => {
    teamScope();
    team.set('plan.md', { body: 'start', rev: 1 });
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen('plan.md');
    // Save A hangs on a slow link; save B, typed on top of it, fails.
    const a = deferred();
    let n = 0;
    teamNet.beforePut = async () => {
      n++;
      if (n === 1) await a.promise;
      else if (n === 2) throw new TypeError('Failed to fetch');
    };
    const saveA = useApp.getState().vaultSave('plan.md', 'start A');
    const saveB = useApp.getState().vaultSave('plan.md', 'start A then B');
    await tick();
    a.resolve();
    await Promise.all([saveA, saveB]);
    // B's words wait for a retry, typed against the version A left.
    expect(pending()[`org::${ORG}::plan.md`]).toMatchObject({ text: 'start A then B', base: 'r2' });
    expect(useApp.getState().vaultError).toBe('save');
    teamNet.beforePut = undefined;
    await useApp.getState().vaultRefresh();
    expect(team.get('plan.md')?.body).toBe('start A then B');
    expect([...team.keys()]).toEqual(['plan.md']);
    expect(pending()).toEqual({});
  });

  it('overlapping saves never fork the note or blame another writer', async () => {
    teamScope();
    team.set('plan.md', { body: 'start', rev: 1 });
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen('plan.md');
    // Both saves are slow; A lands, then B fails.
    const a = deferred();
    const b = deferred();
    let n = 0;
    teamNet.beforePut = async () => {
      n++;
      if (n === 1) await a.promise;
      else if (n === 2) {
        await b.promise;
        throw new TypeError('Failed to fetch');
      }
    };
    const saveA = useApp.getState().vaultSave('plan.md', 'start A');
    const saveB = useApp.getState().vaultSave('plan.md', 'start A then B');
    await tick();
    a.resolve();
    await saveA;
    b.resolve();
    await saveB;
    teamNet.beforePut = undefined;
    await useApp.getState().vaultRefresh();
    // This device's own earlier save is not "elsewhere": B lands on the note.
    expect(team.get('plan.md')?.body).toBe('start A then B');
    expect([...team.keys()]).toEqual(['plan.md']);
    expect(useApp.getState().toast).not.toMatch(/both are kept/);
  });

  it('a team draft replayed after a relaunch sends the rev it was typed against', async () => {
    teamScope();
    team.set('plan.md', { body: 'three revisions in', rev: 3 });
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen('plan.md');
    teamNet.fail = new TypeError('Failed to fetch');
    await useApp.getState().vaultSave('plan.md', 'typed offline');
    teamNet.fail = undefined;
    // A relaunch: the provider's in-memory revs are gone.
    wiring.org!.resetOrgVault();
    await useApp.getState().vaultRefresh();
    expect(teamNet.puts.at(-1)).toMatchObject({ path: 'plan.md', base: 3 });
    expect(team.get('plan.md')?.body).toBe('typed offline');
    // Nothing changed elsewhere, so the server set nothing aside.
    expect([...team.keys()]).toEqual(['plan.md']);
  });

  it('a team draft stashed with no rev reads the note first, so it still sends the right base', async () => {
    teamScope();
    team.set('plan.md', { body: 'five revisions in', rev: 5 });
    mem.set(
      PENDING,
      JSON.stringify({
        [`org::${ORG}::plan.md`]: {
          providerId: 'org',
          resourceId: ORG,
          owner: 'u1',
          path: 'plan.md',
          text: 'typed offline',
          base: 'r5',
          at: '2026-09-27T00:00:00.000Z',
        },
      }),
    );
    wiring.org!.resetOrgVault();
    await useApp.getState().vaultRefresh();
    expect(teamNet.puts.at(-1)).toMatchObject({ path: 'plan.md', base: 5 });
    expect([...team.keys()]).toEqual(['plan.md']);
    expect(team.get('plan.md')?.body).toBe('typed offline');
  });

  it('a stash from before this update is held for the person, never replayed', async () => {
    files.set('old.md', 'what the vault holds now');
    mem.set(
      PENDING,
      JSON.stringify({
        'vault.personal::old.md': {
          resourceId: 'vault.personal',
          path: 'old.md',
          text: 'typed offline before the update',
          at: '2026-09-01T00:00:00.000Z',
        },
      }),
    );
    await useApp.getState().vaultRefresh();
    expect(files.get('old.md')).toBe('what the vault holds now');
    expect(useApp.getState().vaultHeld).toEqual([
      expect.objectContaining({ path: 'old.md', text: 'typed offline before the update' }),
    ]);
    expect(pending()).toEqual({});
  });
});

// 0.2: the cached list can be stale (the agent, a routine, Obsidian, or another
// device wrote a note after it loaded), so a create asks the provider first.
describe('creating a note never truncates one (0.2)', () => {
  beforeEach(reset);

  it('create over an unlisted existing note opens it, bytes unchanged', async () => {
    files.set('Daily.md', 'the agent wrote this');
    // The list has not caught up: the note is not in vaultFiles.
    await useApp.getState().vaultCreate('Daily');
    expect(files.get('Daily.md')).toBe('the agent wrote this');
    expect(useApp.getState().vaultNote).toMatchObject({
      path: 'Daily.md',
      text: 'the agent wrote this',
    });
  });

  it('create over an unlisted note that is still downloading waits, never writes', async () => {
    local.evicted.add('synced.md');
    await useApp.getState().vaultCreate('synced');
    expect(files.has('synced.md')).toBe(false);
    expect(useApp.getState().vaultNote).toBeUndefined();
    expect(useApp.getState().toast).toMatch(/Still downloading/);
  });

  it('opening an unlisted note that is still downloading never opens an empty editor', async () => {
    local.evicted.add('synced.md');
    await useApp.getState().vaultOpen('synced.md');
    expect(useApp.getState().vaultNote).toBeUndefined();
    expect(useApp.getState().toast).toMatch(/Still downloading/);
  });
});

// 0.3: only a name the person types for a NEW note is normalized. Names the
// agent and routines write keep characters the typed-name rule strips.
describe('open, save, and delete by the exact listed path (0.3)', () => {
  beforeEach(reset);

  for (const [path, body] of [
    ['Decision: auth?.md', 'we chose passkeys'],
    ['Crew/C# nightly.md', 'ran at 06:00'],
  ] as const) {
    it(`opens, saves, and deletes the agent-written "${path}"`, async () => {
      files.set(path, body);
      await useApp.getState().vaultRefresh();
      await useApp.getState().vaultOpen(path);
      expect(useApp.getState().vaultNote).toMatchObject({ path, text: body });
      const open = useApp.getState().vaultNote!;
      await useApp.getState().vaultSave(open.path, `${body}, then more`);
      expect(files.get(path)).toBe(`${body}, then more`);
      expect(files.size).toBe(1); // no stripped-name sibling forked
      expect(await useApp.getState().vaultDelete(open.path)).toBe(true);
      expect(files.has(path)).toBe(false);
      expect(useApp.getState().vaultNote).toBeUndefined();
    });
  }
});

// 0.4: a network failure stashes and retries; a permanent refusal is held and
// never retried; nothing fails silently.
describe('failures are loud, classified, and never lose text (0.4)', () => {
  beforeEach(reset);

  it('a throwing stash still sets vaultError and keeps the text', async () => {
    await useApp.getState().vaultCreate('note');
    fail.write = true;
    // The sealed store is full: the stash (and the durable held copy) throw.
    failKeys.add(PENDING);
    failKeys.add(HELD);
    await expect(useApp.getState().vaultSave('note.md', 'precious')).resolves.toBeUndefined();
    expect(useApp.getState().vaultError).toBe('held');
    expect(useApp.getState().vaultHeld).toEqual([
      expect.objectContaining({ path: 'note.md', text: 'precious' }),
    ]);
    expect(useApp.getState().toast).toMatch(/could not keep a copy/);
  });

  it('a 2 MB team body is held, not stashed for retry', async () => {
    teamScope();
    const big = 'x'.repeat(2 * 1024 * 1024);
    await useApp.getState().vaultSave('big.md', big);
    expect(teamNet.puts).toHaveLength(0); // checked before anything was sent
    expect(pending()).toEqual({});
    expect(useApp.getState().vaultError).toBe('held');
    const held = useApp.getState().vaultHeld;
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ providerId: 'org', resourceId: ORG, path: 'big.md' });
    expect(held[0]!.text).toBe(big);
    expect(held[0]!.reason).toMatch(/1 MB/);
    // Nothing retries it: a refresh sends nothing.
    await useApp.getState().vaultRefresh();
    expect(teamNet.puts).toHaveLength(0);
  });

  it("a team server refusal keeps the server's own line and is never retried", async () => {
    teamScope();
    teamNet.fail = new SupabaseRequestError('not a member of this org', 400);
    await useApp.getState().vaultSave('plan.md', 'our plan');
    expect(pending()).toEqual({});
    expect(useApp.getState().vaultHeld[0]).toMatchObject({
      path: 'plan.md',
      text: 'our plan',
      reason: 'Not a member of this org.',
    });
    expect(useApp.getState().toast).toMatch(/Not a member of this org/);
    expect(useApp.getState().toast).not.toMatch(/connection returns/);
  });

  it('a team network failure still stashes and retries', async () => {
    teamScope();
    teamNet.fail = new TypeError('Failed to fetch');
    await useApp.getState().vaultSave('plan.md', 'our plan');
    expect(useApp.getState().vaultError).toBe('save');
    expect(Object.keys(pending())).toEqual([`org::${ORG}::plan.md`]);
    teamNet.fail = undefined;
    await useApp.getState().vaultRefresh();
    expect(team.get('plan.md')?.body).toBe('our plan');
    expect(pending()).toEqual({});
  });

  it('held text is durable and leaves only when the person discards it', async () => {
    teamScope();
    teamNet.fail = new SupabaseRequestError('that note path is not allowed', 400);
    await useApp.getState().vaultSave('odd.md', 'keep me');
    expect(JSON.parse(mem.get(HELD)!)).toEqual([
      expect.objectContaining({ path: 'odd.md', text: 'keep me', owner: 'u1', durable: true }),
    ]);
    expect(useApp.getState().vaultHeld[0]).toMatchObject({ durable: true });
    // Leaving the note and saving others does not clear it.
    teamNet.fail = undefined;
    await useApp.getState().vaultSave('other.md', 'fine');
    expect(useApp.getState().vaultHeld).toHaveLength(1);
    await useApp.getState().vaultDiscardHeld(useApp.getState().vaultHeld[0]!.id);
    expect(useApp.getState().vaultHeld).toEqual([]);
    expect(mem.has(HELD)).toBe(false);
  });

  it("an offline token refresh stashes and retries, through the store's own getter", async () => {
    teamScope();
    useStoreToken();
    // An hour in: the access token has expired, and the refresh cannot reach
    // the server. That is a network failure, not a missing sign-in.
    useApp.setState({ authSession: session(auth.nextUser, -1000) });
    auth.refresh = new TypeError('Failed to fetch');
    await useApp.getState().vaultSave('plan.md', 'typed offline');
    expect(Object.keys(pending())).toEqual([`org::${ORG}::plan.md`]);
    expect(useApp.getState().vaultHeld).toEqual([]);
    expect(useApp.getState().vaultError).toBe('save');
    expect(useApp.getState().toast).not.toMatch(/Sign in/);
    expect(useApp.getState().authSession?.user.id).toBe('u1');
    // The connection returns.
    auth.refresh = undefined;
    await useApp.getState().vaultRefresh();
    expect(team.get('plan.md')?.body).toBe('typed offline');
    expect(teamNet.puts.at(-1)?.token).toBe('tok-u1');
    expect(pending()).toEqual({});
  });

  it('held text this device could not keep says so, and is marked memory-only', async () => {
    teamScope();
    failKeys.add(HELD);
    await useApp.getState().vaultSave('big.md', 'x'.repeat(2 * 1024 * 1024));
    const held = useApp.getState().vaultHeld;
    expect(held).toHaveLength(1);
    expect(held[0]!.durable).toBe(false);
    expect(mem.has(HELD)).toBe(false);
    expect(useApp.getState().toast).not.toMatch(/kept under Not saved/);
    expect(useApp.getState().toast).toMatch(/could not keep a copy/);
  });

  it('a discard never deletes a held list this launch could not read', async () => {
    const earlier = [
      {
        id: 'local::vault.personal::old.md',
        providerId: 'local',
        resourceId: 'vault.personal',
        path: 'old.md',
        text: 'earlier held words',
        reason: 'Held earlier.',
        at: '2026-09-01T00:00:00.000Z',
        durable: true,
      },
    ];
    mem.set(HELD, JSON.stringify(earlier));
    // The device key is not readable this launch (P0-3).
    lockedKeys.add(HELD);
    teamScope();
    teamNet.fail = new SupabaseRequestError('that note path is not allowed', 400);
    await useApp.getState().vaultSave('odd.md', 'new held words');
    const odd = useApp.getState().vaultHeld.find((h) => h.path === 'odd.md')!;
    // The locked list could not take it, and the entry says so.
    expect(odd.durable).toBe(false);
    await useApp.getState().vaultDiscardHeld(odd.id);
    expect(useApp.getState().vaultHeld).toEqual([]);
    expect(JSON.parse(mem.get(HELD)!)).toEqual(earlier);
  });

  it('a refused team delete leaves no standing save line', async () => {
    teamScope();
    team.set('plan.md', { body: 'ours', rev: 1 });
    await useApp.getState().vaultRefresh();
    teamNet.fail = new SupabaseRequestError('not a member of this org', 400);
    expect(await useApp.getState().vaultDelete('plan.md')).toBe(false);
    expect(useApp.getState().vaultError).toBeUndefined();
    expect(useApp.getState().toast).toMatch(/Not a member of this org/);
  });

  it('one unreadable file still yields backlinks for the rest', async () => {
    files.set('a.md', 'see [[b]]');
    files.set('b.md', 'the target');
    files.set('c.md', 'also [[b]]');
    local.failPaths.add('c.md');
    await useApp.getState().vaultRefresh();
    const all = await useApp.getState().vaultReadAll();
    expect(all.map((n) => n.path).sort()).toEqual(['a.md', 'b.md']);
    expect(all.failed).toEqual(['c.md']);
    expect(backlinksTo('b.md', all).map((b) => b.path)).toEqual(['a.md']);
  });

  it('vaultReadAll reports a note still downloading as failed', async () => {
    files.set('a.md', 'here');
    local.evicted.add('far.md');
    const all = await useApp.getState().vaultReadAll();
    expect(all.map((n) => n.path)).toEqual(['a.md']);
    expect(all.failed).toEqual(['far.md']);
  });

  it('a failed delete resolves false and keeps the note; a real one resolves true', async () => {
    files.set('keep.md', 'still here');
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen('keep.md');
    local.fail.remove = true;
    expect(await useApp.getState().vaultDelete('keep.md')).toBe(false);
    expect(files.get('keep.md')).toBe('still here');
    expect(useApp.getState().vaultNote?.path).toBe('keep.md');
    expect(useApp.getState().toast).toMatch(/Could not delete/);
    // The toast says it; the standing "save" line (which promises unsaved
    // text will save) is not about a delete, and nothing retries one.
    expect(useApp.getState().vaultError).toBeUndefined();
    local.fail.remove = false;
    expect(await useApp.getState().vaultDelete('keep.md')).toBe(true);
    expect(files.has('keep.md')).toBe(false);
  });
});

// 0.5: a move reads every note first, copies only notes, checks the target,
// and only then repoints the vault.
describe('moving the vault never drops notes (0.5)', () => {
  beforeEach(reset);

  const providerOfVault = () =>
    (useApp.getState().settings.gitosResources ?? []).find((r) => r.id === 'vault.personal')
      ?.providerId;

  it('one evicted source note aborts the move and the resource still points at the source', async () => {
    files.set('a.md', 'alpha');
    local.evicted.add('b.md');
    await useApp.getState().vaultRefresh();
    const res = await useApp.getState().vaultMoveTo('files');
    expect(res).toEqual({
      ok: false,
      moved: [],
      skipped: ['b.md'],
      forked: [],
      reason: 'unreadable',
    });
    expect(folder.files.size).toBe(0); // nothing half-copied
    expect(providerOfVault()).toBe('local');
  });

  it('a read that fails, or comes back empty for a non-empty file, also aborts', async () => {
    files.set('a.md', 'alpha');
    files.set('b.md', 'beta');
    local.failPaths.add('b.md');
    await useApp.getState().vaultRefresh();
    const res = await useApp.getState().vaultMoveTo('files');
    expect(res.ok).toBe(false);
    expect(res.skipped).toEqual(['b.md']);
    expect(providerOfVault()).toBe('local');
  });

  it('copies only notes (never .obsidian/ or attachments), then repoints', async () => {
    files.set('a.md', 'alpha');
    files.set('.obsidian/app.json', '{}');
    files.set('img.png', 'bytes');
    files.set('x/.trash/old.md', 'trashed');
    await useApp.getState().vaultRefresh();
    const res = await useApp.getState().vaultMoveTo('files');
    expect(res).toEqual({ ok: true, moved: ['a.md'], skipped: [], forked: [] });
    expect([...folder.files.keys()]).toEqual(['a.md']);
    expect(providerOfVault()).toBe('files');
    expect(useApp.getState().vaultFiles.map((f) => f.path)).toEqual(['a.md']);
  });

  it('a target that does not show every copy is never pointed at', async () => {
    files.set('a.md', 'alpha');
    files.set('b.md', 'beta');
    folder.hideFromList.add('b.md');
    await useApp.getState().vaultRefresh();
    const res = await useApp.getState().vaultMoveTo('files');
    expect(res).toMatchObject({ ok: false, reason: 'unverified', skipped: ['b.md'], forked: [] });
    expect(providerOfVault()).toBe('local');
    // The copies it did write are taken back, so the folder is as it was.
    expect(folder.files.size).toBe(0);
  });

  it('a refused move takes back only its own copies, so a retry puts the newest text under the name', async () => {
    folder.files.set('z.md', 'already in the folder');
    files.set('a.md', 'draft one');
    files.set('b.md', 'beta');
    await useApp.getState().vaultRefresh();
    // The folder takes one copy, then stops.
    folder.limits.writesLeft = 1;
    const first = await useApp.getState().vaultMoveTo('files');
    expect(first).toMatchObject({ ok: false, reason: 'copy-failed', forked: [] });
    expect(first.left).toBeUndefined();
    // What was there before stays; what this move wrote is gone.
    expect([...folder.files.keys()]).toEqual(['z.md']);
    expect(folder.files.get('z.md')).toBe('already in the folder');
    expect(providerOfVault()).toBe('local');
    // The person keeps writing, then tries again.
    folder.limits.writesLeft = undefined;
    await useApp.getState().vaultOpen('a.md');
    await useApp.getState().vaultSave('a.md', 'draft two, the latest');
    const second = await useApp.getState().vaultMoveTo('files');
    expect(second).toMatchObject({ ok: true, forked: [] });
    expect(folder.files.get('a.md')).toBe('draft two, the latest');
    await useApp.getState().vaultOpen('a.md');
    expect(useApp.getState().vaultNote?.text).toBe('draft two, the latest');
  });

  it('copies a refused move could not take back are named', async () => {
    files.set('a.md', 'alpha');
    files.set('b.md', 'beta');
    await useApp.getState().vaultRefresh();
    folder.limits.writesLeft = 1;
    folder.fail.remove = true;
    const res = await useApp.getState().vaultMoveTo('files');
    expect(res).toMatchObject({ ok: false, reason: 'copy-failed', left: ['a.md'] });
    expect(providerOfVault()).toBe('local');
  });

  it('a draft stashed offline rides the move instead of being left behind', async () => {
    await useApp.getState().vaultCreate('note');
    fail.write = true;
    await useApp.getState().vaultSave('note.md', 'typed offline');
    fail.write = false;
    const res = await useApp.getState().vaultMoveTo('files');
    expect(res.ok).toBe(true);
    expect(folder.files.get('note.md')).toBe('typed offline');
    expect(pending()).toEqual({});
  });

  it('a note already at the target is never overwritten, whatever its age', async () => {
    // The agent (or Obsidian) already wrote a.md into the folder; the move
    // lands this device's a.md beside it, never over it.
    folder.files.set('a.md', 'the agent wrote this');
    files.set('a.md', 'typed on this device');
    files.set('b.md', 'beta');
    await useApp.getState().vaultRefresh();
    const res = await useApp.getState().vaultMoveTo('files');
    expect(res.ok).toBe(true);
    expect(folder.files.get('a.md')).toBe('the agent wrote this');
    const copies = [...folder.files.keys()].filter((p) => /^a \(conflict .+\)\.md$/.test(p));
    expect(copies).toHaveLength(1);
    expect(folder.files.get(copies[0]!)).toBe('typed on this device');
    expect(folder.files.get('b.md')).toBe('beta');
    // The result names the fork, so the move line can say so (never a plain
    // success over a note that lost its name).
    expect(res.forked).toEqual([{ from: 'a.md', to: copies[0] }]);
  });

  it('the same text already at the target is not copied twice', async () => {
    folder.files.set('a.md', 'same words');
    files.set('a.md', 'same words');
    await useApp.getState().vaultRefresh();
    const res = await useApp.getState().vaultMoveTo('files');
    expect(res.ok).toBe(true);
    expect(res.forked).toEqual([]);
    expect([...folder.files.keys()]).toEqual(['a.md']);
  });
});

// 0.7: the vault a save goes to is fixed when the save is scheduled, and team
// text belongs to the account that typed it: a sign-out forgets it, an expired
// sign-in keeps it for the same person, and it never replays or shows under
// another account.
describe('the save target is fixed when the save is scheduled (0.7)', () => {
  beforeEach(reset);

  it('a scope flip mid-debounce never writes team text into the personal vault', async () => {
    teamScope();
    const at = useApp.getState().vaultTargetRef();
    expect(at).toEqual({ providerId: 'org', resourceId: ORG, owner: 'u1' });
    // Team access drops inside the debounce and the screen falls back.
    useApp.setState({ vaultScope: 'personal', vaultNote: undefined });
    await useApp.getState().vaultSave('Plan.md', 'team words', at);
    expect(team.get('Plan.md')?.body).toBe('team words');
    expect(files.has('Plan.md')).toBe(false);
  });

  it('sign-out leaves no team stash entries or held team text', async () => {
    teamScope();
    teamNet.fail = new TypeError('Failed to fetch');
    await useApp.getState().vaultSave('plan.md', 'unsent team draft');
    teamNet.fail = undefined;
    await useApp.getState().vaultSave('big.md', 'x'.repeat(2 * 1024 * 1024));
    // A personal draft stashed alongside is the person's own and stays.
    fail.write = true;
    const mine = { providerId: 'local' as const, resourceId: 'vault.personal' };
    await useApp.getState().vaultSave('mine.md', 'personal draft', mine);
    expect(Object.keys(pending())).toHaveLength(2);
    expect(useApp.getState().vaultHeld).toHaveLength(1);

    await useApp.getState().signOutAccount();
    expect(useApp.getState().authSession).toBeUndefined();
    expect(Object.keys(pending())).toEqual(['local::vault.personal::mine.md']);
    expect(useApp.getState().vaultHeld).toEqual([]);
    expect(mem.has(HELD)).toBe(false);
  });

  it('team text saved after a sign-out is never sent, written to the device, or shown', async () => {
    teamScope();
    const at = useApp.getState().vaultTargetRef();
    // The person signs out inside the debounce.
    await useApp.getState().signOutAccount();
    await useApp.getState().vaultSave('plan.md', 'last keystrokes', at);
    expect(teamNet.puts).toHaveLength(0);
    expect(team.has('plan.md')).toBe(false);
    expect(files.has('plan.md')).toBe(false);
    expect(pending()).toEqual({});
    expect(mem.has(HELD)).toBe(false);
    expect(useApp.getState().vaultHeldVisible()).toEqual([]);
    // Kept in memory for the same account only: signing back in before the
    // app closes shows it again under Not saved.
    await useApp.getState().signIn('me@example.com', 'pw');
    expect(useApp.getState().vaultHeldVisible()).toEqual([
      expect.objectContaining({ text: 'last keystrokes', owner: 'u1', durable: false }),
    ]);
  });

  it('a team create asked for before a sign-out never reaches the server', async () => {
    teamScope();
    const at = useApp.getState().vaultTargetRef();
    await useApp.getState().signOutAccount();
    await useApp.getState().vaultCreate('Welcome', 'seeded team words', at);
    expect(teamNet.puts).toHaveLength(0);
    expect(team.has('Welcome.md')).toBe(false);
    expect(pending()).toEqual({});
    expect(useApp.getState().vaultHeldVisible()).toEqual([]);
  });

  it('held team text never shows under another account', async () => {
    teamScope();
    const at = useApp.getState().vaultTargetRef();
    await useApp.getState().signOutAccount();
    await useApp.getState().vaultSave('plan.md', 'A private words', at);
    auth.nextUser = { id: 'u2', email: 'b@example.com' };
    await useApp.getState().signIn('b@example.com', 'pw');
    expect(useApp.getState().vaultHeldVisible()).toEqual([]);
    expect(teamHeld()).toEqual([]);
  });

  it('a team write in flight at sign-out never stashes, and never replays under the next account', async () => {
    teamScope();
    const a = deferred();
    teamNet.beforePut = async () => {
      await a.promise;
      throw new TypeError('Failed to fetch');
    };
    const save = useApp.getState().vaultSave('plan.md', 'A private draft');
    await tick();
    await useApp.getState().signOutAccount();
    a.resolve();
    await save;
    teamNet.beforePut = undefined;
    expect(pending()).toEqual({});
    expect(mem.has(HELD)).toBe(false);
    expect(useApp.getState().vaultHeldVisible()).toEqual([]);
    // Another member of the same org signs in on this device and opens the
    // team vault.
    auth.nextUser = { id: 'u2', email: 'b@example.com' };
    await useApp.getState().signIn('b@example.com', 'pw');
    useApp.setState({ vaultScope: 'team' });
    await useApp.getState().vaultRefresh();
    expect(teamNet.puts.filter((p) => p.body === 'A private draft')).toHaveLength(0);
    expect(team.has('plan.md')).toBe(false);
    expect(teamHeld()).toEqual([]);
  });

  // Expiry: the team token getter is the store's own, so the refresh that
  // finds the refresh token dead is the real one.
  async function expireWithUnsentTeamText() {
    teamScope();
    useStoreToken();
    const at = useApp.getState().vaultTargetRef();
    // One team save fails offline and is stashed; another is refused and held.
    teamNet.fail = new TypeError('Failed to fetch');
    await useApp.getState().vaultSave('plan.md', 'unsent team words');
    teamNet.fail = new SupabaseRequestError('that note path is not allowed', 400);
    await useApp.getState().vaultSave('odd.md', 'held team words');
    teamNet.fail = undefined;
    // The refresh token dies (a password changed elsewhere).
    useApp.setState({ authSession: session(auth.nextUser, -1000) });
    auth.refresh = new SupabaseRequestError('invalid grant', 400);
    await useApp.getState().refreshOrgRole();
    expect(useApp.getState().authSession).toBeUndefined();
    // A save scheduled before the expiry fires after it.
    await useApp.getState().vaultSave('late.md', 'typed as it expired', at);
    auth.refresh = undefined;
  }

  it("an expired sign-in keeps the same person's unsent team text, and sends it when they sign back in", async () => {
    await expireWithUnsentTeamText();
    // Kept, sealed, and out of sight while nobody is signed in.
    expect(Object.keys(pending()).sort()).toEqual([`org::${ORG}::late.md`, `org::${ORG}::plan.md`]);
    expect(JSON.parse(mem.get(HELD)!)).toEqual([
      expect.objectContaining({ text: 'held team words', owner: 'u1' }),
    ]);
    expect(useApp.getState().vaultHeldVisible()).toEqual([]);
    expect(useApp.getState().toast).toMatch(/sign in again/i);
    // The same person signs back in and opens the team vault.
    await useApp.getState().signIn('me@example.com', 'pw');
    expect(useApp.getState().vaultHeldVisible()).toEqual([
      expect.objectContaining({ text: 'held team words', owner: 'u1' }),
    ]);
    useApp.setState({ vaultScope: 'team' });
    await useApp.getState().vaultRefresh();
    expect(team.get('plan.md')?.body).toBe('unsent team words');
    expect(team.get('late.md')?.body).toBe('typed as it expired');
    expect(pending()).toEqual({});
  });

  it("another account signing in after an expiry drops the previous account's team text", async () => {
    await expireWithUnsentTeamText();
    auth.nextUser = { id: 'u2', email: 'b@example.com' };
    await useApp.getState().signIn('b@example.com', 'pw');
    expect(pending()).toEqual({});
    expect(teamHeld()).toEqual([]);
    expect(mem.has(HELD)).toBe(false);
    useApp.setState({ vaultScope: 'team' });
    await useApp.getState().vaultRefresh();
    expect(team.has('plan.md')).toBe(false);
    expect(team.has('late.md')).toBe(false);
  });

  const legacyTeamStash = () =>
    mem.set(
      PENDING,
      JSON.stringify({
        [`${ORG}::plan.md`]: {
          resourceId: ORG,
          path: 'plan.md',
          text: 'A team draft from before the update',
          at: '2026-09-01T00:00:00.000Z',
        },
      }),
    );

  it('a team stash from before the update is never shown to a signed-out device', async () => {
    legacyTeamStash();
    await useApp.getState().vaultRefresh();
    expect(useApp.getState().vaultHeld).toEqual([]);
    expect(mem.has(HELD)).toBe(false);
    expect(pending()).toEqual({});
  });

  it('a team stash from before the update shows, in memory only, to a member of its org', async () => {
    teamScope();
    legacyTeamStash();
    await useApp.getState().vaultRefresh();
    expect(useApp.getState().vaultHeldVisible()).toEqual([
      expect.objectContaining({ text: 'A team draft from before the update', durable: false }),
    ]);
    expect(mem.has(HELD)).toBe(false);
    // Nobody knows who typed it, so it is never sent.
    expect(team.has('plan.md')).toBe(false);
    expect(pending()).toEqual({});
  });
});

// 0.18 (D1): Google Drive is held back for v1. A vault that already lives there
// lists and reads, refuses every write with a reason, and moves off.
describe('a Google Drive vault is read-only (0.18)', () => {
  beforeEach(() => {
    reset();
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('gdrive') },
    });
    drive.files.set('a.md', 'drive words');
  });

  it('lists and reads', async () => {
    await useApp.getState().vaultRefresh();
    expect(useApp.getState().vaultFiles.map((f) => f.path)).toEqual(['a.md']);
    await useApp.getState().vaultOpen('a.md');
    expect(useApp.getState().vaultNote?.text).toBe('drive words');
    expect(useApp.getState().vaultReadOnly()).toMatch(/read-only/);
  });

  it('refuses a write, a create, and a delete, and keeps typed text', async () => {
    await useApp.getState().vaultSave('a.md', 'edited on Drive');
    expect(drive.files.get('a.md')).toBe('drive words');
    expect(useApp.getState().vaultHeld[0]).toMatchObject({ text: 'edited on Drive' });
    await useApp.getState().vaultCreate('new');
    expect(drive.files.has('new.md')).toBe(false);
    expect(await useApp.getState().vaultDelete('a.md')).toBe(false);
    expect(drive.files.has('a.md')).toBe(true);
    expect(useApp.getState().toast).toMatch(/read-only/);
  });

  it('moves off Drive, and nothing moves onto it', async () => {
    const res = await useApp.getState().vaultMoveTo('local');
    expect(res).toEqual({ ok: true, moved: ['a.md'], skipped: [], forked: [] });
    expect(files.get('a.md')).toBe('drive words');
    expect(useApp.getState().vaultReadOnly()).toBeUndefined();
    const back = await useApp.getState().vaultMoveTo('gdrive');
    expect(back).toMatchObject({ ok: false, reason: 'unavailable' });
  });
});
