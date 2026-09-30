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
// typed it (a sign-out forgets it, an expiry keeps it for the same person, and
// Sign out asks before it deletes any), and a Google Drive vault is
// read-only. The personal providers are in-memory fakes
// whose ops can be forced to fail; the team vault is the real provider over a
// fake Supabase, and the auth cases run the store's own token getter.
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  StoredFile,
  RemoveResult,
  StoredFileMeta,
  WriteGuard,
  WriteResult,
} from '../src/lib/gitos/providers.js';
import { isNotePath } from '../src/lib/gitos/providers.js';
import {
  createFakeOrgVaultServer,
  type FakeOrgVaultServer,
} from './fixtures/fakeOrgVaultServer.js';
import { backlinksTo, normalizeNotePath } from '../src/lib/vault.js';
import {
  VAULT_TEAM_DELETE_REFUSED,
  VAULT_TEAM_FULL,
  VAULT_TEAM_LAPSED_NOT_CREATED,
  VAULT_TEAM_LAPSED_NOT_DELETED,
  VAULT_TEAM_LAPSED_NOT_RESTORED,
  VAULT_TEAM_LAPSED_NOT_SAVED,
  VAULT_TEAM_LAPSED_NOT_SAVED_LINE,
  vaultFolderMoveTaken,
  vaultGoneToast,
  vaultRenameFailed,
  vaultTickChanged,
  vaultTrashGone,
} from '../src/lib/vaultCopy.js';

const mem = new Map<string, string>();
// Sealed-store keys whose writes throw, as a full localStorage quota would.
const failKeys = new Set<string>();
// Sealed-store keys this launch cannot open (P0-3, a locked device key): they
// read as absent, a write over them does nothing, and a delete still deletes,
// the way platform.ts behaves.
const lockedKeys = new Set<string>();

// The desktop, for the Vault M1 1.3 and 1.4 cases: whether this is the
// computer, what main says about the vault folder, and what a pick returns.
const desk = vi.hoisted(() => ({
  on: false,
  info: undefined as Record<string, unknown> | undefined,
  pick: undefined as unknown,
  bring: undefined as unknown,
  onBring: undefined as (() => void) | undefined,
}));
vi.mock('../src/lib/vaultFolder.js', () => ({
  canPickVaultFolder: () => desk.on,
  vaultFolderInfo: async () => (desk.on ? desk.info : undefined),
  chooseVaultFolder: async () => desk.pick,
  refineVaultFolder: async () => desk.pick,
  bringPreviousVaultFolder: async () => {
    desk.onBring?.();
    return desk.bring;
  },
  revealVaultFolder: async () => true,
  openVaultInObsidian: async () => {},
  openPrivacySettings: async () => {},
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => (desk.on ? 'electron' : 'web'),
  isDesktop: () => desk.on,
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
// `cas` makes the fake enforce the write guard the way the desktop folder
// does (compare-and-swap): a stale ifMatch, a missing note, or a taken name
// comes back as a conflict and nothing is written.
function makeProvider(id: string, cas = false) {
  const files = new VersionedFiles();
  const evicted = new Set<string>();
  const failPaths = new Set<string>();
  const hideFromList = new Set<string>();
  const fail = { list: false, read: false, write: false, stat: false, remove: false };
  const limits = { writesLeft: undefined as number | undefined };
  // `editor.by` is who the storage says last saved every file (the team
  // vault's editedBy, G6).
  const editor = { by: undefined as { id: string; label?: string } | undefined };
  // `stamp.fixed` gives every file one updatedAt, as two saves inside one
  // millisecond would: only the version tells them apart (Vault M2 G1).
  const stamp = { fixed: undefined as string | undefined };
  const counts = {
    lists: 0,
    leases: [] as Array<{ holder: string; ttlMs: number; label?: string }>,
    reads: 0,
    writes: [] as Array<{ path: string; guard?: WriteGuard }>,
    removes: [] as Array<{ path: string; guard?: { ifMatch: string } }>,
  };
  const version = (path: string) => files.versions.get(path)!;
  // updatedAt changes with every write, so the body cache invalidates on edit.
  const meta = (path: string): StoredFileMeta =>
    evicted.has(path)
      ? { path, updatedAt: 'cloud', size: 10, evicted: true }
      : {
          path,
          updatedAt: stamp.fixed ?? version(path),
          size: files.get(path)!.length,
          ...(cas ? { version: version(path) } : {}),
          ...(editor.by ? { editedBy: editor.by } : {}),
        };
  const file = (path: string): StoredFile => ({
    path,
    text: files.get(path)!,
    updatedAt: stamp.fixed ?? version(path),
    ...(cas ? { version: version(path) } : {}),
  });
  const provider = {
    ...(cas ? { compareAndSwap: true as const } : {}),
    id,
    label: id,
    blurb: '',
    ready: true,
    async list(): Promise<StoredFileMeta[]> {
      if (fail.list) throw new Error('offline');
      counts.lists++;
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
      return files.has(path) ? file(path) : undefined;
    },
    async write(_r: string, path: string, text: string, guard?: WriteGuard): Promise<WriteResult> {
      if (fail.write) throw new Error('offline');
      if (limits.writesLeft !== undefined && limits.writesLeft-- <= 0) throw new Error('disk full');
      counts.writes.push({ path, guard });
      if (cas && guard) {
        if ('ifAbsent' in guard) {
          if (files.has(path)) return { ok: false, conflict: 'exists', theirs: file(path) };
        } else if (!files.has(path)) {
          return { ok: false, conflict: 'missing' };
        } else if (version(path) !== guard.ifMatch) {
          return { ok: false, conflict: 'changed', theirs: file(path) };
        }
      }
      files.set(path, text);
      return { ok: true, file: file(path) };
    },
    async remove(_r: string, path: string, guard?: { ifMatch: string }): Promise<RemoveResult> {
      if (fail.remove) throw new Error('offline');
      counts.removes.push({ path, guard });
      if (evicted.has(path) && cas && guard) return { ok: false, conflict: 'downloading' };
      if (cas && guard && files.has(path) && version(path) !== guard.ifMatch) {
        return { ok: false, conflict: 'changed', theirs: file(path) };
      }
      files.delete(path);
      return { ok: true };
    },
    async acquireLease(_r: string, holder: string, ttlMs: number, label?: string) {
      counts.leases.push({ holder, ttlMs, label });
      // A foreign holder keeps its lease; otherwise the caller takes it.
      if (leaseHolder !== 'me' && leaseHolder !== holder) {
        return {
          holder: leaseHolder,
          expiresAt: new Date(Date.now() + 90_000).toISOString(),
          ...(leaseLabel ? { label: leaseLabel } : {}),
        };
      }
      leaseHolder = holder;
      return { holder, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
    },
    async releaseLease(_r: string, holder: string) {
      if (leaseHolder === holder) leaseHolder = 'me';
    },
  };
  const reset = () => {
    files.clear();
    evicted.clear();
    failPaths.clear();
    hideFromList.clear();
    Object.assign(fail, { list: false, read: false, write: false, stat: false, remove: false });
    limits.writesLeft = undefined;
    stamp.fixed = undefined;
    editor.by = undefined;
    counts.lists = 0;
    counts.leases = [];
    counts.reads = 0;
    counts.writes = [];
    counts.removes = [];
  };
  return {
    provider,
    files,
    evicted,
    failPaths,
    hideFromList,
    fail,
    limits,
    stamp,
    editor,
    counts,
    version,
    reset,
  };
}

let leaseHolder = 'me';
// The device kind a foreign lease says it is (Lease.label).
let leaseLabel: string | undefined;
// Whether this device holds a Google account for Drive.
let driveConnected = true;
const local = makeProvider('local');
const folder = makeProvider('files', true);
const drive = makeProvider('gdrive');
// A compare-and-swap storage other than the folder (iCloud, once its native
// half checks the guard), for the "every provider" cases (Vault M2).
const cloud = makeProvider('icloud', true);
// The paired computer's vault (Vault M5, CTO J9): compare-and-swap, like the
// daemon's routes.
const hub = makeProvider('hub', true);
const byId: Record<string, ReturnType<typeof makeProvider>> = {
  local,
  files: folder,
  gdrive: drive,
  icloud: cloud,
  hub,
};
// The personal vault's default provider, under the names the older cases use.
const files = local.files;
const fail = local.fail;

// The team vault: the real provider, over a fake Supabase that keeps one org's
// rows in memory. `teamNet.fail` makes every request throw; `beforePut` runs
// ahead of each org_vault_write (hold it, or throw); `puts` records what each
// one sent (base is its if_match, 0 for a create). Like org_vault_write
// (0021), a stale if_match answers `changed` with theirs and writes nothing.
const ORG = 'org-1';
const team = new Map<string, { body: string; rev: number }>();
const teamNet = {
  fail: undefined as Error | undefined,
  /** Thrown by the RPCs only, so the reads before them still answer. */
  rpcFail: undefined as Error | undefined,
  beforePut: undefined as ((args: Record<string, unknown>) => Promise<void>) | undefined,
  puts: [] as Array<{ token: string; path: string; body: string; base: number }>,
  // How many one-note reads (stat or read, a `path=eq.` select) were asked.
  heads: 0,
  /** Every org_vault_ RPC asked, by name, in order. */
  calls: [] as string[],
  /** The org's settings row (0025) as org_vault_settings_get answers it, with
   *  this caller an admin; undefined answers nothing, as before 0025. */
  settings: undefined as Record<string, unknown> | undefined,
  /** Every org_vault_settings_put's p_settings, in order. */
  settingsPuts: [] as unknown[],
  /** When set, the team's selects and RPCs go to this fake server instead
   *  (test/fixtures/fakeOrgVaultServer.ts: Trash, moves, and 0023's free
   *  space as the migrations write them). */
  server: undefined as FakeOrgVaultServer | undefined,
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
      if (table === 'org_vault_notes' && /path=eq\./.test(query)) teamNet.heads++;
      if (teamNet.fail) throw teamNet.fail;
      // An active member of ORG; no org to pull, no projects, no entitlement.
      if (table === 'org_members' && query.startsWith('select=role')) {
        return [{ role: 'member', status: 'active' }];
      }
      if (teamNet.server) return teamNet.server.select(table, _token, query);
      if (table !== 'org_vault_notes') return [];
      const m = /path=eq\.([^&]+)/.exec(query);
      const only = m ? (JSON.parse(decodeURIComponent(m[1]!)) as string) : undefined;
      return [...team.keys()].filter((p) => only === undefined || p === only).map(row);
    },
    rpc: async (fn: string, token: string, args: Record<string, unknown>) => {
      if (!fn.startsWith('org_vault_')) return null;
      teamNet.calls.push(fn);
      if (teamNet.fail) throw teamNet.fail;
      if (teamNet.rpcFail) throw teamNet.rpcFail;
      if (teamNet.server) return teamNet.server.rpc(fn, token, args);
      if (fn === 'org_vault_settings_get' && teamNet.settings) {
        return {
          settings: teamNet.settings,
          delete_role: 'member',
          context_folder: null,
          rev: 1,
          updated_at: 's1',
          updated_by: null,
          entitled: true,
          entitled_until: null,
          is_admin: true,
        };
      }
      if (fn === 'org_vault_settings_put') {
        teamNet.settingsPuts.push(args.p_settings);
        return { ok: true, rev: 2, updated_at: 's2' };
      }
      const path = args.p_path as string;
      const theirs = (p: string) => {
        const r = row(p);
        return { path: p, body: r.body, rev: r.rev, updated_at: r.updated_at, updated_by: null };
      };
      // Revs never repeat, as with the server's sequence (0021).
      const nextRev = () => Math.max(0, ...[...team.values()].map((r) => r.rev)) + 1;
      if (fn === 'org_vault_remove') {
        const prev = team.get(path);
        if (!prev) return { ok: true, path };
        if (prev.rev !== args.p_if_match)
          return { ok: false, conflict: 'changed', theirs: theirs(path) };
        team.delete(path);
        return { ok: true, path, rev: nextRev() };
      }
      if (fn !== 'org_vault_write') return null;
      await teamNet.beforePut?.(args);
      const body = args.p_body as string;
      const base = (args.p_if_match as number | undefined) ?? 0;
      teamNet.puts.push({ token, path, body, base });
      const prev = team.get(path);
      if (args.p_if_absent) {
        const taken = [...team.keys()].find((k) => k.toLowerCase() === path.toLowerCase());
        if (taken) return { ok: false, conflict: 'exists', theirs: theirs(taken) };
      } else {
        if (!prev) return { ok: false, conflict: 'missing' };
        if (prev.rev !== base) return { ok: false, conflict: 'changed', theirs: theirs(path) };
      }
      team.set(path, { body, rev: nextRev() });
      const r = row(path);
      return { ok: true, path, rev: r.rev, updated_at: r.updated_at, size: r.size };
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
    isGdriveConnected: async () => driveConnected,
    setOrgVaultAuth: (token: () => Promise<string | undefined>) => {
      wiring.storeToken = token;
    },
    resetOrgVault: org.resetOrgVault,
    onOrgVaultPlan: org.onOrgVaultPlan,
    setOrgVaultDeleteRole: org.setOrgVaultDeleteRole,
  };
});

const { useApp } = await import('../src/state/store.js');
const { closeVaultIndex, currentVaultIndex, vaultIndexStatus } =
  await import('../src/lib/vaultIndexHost.js');
const { SupabaseRequestError } = await import('../src/lib/supabase.js');
const { clearVaultTodayCache } = await import('../src/lib/vaultToday.js');

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
  desk.bring = undefined;
  desk.onBring = undefined;
  mem.clear();
  failKeys.clear();
  lockedKeys.clear();
  for (const p of Object.values(byId)) p.reset();
  team.clear();
  teamNet.fail = undefined;
  teamNet.rpcFail = undefined;
  teamNet.beforePut = undefined;
  teamNet.puts = [];
  teamNet.heads = 0;
  teamNet.calls = [];
  teamNet.settings = undefined;
  teamNet.settingsPuts = [];
  teamNet.server = undefined;
  teamToken = 'tok';
  auth.refresh = undefined;
  auth.nextUser = { id: 'u1', email: 'me@example.com' };
  wiring.org!.setOrgVaultAuth(
    async () => teamToken,
    () => true,
  );
  leaseHolder = 'me';
  leaseLabel = undefined;
  driveConnected = true;
  desk.on = false;
  desk.info = undefined;
  desk.pick = undefined;
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
    vaultLeaseOther: undefined,
    vaultTeamExpired: undefined,
    vaultFolder: undefined,
    vaultListed: undefined,
    vaultMoving: undefined,
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
    // The creates primed the cache from their write results (Vault M2 2.1).
    expect(local.counts.reads).toBe(0);
    // Another writer changes one: only that one is read again.
    files.set('b.md', 'written elsewhere');
    local.counts.reads = 0;
    await useApp.getState().vaultReadAll();
    expect(local.counts.reads).toBe(1);
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

  it('the team vault is never read-only for a lease, and writes none', async () => {
    leaseHolder = 'other-device';
    teamScope();
    await useApp.getState().vaultAcquireLease();
    expect(useApp.getState().vaultLeaseHeldByOther).toBe(false);
    expect(teamNet.puts).toEqual([]);
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
    expect(useApp.getState().toast).toMatch(/is kept as ".*", since the note changed elsewhere/);
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
    expect(pending()[`org::${ORG}::plan.md`]).toMatchObject({ text: 'start A then B', base: '2' });
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

  // CTO G3: a team entry stashed before M2 without a rev keeps its old base,
  // which can never equal a rev string, so it resolves as keep both: the note
  // is untouched and the draft lands beside it. Nothing is lost.
  it('a team draft stashed with no rev keeps both, and never writes over the note', async () => {
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
    expect(team.get('plan.md')).toEqual({ body: 'five revisions in', rev: 5 });
    const copy = [...team.keys()].find((k) => k.startsWith('plan (conflict '));
    expect(copy && team.get(copy)?.body).toBe('typed offline');
    expect(teamNet.puts.every((p) => p.path !== 'plan.md')).toBe(true);
    expect(pending()).toEqual({});
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

  it('a plan that lapsed mid-edit (OV402) holds the text and turns the team read-only, calmly', async () => {
    teamScope();
    teamNet.fail = new SupabaseRequestError('the plan is not active', 400, 'OV402');
    await useApp.getState().vaultSave('plan.md', 'our plan');
    expect(pending()).toEqual({});
    expect(useApp.getState().vaultHeld[0]).toMatchObject({
      path: 'plan.md',
      text: 'our plan',
      reason: 'The team plan is not active, so team notes cannot change.',
    });
    expect(useApp.getState().vaultTeamPlan).toMatchObject({ entitled: false });
    const caps = useApp.getState().vaultCapsNow();
    expect([caps.rename, caps.trash, caps.taskWriteBack, caps.settingsWrite]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    teamNet.fail = undefined;
    useApp.setState({ vaultTeamPlan: undefined });
  });

  it("a member's delete refused under admins-only (OV403) says the Y14 line, and nothing goes", async () => {
    teamScope();
    team.set('n.md', { body: 'keep', rev: 5 });
    await useApp.getState().vaultRefresh();
    teamNet.rpcFail = new SupabaseRequestError(
      'only admins can delete team notes here',
      400,
      'OV403',
    );
    const r = await useApp.getState().vaultDeleteNote('n.md');
    expect(r).toEqual({
      ok: false,
      reason: 'storage',
      line: 'Not deleted. Only admins can delete team notes.',
    });
    expect(team.get('n.md')?.body).toBe('keep');
    teamNet.rpcFail = undefined;
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

  // Vault M2 2.6: an expiry with a team note open keeps the note.
  async function expireOnTeamNote() {
    teamScope();
    useStoreToken();
    team.set('plan.md', { body: 'the team plan', rev: 1 });
    team.set('other.md', { body: 'another team note', rev: 1 });
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen('plan.md');
    const at = useApp.getState().vaultTargetRef();
    useApp.setState({ authSession: session(auth.nextUser, -1000) });
    auth.refresh = new SupabaseRequestError('invalid grant', 400);
    await useApp.getState().refreshOrgRole();
    auth.refresh = undefined;
    return at;
  }

  it('an expired sign-in keeps the open team note, read-only, and nothing else of the team', async () => {
    const at = await expireOnTeamNote();
    const st = useApp.getState();
    expect(st.authSession).toBeUndefined();
    expect(st.vaultTeamExpired).toBe(true);
    expect(st.vaultScope).toBe('team');
    expect(st.vaultNote).toMatchObject({ path: 'plan.md', text: 'the team plan' });
    expect(st.vaultFiles.map((f) => f.path)).toEqual(['plan.md']);
    // A refresh (a focus return) lists nothing and blames no connection.
    const puts = teamNet.puts.length;
    await useApp.getState().vaultRefresh();
    expect(useApp.getState().vaultError).toBeUndefined();
    expect(useApp.getState().vaultFiles.map((f) => f.path)).toEqual(['plan.md']);
    // Text typed as it expired waits for the same person, sealed.
    await useApp.getState().vaultSave('plan.md', 'typed as it expired', at);
    expect(teamNet.puts.length).toBe(puts);
    expect(pending()[`org::${ORG}::plan.md`]).toMatchObject({ text: 'typed as it expired' });
  });

  it('signing back in as the same person goes on with the kept note and sends its text', async () => {
    const at = await expireOnTeamNote();
    await useApp.getState().vaultSave('plan.md', 'typed as it expired', at);
    await useApp.getState().signIn('me@example.com', 'pw');
    await tick();
    await tick();
    const st = useApp.getState();
    expect(st.vaultTeamExpired).toBeUndefined();
    expect(st.vaultScope).toBe('team');
    expect(st.vaultNote?.path).toBe('plan.md');
    await useApp.getState().vaultRefresh();
    expect(team.get('plan.md')?.body).toBe('typed as it expired');
  });

  it('another account signing in after an expiry never sees the kept team note', async () => {
    await expireOnTeamNote();
    auth.nextUser = { id: 'u2', email: 'b@example.com' };
    await useApp.getState().signIn('b@example.com', 'pw');
    const st = useApp.getState();
    expect(st.vaultTeamExpired).toBeUndefined();
    expect(st.vaultScope).toBe('personal');
    expect(st.vaultNote).toBeUndefined();
  });

  it('leaving the kept team note goes back to the personal vault', async () => {
    await expireOnTeamNote();
    useApp.getState().vaultCloseNote();
    const st = useApp.getState();
    expect(st.vaultTeamExpired).toBeUndefined();
    expect(st.vaultScope).toBe('personal');
    expect(st.vaultFiles.some((f) => f.path === 'other.md')).toBe(false);
  });

  it('a sign-out never keeps the team note', async () => {
    teamScope();
    team.set('plan.md', { body: 'the team plan', rev: 1 });
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen('plan.md');
    await useApp.getState().signOutAccount();
    expect(useApp.getState().vaultNote).toBeUndefined();
    expect(useApp.getState().vaultScope).toBe('personal');
    expect(useApp.getState().vaultTeamExpired).toBeUndefined();
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

  // X2: with no Google account on this device the list fails for want of
  // the account, and the read-only card says so; a toast blaming the
  // connection would contradict it. With the account there, a failed list is
  // the connection, and the toast says so.
  it('a list that fails for want of the Google account shows no connection toast', async () => {
    drive.fail.list = true;
    driveConnected = false;
    await useApp.getState().vaultRefresh();
    expect(useApp.getState().vaultError).toBe('load');
    expect(useApp.getState().toast).toBeUndefined();
    driveConnected = true;
    await useApp.getState().vaultRefresh();
    expect(useApp.getState().toast).toMatch(/Could not reach your vault storage/);
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

// T5: a sign-out deletes the account's unsent team text from this device
// (R-19), and text stashed offline does not show under Not saved, so Sign out
// asks first. "Stay signed in" keeps every entry; only "Sign out and delete"
// wipes. Mounted in a small real DOM over the real store.
describe('Sign out asks before it deletes unsent team text (T5)', () => {
  beforeEach(reset);
  let dom: import('./support/dom.js').TestDom | undefined;
  afterEach(async () => {
    await dom?.unmount();
    dom = undefined;
  });

  async function mountCard() {
    const { mountDom } = await import('./support/dom.js');
    dom = await mountDom();
    const { SignInCard } = await import('../src/components/SignInCard.js');
    await dom.render(createElement(SignInCard));
    return dom;
  }

  it("counts only the signed-in account's unsent team text", async () => {
    expect(await useApp.getState().unsentTeamTextCount()).toBe(0);
    teamScope();
    teamNet.fail = new TypeError('Failed to fetch');
    await useApp.getState().vaultSave('plan.md', 'unsent team draft');
    teamNet.fail = undefined;
    expect(await useApp.getState().unsentTeamTextCount()).toBe(1);
    useApp.setState({ authSession: session({ id: 'u2', email: 'b@example.com' }) });
    expect(await useApp.getState().unsentTeamTextCount()).toBe(0);
  });

  it('with a stashed team entry, Sign out opens the ask, and Stay signed in keeps it', async () => {
    teamScope();
    teamNet.fail = new TypeError('Failed to fetch');
    await useApp.getState().vaultSave('plan.md', 'unsent team draft');
    teamNet.fail = undefined;
    const key = `org::${ORG}::plan.md`;
    expect(Object.keys(pending())).toEqual([key]);

    const card = await mountCard();
    await card.click('Sign out');
    await card.settle();
    expect(card.text()).toContain('Team text not sent yet');
    expect(card.text()).toContain(
      'One team vault note has text that has not reached your team yet. Signing out deletes it from this device.',
    );
    await card.click('Stay signed in');
    await card.settle();
    expect(useApp.getState().authSession?.user.id).toBe('u1');
    expect(Object.keys(pending())).toEqual([key]);

    // The only way to the wipe is its own button.
    await card.click('Sign out');
    await card.settle();
    await card.click('Sign out and delete');
    await signedOut(card);
    expect(pending()).toEqual({});
    // The card turns to Sign in, and the ask plays its exit, never a cut.
    expect(card.text()).toContain('Sign in');
    expect(card.container.querySelector('.confirm-card.closing')).not.toBeNull();
  });

  // Sign out runs a chain with real asynchronous work in it, not only
  // promise ticks: the team index's storage key is a SHA-256 digest
  // (crypto.subtle, answered from the platform's thread pool), and the sealed
  // store is read and written on the way. One macrotask (`card.settle()`) is
  // usually enough and, on a loaded machine, sometimes not, which is how this
  // row failed now and then. So it waits for the sign-out's own outcome, and
  // then for the card to render it.
  async function signedOut(card: import('./support/dom.js').TestDom): Promise<void> {
    await vi.waitFor(() => expect(useApp.getState().authSession).toBeUndefined());
    await card.settle();
  }

  it('with nothing unsent, Sign out signs out without asking', async () => {
    teamScope();
    const card = await mountCard();
    await card.click('Sign out');
    await signedOut(card);
    expect(card.text()).not.toContain('Team text not sent yet');
    expect(card.text()).toContain('Sign in');
  });
});

// Vault M1, 1.1: on a provider that enforces compare-and-swap (the desktop
// folder; here the in-memory fake with `cas`), a change made somewhere else is
// never overwritten. A clean note reloads in place, a dirty one pauses and
// asks, and nothing the person typed is lost on any path.
describe('compare-and-swap on the folder (1.1)', () => {
  const F = folder.files;
  // Open a note on the folder, as the Vault room does.
  async function openOnFolder(path = 'n.md', text = 'loaded') {
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('files') },
    });
    F.set(path, text);
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen(path);
    expect(useApp.getState().vaultNote?.version).toBe(folder.version(path));
  }
  beforeEach(() => {
    reset();
    useApp.setState({ vaultConflict: undefined, vaultReturnFolder: undefined });
  });

  it('store.ts writes to a provider in exactly one place, with a required guard', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/state/store.ts', import.meta.url), 'utf8');
    const writes = [...src.matchAll(/\.write\(/g)];
    expect(writes).toHaveLength(1);
    const helper = src.indexOf('function putVaultNote(');
    expect(helper).toBeGreaterThan(-1);
    expect(writes[0]!.index).toBeGreaterThan(helper);
    expect(src.slice(helper, writes[0]!.index)).toMatch(/guard: WriteGuard,/);
  });

  it('every save carries the version it was typed against', async () => {
    await openOnFolder();
    const base = folder.version('n.md');
    await useApp.getState().vaultSave('n.md', 'mine');
    expect(folder.counts.writes.at(-1)).toEqual({ path: 'n.md', guard: { ifMatch: base } });
    expect(F.get('n.md')).toBe('mine');
    expect(useApp.getState().vaultNote?.version).toBe(folder.version('n.md'));
  });

  it('an external change reloads a clean draft and pauses a dirty one', async () => {
    await openOnFolder();
    // Clean: the editor holds what was loaded, so the note reloads in place.
    useApp.getState().vaultNoteDraft('n.md', 'loaded');
    F.set('n.md', 'written by the agent');
    await useApp.getState().vaultRecheck({ reason: 'watch', paths: ['n.md'] });
    let st = useApp.getState();
    expect(st.vaultNote?.text).toBe('written by the agent');
    expect(st.vaultNote?.reloadedFrom).toBe('elsewhere');
    expect(st.vaultNote?.reloaded).toBe(1);
    expect(st.vaultConflict).toBeUndefined();
    expect(st.toast).toBeUndefined();

    // Dirty: the person has typed; the note changes again; nothing is
    // written over it, and the choice waits.
    useApp.getState().vaultNoteDraft('n.md', 'my unsaved words');
    F.set('n.md', 'written by Obsidian');
    await useApp.getState().vaultRecheck({ reason: 'focus' });
    st = useApp.getState();
    expect(st.vaultNote?.text).toBe('written by the agent');
    expect(st.vaultConflict).toMatchObject({
      path: 'n.md',
      kind: 'changed',
      base: 'written by the agent',
      theirs: { text: 'written by Obsidian' },
      deferred: false,
    });
    expect(st.vaultConflict?.copyPath).toMatch(conflictCopy('n'));
    // Autosave is paused: what they type goes to the stash, never the note.
    await useApp.getState().vaultSave('n.md', 'my unsaved words, more');
    expect(F.get('n.md')).toBe('written by Obsidian');
    expect(Object.values(pending())).toMatchObject([
      { path: 'n.md', text: 'my unsaved words, more' },
    ]);
  });

  it('a conflict whose theirs equals the loaded text saves silently (a touch)', async () => {
    await openOnFolder();
    // A sync client rewrites the same bytes: a new version, the same text.
    F.set('n.md', 'loaded');
    await useApp.getState().vaultSave('n.md', 'mine');
    const st = useApp.getState();
    expect(F.get('n.md')).toBe('mine');
    expect(st.vaultConflict).toBeUndefined();
    expect(st.toast).toBeUndefined();
    expect(st.vaultNote?.version).toBe(folder.version('n.md'));
  });

  it('theirs equal to the draft adopts the version, with no sheet and no write', async () => {
    await openOnFolder();
    useApp.getState().vaultNoteDraft('n.md', 'same change');
    F.set('n.md', 'same change');
    const writes = folder.counts.writes.length;
    await useApp.getState().vaultRecheck({ reason: 'watch', paths: ['n.md'] });
    const st = useApp.getState();
    expect(st.vaultConflict).toBeUndefined();
    expect(st.vaultNote).toMatchObject({ text: 'same change', version: folder.version('n.md') });
    expect(folder.counts.writes.length).toBe(writes);
  });

  it("our own save's watch event changes nothing", async () => {
    await openOnFolder();
    useApp.getState().vaultNoteDraft('n.md', 'mine');
    await useApp.getState().vaultSave('n.md', 'mine');
    const before = useApp.getState().vaultNote;
    await useApp.getState().vaultRecheck({ reason: 'watch', paths: ['n.md'] });
    expect(useApp.getState().vaultNote).toBe(before);
    expect(useApp.getState().vaultConflict).toBeUndefined();
  });

  it('a recheck during an in-flight save raises no conflict', async () => {
    await openOnFolder();
    useApp.getState().vaultNoteDraft('n.md', 'mine');
    const save = useApp.getState().vaultSave('n.md', 'mine');
    // The watch event for our own write lands while the save is running.
    const recheck = useApp.getState().vaultRecheck({ reason: 'watch', paths: ['n.md'] });
    await Promise.all([save, recheck]);
    expect(useApp.getState().vaultConflict).toBeUndefined();
    expect(F.get('n.md')).toBe('mine');
  });

  it('a save typed against an older version pauses and asks, and writes nothing', async () => {
    await openOnFolder();
    F.set('n.md', 'theirs');
    await useApp.getState().vaultSave('n.md', 'mine');
    expect(F.get('n.md')).toBe('theirs');
    expect(useApp.getState().vaultConflict).toMatchObject({
      kind: 'changed',
      theirs: { text: 'theirs' },
    });
    expect(Object.values(pending())).toMatchObject([{ path: 'n.md', text: 'mine' }]);
  });

  it('a second change while open updates the conflict in place', async () => {
    await openOnFolder();
    useApp.getState().vaultNoteDraft('n.md', 'mine');
    F.set('n.md', 'theirs 1');
    await useApp.getState().vaultRecheck({ reason: 'focus' });
    const copyPath = useApp.getState().vaultConflict?.copyPath;
    F.set('n.md', 'theirs 2');
    await useApp.getState().vaultRecheck({ reason: 'watch', paths: ['n.md'] });
    expect(useApp.getState().vaultConflict).toMatchObject({
      theirs: { text: 'theirs 2' },
      again: true,
      copyPath,
    });
  });

  it('replay skips a note with an open conflict', async () => {
    await openOnFolder();
    useApp.getState().vaultNoteDraft('n.md', 'mine');
    F.set('n.md', 'theirs');
    await useApp.getState().vaultRecheck({ reason: 'focus' });
    await useApp.getState().vaultRefresh();
    expect(F.get('n.md')).toBe('theirs');
    expect([...F.keys()]).toEqual(['n.md']);
    expect(Object.keys(pending())).toHaveLength(1);
  });

  it('Keep both writes the copy with ifAbsent under the name shown, then shows theirs', async () => {
    await openOnFolder();
    useApp.getState().vaultNoteDraft('n.md', 'mine');
    F.set('n.md', 'theirs');
    await useApp.getState().vaultRecheck({ reason: 'focus' });
    const shown = useApp.getState().vaultConflict!.copyPath;
    const r = await useApp.getState().vaultResolve('both', 'mine');
    expect(r.ok).toBe(true);
    expect(F.get(shown)).toBe('mine');
    expect(folder.counts.writes.at(-1)).toEqual({ path: shown, guard: { ifAbsent: true } });
    const st = useApp.getState();
    expect(F.get('n.md')).toBe('theirs');
    expect(st.vaultNote).toMatchObject({ path: 'n.md', text: 'theirs', reloadedFrom: 'resolve' });
    expect(st.vaultConflict).toBeUndefined();
    expect(st.toast).toBe(`Kept both. Yours is "${shown.replace(/\.md$/, '')}".`);
    expect(pending()).toEqual({});
    expect(st.vaultHeld).toEqual([]);
  });

  it('a taken copy name gets the counter, never an overwrite', async () => {
    await openOnFolder();
    useApp.getState().vaultNoteDraft('n.md', 'mine');
    F.set('n.md', 'theirs');
    await useApp.getState().vaultRecheck({ reason: 'focus' });
    const shown = useApp.getState().vaultConflict!.copyPath;
    F.set(shown, 'someone got there first');
    await useApp.getState().vaultResolve('both', 'mine');
    expect(F.get(shown)).toBe('someone got there first');
    const second = [...F.keys()].find((p) => p !== shown && p !== 'n.md')!;
    expect(second).toMatch(/ 2\)\.md$/);
    expect(F.get(second)).toBe('mine');
  });

  it('Keep yours writes with ifMatch on the other version', async () => {
    await openOnFolder();
    useApp.getState().vaultNoteDraft('n.md', 'mine');
    F.set('n.md', 'theirs');
    await useApp.getState().vaultRecheck({ reason: 'focus' });
    const theirsVersion = folder.version('n.md');
    const r = await useApp.getState().vaultResolve('mine', 'mine');
    expect(r.ok).toBe(true);
    expect(folder.counts.writes.at(-1)).toEqual({
      path: 'n.md',
      guard: { ifMatch: theirsVersion },
    });
    expect(F.get('n.md')).toBe('mine');
    expect(useApp.getState().vaultConflict).toBeUndefined();
    expect(useApp.getState().toast).toBe('Kept yours.');
  });

  it('Keep yours that meets yet another change updates the sheet and writes nothing', async () => {
    await openOnFolder();
    useApp.getState().vaultNoteDraft('n.md', 'mine');
    F.set('n.md', 'theirs 1');
    await useApp.getState().vaultRecheck({ reason: 'focus' });
    F.set('n.md', 'theirs 2');
    const r = await useApp.getState().vaultResolve('mine', 'mine');
    expect(r).toEqual({ ok: false });
    expect(F.get('n.md')).toBe('theirs 2');
    expect(useApp.getState().vaultConflict).toMatchObject({
      theirs: { text: 'theirs 2' },
      again: true,
    });
  });

  it('Keep the other version loads theirs and writes nothing', async () => {
    await openOnFolder();
    useApp.getState().vaultNoteDraft('n.md', 'mine');
    F.set('n.md', 'theirs');
    await useApp.getState().vaultRecheck({ reason: 'focus' });
    const writes = folder.counts.writes.length;
    await useApp.getState().vaultResolve('theirs', 'mine');
    expect(folder.counts.writes.length).toBe(writes);
    expect(useApp.getState().vaultNote?.text).toBe('theirs');
    expect(pending()).toEqual({});
    expect(useApp.getState().vaultHeld).toEqual([]);
  });

  it('leaving a changed note keeps both: the copy is written with ifAbsent and named', async () => {
    await openOnFolder();
    useApp.getState().vaultNoteDraft('n.md', 'mine');
    F.set('n.md', 'theirs');
    await useApp.getState().vaultRecheck({ reason: 'focus' });
    const shown = useApp.getState().vaultConflict!.copyPath;
    await useApp.getState().vaultLeaveConflict();
    expect(F.get(shown)).toBe('mine');
    expect(F.get('n.md')).toBe('theirs');
    expect(useApp.getState().toast).toBe(
      `You left before choosing, so both are kept. Yours is "${shown.replace(/\.md$/, '')}".`,
    );
    expect(pending()).toEqual({});
  });

  it('a clean note deleted elsewhere closes to its folder with one toast', async () => {
    await openOnFolder('ideas/n.md');
    useApp.getState().vaultNoteDraft('ideas/n.md', 'loaded');
    F.delete('ideas/n.md');
    await useApp.getState().vaultRecheck({ reason: 'watch', paths: ['ideas/n.md'] });
    const st = useApp.getState();
    expect(st.vaultNote).toBeUndefined();
    expect(st.vaultTakeReturnFolder()).toBe('ideas');
    expect(st.toast).toBe(
      '"n" is no longer in your vault. It was moved or deleted somewhere else.',
    );
  });

  it('a deleted note with a dirty draft asks; leaving puts the text under Not saved and creates no file', async () => {
    await openOnFolder();
    useApp.getState().vaultNoteDraft('n.md', 'mine');
    F.delete('n.md');
    await useApp.getState().vaultRecheck({ reason: 'focus' });
    expect(useApp.getState().vaultConflict).toMatchObject({ kind: 'missing' });
    await useApp.getState().vaultLeaveConflict();
    expect(F.has('n.md')).toBe(false);
    expect([...F.keys()]).toEqual([]);
    expect(useApp.getState().vaultHeld).toMatchObject([
      {
        path: 'n.md',
        text: 'mine',
        reason: 'The note was moved or deleted somewhere else before this text was saved.',
      },
    ]);
  });

  it('Save it again on a gone note creates it with ifAbsent', async () => {
    await openOnFolder();
    useApp.getState().vaultNoteDraft('n.md', 'mine');
    F.delete('n.md');
    await useApp.getState().vaultRecheck({ reason: 'focus' });
    const r = await useApp.getState().vaultResolve('mine', 'mine');
    expect(r.ok).toBe(true);
    expect(folder.counts.writes.at(-1)).toEqual({ path: 'n.md', guard: { ifAbsent: true } });
    expect(F.get('n.md')).toBe('mine');
    expect(useApp.getState().toast).toBe('Saved "n" again.');
  });

  it('a quit with an open conflict replays as a conflict copy on the next launch', async () => {
    await openOnFolder();
    useApp.getState().vaultNoteDraft('n.md', 'mine');
    F.set('n.md', 'theirs');
    await useApp.getState().vaultRecheck({ reason: 'focus' });
    // The app quits: the conflict was only in memory; the stash is sealed.
    useApp.setState({ vaultConflict: undefined, vaultNote: undefined });
    await useApp.getState().vaultRefresh();
    expect(F.get('n.md')).toBe('theirs');
    const copy = [...F.keys()].find((p) => conflictCopy('n').test(p))!;
    expect(F.get(copy)).toBe('mine');
    expect(pending()).toEqual({});
  });

  it('a create meets a name taken since the list loaded and opens theirs', async () => {
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('files') },
    });
    await useApp.getState().vaultRefresh();
    // Written by the agent between the create's stat and its write: the stat
    // is made to miss it, the guarded write does not.
    F.set('late.md', 'the agent wrote this');
    const stat = folder.provider.stat;
    folder.provider.stat = async () => undefined;
    try {
      await useApp.getState().vaultCreate('late');
    } finally {
      folder.provider.stat = stat;
    }
    expect(F.get('late.md')).toBe('the agent wrote this');
    expect(folder.counts.writes.at(-1)).toEqual({ path: 'late.md', guard: { ifAbsent: true } });
    expect(useApp.getState().vaultNote).toMatchObject({
      path: 'late.md',
      text: 'the agent wrote this',
    });
  });
});

// Vault M1 1.3: on the desktop the vault is the folder the agent, routines,
// and Obsidian share. A new personal vault is made there; an empty default
// Local one simply points there; a Local one holding notes gets the one-time
// card and moves through vaultMoveTo, keeping the sealed copy (D7).
// Vault M2 wave 0: a remove answers with a RemoveResult, and every delete
// the store makes is guarded, so a delete typed against an older version
// never removes the newer one. It takes the M1 recheck path instead.
describe('a stale delete never removes a newer version (M2 wave 0)', () => {
  const F = folder.files;
  async function openOnFolder(path = 'n.md', text = 'loaded') {
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('files') },
    });
    F.set(path, text);
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen(path);
    useApp.getState().vaultNoteDraft(path, text);
  }
  beforeEach(() => {
    reset();
    useApp.setState({ vaultConflict: undefined, vaultReturnFolder: undefined });
  });

  it('a delete carries the version the note was loaded at, and removes it', async () => {
    await openOnFolder();
    const base = folder.version('n.md');
    expect(await useApp.getState().vaultDelete('n.md')).toBe(true);
    expect(folder.counts.removes).toEqual([{ path: 'n.md', guard: { ifMatch: base } }]);
    expect(F.has('n.md')).toBe(false);
    expect(useApp.getState().vaultNote).toBeUndefined();
  });

  it('a clean note changed elsewhere is not deleted, and the newer version opens', async () => {
    await openOnFolder();
    F.set('n.md', 'written by the agent');
    expect(await useApp.getState().vaultDelete('n.md')).toBe(false);
    const st = useApp.getState();
    expect(F.get('n.md')).toBe('written by the agent');
    expect(st.vaultNote).toMatchObject({ path: 'n.md', text: 'written by the agent' });
    expect(st.vaultNote?.version).toBe(folder.version('n.md'));
    expect(st.vaultConflict).toBeUndefined();
    expect(st.toast).toBe(
      'Not deleted. "n" changed somewhere else since you opened it. The newer version is open now.',
    );
  });

  it('a note with unsaved edits changed elsewhere raises the changed sheet and keeps the text', async () => {
    await openOnFolder();
    useApp.getState().vaultNoteDraft('n.md', 'my unsaved words');
    F.set('n.md', 'written by Obsidian');
    expect(await useApp.getState().vaultDelete('n.md')).toBe(false);
    const st = useApp.getState();
    expect(F.get('n.md')).toBe('written by Obsidian');
    expect(st.vaultConflict).toMatchObject({
      path: 'n.md',
      kind: 'changed',
      theirs: { text: 'written by Obsidian' },
    });
    expect(Object.values(pending())).toMatchObject([{ path: 'n.md', text: 'my unsaved words' }]);
    expect(st.toast).toBe('Not deleted. "n" changed somewhere else since you opened it.');
  });

  it('a touch (same text, a new version) still deletes', async () => {
    await openOnFolder();
    F.set('n.md', 'loaded');
    expect(await useApp.getState().vaultDelete('n.md')).toBe(true);
    expect(F.has('n.md')).toBe(false);
    expect(folder.counts.removes).toHaveLength(2);
  });

  it('a note still downloading is not deleted, and says so', async () => {
    await openOnFolder();
    folder.evicted.add('n.md');
    expect(await useApp.getState().vaultDelete('n.md')).toBe(false);
    expect(F.get('n.md')).toBe('loaded');
    expect(useApp.getState().toast).toBe(
      'Not deleted. "n" is still downloading to this device. Try again in a moment.',
    );
  });

  it('settling a fork removes the moved copy only at the version it read', async () => {
    const pair = { from: 'a.md', to: 'a (conflict 2026-09-27 1405).md' };
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('files') },
    });
    F.set(pair.from, 'already there');
    F.set(pair.to, 'the one you moved');
    const shown = (await useApp.getState().vaultReadForkPair(pair))!;
    expect(await useApp.getState().vaultSettleFork(pair, 'theirs', shown)).toEqual({ ok: true });
    expect(folder.counts.removes).toEqual([
      { path: pair.to, guard: { ifMatch: shown.moved.version } },
    ]);
  });

  it('a refused move never takes back a copy someone wrote over since', async () => {
    local.files.set('a.md', 'alpha');
    local.files.set('b.md', 'beta');
    await useApp.getState().vaultRefresh();
    folder.hideFromList.add('b.md');
    const list = folder.provider.list;
    // The agent writes over the moved a.md before the move checks the folder.
    folder.provider.list = async () => {
      if (F.get('a.md') === 'alpha') F.set('a.md', 'the agent wrote this');
      return list();
    };
    try {
      const res = await useApp.getState().vaultMoveTo('files');
      expect(res).toMatchObject({ ok: false, reason: 'unverified', left: ['a.md'] });
    } finally {
      folder.provider.list = list;
    }
    expect(F.get('a.md')).toBe('the agent wrote this');
    expect(F.has('b.md')).toBe(false);
  });
});

describe('the desktop defaults to the folder (1.3)', () => {
  const FOLDER = {
    dir: '/home/me/OSCode/Vault',
    display: '~/OSCode/Vault',
    exists: true,
    os: 'linux',
    obsidian: 'none',
    count: 0,
  };
  beforeEach(() => {
    reset();
    desk.on = true;
    desk.info = { ...FOLDER };
  });
  const row = () =>
    (useApp.getState().settings.gitosResources ?? []).find((r) => r.id === 'vault.personal');

  it('a fresh desktop lands on the folder with no card and no toast', async () => {
    folder.files.set('Run 2026-09-27.md', 'routine note');
    await useApp.getState().vaultRefresh();
    expect(row()?.providerId).toBe('files');
    expect(useApp.getState().vaultFiles.map((f) => f.path)).toEqual(['Run 2026-09-27.md']);
    expect(useApp.getState().vaultFolderOfferShown()).toBe(false);
    expect(useApp.getState().toast).toBeUndefined();
    expect(useApp.getState().vaultListed).toBe(true);
  });

  it('off the desktop a fresh vault is still made on This device', async () => {
    desk.on = false;
    await useApp.getState().vaultRefresh();
    expect(row()?.providerId).toBe('local');
  });

  it('an empty default Local vault repoints once, with the toast, copying nothing', async () => {
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('local') },
    });
    folder.files.set('agent.md', 'from the agent');
    await useApp.getState().vaultRefresh();
    expect(row()?.providerId).toBe('files');
    expect(row()?.chosenAt).toBeUndefined();
    expect(useApp.getState().toast).toBe(
      'Your vault now uses ~/OSCode/Vault, the same folder as your agent and routines.',
    );
    expect(useApp.getState().vaultFiles.map((f) => f.path)).toEqual(['agent.md']);
    expect(folder.counts.writes).toEqual([]);
  });

  it('an empty Local vault with stashed text stays put', async () => {
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('local') },
    });
    mem.set(
      PENDING,
      JSON.stringify({
        'local::vault.personal::a.md': {
          providerId: 'local',
          resourceId: 'vault.personal',
          path: 'a.md',
          text: 'typed',
          at: new Date().toISOString(),
        },
      }),
    );
    local.fail.write = true;
    await useApp.getState().vaultRefresh();
    expect(row()?.providerId).toBe('local');
  });

  it('a failed Local list neither repoints nor offers', async () => {
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('local') },
    });
    fail.list = true;
    await useApp.getState().vaultRefresh();
    expect(row()?.providerId).toBe('local');
    expect(useApp.getState().vaultFolderOfferShown()).toBe(false);
  });

  it('a Local vault the person chose is never offered or repointed', async () => {
    useApp.setState({
      settings: {
        ...useApp.getState().settings,
        gitosResources: [{ ...personalOn('local')[0]!, chosenAt: '2026-09-01T00:00:00Z' }],
      },
    });
    await useApp.getState().vaultRefresh();
    expect(row()?.providerId).toBe('local');
    files.set('a.md', 'alpha');
    await useApp.getState().vaultRefresh();
    expect(useApp.getState().vaultFolderOfferShown()).toBe(false);
  });

  it('three Local notes show the card, and the move lands them all, keeping the Local copy', async () => {
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('local') },
    });
    files.set('a.md', 'alpha');
    files.set('ideas/b.md', 'beta');
    files.set('c.md', 'gamma');
    await useApp.getState().vaultRefresh();
    expect(useApp.getState().vaultFolderOfferShown()).toBe(true);
    const res = await useApp.getState().vaultMoveTo('files');
    expect(res.ok).toBe(true);
    // Matching counts, note for note, and the sealed source untouched (D7).
    expect(res.moved).toHaveLength(3);
    expect([...folder.files.keys()].sort()).toEqual(['a.md', 'c.md', 'ideas/b.md']);
    expect(useApp.getState().vaultFiles).toHaveLength(3);
    expect([...files.keys()].sort()).toEqual(['a.md', 'c.md', 'ideas/b.md']);
    expect(files.get('ideas/b.md')).toBe('beta');
    // The move is the person's choice: stamped, and the offer is over.
    expect(row()?.providerId).toBe('files');
    expect(row()?.chosenAt).toBeDefined();
    expect(useApp.getState().vaultFolderOfferShown()).toBe(false);
    expect(useApp.getState().vaultMoving).toBe(false);
  });

  it('Keep it on this device hides the card; it returns once, after 7 days, only if the folder grew', async () => {
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('local') },
    });
    files.set('a.md', 'alpha');
    desk.info = { ...FOLDER, count: 2 };
    await useApp.getState().vaultRefresh();
    expect(useApp.getState().vaultFolderOfferShown()).toBe(true);
    await useApp.getState().vaultDeclineFolderMove();
    expect(useApp.getState().toast).toBe(
      'Your vault stays on this device. Where it lives can move it any time.',
    );
    expect(useApp.getState().vaultFolderOfferShown()).toBe(false);
    expect(useApp.getState().settings.vaultMoveOffer).toMatchObject({
      dismissals: 1,
      folderNotes: 2,
    });
    // Eight days on, the folder unchanged: still hidden.
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    useApp.setState({
      settings: {
        ...useApp.getState().settings,
        vaultMoveOffer: { dismissals: 1, at: eightDaysAgo, folderNotes: 2 },
      },
    });
    expect(useApp.getState().vaultFolderOfferShown()).toBe(false);
    // The agent wrote more there: it comes back, once.
    useApp.setState({ vaultFolder: { ...FOLDER, count: 5 } });
    expect(useApp.getState().vaultFolderOfferShown()).toBe(true);
    await useApp.getState().vaultDeclineFolderMove();
    expect(useApp.getState().settings.vaultMoveOffer?.dismissals).toBe(2);
    useApp.setState({ vaultFolder: { ...FOLDER, count: 50 } });
    expect(useApp.getState().vaultFolderOfferShown()).toBe(false);
    // The vault never moved.
    expect(row()?.providerId).toBe('local');
  });
});

// Vault M1 1.4 (CTO F7.6): a pick only repoints, and text typed against the
// old folder never replays into the new one.
describe('picking another folder (1.4)', () => {
  const OLD = {
    dir: '/home/me/OSCode/Vault',
    display: '~/OSCode/Vault',
    exists: true,
    os: 'linux',
    obsidian: 'none',
  };
  const NEW = { ...OLD, dir: '/home/me/Brain', display: '~/Brain', obsidian: 'vault' };
  beforeEach(() => {
    reset();
    desk.on = true;
    desk.info = { ...OLD };
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('files') },
    });
  });

  it('a draft stashed in the old folder is held naming it, never replayed into the new one', async () => {
    await useApp.getState().vaultRefresh();
    // Typed in the old folder while its write failed: stashed, with the folder.
    folder.fail.write = true;
    await useApp.getState().vaultSave('Plan.md', 'typed in the old folder');
    folder.fail.write = false;
    expect(Object.values(pending())[0]).toMatchObject({ folder: OLD.dir });
    desk.info = { ...NEW };
    desk.pick = {
      ok: true,
      info: { ...NEW },
      survey: { notes: 0, capped: false, otherFiles: 0, obsidian: true },
      previous: { display: OLD.display },
    };
    const r = await useApp.getState().vaultChooseFolder();
    expect(r?.ok).toBe(true);
    expect(useApp.getState().vaultFolder?.dir).toBe(NEW.dir);
    // Nothing landed in the (new) folder, and nothing waits to replay there.
    expect(folder.files.has('Plan.md')).toBe(false);
    expect(pending()).toEqual({});
    const held = useApp.getState().vaultHeld;
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      text: 'typed in the old folder',
      folder: OLD.dir,
      folderDisplay: OLD.display,
      reason:
        'Typed in ~/OSCode/Vault before your vault moved to another folder, so it was not saved there.',
    });
  });

  it('Bring holds the room still while it copies, then re-lists the folder', async () => {
    await useApp.getState().vaultRefresh();
    const result = { ok: true, moved: ['Brought.md'], skipped: [], forked: [] };
    desk.bring = result;
    let during: boolean | undefined;
    desk.onBring = () => {
      during = useApp.getState().vaultMoving;
      folder.files.set('Brought.md', 'from the earlier folder');
    };
    expect(await useApp.getState().vaultBringPrevious()).toEqual(result);
    expect(during).toBe(true);
    expect(useApp.getState().vaultMoving).toBe(false);
    expect(useApp.getState().vaultFiles.map((f) => f.path)).toContain('Brought.md');
    desk.onBring = undefined;
  });

  it('a refused pick changes nothing', async () => {
    await useApp.getState().vaultRefresh();
    desk.pick = { ok: false, refused: 'home' };
    const r = await useApp.getState().vaultChooseFolder();
    expect(r).toEqual({ ok: false, refused: 'home' });
    expect(useApp.getState().vaultFolder?.dir).toBe(OLD.dir);
  });
});

// Creative Studio 1d: settling a move's forked pair in the folder.
describe("settling a move's forked pairs (1d)", () => {
  const pair = { from: 'a.md', to: 'a (conflict 2026-09-27 1405).md' };
  beforeEach(() => {
    reset();
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('files') },
    });
    folder.files.set(pair.from, 'already there');
    folder.files.set(pair.to, 'the one you moved');
  });

  it('Keep the one you moved leaves one file, under the name, with the moved text', async () => {
    const shown = (await useApp.getState().vaultReadForkPair(pair))!;
    expect(shown.there.text).toBe('already there');
    const r = await useApp.getState().vaultSettleFork(pair, 'mine', shown);
    expect(r).toEqual({ ok: true });
    expect([...folder.files.keys()]).toEqual([pair.from]);
    expect(folder.files.get(pair.from)).toBe('the one you moved');
    // The rename wrote with the version it was shown (compare-and-swap).
    expect(folder.counts.writes.at(-1)?.guard).toEqual({ ifMatch: shown.there.version });
  });

  it('Keep the one already there removes only the moved copy', async () => {
    const shown = (await useApp.getState().vaultReadForkPair(pair))!;
    expect(await useApp.getState().vaultSettleFork(pair, 'theirs', shown)).toEqual({ ok: true });
    expect([...folder.files.keys()]).toEqual([pair.from]);
    expect(folder.files.get(pair.from)).toBe('already there');
  });

  it('a note that changed since it was shown is never written over or deleted', async () => {
    const shown = (await useApp.getState().vaultReadForkPair(pair))!;
    folder.files.set(pair.from, 'the agent wrote this since');
    expect(await useApp.getState().vaultSettleFork(pair, 'mine', shown)).toEqual({
      ok: false,
      changed: true,
    });
    expect(folder.files.get(pair.from)).toBe('the agent wrote this since');
    expect(folder.files.get(pair.to)).toBe('the one you moved');
    folder.files.set(pair.to, 'edited copy');
    expect(await useApp.getState().vaultSettleFork(pair, 'theirs', shown)).toEqual({
      ok: false,
      changed: true,
    });
    expect(folder.files.get(pair.to)).toBe('edited copy');
  });

  it('reads and settles the pair on the storage the vault is on now (review M1-2)', async () => {
    // A move back to This device forks there, never in the folder.
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('local') },
    });
    local.files.set(pair.from, 'already on this device');
    local.files.set(pair.to, 'moved back');
    const shown = (await useApp.getState().vaultReadForkPair(pair))!;
    expect(shown?.there.text).toBe('already on this device');
    expect(shown?.moved.text).toBe('moved back');
    expect(await useApp.getState().vaultSettleFork(pair, 'theirs', shown)).toEqual({ ok: true });
    expect([...local.files.keys()]).toEqual([pair.from]);
    // The folder's own pair is left alone.
    expect(folder.files.get(pair.to)).toBe('the one you moved');
  });

  it('a copy that cannot be removed after the rename says so, in part', async () => {
    const shown = (await useApp.getState().vaultReadForkPair(pair))!;
    folder.fail.remove = true;
    expect(await useApp.getState().vaultSettleFork(pair, 'mine', shown)).toEqual({
      ok: true,
      partial: true,
    });
    expect(folder.files.get(pair.from)).toBe('the one you moved');
  });
});

describe('Vault M2 2.1 in the store', () => {
  const F = folder.files;
  async function onFolder(path = 'n.md', text = 'loaded') {
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('files') },
    });
    F.set(path, text);
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen(path);
  }
  beforeEach(() => {
    reset();
    useApp.setState({ vaultConflict: undefined, vaultReturnFolder: undefined });
  });

  it('a save patches the file list from the write result, never re-lists', async () => {
    await onFolder();
    folder.counts.lists = 0;
    await useApp.getState().vaultSave('n.md', 'a longer body');
    expect(folder.counts.lists).toBe(0);
    const row = useApp.getState().vaultFiles.find((f) => f.path === 'n.md');
    expect(row).toMatchObject({ version: folder.version('n.md'), size: 13 });
    expect(row?.editedBy).toBeUndefined();
  });

  it('a create adds the note to the list in path order without a re-list', async () => {
    await onFolder('m.md');
    folder.counts.lists = 0;
    await useApp.getState().vaultCreate('a note');
    expect(folder.counts.lists).toBe(0);
    expect(useApp.getState().vaultFiles.map((f) => f.path)).toEqual(['a note.md', 'm.md']);
  });

  it('a delete takes the note off the list without a re-list', async () => {
    await onFolder();
    folder.counts.lists = 0;
    expect(await useApp.getState().vaultDelete('n.md')).toBe(true);
    expect(folder.counts.lists).toBe(0);
    expect(useApp.getState().vaultFiles).toEqual([]);
  });

  it('the size in the patched list is bytes, not characters', async () => {
    await onFolder();
    await useApp.getState().vaultSave('n.md', 'café');
    expect(useApp.getState().vaultFiles.find((f) => f.path === 'n.md')?.size).toBe(5);
  });

  it('two saves in one millisecond differ only by version, and the body cache sees it', async () => {
    folder.stamp.fixed = '2026-09-27T10:00:00.000Z';
    await onFolder('n.md', 'first');
    F.set('other.md', 'links to [[n]]');
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultReadAll();
    // Another writer changes it inside the same millisecond.
    F.set('other.md', 'rewritten, same stamp');
    folder.counts.reads = 0;
    const all = await useApp.getState().vaultReadAll();
    expect(folder.counts.reads).toBe(1);
    expect(all.find((n) => n.path === 'other.md')?.text).toBe('rewritten, same stamp');
  });

  it('opening a note still downloading asks for its bytes and opens nothing', async () => {
    local.evicted.add('far.md');
    await useApp.getState().vaultRefresh();
    local.counts.reads = 0;
    await useApp.getState().vaultOpen('far.md');
    expect(local.counts.reads).toBe(1);
    expect(useApp.getState().vaultNote).toBeUndefined();
    expect(useApp.getState().toast).toMatch(/Still downloading/);
  });

  it('a team stash with a rev becomes base = String(rev) once the team compares revs', async () => {
    const org = wiring.org!.orgVaultProvider as { compareAndSwap?: true };
    const had = org.compareAndSwap;
    org.compareAndSwap = true;
    try {
      teamScope();
      mem.set(
        PENDING,
        JSON.stringify({
          [`org::${ORG}::plan.md`]: {
            providerId: 'org',
            resourceId: ORG,
            owner: 'u1',
            path: 'plan.md',
            text: 'typed offline',
            base: '2026-09-01T00:00:00.000Z',
            rev: 7,
            at: '2026-09-27T00:00:00.000Z',
          },
          [`org::${ORG}::old.md`]: {
            providerId: 'org',
            resourceId: ORG,
            owner: 'u1',
            path: 'old.md',
            text: 'no rev on this one',
            base: '2026-09-01T00:00:00.000Z',
            at: '2026-09-27T00:00:00.000Z',
          },
        }),
      );
      // Any read of the stash converts it, once, and stores it converted.
      await useApp.getState().unsentTeamTextCount();
      const p = JSON.parse(mem.get(PENDING)!) as Record<string, Record<string, unknown>>;
      expect(p[`org::${ORG}::plan.md`]).toMatchObject({ base: '7' });
      expect(p[`org::${ORG}::plan.md`]).not.toHaveProperty('rev');
      // No rev: the ISO base stays, which never equals a rev, so it keeps both.
      expect(p[`org::${ORG}::old.md`]).toMatchObject({ base: '2026-09-01T00:00:00.000Z' });
    } finally {
      if (had) org.compareAndSwap = had;
      else delete org.compareAndSwap;
    }
  });

  it('before the team compares revs, a stash with a rev is left as it was', async () => {
    const entry = {
      providerId: 'org',
      resourceId: ORG,
      owner: 'u1',
      path: 'plan.md',
      text: 'typed offline',
      base: '2026-09-01T00:00:00.000Z',
      rev: 7,
      at: '2026-09-27T00:00:00.000Z',
    };
    // The team client compares revs on this branch; the row before it does is
    // held by taking the flag away for the test, as the row above adds it.
    const org = wiring.org!.orgVaultProvider as { compareAndSwap?: true };
    const had = org.compareAndSwap;
    delete org.compareAndSwap;
    try {
      teamScope();
      mem.set(PENDING, JSON.stringify({ [`org::${ORG}::plan.md`]: entry }));
      expect(await useApp.getState().unsentTeamTextCount()).toBe(1);
      expect(JSON.parse(mem.get(PENDING)!)[`org::${ORG}::plan.md`]).toEqual(entry);
    } finally {
      if (had) org.compareAndSwap = had;
    }
  });

  it('the store keeps no team rev of its own', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/state/store.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/orgVaultBaseRev|seedOrgVaultBaseRev/);
  });
});

describe('conflicts and the save status on every compare-and-swap storage (M2 2.2)', () => {
  const C = cloud.files;
  async function onCloud(path = 'n.md', text = 'loaded') {
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('icloud') },
    });
    C.set(path, text);
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen(path);
  }
  beforeEach(() => {
    reset();
    useApp.setState({ vaultConflict: undefined, vaultReturnFolder: undefined, vaultPending: [] });
  });

  it('a conflict result stops the write and raises the choice, on any such storage', async () => {
    await onCloud();
    C.set('n.md', 'written on the iPad');
    await useApp.getState().vaultSave('n.md', 'typed here');
    expect(C.get('n.md')).toBe('written on the iPad');
    expect(useApp.getState().vaultConflict).toMatchObject({ path: 'n.md', kind: 'changed' });
    // Typing on goes to the stash, never the note.
    await useApp.getState().vaultSave('n.md', 'typed here, more');
    expect(C.get('n.md')).toBe('written on the iPad');
    expect(pending()['icloud::vault.personal::n.md']).toMatchObject({ text: 'typed here, more' });
  });

  it('a focus return re-checks the open note on any such storage', async () => {
    await onCloud();
    C.set('n.md', 'written on the iPad');
    await useApp.getState().vaultRecheck({ reason: 'focus' });
    expect(useApp.getState().vaultNote?.text).toBe('written on the iPad');
    expect(useApp.getState().vaultNote?.reloadedFrom).toBe('elsewhere');
  });

  it('the pending refs follow the stash, and a Retry that lands empties them', async () => {
    await onCloud();
    cloud.fail.write = true;
    await useApp.getState().vaultSave('n.md', 'typed offline');
    expect(useApp.getState().vaultPending).toEqual([
      { providerId: 'icloud', resourceId: 'vault.personal', path: 'n.md' },
    ]);
    expect(useApp.getState().vaultError).toBe('save');
    cloud.fail.write = false;
    await useApp.getState().vaultRefresh();
    expect(C.get('n.md')).toBe('typed offline');
    expect(useApp.getState().vaultPending).toEqual([]);
  });

  it('a replay that lands on the open note becomes its version, so the next save is not a conflict', async () => {
    await onCloud();
    cloud.fail.write = true;
    await useApp.getState().vaultSave('n.md', 'typed offline');
    cloud.fail.write = false;
    await useApp.getState().vaultRefresh();
    expect(useApp.getState().vaultNote).toMatchObject({
      text: 'typed offline',
      version: cloud.version('n.md'),
    });
    await useApp.getState().vaultSave('n.md', 'typed offline, then more');
    expect(useApp.getState().vaultConflict).toBeUndefined();
    expect(C.get('n.md')).toBe('typed offline, then more');
  });

  it('vaultSaving is true while a save is on its way', async () => {
    await onCloud();
    const seen: boolean[] = [];
    const off = useApp.subscribe((s) => seen.push(Boolean(s.vaultSaving)));
    await useApp.getState().vaultSave('n.md', 'saved');
    off();
    expect(seen).toContain(true);
    expect(useApp.getState().vaultSaving).toBe(false);
  });

  it('the pending count leaves out the note whose choice is open, and other accounts', async () => {
    const { vaultPendingCount } = await import('../src/lib/vault.js');
    const t = { providerId: 'org', resourceId: ORG };
    const list = [
      { providerId: 'org', resourceId: ORG, owner: 'u1', path: 'a.md' },
      { providerId: 'org', resourceId: ORG, owner: 'u2', path: 'b.md' },
      { providerId: 'org', resourceId: ORG, owner: 'u1', path: 'c.md' },
      { providerId: 'local', resourceId: 'vault.personal', path: 'd.md' },
    ];
    expect(vaultPendingCount(list, t, { uid: 'u1' })).toBe(2);
    expect(vaultPendingCount(list, t, { uid: 'u1', conflictPath: 'c.md' })).toBe(1);
    expect(vaultPendingCount(list, undefined)).toBe(0);
  });
});

describe('the lease is advisory with compare-and-swap, enforced without it (M2 2.5)', () => {
  const now = { t: Date.parse('2026-09-27T10:00:00Z') };
  beforeEach(async () => {
    reset();
    // The store remembers the lease it holds across cases; let it go.
    await useApp.getState().vaultReleaseLease();
    for (const p of Object.values(byId)) p.counts.leases = [];
    leaseHolder = 'me';
    now.t = Date.parse('2026-09-27T10:00:00Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now.t);
    useApp.setState({ vaultConflict: undefined, vaultLeaseOther: undefined });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const on = (providerId: string) =>
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn(providerId) },
    });

  it('the one rule: enforced only without compare-and-swap, advisory only on iCloud', async () => {
    const { vaultLeaseMode } = await import('../src/lib/vaultLease.js');
    expect(vaultLeaseMode({ id: 'local', compareAndSwap: true }, true)).toBe('none');
    expect(vaultLeaseMode({ id: 'files', compareAndSwap: true }, true)).toBe('none');
    expect(vaultLeaseMode({ id: 'org', compareAndSwap: true }, true)).toBe('none');
    expect(vaultLeaseMode({ id: 'icloud', compareAndSwap: true }, true)).toBe('advisory');
    expect(vaultLeaseMode({ id: 'icloud' }, true)).toBe('enforced');
    expect(vaultLeaseMode({ id: 'dropbox' }, true)).toBe('enforced');
    expect(vaultLeaseMode({ id: 'gdrive' }, false)).toBe('none');
  });

  it('the label is the device kind, never a name', async () => {
    const { vaultDeviceKind } = await import('../src/lib/vaultLease.js');
    expect(vaultDeviceKind('ios', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' })).toBe(
      'iPhone',
    );
    expect(vaultDeviceKind('ios', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0)' })).toBe('iPad');
    expect(
      vaultDeviceKind('ios', { userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 5 }),
    ).toBe('iPad');
    expect(vaultDeviceKind('electron', { platform: 'MacIntel' })).toBe('Mac');
    expect(vaultDeviceKind('electron', { platform: 'Win32' })).toBe('Windows computer');
    expect(vaultDeviceKind('web', { userAgent: 'anything' })).toBeUndefined();
  });

  it('no lease is ever written on the folder or the team vault', async () => {
    on('files');
    folder.files.set('n.md', 'loaded');
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen('n.md');
    await useApp.getState().vaultAcquireLease();
    await useApp.getState().vaultLeaseTouch();
    await useApp.getState().vaultSave('n.md', 'typed');
    expect(folder.counts.leases).toEqual([]);
    teamScope();
    await useApp.getState().vaultLeaseTouch();
    expect(teamNet.puts).toEqual([]);
  });

  it('iCloud with compare-and-swap takes a lease only on typing, renewed at most every 60 s, TTL 150 s', async () => {
    on('icloud');
    cloud.files.set('n.md', 'loaded');
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen('n.md');
    // Only open: no lease.
    expect(cloud.counts.leases).toEqual([]);
    await useApp.getState().vaultLeaseTouch();
    now.t += 30_000;
    await useApp.getState().vaultLeaseTouch();
    expect(cloud.counts.leases).toHaveLength(1);
    expect(cloud.counts.leases[0]).toMatchObject({ holder: 'this-device', ttlMs: 150_000 });
    now.t += 31_000;
    await useApp.getState().vaultLeaseTouch();
    expect(cloud.counts.leases).toHaveLength(2);
  });

  it('advisory: another device editing is one quiet line, and saves still land', async () => {
    on('icloud');
    cloud.files.set('n.md', 'loaded');
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen('n.md');
    leaseHolder = 'the-ipad';
    leaseLabel = 'iPad';
    await useApp.getState().vaultLeaseTouch();
    expect(useApp.getState().vaultLeaseOther).toEqual({ mode: 'advisory', label: 'iPad' });
    expect(useApp.getState().vaultLeaseHeldByOther).toBe(false);
    await useApp.getState().vaultSave('n.md', 'typed here too');
    expect(cloud.files.get('n.md')).toBe('typed here too');
    const { vaultLeaseAlsoOpen } = await import('../src/lib/vaultCopy.js');
    expect(vaultLeaseAlsoOpen('iPad')).toBe('Also open on your iPad.');
  });

  it('enforced: create and delete are refused while another device holds the lease', async () => {
    // The fake This device here has no compare-and-swap.
    files.set('keep.md', 'kept');
    await useApp.getState().vaultRefresh();
    leaseHolder = 'other-device';
    await useApp.getState().vaultCreate('new note');
    expect(files.has('new note.md')).toBe(false);
    expect(useApp.getState().toast).toMatch(/Take over editing/);
    expect(useApp.getState().vaultLeaseHeldByOther).toBe(true);
    expect(await useApp.getState().vaultDelete('keep.md')).toBe(false);
    expect(files.get('keep.md')).toBe('kept');
  });

  it("enforced: a take over sends the displaced device's text to its stash, never the note", async () => {
    files.set('n.md', 'loaded');
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen('n.md');
    const base = local.version('n.md');
    // This device types, and holds the lease.
    await useApp.getState().vaultLeaseTouch();
    expect(leaseHolder).toBe('this-device');
    // Another device takes over editing.
    leaseHolder = 'other-device';
    leaseLabel = 'Mac';
    now.t += 61_000;
    await useApp.getState().vaultLeaseTouch();
    expect(useApp.getState().vaultLeaseHeldByOther).toBe(true);
    expect(useApp.getState().toast).toMatch(/Editing moved to your Mac/);
    // The autosave that was waiting lands in the stash, with its base.
    await useApp.getState().vaultSave('n.md', 'typed before the take over');
    expect(files.get('n.md')).toBe('loaded');
    expect(pending()['local::vault.personal::n.md']).toMatchObject({
      text: 'typed before the take over',
      base,
    });
    // Nothing replays into the note while the other device holds it.
    await useApp.getState().vaultRefresh();
    expect(files.get('n.md')).toBe('loaded');
  });

  it('enforced: Take over editing makes this device the holder', async () => {
    files.set('n.md', 'loaded');
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen('n.md');
    leaseHolder = 'other-device';
    await useApp.getState().vaultLeaseTouch();
    expect(useApp.getState().vaultLeaseHeldByOther).toBe(true);
    await useApp.getState().vaultTakeOverLease();
    expect(leaseHolder).toBe('this-device');
    expect(useApp.getState().vaultLeaseHeldByOther).toBe(false);
    expect(useApp.getState().toast).toBe(
      'Editing here now. The other device stops saving within a minute.',
    );
    await useApp.getState().vaultSave('n.md', 'mine now');
    expect(files.get('n.md')).toBe('mine now');
  });

  it('the Vault screen holds no lease on a timer', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/screens/VaultScreen.tsx', import.meta.url), 'utf8');
    expect(src).not.toMatch(/setInterval\([^)]*Lease/);
    expect(src).not.toMatch(/vaultAcquireLease/);
  });
});

describe('team live refresh by polling (M2 2.7)', () => {
  const org = () => wiring.org!.orgVaultProvider as { compareAndSwap?: true };
  let had: true | undefined;
  beforeEach(async () => {
    reset();
    useApp.setState({ vaultConflict: undefined });
    // The poll looks only on a storage with compare-and-swap; the team
    // client gains it with 0021 (stream D), so it is switched on here.
    had = org().compareAndSwap;
    org().compareAndSwap = true;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    teamScope();
    useApp.setState({ serverRole: 'member' } as never);
    team.set('plan.md', { body: 'the team plan', rev: 1 });
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen('plan.md');
    teamNet.heads = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    useApp.getState().vaultStopPoll();
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (had) org().compareAndSwap = had;
    else delete org().compareAndSwap;
    delete (globalThis as { document?: unknown }).document;
  });

  it('the schedule: 30 s within 10%, backing off 30, 60, 120, 240, then 300 s', async () => {
    const { vaultPollDelayMs } = await import('../src/lib/vaultPoll.js');
    expect(vaultPollDelayMs(0, 0)).toBe(27_000);
    expect(vaultPollDelayMs(0, 1)).toBe(33_000);
    expect([0, 1, 2, 3, 4, 5, 9].map((n) => vaultPollDelayMs(n, 0.5))).toEqual([
      30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000,
    ]);
  });

  it("a teammate's save reloads a clean open note within one tick", async () => {
    useApp.getState().vaultStartPoll();
    team.set('plan.md', { body: 'the plan, edited by a teammate', rev: 2 });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(useApp.getState().vaultNote?.text).toBe('the team plan');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(useApp.getState().vaultNote?.text).toBe('the plan, edited by a teammate');
    expect(useApp.getState().vaultNote?.reloadedFrom).toBe('elsewhere');
    expect(useApp.getState().toast).toBeUndefined();
  });

  it('a dirty draft raises the resolve sheet instead', async () => {
    useApp.getState().vaultStartPoll();
    useApp.getState().vaultNoteDraft('plan.md', 'the team plan, and mine');
    team.set('plan.md', { body: 'the plan, edited by a teammate', rev: 2 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(useApp.getState().vaultConflict).toMatchObject({ path: 'plan.md', kind: 'changed' });
  });

  it('no tick while hidden', async () => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { visibilityState: 'hidden' },
    });
    useApp.getState().vaultStartPoll();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(teamNet.heads).toBe(0);
  });

  it('errors back off to 300 s and stay there, and a success resets it', async () => {
    teamNet.fail = new TypeError('Failed to fetch');
    useApp.getState().vaultStartPoll();
    const at = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      return teamNet.heads;
    };
    expect(await at(30_000)).toBe(1); // t = 30 s
    expect(await at(59_000)).toBe(1);
    expect(await at(1_000)).toBe(2); // t = 90 s
    expect(await at(120_000)).toBe(3); // t = 210 s
    expect(await at(240_000)).toBe(4); // t = 450 s
    expect(await at(299_000)).toBe(4);
    expect(await at(1_000)).toBe(5); // t = 750 s
    expect(await at(300_000)).toBe(6); // t = 1050 s, still 300 s
    teamNet.fail = undefined;
    expect(await at(300_000)).toBe(7); // answers: back to 30 s
    expect(await at(30_000)).toBe(8);
  });

  it('a scope change stops the poll', async () => {
    useApp.getState().vaultStartPoll();
    await useApp.getState().setVaultScope('personal');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(teamNet.heads).toBe(0);
  });

  it('visible again checks at once', async () => {
    useApp.getState().vaultStartPoll({ now: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(teamNet.heads).toBe(1);
  });
});

describe('who last saved a note (M2 2.7)', () => {
  beforeEach(() => {
    reset();
    useApp.setState({ vaultConflict: undefined });
  });

  it("comes from the storage, and the person's own save clears it", async () => {
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('icloud') },
    });
    cloud.files.set('n.md', 'loaded');
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen('n.md');
    cloud.editor.by = { id: 'u2', label: 'sam' };
    cloud.files.set('n.md', 'written by sam');
    await useApp.getState().vaultRecheck({ reason: 'focus' });
    expect(useApp.getState().vaultNote?.editedBy).toEqual({ id: 'u2', label: 'sam' });
    await useApp.getState().vaultSave('n.md', 'written by me');
    expect(useApp.getState().vaultNote?.editedBy).toBeUndefined();
  });

  it('reads "Edited by sam, 2 min ago", a teammate when unnamed, and nothing for your own', async () => {
    const { vaultEditedByLine } = await import('../src/lib/vaultCopy.js');
    const now = Date.parse('2026-09-27T10:02:30Z');
    const at = '2026-09-27T10:00:00Z';
    expect(vaultEditedByLine({ id: 'u2', label: 'sam' }, at, 'u1', now)).toBe(
      ' · Edited by sam, 2 min ago',
    );
    expect(vaultEditedByLine({ id: 'u2' }, at, 'u1', now)).toBe(
      ' · Edited by a teammate, 2 min ago',
    );
    expect(vaultEditedByLine({ id: 'u1', label: 'me' }, at, 'u1', now)).toBeUndefined();
    expect(vaultEditedByLine(undefined, at, 'u1', now)).toBeUndefined();
    expect(vaultEditedByLine({ id: 'u2' }, 'r3', 'u1', now)).toBe(' · Edited by a teammate');
  });
});

// The Vault index (M3 3.2, CTO H3 and H6): the store feeds it from every
// write, remove, list, and open, and a sign-out that forgets team drafts
// forgets the team index too. The CRLF wrap on the save path (H2) keeps an
// all-CRLF note's bytes.
describe('the Vault index (M3 3.2)', () => {
  beforeEach(async () => {
    reset();
    await closeVaultIndex();
  });
  afterEach(async () => {
    await closeVaultIndex();
  });
  // The index on screen, once the reconcile the last list started settles.
  async function settledIndex() {
    for (let i = 0; i < 100; i++) {
      await tick();
      const host = currentVaultIndex();
      const state = vaultIndexStatus().state;
      if (host && (state === 'ready' || state === 'partial')) return host;
    }
    throw new Error('the index never settled');
  }

  it('a save updates one index entry and reads no other note', async () => {
    files.set('Plan.md', '# Plan');
    files.set('Idea.md', 'Nothing yet.');
    files.set('Other.md', 'Links to [[Plan]].');
    await useApp.getState().vaultRefresh();
    const host = await settledIndex();
    expect(host.backlinks('Plan.md').map((b) => b.source)).toEqual(['Other.md']);
    const plan = host.index.entry('Plan.md');
    const other = host.index.entry('Other.md');
    local.counts.reads = 0;
    await useApp.getState().vaultSave('Idea.md', 'Build on [[Plan]].');
    expect(local.counts.reads).toBe(0);
    expect(host.index.entry('Plan.md')).toBe(plan);
    expect(host.index.entry('Other.md')).toBe(other);
    expect(host.backlinks('Plan.md').map((b) => b.source)).toEqual(['Idea.md', 'Other.md']);
    // A delete leaves the index the same way, with no read either.
    await useApp.getState().vaultDelete('Other.md');
    expect(local.counts.reads).toBe(0);
    expect(host.backlinks('Plan.md').map((b) => b.source)).toEqual(['Idea.md']);
  });

  it('opening a note reads no other note', async () => {
    for (let i = 0; i < 20; i++) files.set(`n${i}.md`, `note ${i} links [[Plan]]`);
    files.set('Plan.md', '# Plan');
    await useApp.getState().vaultRefresh();
    await settledIndex();
    local.counts.reads = 0;
    await useApp.getState().vaultOpen('Plan.md');
    expect(useApp.getState().vaultNote?.path).toBe('Plan.md');
    expect(local.counts.reads).toBe(1);
  });

  it('a list result reconciles: only the note that moved is read again', async () => {
    files.set('a.md', 'one');
    files.set('b.md', 'two');
    await useApp.getState().vaultRefresh();
    await settledIndex();
    files.set('b.md', 'two, edited elsewhere with [[a]]');
    local.counts.reads = 0;
    await useApp.getState().vaultRefresh();
    const host = await settledIndex();
    expect(local.counts.reads).toBe(1);
    expect(host.backlinks('a.md').map((b) => b.source)).toEqual(['b.md']);
  });

  it('a sign-out drops the team index', async () => {
    teamScope();
    team.set('Plan.md', { body: '# Plan', rev: 1 });
    team.set('Idea.md', { body: 'See [[Plan]].', rev: 1 });
    await useApp.getState().vaultRefresh();
    const host = await settledIndex();
    expect(host.target).toEqual({ providerId: 'org', resourceId: ORG, owner: 'u1' });
    expect(host.backlinks('Plan.md')).toHaveLength(1);
    await useApp.getState().signOutAccount();
    expect(currentVaultIndex()?.target.providerId).not.toBe('org');
    expect(host.index.size).toBe(0);
  });

  it('a CRLF note opened and saved with no edit writes nothing; a body edit keeps CRLF', async () => {
    const loaded = '---\r\ntitle: Plan\r\n---\r\n# Plan\r\nFirst line\r\n';
    files.set('Plan.md', loaded);
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen('Plan.md');
    local.counts.writes = [];
    // The textarea hands the untouched text back with LF.
    await useApp.getState().vaultSave('Plan.md', loaded.replace(/\r\n/g, '\n'));
    expect(local.counts.writes).toEqual([]);
    expect(files.get('Plan.md')).toBe(loaded);
    // A body edit keeps every CRLF, the frontmatter's bytes included.
    const edited = loaded.replace(/\r\n/g, '\n').replace('First line', 'First line, edited');
    await useApp.getState().vaultSave('Plan.md', edited);
    expect(files.get('Plan.md')).toBe(loaded.replace('First line', 'First line, edited'));
    expect(files.get('Plan.md')!.startsWith('---\r\ntitle: Plan\r\n---\r\n')).toBe(true);
  });

  it('an LF note saves as typed', async () => {
    files.set('Plan.md', '# Plan\nFirst\n');
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen('Plan.md');
    await useApp.getState().vaultSave('Plan.md', '# Plan\nFirst, edited\n');
    expect(files.get('Plan.md')).toBe('# Plan\nFirst, edited\n');
  });
});

// Vault M5, CTO J9 (D2): what pairing does to the personal vault. An empty
// vault on This device by default points at the computer with one toast; one
// that holds notes (or text waiting to save) gets the one-time move card,
// whose move writes every copy ifAbsent; a storage the person chose is never
// repointed; unpairing returns the vault to where it was and moves nothing
// back.
describe('pairing and the vault on your computer', () => {
  beforeEach(reset);
  const box = { baseUrl: 'http://box.tail1.ts.net:4820', token: 't' };
  const providerNow = () =>
    useApp.getState().settings.gitosResources?.find((r) => r.id === 'vault.personal');

  it('an empty Local vault repoints to the computer, and unpairing returns it', async () => {
    await useApp.getState().saveHub(box, { role: 'admin' });
    await vi.waitFor(() => expect(providerNow()?.providerId).toBe('hub'));
    expect(providerNow()?.chosenAt).toBeUndefined();
    expect(useApp.getState().toast).toMatch(/lives on your computer/);
    expect(useApp.getState().settings.vaultBeforeHub).toEqual({
      providerId: 'local',
      hub: box.baseUrl,
    });
    hub.files.set('Written on the computer.md', 'x');
    await useApp.getState().removeHub(box.baseUrl);
    await vi.waitFor(() => expect(providerNow()?.providerId).toBe('local'));
    expect(useApp.getState().settings.vaultBeforeHub).toBeUndefined();
    // Nothing moved back.
    expect(local.files.size).toBe(0);
    expect(hub.files.has('Written on the computer.md')).toBe(true);
  });

  it('a Local vault with notes gets the one-time move card, and its move never replaces', async () => {
    files.set('Mine.md', 'my note');
    files.set('Same.md', 'on both');
    hub.files.set('Same.md', 'different on the computer');
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('local') },
    });
    await useApp.getState().saveHub(box, { role: 'admin' });
    await vi.waitFor(() =>
      expect(useApp.getState().settings.vaultHubOffer).toEqual({
        hub: box.baseUrl,
        state: 'offered',
      }),
    );
    expect(providerNow()?.providerId).toBe('local');
    await useApp.getState().vaultRefresh();
    expect(useApp.getState().vaultHubOfferShown()).toBe(true);
    const r = await useApp.getState().vaultAcceptHubMove();
    expect(r.ok).toBe(true);
    expect(providerNow()?.providerId).toBe('hub');
    expect(hub.files.get('Mine.md')).toBe('my note');
    // The computer's own note kept its name; ours landed beside it.
    expect(hub.files.get('Same.md')).toBe('different on the computer');
    expect(r.forked).toHaveLength(1);
    expect(hub.counts.writes.every((w) => w.guard && 'ifAbsent' in w.guard)).toBe(true);
    expect(useApp.getState().settings.vaultHubOffer).toBeUndefined();
    expect(useApp.getState().settings.vaultBeforeHub?.providerId).toBe('local');
    // Unpairing returns to This device, and the notes there are as they were.
    await useApp.getState().removeHub(box.baseUrl);
    await vi.waitFor(() => expect(providerNow()?.providerId).toBe('local'));
    expect(files.get('Mine.md')).toBe('my note');
  });

  it('the hub link follows the pairing, and a pairing change closes the warm index', async () => {
    const { hubVaultLink } = await import('../src/lib/gitos/hub.js');
    files.set('Mine.md', 'my note');
    await useApp.getState().vaultRefresh();
    await vi.waitFor(() => expect(currentVaultIndex()?.target.providerId).toBe('local'));
    // Pairing: the link names this computer and this person on it, and the
    // personal index that belonged to the old arrangement closes (CTO J1).
    await useApp.getState().saveHub(box, { role: 'admin' });
    expect(hubVaultLink()?.target).toMatchObject({
      providerId: 'hub',
      resourceId: 'vault',
      owner: expect.stringMatching(/^http:\/\/box\.tail1\.ts\.net:4820#[0-9a-f]{16}$/),
    });
    expect(currentVaultIndex()).toBeUndefined();
    // Unpairing: no link, so the hub vault refuses in plain words.
    await useApp.getState().removeHub(box.baseUrl);
    expect(hubVaultLink()).toBeUndefined();
  });

  it('a declined card stays declined for that computer', async () => {
    files.set('Mine.md', 'my note');
    await useApp.getState().saveHub(box, { role: 'admin' });
    await vi.waitFor(() => expect(useApp.getState().settings.vaultHubOffer?.state).toBe('offered'));
    await useApp.getState().vaultDeclineHubMove();
    expect(await useApp.getState().vaultAfterPairing()).toBe('stay');
    expect(useApp.getState().settings.vaultHubOffer?.state).toBe('declined');
    expect(useApp.getState().vaultHubOfferShown()).toBe(false);
  });

  it('text waiting to save counts as notes: the card, never a quiet repoint', async () => {
    mem.set(
      PENDING,
      JSON.stringify({
        'local::vault.personal::Draft.md': {
          providerId: 'local',
          resourceId: 'vault.personal',
          path: 'Draft.md',
          text: 'typed offline',
          at: 'x',
        },
      }),
    );
    await useApp.getState().saveHub(box, { role: 'admin' });
    await vi.waitFor(() => expect(useApp.getState().settings.vaultHubOffer?.state).toBe('offered'));
    expect(providerNow()?.providerId ?? 'local').toBe('local');
  });

  it('a storage the person chose is never repointed, and a desktop keeps its own folder', async () => {
    useApp.setState({
      settings: {
        ...useApp.getState().settings,
        gitosResources: [{ ...personalOn('local')[0]!, chosenAt: '2026-09-01T00:00:00Z' }],
      },
    });
    expect(await useApp.getState().vaultAfterPairing()).toBe('stay');
    await useApp.getState().saveHub(box, { role: 'admin' });
    expect(await useApp.getState().vaultAfterPairing()).toBe('stay');
    expect(providerNow()?.providerId).toBe('local');
    expect(useApp.getState().settings.vaultHubOffer).toBeUndefined();
    reset();
    desk.on = true;
    await useApp.getState().saveHub(box, { role: 'admin' });
    expect(await useApp.getState().vaultAfterPairing()).toBe('stay');
    expect(providerNow()?.providerId ?? 'local').toBe('local');
  });
});

// ---- Vault M6 (the wave 2 call sites; state/vaultOps.ts does the work) ------
// The folder fake gains the M6 members a case needs: Trash under `.trash/`
// in the same file map (so the provider lists it and the store must leave it
// out), rename, and the rest, each removed again after the case.
describe('Vault M6 operations through the store', () => {
  const F = folder.files;
  const p = folder.provider as unknown as Record<string, unknown>;
  const added: string[] = [];
  const give = (name: string, fn: unknown) => {
    p[name] = fn;
    added.push(name);
  };
  const metaAt = (path: string): StoredFileMeta => ({
    path,
    updatedAt: folder.version(path),
    size: F.get(path)!.length,
    version: folder.version(path),
  });
  function withTrash() {
    give('trash', async (_r: string, t: { kind: string; path: string; ifMatch?: string }) => {
      if (!F.has(t.path)) return { ok: false, conflict: 'changed' };
      if (t.ifMatch !== folder.version(t.path)) {
        return { ok: false, conflict: 'changed', theirs: { path: t.path, text: F.get(t.path) } };
      }
      F.set(`.trash/${t.path}`, F.get(t.path)!);
      F.delete(t.path);
      const entry = { id: `.trash/${t.path}`, path: t.path, kind: 'note', size: 1 };
      return { ok: true, entry, notes: 1, attachments: 0 };
    });
    give('listTrash', async () =>
      [...F.keys()]
        .filter((k) => k.startsWith('.trash/'))
        .map((k) => ({ id: k, path: k.slice(7), kind: 'note', size: F.get(k)!.length })),
    );
    give('restore', async (_r: string, id: string) => {
      if (!F.has(id)) return { ok: false, conflict: 'missing' };
      const path = id.slice(7);
      F.set(path, F.get(id)!);
      F.delete(id);
      return { ok: true, file: metaAt(path), renamed: false };
    });
    give('emptyTrash', async () => {
      const gone = [...F.keys()].filter((k) => k.startsWith('.trash/'));
      for (const k of gone) F.delete(k);
      return { removed: gone.length };
    });
  }
  async function openOnFolder(path: string, text: string) {
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('files') },
    });
    F.set(path, text);
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen(path);
  }
  beforeEach(() => {
    reset();
    useApp.setState({
      vaultConflict: undefined,
      vaultReturnFolder: undefined,
      vaultTrash: undefined,
    });
  });
  afterEach(() => {
    for (const name of added.splice(0)) delete p[name];
    useApp.getState().vaultBindAutosave(undefined);
  });

  it('delete then Undo restores the bytes, and .trash stays out of the tree', async () => {
    withTrash();
    const { vaultAutosave } = await import('../src/lib/vaultAutosave.js');
    await openOnFolder('Ideas/x.md', 'the words');
    expect(useApp.getState().vaultCapsNow().trash).toBe(true);
    // Typed and still waiting for the debounce: the delete writes it first,
    // and cancels the timer, so nothing lands after the note went to Trash.
    const autosave = vaultAutosave({
      target: () => useApp.getState().vaultTargetRef(),
      save: (path, text, at) => void useApp.getState().vaultSave(path, text, at),
      delayMs: 30,
    });
    useApp.getState().vaultBindAutosave(autosave);
    autosave.schedule('Ideas/x.md', 'typed last');
    const r = await useApp.getState().vaultDeleteNote('Ideas/x.md');
    expect(r).toMatchObject({ ok: true, trashed: true });
    await new Promise((res) => setTimeout(res, 60));
    expect(F.has('Ideas/x.md')).toBe(false);
    expect(F.get('.trash/Ideas/x.md')).toBe('typed last');
    expect(useApp.getState().vaultNote).toBeUndefined();
    await vi.waitFor(() => expect(useApp.getState().vaultTrash).toHaveLength(1));
    await useApp.getState().vaultRefresh();
    expect(useApp.getState().vaultFiles.map((f) => f.path)).toEqual([]);
    expect(currentVaultIndex()?.index.paths() ?? []).not.toContain('.trash/Ideas/x.md');

    const back = await useApp.getState().vaultUndoDelete(r!.ok ? r!.undo! : (undefined as never));
    expect(back).toMatchObject({ ok: true, path: 'Ideas/x.md', renamed: false });
    expect(F.get('Ideas/x.md')).toBe('typed last');
    expect(useApp.getState().vaultFiles.map((f) => f.path)).toEqual(['Ideas/x.md']);
    await vi.waitFor(() => expect(useApp.getState().vaultTrash).toEqual([]));
  });

  it('a rename re-keys pins, the stash, Recent and the open note, at the path the storage answered', async () => {
    // The storage matches a parent to its spelling on disk: asked for
    // work/Roadmap.md, it lands at Work/Roadmap.md (stream B).
    give('rename', async (_r: string, from: string, to: string, guard: { ifMatch: string }) => {
      if (!F.has(from)) return { ok: false, conflict: 'missing' };
      if (folder.version(from) !== guard.ifMatch) return { ok: false, conflict: 'changed' };
      const landed = to.replace(/^work\//, 'Work/');
      if (F.has(landed)) return { ok: false, conflict: 'exists' };
      F.set(landed, F.get(from)!);
      F.delete(from);
      return { ok: true, file: metaAt(landed) };
    });
    F.set('Work/Other.md', 'another');
    F.set('Home.md', 'See [[Plan]].');
    await openOnFolder('Plan.md', 'the plan, from [home](Home.md)');
    const st = useApp.getState();
    useApp.setState({
      settings: {
        ...st.settings,
        projects: [{ id: 'p1', name: 'P', vaultPins: ['Plan.md', 'Home.md'] }],
      } as never,
    });
    mem.set(
      PENDING,
      JSON.stringify({
        'files::vault.personal::Plan.md': {
          providerId: 'files',
          resourceId: 'vault.personal',
          path: 'Plan.md',
          text: 'typed offline',
          at: 'x',
        },
      }),
    );
    await vi.waitFor(() =>
      expect(
        currentVaultIndex()
          ?.index.backlinks('Plan.md')
          .map((b) => b.source),
      ).toEqual(['Home.md']),
    );
    // Opening it put it on this vault's Recent ring.
    await vi.waitFor(() =>
      expect(
        useApp
          .getState()
          .vaultRecentRing()
          .map((e) => e.path),
      ).toEqual(['Plan.md']),
    );

    const preview = await useApp.getState().vaultPrepareMove('note', 'Plan.md', 'work/Roadmap.md');
    expect(preview).toMatchObject({ links: 1, linkNotes: 1 });
    const r = await useApp.getState().vaultApplyMove(preview!, true);
    expect(r).toMatchObject({ ok: true, moved: [{ path: 'Work/Roadmap.md' }] });
    expect(r!.ok && r!.rewrite).toMatchObject({ updated: 1, skipped: [], notUpdated: [] });

    // The open note, the list and the index follow to where it landed.
    const open = useApp.getState().vaultNote!;
    expect(open.path).toBe('Work/Roadmap.md');
    expect(open.version).toBe(folder.version('Work/Roadmap.md'));
    const listed = useApp.getState().vaultFiles.map((f) => f.path);
    expect(listed).toContain('Work/Roadmap.md');
    expect(listed).not.toContain('Plan.md');
    expect(listed).not.toContain('work/Roadmap.md');
    expect(currentVaultIndex()?.index.has('Work/Roadmap.md')).toBe(true);
    // Links follow; the moved note's own link still resolves, so it stays.
    expect(F.get('Home.md')).toBe('See [[Roadmap]].');
    expect(F.get('Work/Roadmap.md')).toBe('the plan, from [home](Home.md)');
    expect(F.has('work/Roadmap.md')).toBe(false);
    // Pins and the stash re-key.
    expect(useApp.getState().settings.projects?.[0]?.vaultPins).toEqual([
      'Work/Roadmap.md',
      'Home.md',
    ]);
    expect(Object.keys(pending())).toEqual(['files::vault.personal::Work/Roadmap.md']);
    await vi.waitFor(() =>
      expect(
        useApp
          .getState()
          .vaultRecentRing()
          .map((e) => e.path),
      ).toEqual(['Work/Roadmap.md']),
    );
    expect(pending()['files::vault.personal::Work/Roadmap.md']?.path).toBe('Work/Roadmap.md');
  });

  it('Today opens an existing note unchanged, and starts a missing one only while the name is free', async () => {
    const { datePartsOf, formatVaultDate } = await import('os-code/protocol');
    const named = formatVaultDate(datePartsOf(new Date()), 'YYYY-MM-DD');
    const path = `${named.ok ? named.text : 'x'}.md`;
    useApp.setState({
      settings: { ...useApp.getState().settings, gitosResources: personalOn('files') },
    });
    F.set(path, 'already written\r\n');
    await useApp.getState().vaultRefresh();
    expect(useApp.getState().vaultCapsNow().today).toBe(true);
    const writes = folder.counts.writes.length;
    expect(await useApp.getState().vaultToday()).toEqual({ kind: 'opened', path });
    expect(folder.counts.writes.length).toBe(writes);
    expect(F.get(path)).toBe('already written\r\n');
    expect(useApp.getState().vaultNote).toMatchObject({ path, text: 'already written\r\n' });

    // Not there yet: one create, guarded ifAbsent, opened in the editor.
    useApp.getState().vaultCloseNote();
    F.delete(path);
    await useApp.getState().vaultRefresh();
    const { VAULT_TODAY_STARTED } = await import('../src/lib/vaultCopy.js');
    expect(await useApp.getState().vaultToday()).toEqual({
      kind: 'created',
      path,
      line: VAULT_TODAY_STARTED,
    });
    expect(folder.counts.writes.at(-1)).toEqual({ path, guard: { ifAbsent: true } });
    expect(F.get(path)).toBe('');
    expect(useApp.getState().vaultNote).toMatchObject({ path, fresh: true });
  });

  it('a checkbox tick with frontmatter present writes the right line', async () => {
    const text = ['---', 'tags: [a]', '---', '# Tasks', '', '- [ ] first', '- [ ] second', ''].join(
      '\n',
    );
    await openOnFolder('t.md', text);
    const base = folder.version('t.md');
    // Line 6 of the whole note, frontmatter counted, is "- [ ] second".
    expect(await useApp.getState().vaultToggleTask('t.md', 6, true)).toBe(true);
    expect(F.get('t.md')).toBe(text.replace('- [ ] second', '- [x] second'));
    expect(folder.counts.writes.at(-1)).toEqual({ path: 't.md', guard: { ifMatch: base } });
    // The open note shows what landed, at its new version.
    expect(useApp.getState().vaultNote?.text).toBe(F.get('t.md'));
    expect(useApp.getState().vaultNote?.version).toBe(folder.version('t.md'));
    // Changed somewhere else: nothing is written over it, or even tried
    // (the tick reads the note first, E2).
    F.set('t.md', `${F.get('t.md')}more from elsewhere\n`);
    const writes = folder.counts.writes.length;
    expect(await useApp.getState().vaultToggleTask('t.md', 5, true)).toBe(false);
    expect(folder.counts.writes.length).toBe(writes);
    expect(F.get('t.md')).toContain('- [ ] first');
  });

  it('without a real Trash a delete is for good, and Undo comes back beside a taken name', async () => {
    await openOnFolder('x.md', 'first words');
    expect(useApp.getState().vaultCapsNow().trash).toBe(false);
    const r = await useApp.getState().vaultDeleteNote('x.md');
    expect(r).toMatchObject({
      ok: true,
      trashed: false,
      undo: { kind: 'bytes', text: 'first words' },
    });
    expect(F.has('x.md')).toBe(false);
    // Someone else takes the name meanwhile: the Undo never overwrites it.
    F.set('x.md', 'someone else');
    const back = await useApp.getState().vaultUndoDelete(r!.ok ? r!.undo! : (undefined as never));
    expect(back).toMatchObject({ ok: true, path: 'x (restored).md', renamed: true });
    expect(F.get('x.md')).toBe('someone else');
    expect(F.get('x (restored).md')).toBe('first words');
  });
});

// The team review of 2026-09-30: 0025's row accepts `delete: "permanent"`,
// but every team delete is org_vault_remove, which keeps the note in Trash
// for 30 days where any member restores it. So a team vault whose stored
// settings say For good still deletes with one tap to Trash, never arms
// "for good", and never saves the choice.
describe('a team delete is always one tap to Trash', () => {
  beforeEach(() => {
    reset();
    useApp.setState({ vaultConflict: undefined, vaultTrash: undefined });
  });
  afterEach(() => {
    wiring.org!.resetOrgVault();
  });

  it('a stored delete: permanent still goes to Trash in one tap, and is never saved', async () => {
    teamNet.settings = { version: 1, delete: 'permanent', tree: { sort: 'modified' } };
    teamScope();
    team.set('plan.md', { body: 'the team plan', rev: 1 });
    await useApp.getState().vaultRefresh();
    const s = await useApp.getState().vaultLoadSettings({ force: true });
    // The row was read (its sort holds), and its Delete was not.
    expect(s?.tree.sort).toBe('modified');
    expect(s?.delete).toBe('trash');
    const caps = useApp.getState().vaultCapsNow();
    expect(caps.trash).toBe(true);
    expect(caps.settingsWrite).toBe(true);
    const r = await useApp.getState().vaultDeleteNote('plan.md');
    expect(r).toMatchObject({ ok: true, trashed: true, undo: { kind: 'trash' } });
    expect(team.has('plan.md')).toBe(false);
    // An admin cannot save For good on the team vault: nothing is sent.
    expect(
      await useApp.getState().vaultSaveSetting({ field: 'delete', value: 'permanent' }),
    ).toEqual({ kind: 'read-only' });
    expect(
      await useApp.getState().vaultSaveSetting({ field: 'attachments.folder', value: 'Files' }),
    ).toEqual({ kind: 'read-only' });
    expect(teamNet.settingsPuts).toEqual([]);
    // A field the team does carry out still saves, with no Delete in it.
    expect(
      await useApp.getState().vaultSaveSetting({ field: 'editor.font', value: 'serif' }),
    ).toMatchObject({ kind: 'saved' });
    expect(teamNet.settingsPuts).toEqual([
      { version: 1, tree: { sort: 'modified' }, editor: { font: 'serif' } },
    ]);
  });
});

// A lapsed team plan (CX Y15, 0025's OV402), or a member under admins-only
// delete (Y14, OV403): every store write the room can still hand over (an
// Undo toast up, a Trash page or a resolve sheet open when the plan lapsed,
// any other caller) says the plan's line before the server is asked, and
// the text a write carried is never lost (review, 2026-09-30).
describe('the team plan refuses before the server is asked (Y14, Y15)', () => {
  beforeEach(reset);
  afterEach(() => {
    useApp.setState({ vaultTeamPlan: undefined, vaultConflict: undefined });
  });
  const lapse = () =>
    useApp.setState({ vaultTeamPlan: { entitled: false, isAdmin: false, deleteRole: 'member' } });

  it("Today on a lapsed plan says the plan's line, never the generic one", async () => {
    teamScope();
    lapse();
    expect(await useApp.getState().vaultToday()).toEqual({
      kind: 'refused',
      line: VAULT_TEAM_LAPSED_NOT_CREATED,
    });
    expect(teamNet.puts).toEqual([]);
  });

  it('a new note on a lapsed plan is refused before the server is asked', async () => {
    teamScope();
    team.set('Plan.md', { body: 'ours', rev: 3 });
    await useApp.getState().vaultRefresh();
    lapse();
    teamNet.heads = 0;
    teamNet.calls = [];
    await useApp.getState().vaultCreate('Ideas');
    expect(useApp.getState().toast).toBe(VAULT_TEAM_LAPSED_NOT_CREATED);
    expect(useApp.getState().vaultNote).toBeUndefined();
    // A seeded body is held, never dropped.
    await useApp.getState().vaultCreate('Welcome', 'hello');
    expect(teamHeld()).toEqual([
      expect.objectContaining({
        path: 'Welcome.md',
        text: 'hello',
        reason: VAULT_TEAM_LAPSED_NOT_SAVED,
      }),
    ]);
    expect([teamNet.calls, teamNet.heads]).toEqual([[], 0]);
    expect(team.has('Ideas.md')).toBe(false);
    // A note that is there still opens, read-only.
    await useApp.getState().vaultCreate('Plan');
    expect(useApp.getState().vaultNote).toMatchObject({ path: 'Plan.md', text: 'ours' });
    expect(teamNet.calls).toEqual([]);
  });

  it('Keep both and Keep yours on a lapsed plan hold the text and send nothing', async () => {
    teamScope();
    team.set('n.md', { body: 'theirs', rev: 7 });
    await useApp.getState().vaultRefresh();
    const target = useApp.getState().vaultTargetRef()!;
    const theirs = { path: 'n.md', text: 'theirs', updatedAt: 'r7', version: '7' };
    // One sitting of the note (loadedAt), so its holds keep one entry.
    const open = (kind: 'changed' | 'missing') =>
      useApp.setState({
        vaultNote: { path: 'n.md', text: 'base', updatedAt: 'r5', version: '5', loadedAt: 1 },
        vaultConflict: {
          path: 'n.md',
          target,
          kind,
          base: 'base',
          baseVersion: '5',
          ...(kind === 'changed' ? { theirs } : {}),
          copyPath: 'n (conflict 2026-09-30 1200).md',
          foundAt: Date.now(),
          deferred: false,
        },
        toast: undefined,
      });
    lapse();
    teamNet.calls = [];
    for (const choice of ['both', 'mine'] as const) {
      open('changed');
      expect(await useApp.getState().vaultResolve(choice, 'mine')).toEqual({ ok: true });
      const st = useApp.getState();
      expect(st.vaultConflict).toBeUndefined();
      expect(st.vaultNote).toMatchObject({ path: 'n.md', text: 'theirs' });
      expect(teamHeld()).toEqual([
        expect.objectContaining({
          path: 'n.md',
          text: 'mine',
          reason: VAULT_TEAM_LAPSED_NOT_SAVED,
        }),
      ]);
      expect(st.toast).toBe(
        `${VAULT_TEAM_LAPSED_NOT_SAVED_LINE} Your text is kept under Not saved.`,
      );
    }
    // A note gone elsewhere: Keep yours holds the text and closes the note.
    open('missing');
    expect(await useApp.getState().vaultResolve('mine', 'mine again')).toEqual({ ok: true });
    expect(useApp.getState().vaultNote).toBeUndefined();
    expect(teamHeld()).toEqual([expect.objectContaining({ path: 'n.md', text: 'mine again' })]);
    expect(teamNet.calls).toEqual([]);
    expect(team.get('n.md')?.body).toBe('theirs');
    expect([...team.keys()]).toEqual(['n.md']);
  });

  it("Restore and Undo on a lapsed plan say the plan's line and ask nothing", async () => {
    teamScope();
    lapse();
    const refused = {
      ok: false,
      reason: 'unsupported',
      line: VAULT_TEAM_LAPSED_NOT_RESTORED,
      whole: true,
    };
    const undo = {
      kind: 'trash' as const,
      id: 'n:Old.md',
      path: 'Old.md',
      folder: false,
      notes: 1,
    };
    const at = useApp.getState().vaultTargetRef();
    expect(await useApp.getState().vaultUndoDelete(undo, at)).toEqual(refused);
    expect(await useApp.getState().vaultRestoreTrash('n:Old.md')).toEqual(refused);
    expect(teamNet.calls).toEqual([]);
  });

  it('a delete on a lapsed plan, or by a member under admins-only, is refused before the server', async () => {
    teamScope();
    team.set('Work/n.md', { body: 'keep', rev: 5 });
    await useApp.getState().vaultRefresh();
    lapse();
    teamNet.calls = [];
    const lapsed = { ok: false, reason: 'storage', line: VAULT_TEAM_LAPSED_NOT_DELETED };
    expect(await useApp.getState().vaultDeleteNote('Work/n.md')).toEqual(lapsed);
    expect(await useApp.getState().vaultDeleteFolder('Work')).toEqual(lapsed);
    useApp.setState({ vaultTeamPlan: { entitled: true, isAdmin: false, deleteRole: 'admin' } });
    const member = { ok: false, reason: 'storage', line: VAULT_TEAM_DELETE_REFUSED };
    expect(await useApp.getState().vaultDeleteNote('Work/n.md')).toEqual(member);
    expect(await useApp.getState().vaultDeleteFolder('Work')).toEqual(member);
    expect(teamNet.calls).toEqual([]);
    expect(team.get('Work/n.md')?.body).toBe('keep');
  });
});

// 0023's free space (the 2026-09-30 review, finding 1): every team with no
// live plan runs under it in the beta. The real team provider over the shared
// fake server, which refuses growth past `freeBytes` with 0023's own 23514:
// save, Restore, Undo, Today and a rename each say why, the verb first, and
// never "Try again in a moment", which would be false; a folder's Undo says
// what came back and what stayed in Trash.
describe("the team's free space (0023) says why, never 'try again'", () => {
  let server: FakeOrgVaultServer;
  beforeEach(() => {
    reset();
    server = createFakeOrgVaultServer(ORG);
    teamNet.server = server;
    teamScope();
  });

  it('a save past it is held under Not saved with the reason, and nothing retries', async () => {
    server.freeBytes = server.usage();
    await useApp.getState().vaultSave('plan.md', 'our plan');
    expect(pending()).toEqual({});
    expect(teamHeld()).toEqual([
      expect.objectContaining({ path: 'plan.md', text: 'our plan', reason: VAULT_TEAM_FULL }),
    ]);
    expect(useApp.getState().toast).toBe(
      `Not saved. ${VAULT_TEAM_FULL} Your text is kept under Not saved.`,
    );
    expect(server.bytes('plan.md')).toBeUndefined();
  });

  it('Restore in Trash past it says Not restored and why, and the note stays in Trash', async () => {
    server.put('Old.md', 'x'.repeat(40), 'u-me');
    server.drop('Old.md');
    server.freeBytes = server.usage() + 10;
    await useApp.getState().vaultRefresh();
    expect((await useApp.getState().vaultLoadTrash())?.map((e) => e.path)).toEqual(['Old.md']);
    expect(await useApp.getState().vaultRestoreTrash('n:Old.md')).toEqual({
      ok: false,
      reason: 'storage',
      line: `Not restored. ${VAULT_TEAM_FULL}`,
      whole: true,
    });
    expect(server.bytes('Old.md')).toBeUndefined();
  });

  it('Undo of a delete past it says Not restored and why', async () => {
    server.put('Old.md', 'x'.repeat(40), 'u-me');
    await useApp.getState().vaultRefresh();
    const at = useApp.getState().vaultTargetRef();
    const gone = await useApp.getState().vaultDeleteNote('Old.md', at);
    if (!gone?.ok || !gone.undo) throw new Error('not deleted');
    server.freeBytes = server.usage() + 10;
    expect(await useApp.getState().vaultUndoDelete(gone.undo, at)).toEqual({
      ok: false,
      reason: 'storage',
      line: `Not restored. ${VAULT_TEAM_FULL}`,
      whole: true,
    });
  });

  it("a folder's Undo brings back what fits, and says which stayed in Trash", async () => {
    server.put('Work/a.md', 'a'.repeat(5), 'u-me');
    server.put('Work/big.md', 'b'.repeat(60), 'u-me');
    server.put('Work/c.md', 'c'.repeat(5), 'u-me');
    await useApp.getState().vaultRefresh();
    const at = useApp.getState().vaultTargetRef();
    const gone = await useApp.getState().vaultDeleteFolder('Work');
    if (!gone?.ok || !gone.undo) throw new Error('not deleted');
    server.freeBytes = server.usage() + 20;
    expect(await useApp.getState().vaultUndoDelete(gone.undo, at)).toEqual({
      ok: true,
      path: 'Work/a.md',
      renamed: false,
      partial: { restored: 2, left: ['Work/big.md'], line: VAULT_TEAM_FULL },
    });
    // The list shows what came back.
    expect(
      useApp
        .getState()
        .vaultFiles.map((f) => f.path)
        .sort(),
    ).toEqual(['Work/a.md', 'Work/c.md']);
  });

  it("Today's start past it says Not started and why", async () => {
    server.putSettings({ version: 1, daily: { template: 'Templates/Day' } });
    server.put('Templates/Day.md', '# The day', 'u-me');
    await useApp.getState().vaultRefresh();
    // Settings read before this case are cached for a minute: read them again.
    clearVaultTodayCache();
    server.freeBytes = server.usage();
    expect(await useApp.getState().vaultToday()).toEqual({
      kind: 'refused',
      line: `Not started. ${VAULT_TEAM_FULL}`,
    });
  });

  it('a rename once the team is past it says Not renamed and why', async () => {
    server.put('a.md', 'x'.repeat(20), 'u-me');
    await useApp.getState().vaultRefresh();
    const preview = await useApp.getState().vaultPrepareMove('note', 'a.md', 'b.md');
    if (!preview) throw new Error('no preview');
    server.freeBytes = server.usage() - 1;
    expect(await useApp.getState().vaultApplyMove(preview, false)).toEqual({
      ok: false,
      reason: 'storage',
      line: `Not renamed. ${VAULT_TEAM_FULL}`,
      whole: true,
    });
    expect(server.bytes('a.md')).toBe('x'.repeat(20));
  });
});

// The round 5 review (2026-09-30): every way a team refusal or a thrown
// provider error reaches the person ends in an honest line and never loses
// typed text. The real team provider over the shared fake server, which
// raises 0023's 23514 past `freeBytes`, OV402 when `entitled` is false, and
// answers `missing`, `exists` and `changed` the way 0021 and 0024 do.
describe('round 5: a team refusal says what happened and keeps the text', () => {
  let server: FakeOrgVaultServer;
  beforeEach(async () => {
    reset();
    await closeVaultIndex();
    wiring.org!.resetOrgVault();
    useApp.setState({ vaultTeamPlan: undefined, vaultConflict: undefined, vaultTrash: undefined });
    server = createFakeOrgVaultServer(ORG);
    teamNet.server = server;
    teamScope();
  });
  afterEach(async () => {
    useApp.setState({ vaultTeamPlan: undefined, vaultConflict: undefined });
    await closeVaultIndex();
  });
  const FULL_HELD = `Not saved. ${VAULT_TEAM_FULL} Your text is kept under Not saved.`;
  async function settledIndex() {
    for (let i = 0; i < 100; i++) {
      await tick();
      const state = vaultIndexStatus().state;
      if (currentVaultIndex() && (state === 'ready' || state === 'partial')) return;
    }
    throw new Error('the index never settled');
  }
  // The note open here, changed (or deleted) by a teammate, and a save of
  // `typed` that raises the resolve sheet.
  async function sheetOn(path: string, typed: string, gone = false) {
    server.put(path, 'the base', 'u-me');
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen(path);
    if (gone) server.drop(path);
    else server.put(path, 'theirs');
    await useApp.getState().vaultSave(path, typed);
    expect(useApp.getState().vaultConflict).toMatchObject({
      path,
      kind: gone ? 'missing' : 'changed',
    });
  }

  it('a save that lands after its note closed keeps the text when the keep-both copy is refused (finding 1)', async () => {
    server.put('plan.md', 'the plan', 'u-me');
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen('plan.md');
    const at = useApp.getState().vaultTargetRef();
    server.put('plan.md', 'their plan');
    server.freeBytes = server.usage() + 3;
    const words = 'my words, typed before leaving';
    // Leaving the note flushes its save; the answer comes back after it closed.
    const saving = useApp.getState().vaultSave('plan.md', words, at);
    useApp.getState().vaultCloseNote();
    await expect(saving).resolves.toBeUndefined();
    expect(pending()).toEqual({});
    expect(teamHeld()).toEqual([
      expect.objectContaining({ path: 'plan.md', text: words, reason: VAULT_TEAM_FULL }),
    ]);
    expect(useApp.getState().toast).toBe(FULL_HELD);
    expect(useApp.getState().vaultError).toBe('held');
    expect(server.bytes('plan.md')).toBe('their plan');
    expect([...server.notes.keys()]).toEqual(['plan.md']);
  });

  it('Keep both, Keep yours and Save it again at the cap hold the text with the reason (finding 2)', async () => {
    const mine = 'mine, typed here while it changed';
    for (const [choice, path] of [
      ['both', 'a.md'],
      ['mine', 'b.md'],
    ] as const) {
      await sheetOn(path, mine);
      server.freeBytes = server.usage() + 2;
      expect(await useApp.getState().vaultResolve(choice, mine)).toEqual({ ok: true });
      const st = useApp.getState();
      expect(st.vaultConflict).toBeUndefined();
      expect(st.vaultNote).toMatchObject({ path, text: 'theirs' });
      expect(teamHeld()).toContainEqual(
        expect.objectContaining({ path, text: mine, reason: VAULT_TEAM_FULL }),
      );
      expect(st.toast).toBe(FULL_HELD);
      expect(server.bytes(path)).toBe('theirs');
      server.freeBytes = undefined;
    }
    // Gone elsewhere: Save it again is a new note, refused the same way.
    await sheetOn('c.md', mine, true);
    server.freeBytes = server.usage() + 2;
    expect(await useApp.getState().vaultResolve('mine', mine)).toEqual({ ok: true });
    expect(useApp.getState().vaultNote).toBeUndefined();
    expect(teamHeld()).toContainEqual(
      expect.objectContaining({ path: 'c.md', text: mine, reason: VAULT_TEAM_FULL }),
    );
    expect(useApp.getState().toast).toBe(FULL_HELD);
    expect(server.bytes('c.md')).toBeUndefined();
    // Nothing is left to replay over the note later.
    expect(pending()).toEqual({});
  });

  it('a plan the room has not read yet (OV402) holds the text with its line on the first tap (finding 2)', async () => {
    const mine = 'mine, typed here';
    await sheetOn('n.md', mine);
    server.entitled = false;
    useApp.setState({ vaultTeamPlan: undefined });
    expect(await useApp.getState().vaultResolve('both', mine)).toEqual({ ok: true });
    expect(teamHeld()).toEqual([
      expect.objectContaining({ path: 'n.md', text: mine, reason: VAULT_TEAM_LAPSED_NOT_SAVED }),
    ]);
    expect(useApp.getState().toast).toBe(
      `${VAULT_TEAM_LAPSED_NOT_SAVED_LINE} Your text is kept under Not saved.`,
    );
    expect(useApp.getState().vaultTeamPlan).toMatchObject({ entitled: false });
  });

  it('a failure that may pass keeps the sheet up and says so, holding nothing', async () => {
    const mine = 'mine, typed here';
    await sheetOn('n.md', mine);
    server.rpcFailure = new TypeError('Failed to fetch');
    expect(await useApp.getState().vaultResolve('both', mine)).toEqual({
      ok: false,
      failed: true,
    });
    expect(useApp.getState().vaultConflict).toMatchObject({ path: 'n.md' });
    expect(teamHeld()).toEqual([]);
  });

  it('links a rename cannot update at the cap carry the reason, and Update the rest does too (finding 3)', async () => {
    server.put('Ideas.md', 'my ideas', 'u-me');
    server.put('Ref.md', 'see [[Ideas]]');
    await useApp.getState().vaultRefresh();
    await settledIndex();
    const preview = await useApp
      .getState()
      .vaultPrepareMove('note', 'Ideas.md', 'Plans and more.md');
    if (!preview) throw new Error('no preview');
    expect(preview.links).toBe(1);
    server.freeBytes = server.usage() + 2;
    const r = await useApp.getState().vaultApplyMove(preview, true);
    if (!r?.ok || !r.rewrite) throw new Error('not renamed');
    expect(r.rewrite).toMatchObject({
      updated: 0,
      total: 1,
      notUpdated: ['Ref.md'],
      stopped: true,
      refusal: { line: VAULT_TEAM_FULL },
    });
    expect(server.bytes('Plans and more.md')).toBe('my ideas');
    expect(server.bytes('Ref.md')).toBe('see [[Ideas]]');
    const again = await useApp.getState().vaultUpdateRest(preview, r.rewrite);
    expect(again).toMatchObject({ stopped: true, refusal: { line: VAULT_TEAM_FULL } });
  });

  it('linking a mention and marking reviewed at the cap say why, verb first (finding 4)', async () => {
    server.put('a.md', 'Plan is here', 'u-me');
    await useApp.getState().vaultRefresh();
    server.freeBytes = server.usage() + 1;
    expect(
      await useApp.getState().vaultRewriteNote('a.md', (t) => t.replace('Plan', '[[Plan]]')),
    ).toEqual({ ok: false, line: `Not linked. ${VAULT_TEAM_FULL}` });
    expect(await useApp.getState().vaultMarkReviewed('a.md', true)).toEqual({
      kind: 'refused',
      line: `Not marked. ${VAULT_TEAM_FULL}`,
    });
    expect(server.bytes('a.md')).toBe('Plan is here');
  });

  it("a settings save refused by the plan or the admin rule says that line, never 'try again' (finding 4)", async () => {
    const ADMINS_ONLY = 'Not saved. Only admins can change team vault settings.';
    server.put('a.md', 'x', 'u-me');
    await useApp.getState().vaultRefresh();
    // Each case starts from a fresh read, as the sheet's open does.
    const read = async () => {
      for (let i = 0; i < 5; i++) await tick();
      await useApp.getState().vaultLoadSettings({ force: true });
      expect(useApp.getState().vaultCapsNow().settingsWrite).toBe(true);
    };
    await read();
    // Demoted after the sheet read the row: the settings read again say so.
    server.isAdmin = false;
    expect(
      await useApp.getState().vaultSaveSetting({ field: 'editor.font', value: 'serif' }),
    ).toEqual({ kind: 'refused', line: ADMINS_ONLY });
    await vi.waitFor(() => expect(useApp.getState().vaultTeamPlan?.isAdmin).toBe(false));
    server.isAdmin = true;
    await read();
    server.isAdmin = false;
    expect(await useApp.getState().vaultSetTeamDeleteRole('admin')).toEqual({
      kind: 'refused',
      line: ADMINS_ONLY,
    });
    // The plan lapsed after the read (OV402).
    server.isAdmin = true;
    await read();
    server.entitled = false;
    expect(await useApp.getState().vaultSetTeamDeleteRole('admin')).toEqual({
      kind: 'refused',
      line: VAULT_TEAM_LAPSED_NOT_SAVED_LINE,
    });
    expect(useApp.getState().vaultTeamPlan).toMatchObject({ entitled: false });
    server.entitled = true;
    await read();
    server.entitled = false;
    expect(
      await useApp.getState().vaultSaveSetting({ field: 'editor.font', value: 'serif' }),
    ).toEqual({ kind: 'refused', line: VAULT_TEAM_LAPSED_NOT_SAVED_LINE });
    expect(useApp.getState().vaultTeamPlan).toMatchObject({ entitled: false });
    expect(server.settingsRow).toBeUndefined();
  });

  it('a delete of a note a teammate already deleted says it is gone and relists (finding 5)', async () => {
    server.put('gone.md', 'x', 'u-me');
    server.put('open.md', 'y', 'u-me');
    server.put('keep.md', 'z', 'u-me');
    await useApp.getState().vaultRefresh();
    // From a stale list, closed.
    server.drop('gone.md');
    expect(await useApp.getState().vaultDeleteNote('gone.md')).toEqual({
      ok: false,
      reason: 'missing',
      line: vaultGoneToast('gone'),
    });
    expect(
      useApp
        .getState()
        .vaultFiles.map((f) => f.path)
        .sort(),
    ).toEqual(['keep.md', 'open.md']);
    // Open, clean: the remove's gone answer is not "changed", and the note closes.
    await useApp.getState().vaultOpen('open.md');
    server.drop('open.md');
    expect(await useApp.getState().vaultDeleteNote('open.md')).toEqual({
      ok: false,
      reason: 'missing',
      line: vaultGoneToast('open'),
    });
    expect(useApp.getState().vaultNote).toBeUndefined();
    expect(useApp.getState().vaultFiles.map((f) => f.path)).toEqual(['keep.md']);
  });

  it('a rename of a note a teammate deleted says it is gone, not try again (finding 5)', async () => {
    server.put('a.md', 'x', 'u-me');
    server.put('keep.md', 'z', 'u-me');
    await useApp.getState().vaultRefresh();
    const preview = await useApp.getState().vaultPrepareMove('note', 'a.md', 'b.md');
    if (!preview) throw new Error('no preview');
    server.drop('a.md');
    expect(await useApp.getState().vaultApplyMove(preview, false)).toMatchObject({
      ok: false,
      reason: 'missing',
      line: vaultGoneToast('a'),
      whole: true,
    });
    expect(useApp.getState().vaultFiles.map((f) => f.path)).toEqual(['keep.md']);
  });

  it('a folder move stopped by a taken name, even one that differs by case, names it (finding 5)', async () => {
    server.put('Work/a.md', 'a', 'u-me');
    server.put('Work/c.md', 'c', 'u-me');
    server.put('Done/C.md', 'theirs');
    await useApp.getState().vaultRefresh();
    await settledIndex();
    const preview = await useApp.getState().vaultPrepareMove('folder', 'Work', 'Done');
    if (!preview) throw new Error('no preview');
    const r = await useApp.getState().vaultApplyMove(preview, false);
    expect(r).toMatchObject({
      ok: false,
      reason: 'partial',
      line: vaultFolderMoveTaken({ old: 'Work', moved: 1, total: 2, name: 'C', folder: 'Done' }),
      whole: true,
    });
    expect(r && !r.ok ? r.line : '').not.toMatch(/try again/i);
    expect(server.bytes('Done/a.md')).toBe('a');
    expect(server.bytes('Work/c.md')).toBe('c');
    expect(server.bytes('Done/C.md')).toBe('theirs');
    // Taken on the first note: nothing moved, and it still names the note.
    server.put('Old/d.md', 'd', 'u-me');
    server.put('Done/D.md', 'theirs');
    await useApp.getState().vaultRefresh();
    await settledIndex();
    const first = await useApp.getState().vaultPrepareMove('folder', 'Old', 'Done');
    if (!first) throw new Error('no preview');
    expect(await useApp.getState().vaultApplyMove(first, false)).toMatchObject({
      ok: false,
      reason: 'exists',
      line: vaultFolderMoveTaken({ old: 'Old', moved: 0, total: 1, name: 'D', folder: 'Done' }),
      whole: true,
    });
  });

  it("a new note whose name a teammate took in another case opens theirs, at theirs' path (finding 6)", async () => {
    await useApp.getState().vaultRefresh();
    server.put('plan.md', 'their plan');
    await useApp.getState().vaultCreate('Plan');
    expect(useApp.getState().vaultNote).toMatchObject({ path: 'plan.md', text: 'their plan' });
    expect(server.bytes('Plan.md')).toBeUndefined();
    expect([...server.notes.keys()]).toEqual(['plan.md']);
  });

  // The sweep after the round 5 findings: the paths the review did not name.
  it('a tick refused by a plan the room had not read (OV402) says the plan, never try again (sweep)', async () => {
    server.put('t.md', '- [ ] one', 'u-me');
    await useApp.getState().vaultRefresh();
    await useApp.getState().vaultOpen('t.md');
    for (let i = 0; i < 5; i++) await tick();
    server.entitled = false;
    useApp.setState({ vaultTeamPlan: undefined, toast: undefined });
    expect(await useApp.getState().vaultToggleTask('t.md', 0, true)).toBe(false);
    expect(useApp.getState().toast).toBe(VAULT_TEAM_LAPSED_NOT_SAVED_LINE);
    expect(useApp.getState().vaultTeamPlan).toMatchObject({ entitled: false });
    expect(server.bytes('t.md')).toBe('- [ ] one');
  });

  it('a Restore or an Undo of what is no longer in Trash says so, never "still in Trash" (sweep)', async () => {
    // A folder's Undo after a teammate brought its notes back.
    server.put('Work/a.md', 'a', 'u-me');
    await useApp.getState().vaultRefresh();
    const at = useApp.getState().vaultTargetRef();
    const gone = await useApp.getState().vaultDeleteFolder('Work');
    if (!gone?.ok || !gone.undo) throw new Error('not deleted');
    server.put('Work/a.md', 'a, back', 'u-teammate');
    expect(await useApp.getState().vaultUndoDelete(gone.undo, at)).toEqual({
      ok: false,
      reason: 'missing',
      line: vaultTrashGone('Work'),
      whole: true,
    });
    await vi.waitFor(() =>
      expect(useApp.getState().vaultFiles.map((f) => f.path)).toEqual(['Work/a.md']),
    );
    // A Trash page's Restore of a note whose history was cleared meanwhile.
    server.put('Old.md', 'old', 'u-me');
    server.drop('Old.md');
    await useApp.getState().vaultRefresh();
    expect((await useApp.getState().vaultLoadTrash())?.map((e) => e.path)).toEqual(['Old.md']);
    server.revisions.length = 0;
    server.notes.delete('Old.md');
    expect(await useApp.getState().vaultRestoreTrash('n:Old.md')).toEqual({
      ok: false,
      reason: 'missing',
      line: vaultTrashGone('Old'),
      whole: true,
    });
    await vi.waitFor(() => expect(useApp.getState().vaultTrash).toEqual([]));
  });

  it('a folder move passes over a note a teammate already deleted, and moves the rest (sweep)', async () => {
    server.put('Work/a.md', 'a', 'u-me');
    server.put('Work/b.md', 'b', 'u-me');
    await useApp.getState().vaultRefresh();
    await settledIndex();
    // Deleted elsewhere before this list or the index caught up.
    server.drop('Work/a.md');
    const preview = await useApp.getState().vaultPrepareMove('folder', 'Work', 'Done');
    if (!preview) throw new Error('no preview');
    expect(await useApp.getState().vaultApplyMove(preview, false)).toMatchObject({ ok: true });
    expect(server.bytes('Done/b.md')).toBe('b');
    expect(server.bytes('Work/b.md')).toBeUndefined();
    expect(useApp.getState().vaultFiles.map((f) => f.path)).toEqual(['Done/b.md']);
  });

  it('a folder whose first note changed while it moved says nothing moved, not "the newer version is open" (sweep)', async () => {
    server.put('Work/a.md', 'a', 'u-me');
    await useApp.getState().vaultRefresh();
    await settledIndex();
    const preview = await useApp.getState().vaultPrepareMove('folder', 'Work', 'Done');
    if (!preview) throw new Error('no preview');
    // A teammate saves the note between the stat and the move.
    const rpc = server.rpc.bind(server);
    server.rpc = async (fn, token, args) => {
      if (fn === 'org_vault_move') server.put('Work/a.md', 'a, edited');
      return rpc(fn, token, args);
    };
    expect(await useApp.getState().vaultApplyMove(preview, false)).toMatchObject({
      ok: false,
      reason: 'changed',
      line: vaultRenameFailed('Work'),
      whole: true,
    });
    expect(server.bytes('Work/a.md')).toBe('a, edited');
  });
});

// ---- round 7: team text belongs to its account and its version ------------
// The fake server, per caller: auth.uid() is the token's account (0021's
// org_vault_write stamps updated_by with it), a non-member's RPCs raise "not a
// member of this org", and a non-member's RLS selects answer nothing. `hold`
// delays the answer of the next matching call (the request already ran on the
// server), as a slow network would; with `fail`, the call waits and then
// throws what `fail` returns, before it reaches the server.
function perCaller(server: FakeOrgVaultServer, opts: { members?: string[] } = {}) {
  const rpc = server.rpc.bind(server);
  const select = server.select.bind(server);
  const uidOf = (token: string) => token.replace(/^tok-/, '');
  const holds: Array<{ fn: string; gate: Promise<void>; hit: () => void; fail?: () => unknown }> =
    [];
  server.rpc = async (fn, token, args) => {
    const uid = uidOf(token);
    if (opts.members && !opts.members.includes(uid)) {
      server.rpcs.push({ fn, args });
      throw Object.assign(new Error('not a member of this org'), { status: 400 });
    }
    const i = holds.findIndex((h) => h.fn === fn);
    const h = i >= 0 ? holds.splice(i, 1)[0]! : undefined;
    if (h?.fail) {
      h.hit();
      await h.gate;
      const e = h.fail();
      if (e) throw e;
    }
    server.caller = uid;
    const out = await rpc(fn, token, args);
    if (h && !h.fail) {
      h.hit();
      await h.gate;
    }
    return out;
  };
  server.select = async (table, token, query) => {
    if (opts.members && !opts.members.includes(uidOf(token)) && table.startsWith('org_vault')) {
      return [];
    }
    return select(table, token, query);
  };
  return {
    hold(fn: string, fail?: () => unknown) {
      const d = deferred();
      const reached = deferred();
      holds.push({ fn, gate: d.promise, hit: reached.resolve, ...(fail ? { fail } : {}) });
      return { release: d.resolve, reached: reached.promise };
    },
  };
}
// Hold every org_vault_write before it reaches the server until `open`
// resolves; `seen` counts the ones held.
function gateWrites(server: FakeOrgVaultServer) {
  const rpc = server.rpc.bind(server);
  const g = { on: true, open: deferred(), seen: 0 };
  server.rpc = async (fn, token, args) => {
    if (fn === 'org_vault_write' && g.on) {
      g.seen++;
      await g.open.promise;
    }
    return rpc(fn, token, args);
  };
  return g;
}
const U2 = { id: 'u2', email: 'b@example.com' };
// Whether words are anywhere this device or the team keeps them: a live note,
// the stash, or Not saved.
const liveHas = (server: FakeOrgVaultServer, words: string) =>
  [...server.notes.values()].some((n) => !n.deleted && n.body.includes(words)) ||
  Object.values(pending()).some((e) => e.text.includes(words)) ||
  useApp.getState().vaultHeld.some((h) => h.text.includes(words));
const sealedHeld = () =>
  JSON.parse(mem.get(HELD) ?? '[]') as Array<{ text: string; owner?: string; id: string }>;

describe('round 7: team text belongs to its account and its version', () => {
  let server: FakeOrgVaultServer;
  const st = () => useApp.getState();
  beforeEach(async () => {
    reset();
    // No refresh an earlier case made stands in for this case's own.
    await (await import('../src/lib/authSession.js')).clearSession();
    await closeVaultIndex();
    wiring.org!.resetOrgVault();
    useApp.setState({ vaultTeamPlan: undefined, vaultConflict: undefined, vaultTrash: undefined });
    server = createFakeOrgVaultServer(ORG);
    teamNet.server = server;
    teamScope();
  });
  afterEach(async () => {
    useApp.setState({ vaultTeamPlan: undefined, vaultConflict: undefined });
    await closeVaultIndex();
  });

  describe('E1: a team choice and its draft leave with the sign-in', () => {
    // u1 types in team Plan.md as a teammate saves, defers the choice (as
    // leaving the room does), signs out, and u2 signs in on the personal vault.
    async function staleChoice(words: string, members = ['u1', 'u2'], theirs = 'team theirs') {
      perCaller(server, { members });
      useStoreToken();
      server.put('Plan.md', 'the base', 'u1');
      await st().vaultRefresh();
      await st().vaultOpen('Plan.md');
      server.put('Plan.md', theirs);
      st().vaultNoteDraft('Plan.md', words);
      await st().vaultSave('Plan.md', words);
      expect(st().vaultConflict?.kind).toBe('changed');
      st().vaultDeferConflict(true);
      await st().signOutAccount();
      signedOut = st().vaultConflict;
      auth.nextUser = U2;
      await st().signIn('b@example.com', 'pw');
      expect(st().authSession?.user.id).toBe('u2');
      useApp.setState({ vaultScope: 'personal', toast: undefined });
    }
    let signedOut: unknown;

    it('the choice is gone after the sign-out and after the next sign-in', async () => {
      await staleChoice('u1 private words');
      expect(signedOut).toBeUndefined();
      expect(st().vaultConflict).toBeUndefined();
    });

    it("opening any personal note never publishes u1's words under u2 (B4)", async () => {
      await staleChoice('u1 private words');
      files.set('Other.md', 'u2 personal');
      await st().vaultRefresh();
      await st().vaultOpen('Other.md');
      for (let i = 0; i < 10; i++) await tick();
      const live = [...server.notes.values()]
        .filter((n) => !n.deleted && n.body.includes('u1 private words'))
        .map((n) => `${n.path} by ${n.updated_by}`);
      expect(live).toEqual([]);
      expect(st().toast).toBeUndefined();
      expect(JSON.stringify(st().vaultHeld)).not.toContain('u1 private words');
    });

    it('Keep yours on a personal note of the same name never writes it over the team note (B2)', async () => {
      await staleChoice('u1 private words');
      files.set('Plan.md', "u2's private personal plan");
      await st().vaultRefresh();
      await st().vaultOpen('Plan.md');
      expect(st().vaultConflict).toBeUndefined();
      await st().vaultResolve('mine', "u2's private personal plan");
      expect(server.bytes('Plan.md')).toBe('team theirs');
    });

    it('Keep the other version never puts team text into the personal file (B3)', async () => {
      await staleChoice('u1 private words');
      files.set('Plan.md', "u2's private personal plan");
      await st().vaultRefresh();
      await st().vaultOpen('Plan.md');
      await st().vaultResolve('theirs', "u2's private personal plan");
      await st().vaultSave('Plan.md', `${st().vaultNote?.text ?? ''}!`);
      expect(files.get('Plan.md')).toBe("u2's private personal plan!");
    });

    it("an account outside the org is never shown the org's text", async () => {
      await staleChoice('u1 private words', ['u1'], 'org-only salary table');
      files.set('Plan.md', "u2's private personal plan");
      await st().vaultRefresh();
      await st().vaultOpen('Plan.md');
      expect({ theirs: st().vaultConflict?.theirs?.text, base: st().vaultConflict?.base }).toEqual({
        theirs: undefined,
        base: undefined,
      });
      expect(JSON.stringify(st().vaultHeld)).not.toContain('u1 private words');
    });

    it('a stale choice left in place is never settled under another account', async () => {
      perCaller(server, { members: ['u1', 'u2'] });
      useStoreToken();
      server.put('Plan.md', 'the base', 'u1');
      await st().vaultRefresh();
      await st().vaultOpen('Plan.md');
      server.put('Plan.md', 'team theirs');
      st().vaultNoteDraft('Plan.md', 'u1 private words');
      await st().vaultSave('Plan.md', 'u1 private words');
      const c = st().vaultConflict!;
      // Put back as if a sign-out had missed it: u2 is now signed in.
      await st().signOutAccount();
      auth.nextUser = U2;
      await st().signIn('b@example.com', 'pw');
      await st().setVaultScope('team');
      useApp.setState({ vaultConflict: c, toast: undefined });
      expect(await st().vaultResolve('both', 'u1 private words')).toMatchObject({ ok: false });
      useApp.setState({ vaultConflict: c });
      await st().vaultLeaveConflict();
      for (let i = 0; i < 10; i++) await tick();
      expect(liveHas(server, 'u1 private words')).toBe(false);
      expect(st().vaultConflict).toBeUndefined();
      expect(server.rpcs.filter((r) => r.fn === 'org_vault_write').length).toBe(1);
    });

    it('an expiry keeps the choice for the same account, whose Keep both then writes the copy', async () => {
      perCaller(server, { members: ['u1', 'u2'] });
      useStoreToken();
      server.put('Plan.md', 'the base', 'u1');
      await st().vaultRefresh();
      await st().vaultOpen('Plan.md');
      server.put('Plan.md', 'team theirs');
      st().vaultNoteDraft('Plan.md', 'u1 typed words');
      await st().vaultSave('Plan.md', 'u1 typed words');
      useApp.setState({ authSession: session(auth.nextUser, -1000) });
      auth.refresh = new SupabaseRequestError('invalid grant', 400);
      await st().refreshOrgRole();
      auth.refresh = undefined;
      expect(st().vaultTeamExpired).toBe(true);
      expect(st().vaultConflict).toMatchObject({ path: 'Plan.md', kind: 'changed' });
      await st().signIn('me@example.com', 'pw');
      expect(st().vaultConflict).toMatchObject({ path: 'Plan.md', kind: 'changed' });
      expect(await st().vaultResolve('both', 'u1 typed words')).toEqual({ ok: true });
      const copies = [...server.notes.values()].filter(
        (n) => !n.deleted && conflictCopy('Plan').test(n.path),
      );
      expect(copies.map((n) => [n.body, n.updated_by])).toEqual([['u1 typed words', 'u1']]);
    });

    it('an expiry followed by another account clears the choice and sends nothing', async () => {
      perCaller(server, { members: ['u1', 'u2'] });
      useStoreToken();
      server.put('Plan.md', 'the base', 'u1');
      await st().vaultRefresh();
      await st().vaultOpen('Plan.md');
      server.put('Plan.md', 'team theirs');
      st().vaultNoteDraft('Plan.md', 'u1 typed words');
      await st().vaultSave('Plan.md', 'u1 typed words');
      useApp.setState({ authSession: session(auth.nextUser, -1000) });
      auth.refresh = new SupabaseRequestError('invalid grant', 400);
      await st().refreshOrgRole();
      auth.refresh = undefined;
      const writes = server.rpcs.filter((r) => r.fn === 'org_vault_write').length;
      auth.nextUser = U2;
      await st().signIn('b@example.com', 'pw');
      expect(st().vaultConflict).toBeUndefined();
      files.set('Other.md', 'u2 personal');
      await st().vaultRefresh();
      await st().vaultOpen('Other.md');
      for (let i = 0; i < 10; i++) await tick();
      expect(server.rpcs.filter((r) => r.fn === 'org_vault_write').length).toBe(writes);
      expect(liveHas(server, 'u1 typed words')).toBe(false);
    });
  });

  describe('E5: team text is sent only under the account that typed it', () => {
    // Every team RPC with the token it went out on.
    function recordTokens() {
      const calls: Array<{ fn: string; token: string; body?: unknown; path?: unknown }> = [];
      const rpc = server.rpc.bind(server);
      server.rpc = async (fn, token, args) => {
        calls.push({ fn, token, body: args.p_body, path: args.p_path ?? args.p_to });
        return rpc(fn, token, args);
      };
      return calls;
    }
    async function switchTo(user: { id: string; email: string }) {
      await st().signOutAccount();
      auth.nextUser = user;
      await st().signIn(user.email, 'pw');
    }

    it("a keep-both copy after the account switch is never sent on the new account's token", async () => {
      useStoreToken();
      server.put('n.md', 'A', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('n.md');
      const g = gateWrites(server);
      const calls = recordTokens();
      const at = st().vaultTargetRef();
      const save = st().vaultSave('n.md', 'u1 words, private to u1', at);
      await vi.waitFor(() => expect(g.seen).toBe(1));
      server.put('n.md', 'a teammate saved');
      g.on = false;
      await switchTo(U2);
      g.open.resolve();
      await save;
      for (let i = 0; i < 10; i++) await tick();
      expect(
        calls.filter(
          (c) => c.token === 'tok-u2' && typeof c.body === 'string' && c.body.includes('u1 words'),
        ),
      ).toEqual([]);
      expect(liveHas(server, 'u1 words, private to u1')).toBe(true);
      expect(server.bytes('n.md')).toBe('a teammate saved');
      expect(st().vaultHeldVisible()).toEqual([]);
    });

    it("the copy is never published under u2, and u1's text shows to u1 alone", async () => {
      const net = perCaller(server, { members: ['u1', 'u2'] });
      useStoreToken();
      server.put('Plan.md', 'the base', 'u9');
      await st().vaultRefresh();
      await st().vaultOpen('Plan.md');
      server.put('Plan.md', 'theirs', 'u-teammate');
      const held = net.hold('org_vault_write');
      const save = st().vaultSave('Plan.md', 'the base\nu1 in-flight words');
      await held.reached;
      await switchTo(U2);
      held.release();
      await save;
      for (let i = 0; i < 10; i++) await tick();
      const live = [...server.notes.values()].filter((n) => !n.deleted);
      expect(live.map((n) => [n.path, n.body, n.updated_by])).toEqual([
        ['Plan.md', 'theirs', 'u-teammate'],
      ]);
      expect(st().vaultHeldVisible()).toEqual([]);
      // Kept in memory for u1 alone, never sent (keepUnsentTeamText).
      expect(st().vaultHeld.map((h) => [h.owner, h.text, h.durable])).toEqual([
        ['u1', 'the base\nu1 in-flight words', false],
      ]);
    });

    it("a replay that runs across a sign-out never writes the rest of u1's stash under u2", async () => {
      const net = perCaller(server, { members: ['u1', 'u2'] });
      useStoreToken();
      teamNet.fail = new TypeError('Failed to fetch');
      await st().vaultSave('a.md', 'u1 draft a');
      await st().vaultSave('b.md', 'u1 draft b');
      teamNet.fail = undefined;
      expect(Object.keys(pending()).length).toBe(2);
      const held = net.hold('org_vault_write');
      const refresh = st().vaultRefresh();
      await held.reached;
      await switchTo(U2);
      useApp.setState({ toast: undefined, vaultError: undefined });
      held.release();
      await refresh;
      for (let i = 0; i < 10; i++) await tick();
      const byU2 = [...server.notes.values()].filter(
        (n) => !n.deleted && n.body.startsWith('u1 draft') && n.updated_by === 'u2',
      );
      expect(byU2.map((n) => n.path)).toEqual([]);
      expect(pending()).toEqual({});
      expect(st().vaultError).toBeUndefined();
      expect(st().toast).toBeUndefined();
    });

    it('a replay cut short by an expiry keeps the rest sealed, and it replays under u1 on return', async () => {
      const net = perCaller(server, { members: ['u1', 'u2'] });
      useStoreToken();
      teamNet.fail = new TypeError('Failed to fetch');
      await st().vaultSave('a.md', 'u1 draft a');
      await st().vaultSave('b.md', 'u1 draft b');
      teamNet.fail = undefined;
      const held = net.hold('org_vault_write');
      const refresh = st().vaultRefresh();
      await held.reached;
      useApp.setState({ authSession: session(auth.nextUser, -1000) });
      auth.refresh = new SupabaseRequestError('invalid grant', 400);
      await st().refreshOrgRole();
      auth.refresh = undefined;
      expect(st().vaultTeamExpired).toBeFalsy();
      held.release();
      await refresh;
      for (let i = 0; i < 10; i++) await tick();
      expect(server.bytes('b.md')).toBeUndefined();
      expect(Object.values(pending()).map((e) => e.text)).toEqual(['u1 draft b']);
      await st().signIn('me@example.com', 'pw');
      await st().setVaultScope('team');
      for (let i = 0; i < 10; i++) await tick();
      expect(server.notes.get('b.md')).toMatchObject({ body: 'u1 draft b', updated_by: 'u1' });
      expect(pending()).toEqual({});
    });

    it('a folder move that spans the switch sends no step on the new token', async () => {
      const net = perCaller(server, { members: ['u1', 'u2'] });
      useStoreToken();
      server.put('Work/a.md', 'a', 'u1');
      server.put('Work/b.md', 'b', 'u1');
      await st().vaultRefresh();
      for (let i = 0; i < 20; i++) await tick();
      const preview = await st().vaultPrepareMove('folder', 'Work', 'Done');
      if (!preview) throw new Error('no preview');
      const calls = recordTokens();
      const held = net.hold('org_vault_move');
      const move = st().vaultApplyMove(preview, false);
      await held.reached;
      await switchTo(U2);
      held.release();
      await move;
      expect(
        calls.filter((c) => c.token === 'tok-u2' && c.fn !== 'org_vault_settings_get'),
      ).toEqual([]);
    });

    it('with no account switch, the keep-both copy is written and every draft replays', async () => {
      perCaller(server, { members: ['u1', 'u2'] });
      useStoreToken();
      server.put('n.md', 'A', 'u1');
      await st().vaultRefresh();
      await st().vaultOpen('n.md');
      st().vaultCloseNote();
      teamNet.fail = new TypeError('Failed to fetch');
      await st().vaultSave('a.md', 'u1 draft a');
      await st().vaultSave('b.md', 'u1 draft b');
      teamNet.fail = undefined;
      // The access token turns over mid-replay: the same account goes on.
      useApp.setState({ authSession: session(auth.nextUser, -1000) });
      await st().vaultRefresh();
      for (let i = 0; i < 10; i++) await tick();
      expect(server.notes.get('a.md')).toMatchObject({ body: 'u1 draft a', updated_by: 'u1' });
      expect(server.notes.get('b.md')).toMatchObject({ body: 'u1 draft b', updated_by: 'u1' });
      expect(pending()).toEqual({});
    });
  });

  describe('E6: after an expiry, team text stays sealed for the same account', () => {
    beforeEach(() => {
      perCaller(server, { members: ['u1', 'u2'] });
    });
    // The note open here, changed (or deleted) by a teammate, and a save of
    // `typed` that raises the choice; its words are in the stash.
    async function choiceOn(path: string, typed: string, gone = false) {
      server.put(path, 'the base', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen(path);
      if (gone) server.drop(path);
      else server.put(path, 'theirs');
      st().vaultNoteDraft(path, typed);
      await st().vaultSave(path, typed);
      expect(st().vaultConflict).toMatchObject({ path, kind: gone ? 'missing' : 'changed' });
    }
    async function expire() {
      useApp.setState({ authSession: session(auth.nextUser, -1000) });
      auth.refresh = new SupabaseRequestError('invalid grant', 400);
      await st().refreshOrgRole();
      auth.refresh = undefined;
    }
    const sealedHas = (t: string) => sealedHeld().some((h) => h.text === t && h.owner === 'u1');
    const kept = (path: string, t: string) =>
      pending()[`org::${ORG}::${path}`]?.text === t || sealedHas(t);
    const noFalseCopyLine = () => {
      expect(st().toast ?? '').not.toMatch(/could not keep a copy|Copy it somewhere safe/);
    };
    // u1 signs back in: the text replays into the team vault, shows under
    // Not saved, or waits in the stash under the choice, back on screen.
    async function backAsU1(t: string) {
      await st().signIn('me@example.com', 'pw');
      if (st().vaultScope !== 'team') await st().setVaultScope('team');
      else await st().vaultRefresh();
      for (let i = 0; i < 10; i++) await tick();
      const shown = st()
        .vaultHeldVisible()
        .some((h) => h.text === t);
      const saved = [...server.notes.values()].some(
        (n) => !n.deleted && n.body === t && n.updated_by === 'u1',
      );
      const c = st().vaultConflict;
      const asking =
        c?.target.owner === 'u1' &&
        st().vaultNote?.path === c.path &&
        pending()[`org::${ORG}::${c.path}`]?.text === t;
      expect(shown || saved || asking).toBe(true);
    }

    for (const choice of ['both', 'mine'] as const) {
      it(`${choice === 'both' ? 'Keep both' : 'Keep yours'} after an expiry keeps the words sealed and sends nothing`, async () => {
        useStoreToken();
        await choiceOn('n.md', 'typed before expiry');
        await expire();
        expect(st().vaultTeamExpired).toBe(true);
        useApp.setState({ toast: undefined });
        const writes = server.rpcs.filter((r) => r.fn === 'org_vault_write').length;
        expect(await st().vaultResolve(choice, 'typed before expiry')).toMatchObject({ ok: false });
        expect(kept('n.md', 'typed before expiry')).toBe(true);
        expect(server.rpcs.filter((r) => r.fn === 'org_vault_write').length).toBe(writes);
        noFalseCopyLine();
        await backAsU1('typed before expiry');
      });
    }

    it('a tap that is the first to find the expiry keeps the words sealed', async () => {
      useStoreToken();
      await choiceOn('n.md', 'mine, typed while it changed');
      useApp.setState({ authSession: session(auth.nextUser, -1000), toast: undefined });
      auth.refresh = new SupabaseRequestError('invalid grant', 400);
      await st().vaultResolve('both', 'mine, typed while it changed');
      auth.refresh = undefined;
      expect(st().vaultTeamExpired).toBe(true);
      expect(kept('n.md', 'mine, typed while it changed')).toBe(true);
      noFalseCopyLine();
      await backAsU1('mine, typed while it changed');
    });

    it('closing the kept note on a gone-note choice keeps the words sealed', async () => {
      useStoreToken();
      await choiceOn('n.md', 'typed before expiry', true);
      await expire();
      useApp.setState({ toast: undefined });
      st().vaultCloseNote();
      for (let i = 0; i < 10; i++) await tick();
      expect(kept('n.md', 'typed before expiry')).toBe(true);
      noFalseCopyLine();
      await backAsU1('typed before expiry');
    });

    it("Settings' Vault row on a gone-note choice after an expiry keeps the words sealed", async () => {
      useStoreToken();
      await choiceOn('n.md', 'mine, typed as it went', true);
      await expire();
      useApp.setState({ toast: undefined });
      await st().setVaultScope('personal');
      expect(kept('n.md', 'mine, typed as it went')).toBe(true);
      noFalseCopyLine();
      await backAsU1('mine, typed as it went');
    });

    it('an expiry during a replay keeps the rest sealed', async () => {
      useStoreToken();
      server.put('x.md', 'X', 'u-me');
      server.put('y.md', 'Y', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('x.md');
      server.rpcFailure = new TypeError('Failed to fetch');
      await st().vaultSave('x.md', 'X, and offline words');
      server.rpcFailure = undefined;
      await st().vaultOpen('y.md');
      const g = gateWrites(server);
      const save = st().vaultSave('y.md', 'Y, saved');
      await vi.waitFor(() => expect(g.seen).toBe(1));
      useApp.setState({ authSession: session(auth.nextUser, -1000) });
      auth.refresh = new SupabaseRequestError('invalid grant', 400);
      g.on = false;
      g.open.resolve();
      await save;
      auth.refresh = undefined;
      for (let i = 0; i < 10; i++) await tick();
      expect(kept('x.md', 'X, and offline words')).toBe(true);
      noFalseCopyLine();
    });

    it('a save out when it expired, meeting a deleted note, keeps the words sealed', async () => {
      useStoreToken();
      server.put('n.md', 'A', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('n.md');
      const at = st().vaultTargetRef();
      const g = gateWrites(server);
      const save = st().vaultSave('n.md', 'A, and words out when it expired', at);
      await vi.waitFor(() => expect(g.seen).toBe(1));
      st().vaultCloseNote();
      server.drop('n.md');
      await expire();
      useApp.setState({ toast: undefined });
      g.open.resolve();
      await save;
      expect(kept('n.md', 'A, and words out when it expired')).toBe(true);
      noFalseCopyLine();
    });

    it('another account signing in after the expiry gets nothing of it', async () => {
      useStoreToken();
      await choiceOn('n.md', 'u1 typed before expiry', true);
      await expire();
      st().vaultCloseNote();
      for (let i = 0; i < 10; i++) await tick();
      auth.nextUser = U2;
      await st().signIn('b@example.com', 'pw');
      expect(JSON.stringify(pending())).not.toContain('u1 typed');
      expect(JSON.stringify(sealedHeld())).not.toContain('u1 typed');
      expect(st().vaultHeld.some((h) => h.text.includes('u1 typed'))).toBe(false);
    });
  });

  describe('E7: every Not saved entry keeps its own text', () => {
    const FULL = `Not saved. ${VAULT_TEAM_FULL} Your text is kept under Not saved.`;

    it('a second refused session of the same note keeps the first refused text', async () => {
      server.put('n.md', 'the base', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('n.md');
      server.freeBytes = server.usage();
      const first = 'the base\nA whole paragraph I wrote first.';
      await st().vaultSave('n.md', first);
      expect(st().toast).toBe(FULL);
      st().vaultCloseNote();
      await st().vaultOpen('n.md');
      expect(st().vaultNote?.text).toBe('the base');
      const second = 'the base\nA second thought.';
      await st().vaultSave('n.md', second);
      expect(
        teamHeld()
          .map((h) => h.text)
          .sort(),
      ).toEqual([first, second].sort());
      expect(
        sealedHeld()
          .map((h) => h.text)
          .sort(),
      ).toEqual([first, second].sort());
      // A discard removes exactly the entry shown.
      await st().vaultDiscardHeld(teamHeld().find((h) => h.text === first)!.id);
      expect(teamHeld().map((h) => h.text)).toEqual([second]);
      expect(sealedHeld().map((h) => h.text)).toEqual([second]);
    });

    it('refused autosaves in one sitting leave one entry, with the newest text', async () => {
      server.put('n.md', 'the base', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('n.md');
      server.freeBytes = server.usage();
      await st().vaultSave('n.md', 'the base\nA');
      await st().vaultSave('n.md', 'the base\nA and B');
      expect(teamHeld().map((h) => h.text)).toEqual(['the base\nA and B']);
      expect(sealedHeld().map((h) => h.text)).toEqual(['the base\nA and B']);
    });

    it("another account's late unsent text never replaces yours", async () => {
      const net = perCaller(server, { members: ['u1', 'u2'] });
      useStoreToken();
      await st().vaultRefresh();
      const held = net.hold('org_vault_write', () => new TypeError('Failed to fetch'));
      const save = st().vaultSave('Idea.md', 'u1 idea');
      await held.reached;
      await st().signOutAccount();
      auth.nextUser = U2;
      await st().signIn('b@example.com', 'pw');
      await st().setVaultScope('team');
      server.freeBytes = server.usage();
      await st().vaultCreate('Idea', 'u2 words about the idea');
      expect(
        st()
          .vaultHeldVisible()
          .map((h) => h.text),
      ).toEqual(['u2 words about the idea']);
      held.release();
      await save;
      await tick();
      expect(
        st()
          .vaultHeldVisible()
          .map((h) => h.text),
      ).toEqual(['u2 words about the idea']);
      expect(
        st()
          .vaultHeld.filter((h) => h.owner === 'u1')
          .map((h) => h.text),
      ).toEqual(['u1 idea']);
      // A discard by u2 never removes u1's entry, whatever its id.
      for (const h of [...st().vaultHeld]) await st().vaultDiscardHeld(h.id);
      expect(st().vaultHeld.map((h) => [h.owner, h.text])).toEqual([['u1', 'u1 idea']]);
    });

    it("an earlier sitting's stashed words are kept beside a later refused save", async () => {
      server.put('n.md', 'the base', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('n.md');
      server.rpcFailure = new TypeError('Failed to fetch');
      await st().vaultSave('n.md', 'the base\nwritten offline');
      server.rpcFailure = undefined;
      expect(pending()[`org::${ORG}::n.md`]).toMatchObject({ text: 'the base\nwritten offline' });
      st().vaultCloseNote();
      server.freeBytes = server.usage();
      await st().vaultOpen('n.md');
      await st().vaultSave('n.md', 'the base\nnewer, refused');
      expect(
        teamHeld()
          .map((h) => h.text)
          .sort(),
      ).toEqual(['the base\nnewer, refused', 'the base\nwritten offline']);
      expect(pending()).toEqual({});
      expect(st().toast).toBe(FULL);
    });

    it('a stashed draft refused on replay is kept beside an earlier Not saved entry', async () => {
      server.put('n.md', 'the base', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('n.md');
      server.freeBytes = server.usage();
      await st().vaultSave('n.md', 'the base\nrefused first');
      st().vaultCloseNote();
      server.freeBytes = undefined;
      await st().vaultOpen('n.md');
      server.rpcFailure = new TypeError('Failed to fetch');
      await st().vaultSave('n.md', 'the base\nwritten offline later');
      server.rpcFailure = undefined;
      st().vaultCloseNote();
      server.freeBytes = server.usage();
      await st().vaultRefresh();
      expect(
        teamHeld()
          .map((h) => h.text)
          .sort(),
      ).toEqual(['the base\nrefused first', 'the base\nwritten offline later']);
      expect(
        sealedHeld()
          .map((h) => h.text)
          .sort(),
      ).toEqual(['the base\nrefused first', 'the base\nwritten offline later']);
      expect(st().toast).toBe('An offline edit could not be saved, so it is kept under Not saved.');
    });

    it('an entry sealed under the old id can still be discarded', async () => {
      const legacy = {
        id: 'local::vault.personal::old.md',
        providerId: 'local' as const,
        resourceId: 'vault.personal',
        path: 'old.md',
        text: 'kept from before',
        reason: 'x',
        at: '2026-09-01T00:00:00.000Z',
      };
      mem.set(HELD, JSON.stringify([legacy]));
      useApp.setState({ vaultHeld: [{ ...legacy, durable: true }] });
      await st().vaultDiscardHeld(legacy.id);
      expect(sealedHeld()).toEqual([]);
      expect(st().vaultHeld).toEqual([]);
    });
  });

  describe('E2: a tick is made on the text of the version it is guarded by', () => {
    it("reopening a note a teammate changed, then ticking, keeps the teammate's text", async () => {
      server.put('Tasks.md', '- [ ] mine', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('Tasks.md');
      await st().vaultSave('Tasks.md', '- [ ] mine\n- [ ] also mine');
      st().vaultCloseNote();
      server.put('Tasks.md', '- [ ] mine\n- [ ] also mine\n- [ ] theirs');
      await st().vaultOpen('Tasks.md');
      expect(st().vaultNote).toMatchObject({ text: '- [ ] mine\n- [ ] also mine\n- [ ] theirs' });
      expect(await st().vaultToggleTask('Tasks.md', 0, true)).toBe(true);
      expect(server.bytes('Tasks.md')).toBe('- [x] mine\n- [ ] also mine\n- [ ] theirs');
      expect(st().vaultNote?.text).toBe('- [x] mine\n- [ ] also mine\n- [ ] theirs');
    });

    it("a tick after the poll reloaded a teammate's version keeps their text", async () => {
      server.put('t.md', '- [ ] one', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('t.md');
      await st().vaultSave('t.md', '- [ ] one\nmine');
      server.put('t.md', '- [ ] one\nmine\ntheir line');
      expect(await st().vaultRecheck({ reason: 'poll' })).toBe('checked');
      expect(st().vaultNote).toMatchObject({ text: '- [ ] one\nmine\ntheir line' });
      expect(await st().vaultToggleTask('t.md', 0, true)).toBe(true);
      expect(server.bytes('t.md')).toBe('- [x] one\nmine\ntheir line');
    });

    it('Keep the other version, then a tick, keeps their text', async () => {
      server.put('n.md', '- [ ] one', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('n.md');
      await st().vaultSave('n.md', '- [ ] one\nsaved here');
      server.put('n.md', '- [ ] one\nsaved here\ntheir words');
      st().vaultNoteDraft('n.md', '- [ ] one\nsaved here\ntyped here');
      await st().vaultSave('n.md', '- [ ] one\nsaved here\ntyped here');
      expect(await st().vaultResolve('theirs', '- [ ] one\nsaved here\ntyped here')).toEqual({
        ok: true,
      });
      expect(await st().vaultToggleTask('n.md', 0, true)).toBe(true);
      expect(server.bytes('n.md')).toBe('- [x] one\nsaved here\ntheir words');
    });

    it("tick, a teammate adds a task, the poll reloads, tick again: the teammate's task stays", async () => {
      server.put('t.md', '- [ ] a\n- [ ] b', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('t.md');
      expect(await st().vaultToggleTask('t.md', 0, true)).toBe(true);
      server.put('t.md', '- [x] a\n- [ ] b\n- [ ] c from a teammate');
      expect(await st().vaultRecheck({ reason: 'poll' })).toBe('checked');
      expect(await st().vaultToggleTask('t.md', 1, true)).toBe(true);
      expect(server.bytes('t.md')).toBe('- [x] a\n- [x] b\n- [ ] c from a teammate');
    });

    it('a teammate line above the task, not yet on screen: the tick is refused, nothing is written, and the newer version opens', async () => {
      server.put('t.md', '- [ ] a\n- [ ] b', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('t.md');
      server.put('t.md', '- [ ] a\n- [ ] new from a teammate\n- [ ] b');
      const writes = server.rpcs.filter((r) => r.fn === 'org_vault_write').length;
      // The person ticks b, the second line on screen.
      expect(await st().vaultToggleTask('t.md', 1, true)).toBe(false);
      expect(server.bytes('t.md')).toBe('- [ ] a\n- [ ] new from a teammate\n- [ ] b');
      expect(server.rpcs.filter((r) => r.fn === 'org_vault_write').length).toBe(writes);
      expect(st().toast).toBe(vaultTickChanged('t'));
      expect(st().vaultNote?.text).toBe('- [ ] a\n- [ ] new from a teammate\n- [ ] b');
    });

    it('a team save patches the list and the body cache at its new version', async () => {
      server.put('t.md', 'one', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('t.md');
      await st().vaultSave('t.md', 'one, two');
      const rev = String(server.notes.get('t.md')!.rev);
      expect(st().vaultFiles.find((f) => f.path === 't.md')?.version).toBe(rev);
      st().vaultCloseNote();
      const reads = server.selects.length;
      expect(await st().vaultReadBody('t.md')).toBe('one, two');
      expect(server.selects.length).toBe(reads);
    });

    it('a plain tick with no other writer writes once', async () => {
      server.put('t.md', '- [ ] a', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('t.md');
      const writes = server.rpcs.filter((r) => r.fn === 'org_vault_write').length;
      expect(await st().vaultToggleTask('t.md', 0, true)).toBe(true);
      expect(server.rpcs.filter((r) => r.fn === 'org_vault_write').length).toBe(writes + 1);
      expect(server.bytes('t.md')).toBe('- [x] a');
    });

    it("on the folder, a tick after the watcher reloaded Obsidian's edit keeps it", async () => {
      reset();
      useApp.setState({
        settings: { ...st().settings, gitosResources: personalOn('files') },
      });
      folder.files.set('t.md', '- [ ] a\n- [ ] b');
      await st().vaultRefresh();
      await st().vaultOpen('t.md');
      expect(await st().vaultToggleTask('t.md', 0, true)).toBe(true);
      folder.files.set('t.md', '- [x] a\n- [ ] b\nadded in Obsidian');
      await st().vaultRecheck({ reason: 'watch', paths: ['t.md'] });
      expect(st().vaultNote?.text).toBe('- [x] a\n- [ ] b\nadded in Obsidian');
      expect(await st().vaultToggleTask('t.md', 1, true)).toBe(true);
      expect(folder.files.get('t.md')).toBe('- [x] a\n- [x] b\nadded in Obsidian');
    });
  });

  describe('E3: reopening a note while its save is on its way keeps the words in flight', () => {
    // The text the editor shows, followed through every store change: it
    // takes the note's text only when the path changes or `reloaded` moves,
    // as VaultScreen's draft effects do.
    function screen() {
      let seen = st().vaultNote;
      const stop = useApp.subscribe((state) => {
        const now = state.vaultNote;
        if (!now) seen = undefined;
        else if (now.path !== seen?.path || now.reloaded !== seen?.reloaded) seen = now;
      });
      stops.push(stop);
      return () => seen?.text ?? '';
    }
    const stops: Array<() => void> = [];
    afterEach(() => {
      for (const stop of stops.splice(0)) stop();
    });

    it('All notes and straight back: the reopened note shows the words, and the next save keeps them', async () => {
      server.put('n.md', 'A', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('n.md');
      const at = st().vaultTargetRef();
      const g = gateWrites(server);
      const typed = 'A, and B typed before leaving';
      st().vaultNoteDraft('n.md', typed);
      const save = st().vaultSave('n.md', typed, at);
      st().vaultCloseNote();
      const shown = screen();
      const reopen = st().vaultOpen('n.md');
      await tick();
      g.open.resolve();
      await save;
      await reopen;
      expect(shown()).toBe(typed);
      await st().vaultSave('n.md', `${shown()}, and C`);
      expect(server.bytes('n.md')).toBe(`${typed}, and C`);
    });

    it('the same through Today from the list', async () => {
      await st().vaultRefresh();
      expect(await st().vaultToday()).toMatchObject({ kind: 'created' });
      const path = st().vaultNote!.path;
      const at = st().vaultTargetRef();
      const g = gateWrites(server);
      const typed = `${st().vaultNote!.text}The morning's first paragraph.`;
      st().vaultNoteDraft(path, typed);
      const save = st().vaultSave(path, typed, at);
      st().vaultCloseNote();
      const shown = screen();
      const today = st().vaultToday();
      await tick();
      g.open.resolve();
      await save;
      expect(await today).toMatchObject({ kind: 'opened' });
      expect(shown()).toBe(typed);
      await st().vaultSave(path, `${shown()} Later.`);
      expect(liveHas(server, "The morning's first paragraph.")).toBe(true);
    });

    it("a teammate's save in the window: the note shows theirs, and the words in flight are a keep-both copy", async () => {
      server.put('n.md', 'A', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('n.md');
      const at = st().vaultTargetRef();
      const g = gateWrites(server);
      const typed = 'A, and B typed before leaving';
      st().vaultNoteDraft('n.md', typed);
      const save = st().vaultSave('n.md', typed, at);
      st().vaultCloseNote();
      const reopen = st().vaultOpen('n.md');
      await tick();
      server.put('n.md', 'theirs');
      g.open.resolve();
      await save;
      await reopen;
      expect(st().vaultNote?.text).toBe('theirs');
      expect(st().vaultConflict).toBeUndefined();
      const copies = [...server.notes.values()].filter(
        (n) => !n.deleted && conflictCopy('n').test(n.path),
      );
      expect(copies.map((n) => n.body)).toEqual([typed]);
      expect(st().toast).toMatch(/kept as/);
    });

    it('Today on the open note leaves it and its typed text as they are', async () => {
      await st().vaultRefresh();
      await st().vaultToday();
      const path = st().vaultNote!.path;
      const before = st().vaultNote;
      st().vaultNoteDraft(path, 'typed, not yet saved');
      expect(await st().vaultToday()).toMatchObject({ kind: 'opened' });
      expect(st().vaultNote).toBe(before);
      // A choice raised later is left with the typed text, never ''.
      server.put(path, 'a teammate wrote today');
      await st().vaultSave(path, 'typed, not yet saved');
      expect(st().vaultConflict).toMatchObject({ path });
      st().vaultCloseNote();
      for (let i = 0; i < 10; i++) await tick();
      expect(liveHas(server, 'typed, not yet saved')).toBe(true);
    });

    it("opening another note while one's save is out: the later tap wins", async () => {
      server.put('x.md', 'X', 'u-me');
      server.put('y.md', 'Y', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('x.md');
      const at = st().vaultTargetRef();
      const g = gateWrites(server);
      const save = st().vaultSave('x.md', 'X, more', at);
      st().vaultCloseNote();
      const first = st().vaultOpen('x.md');
      await tick();
      await st().vaultOpen('y.md');
      g.open.resolve();
      await save;
      await first;
      expect(st().vaultNote?.path).toBe('y.md');
    });

    it('a save that fails while the open waits: the note opens and the stash holds the text', async () => {
      server.put('n.md', 'A', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('n.md');
      const at = st().vaultTargetRef();
      const g = gateWrites(server);
      const save = st().vaultSave('n.md', 'A, offline words', at);
      st().vaultCloseNote();
      const reopen = st().vaultOpen('n.md');
      await tick();
      server.rpcFailure = new TypeError('Failed to fetch');
      g.open.resolve();
      await save;
      server.rpcFailure = undefined;
      await reopen;
      expect(st().vaultNote?.path).toBe('n.md');
      expect(pending()[`org::${ORG}::n.md`]).toMatchObject({ text: 'A, offline words' });
    });

    it('a hung write: the note opens within the wait, and the landing reloads the clean editor', async () => {
      server.put('n.md', 'A', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('n.md');
      const at = st().vaultTargetRef();
      const g = gateWrites(server);
      const typed = 'A, and words on a slow line';
      const save = st().vaultSave('n.md', typed, at);
      st().vaultCloseNote();
      const shown = screen();
      const started = Date.now();
      await st().vaultOpen('n.md');
      expect(Date.now() - started).toBeLessThan(4000);
      expect(shown()).toBe('A');
      g.open.resolve();
      await save;
      expect(shown()).toBe(typed);
      expect(st().vaultNote?.version).toBe(String(server.notes.get('n.md')!.rev));
    }, 10_000);

    it('on a personal folder vault, reopening while its save is out never loses the saved words', async () => {
      reset();
      useApp.setState({ settings: { ...st().settings, gitosResources: personalOn('files') } });
      folder.files.set('n.md', 'A');
      await st().vaultRefresh();
      await st().vaultOpen('n.md');
      const at = st().vaultTargetRef();
      const gate = deferred();
      const p = folder.provider as unknown as Record<string, unknown>;
      const write = folder.provider.write.bind(folder.provider);
      p.write = async (r: string, path: string, text: string, guard?: WriteGuard) => {
        await gate.promise;
        return write(r, path, text, guard);
      };
      try {
        const saving = st().vaultSave('n.md', 'A, and B', at);
        st().vaultCloseNote();
        const shown = screen();
        const reopen = st().vaultOpen('n.md');
        await tick();
        p.write = write;
        gate.resolve();
        await saving;
        await reopen;
        await st().vaultSave('n.md', `${shown()}, and C`);
        expect(folder.files.get('n.md')).toBe('A, and B, and C');
      } finally {
        p.write = write;
      }
    });
  });

  describe("E4: a save's retry compares theirs with the text it was typed on", () => {
    it("a reopen past the wait never lets the retry overwrite a teammate's save", async () => {
      server.put('n.md', 'A', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('n.md');
      const at = st().vaultTargetRef();
      const g = gateWrites(server);
      const typed = 'A, and B typed before leaving';
      st().vaultNoteDraft('n.md', typed);
      const save = st().vaultSave('n.md', typed, at);
      st().vaultCloseNote();
      server.put('n.md', "the teammate's paragraph");
      // The write hangs past the open's wait, so the note opens on theirs.
      await st().vaultOpen('n.md');
      expect(st().vaultNote?.text).toBe("the teammate's paragraph");
      useApp.setState({ toast: undefined });
      g.open.resolve();
      await save;
      expect(server.bytes('n.md')).toBe("the teammate's paragraph");
      expect(liveHas(server, 'A, and B typed before leaving')).toBe(true);
    }, 10_000);

    it('the same note picked again, or Today on it, with the save out: nothing is overwritten', async () => {
      await st().vaultRefresh();
      await st().vaultToday();
      const path = st().vaultNote!.path;
      const at = st().vaultTargetRef();
      const g = gateWrites(server);
      const typed = 'typed on the empty note';
      st().vaultNoteDraft(path, typed);
      const save = st().vaultSave(path, typed, at);
      server.put(path, "the teammate's morning");
      await st().vaultOpen(path);
      await st().vaultToday();
      g.open.resolve();
      await save;
      expect(server.bytes(path)).toBe("the teammate's morning");
      expect(st().vaultConflict).toMatchObject({ path, kind: 'changed' });
      expect(pending()[`org::${ORG}::${path}`]).toMatchObject({ text: typed });
    });

    it('across an account switch the retry never overwrites the teammate under u2', async () => {
      const net = perCaller(server, { members: ['u1', 'u2'] });
      useStoreToken();
      server.put('Plan.md', 'the base', 'u9');
      await st().vaultRefresh();
      await st().vaultOpen('Plan.md');
      server.put('Plan.md', 'theirs', 'u-teammate');
      const held = net.hold('org_vault_write');
      const save = st().vaultSave('Plan.md', 'the base\nu1 in-flight words');
      await held.reached;
      await st().signOutAccount();
      auth.nextUser = U2;
      await st().signIn('b@example.com', 'pw');
      await st().setVaultScope('team');
      await st().vaultOpen('Plan.md');
      held.release();
      await save;
      await tick();
      const note = server.notes.get('Plan.md')!;
      expect([note.body, note.updated_by]).toEqual(['theirs', 'u-teammate']);
      expect(st().vaultNote?.text).toBe('theirs');
    });

    it('a same-bytes rewrite under the open note is still adopted and saved', async () => {
      server.put('n.md', 'A', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('n.md');
      server.put('n.md', 'A');
      await st().vaultSave('n.md', 'A, and mine');
      expect(server.bytes('n.md')).toBe('A, and mine');
      expect(st().vaultConflict).toBeUndefined();
    });

    it("a same-bytes rewrite under a closed note's save is still adopted, through the body cache", async () => {
      server.put('n.md', 'A', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('n.md');
      const at = st().vaultTargetRef();
      const g = gateWrites(server);
      const save = st().vaultSave('n.md', 'A, and mine', at);
      st().vaultCloseNote();
      server.put('n.md', 'A');
      g.open.resolve();
      await save;
      expect(server.bytes('n.md')).toBe('A, and mine');
      expect(teamHeld()).toEqual([]);
    });

    it('a chained second save retries on the version the first one left', async () => {
      server.put('n.md', 'A', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('n.md');
      const g = gateWrites(server);
      const first = st().vaultSave('n.md', 'A1');
      await vi.waitFor(() => expect(g.seen).toBe(1));
      const second = st().vaultSave('n.md', 'A1 A2');
      g.on = false;
      g.open.resolve();
      await first;
      // A metadata-only touch of the first save's version, before the second.
      server.put('n.md', 'A1');
      await second;
      expect(server.bytes('n.md')).toBe('A1 A2');
      expect(st().vaultConflict).toBeUndefined();
    });

    it("a delete while the note was reopened on a teammate's version never deletes it", async () => {
      server.put('n.md', 'A', 'u-me');
      await st().vaultRefresh();
      await st().vaultOpen('n.md');
      const at = st().vaultTargetRef();
      const rpc = server.rpc.bind(server);
      const gate = deferred();
      let held = false;
      server.rpc = async (fn, token, args) => {
        if (fn === 'org_vault_remove' && !held) {
          held = true;
          await gate.promise;
        }
        return rpc(fn, token, args);
      };
      const removing = st().vaultDelete('n.md', at);
      await vi.waitFor(() => expect(held).toBe(true));
      server.put('n.md', "the teammate's version");
      st().vaultCloseNote();
      await st().vaultOpen('n.md');
      gate.resolve();
      expect(await removing).toBe(false);
      expect(server.bytes('n.md')).toBe("the teammate's version");
    });
  });
});
