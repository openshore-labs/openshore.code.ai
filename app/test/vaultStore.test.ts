// Vault data-safety invariants at the store level: a failed provider write
// never loses the typed text (it is stashed and replayed, or held when retrying
// cannot help), a stale stash never replays over newer work or onto another
// provider, a failed list shows an offline state rather than the first-run
// empty greeting, a note whose bytes are not downloaded yet is never opened as
// an empty editable note (which a keystroke would then save back as empty), a
// create never truncates a note the list has not caught up with, notes open and
// delete by their exact listed path, a vault move never drops a note, a
// scheduled save keeps the vault it was scheduled for, sign-out forgets the
// team's drafts, and a Google Drive vault is read-only. The personal providers
// are in-memory fakes whose ops can be forced to fail; the team vault is the
// real provider over a fake Supabase.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredFile, StoredFileMeta } from '../src/lib/gitos/providers.js';
import { isNotePath } from '../src/lib/gitos/providers.js';
import { backlinksTo, normalizeNotePath } from '../src/lib/vault.js';

const mem = new Map<string, string>();
// Sealed-store keys whose writes throw, as a full localStorage quota would.
const failKeys = new Set<string>();

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
    if (failKeys.has(k)) throw new Error('QuotaExceededError');
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
// simulate an offline or token-expired cloud vault; `evicted` paths list as
// iCloud placeholders whose bytes are not here; `failPaths` fail to read;
// `hideFromList` paths are written but not listed (a copy that did not land).
function makeProvider(id: string) {
  const files = new Map<string, string>();
  const evicted = new Set<string>();
  const failPaths = new Set<string>();
  const hideFromList = new Set<string>();
  const fail = { list: false, read: false, write: false, stat: false, remove: false };
  const counts = { reads: 0 };
  // updatedAt changes with content, so the body cache invalidates on edit.
  const meta = (path: string): StoredFileMeta =>
    evicted.has(path)
      ? { path, updatedAt: 'cloud', size: 10, evicted: true }
      : { path, updatedAt: `v${files.get(path)!.length}`, size: files.get(path)!.length };
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
      return text === undefined ? undefined : { path, text, updatedAt: `v${text.length}` };
    },
    async write(_r: string, path: string, text: string): Promise<StoredFile> {
      if (fail.write) throw new Error('offline');
      files.set(path, text);
      return { path, text, updatedAt: `v${text.length}` };
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
    counts.reads = 0;
  };
  return { provider, files, evicted, failPaths, hideFromList, fail, counts, reset };
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
// rows in memory. `teamNet.fail` makes every request throw.
const ORG = 'org-1';
const team = new Map<string, { body: string; rev: number }>();
const teamNet = { fail: undefined as Error | undefined, puts: 0 };
let teamToken: string | undefined = 'tok';

vi.mock('../src/lib/supabase.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/supabase.js')>();
  const row = (path: string) => {
    const r = team.get(path)!;
    return { path, body: r.body, updated_at: `r${r.rev}`, rev: r.rev, size: r.body.length };
  };
  return {
    ...actual,
    isConfigured: () => true,
    select: async (_table: string, _token: string, query: string) => {
      if (teamNet.fail) throw teamNet.fail;
      const m = /path=eq\.([^&]+)/.exec(query);
      const only = m ? (JSON.parse(decodeURIComponent(m[1]!)) as string) : undefined;
      return [...team.keys()].filter((p) => only === undefined || p === only).map(row);
    },
    rpc: async (fn: string, _token: string, args: Record<string, unknown>) => {
      if (teamNet.fail) throw teamNet.fail;
      const path = args.p_path as string;
      if (fn === 'org_vault_delete') {
        team.delete(path);
        return null;
      }
      teamNet.puts++;
      const prev = team.get(path);
      team.set(path, { body: args.p_body as string, rev: (prev?.rev ?? 0) + 1 });
      return row(path);
    },
  };
});

vi.mock('../src/lib/gitos/index.js', async () => {
  const providers = await vi.importActual<typeof import('../src/lib/gitos/providers.js')>(
    '../src/lib/gitos/providers.js',
  );
  const org = await vi.importActual<typeof import('../src/lib/gitos/orgVault.js')>(
    '../src/lib/gitos/orgVault.js',
  );
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
    setOrgVaultAuth: () => {},
    resetOrgVault: org.resetOrgVault,
  };
});

const { useApp } = await import('../src/state/store.js');
const { SupabaseRequestError } = await import('../src/lib/supabase.js');

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
  for (const p of Object.values(byId)) p.reset();
  team.clear();
  teamNet.fail = undefined;
  teamNet.puts = 0;
  teamToken = 'tok';
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
function teamScope() {
  const st = useApp.getState();
  useApp.setState({
    vaultScope: 'team',
    vaultFiles: [],
    vaultNote: undefined,
    authSession: {
      accessToken: 'tok',
      refreshToken: 'r',
      expiresAt: Date.now() + 3_600_000,
      user: { id: 'u1', email: 'me@example.com' },
    },
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
    // The superseded stash is gone, so a later refresh cannot replay it either.
    expect(pending()).toEqual({});
    await useApp.getState().vaultRefresh();
    expect(files.get('note.md')).toBe('old words typed offline, then newer words');
    expect(useApp.getState().vaultError).toBeUndefined();
  });

  it("records the provider's version the text was typed against, never a device clock", async () => {
    await useApp.getState().vaultCreate('note');
    fail.write = true;
    await useApp.getState().vaultSave('note.md', 'typed offline');
    expect(Object.values(pending())).toEqual([
      expect.objectContaining({
        providerId: 'local',
        resourceId: 'vault.personal',
        path: 'note.md',
        base: 'v0',
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
    expect(teamNet.puts).toBe(0); // checked before anything was sent
    expect(pending()).toEqual({});
    expect(useApp.getState().vaultError).toBe('held');
    const held = useApp.getState().vaultHeld;
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ providerId: 'org', resourceId: ORG, path: 'big.md' });
    expect(held[0]!.text).toBe(big);
    expect(held[0]!.reason).toMatch(/1 MB/);
    // Nothing retries it: a refresh sends nothing.
    await useApp.getState().vaultRefresh();
    expect(teamNet.puts).toBe(0);
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
      expect.objectContaining({ path: 'odd.md', text: 'keep me' }),
    ]);
    // Leaving the note and saving others does not clear it.
    teamNet.fail = undefined;
    await useApp.getState().vaultSave('other.md', 'fine');
    expect(useApp.getState().vaultHeld).toHaveLength(1);
    await useApp.getState().vaultDiscardHeld(useApp.getState().vaultHeld[0]!.id);
    expect(useApp.getState().vaultHeld).toEqual([]);
    expect(mem.has(HELD)).toBe(false);
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
    expect(res).toEqual({ ok: false, moved: [], skipped: ['b.md'], reason: 'unreadable' });
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
    expect(res).toEqual({ ok: true, moved: ['a.md'], skipped: [] });
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
    expect(res).toMatchObject({ ok: false, reason: 'unverified', skipped: ['b.md'] });
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
  });

  it('the same text already at the target is not copied twice', async () => {
    folder.files.set('a.md', 'same words');
    files.set('a.md', 'same words');
    await useApp.getState().vaultRefresh();
    const res = await useApp.getState().vaultMoveTo('files');
    expect(res.ok).toBe(true);
    expect([...folder.files.keys()]).toEqual(['a.md']);
  });
});

// 0.7: the vault a save goes to is fixed when the save is scheduled, and
// sign-out forgets the team's unsent text.
describe('the save target is fixed when the save is scheduled (0.7)', () => {
  beforeEach(reset);

  it('a scope flip mid-debounce never writes team text into the personal vault', async () => {
    teamScope();
    const at = useApp.getState().vaultTargetRef();
    expect(at).toEqual({ providerId: 'org', resourceId: ORG });
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

    useApp.setState({ authSession: undefined });
    await useApp.getState().signOutAccount();
    expect(Object.keys(pending())).toEqual(['local::vault.personal::mine.md']);
    expect(useApp.getState().vaultHeld).toEqual([]);
    expect(mem.has(HELD)).toBe(false);
  });

  it('team text refused after the session is gone is never written to the device', async () => {
    teamScope();
    const at = useApp.getState().vaultTargetRef();
    // The session expired and was forgotten inside the debounce.
    teamToken = undefined;
    useApp.setState({ authSession: undefined, vaultScope: 'personal' });
    await useApp.getState().vaultSave('plan.md', 'last keystrokes', at);
    expect(pending()).toEqual({});
    expect(mem.has(HELD)).toBe(false);
    expect(files.has('plan.md')).toBe(false);
    // Shown until the app closes, so the person can still copy it.
    expect(useApp.getState().vaultHeld[0]).toMatchObject({ text: 'last keystrokes' });
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
    expect(res).toEqual({ ok: true, moved: ['a.md'], skipped: [] });
    expect(files.get('a.md')).toBe('drive words');
    expect(useApp.getState().vaultReadOnly()).toBeUndefined();
    const back = await useApp.getState().vaultMoveTo('gdrive');
    expect(back).toMatchObject({ ok: false, reason: 'unavailable' });
  });
});
