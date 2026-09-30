import { beforeEach, describe, expect, it, vi } from 'vitest';
import { afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createFakeOrgVaultServer,
  FREE_SPACE_REFUSAL,
  type FakeOrgVaultServer,
} from './fixtures/fakeOrgVaultServer.js';

// The provider talks to Supabase through ../supabase.js; mock that seam so these
// tests exercise the provider's own logic (row mapping, versions, paging, the
// RPCs it calls and how it reads their answers) without a network or a live
// Postgres. The fake speaks migration 0021's RPC semantics.
vi.mock('../src/lib/supabase.js', () => ({
  isConfigured: () => true,
  select: vi.fn(),
  rpc: vi.fn(),
}));

import { select, rpc } from '../src/lib/supabase.js';
import {
  orgVaultProvider,
  setOrgVaultAuth,
  isOrgVaultAvailable,
  resetOrgVault,
  OrgVaultRefusal,
  OrgVaultNotReady,
  orgVaultBaseRev,
  ORG_VAULT_MEMBERS_TTL_MS,
  OrgVaultDeleteRefused,
  OrgVaultLapsed,
  onOrgVaultPlan,
  orgVaultPlan,
  setOrgVaultDeleteRole,
  ORG_VAULT_UNAPPLIED_SETTINGS,
  orgVaultAppliedSettings,
  OrgVaultFull,
  OrgVaultNotMember,
  onOrgVaultNotMember,
} from '../src/lib/gitos/orgVault.js';
import {
  VAULT_TEAM_FULL,
  VAULT_TEAM_NOT_MEMBER_REASON,
  vaultTeamEditableUntil,
} from '../src/lib/vaultCopy.js';

const ORG = 'org-123';
const mockSelect = vi.mocked(select);
const mockRpc = vi.mocked(rpc);
let server: FakeOrgVaultServer;

const notesSelects = () => server.selects.filter((s) => s.table === 'org_vault_notes');
const memberSelects = () => server.selects.filter((s) => s.table === 'org_members');

beforeEach(() => {
  server = createFakeOrgVaultServer(ORG);
  mockSelect.mockReset();
  mockRpc.mockReset();
  mockSelect.mockImplementation(server.select as typeof select);
  mockRpc.mockImplementation(server.rpc as typeof rpc);
  resetOrgVault();
  setOrgVaultAuth(
    async () => 'tok',
    () => true,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('org vault provider', () => {
  it('is available only when configured and the readiness predicate is true', () => {
    setOrgVaultAuth(
      async () => 'tok',
      () => false,
    );
    expect(isOrgVaultAvailable()).toBe(false);
    setOrgVaultAuth(
      async () => 'tok',
      () => true,
    );
    expect(isOrgVaultAvailable()).toBe(true);
  });

  it('declares compareAndSwap', () => {
    expect(orgVaultProvider.compareAndSwap).toBe(true);
  });

  it('lists live notes with the rev as the version, and never a tombstone', async () => {
    const a = server.put('a.md', 'hello');
    const c = server.put('b/c.md', 'nine byte');
    server.put('gone.md', 'x');
    server.drop('gone.md');
    const files = await orgVaultProvider.list(ORG);
    expect(files).toEqual([
      {
        path: 'a.md',
        updatedAt: a.updated_at,
        size: 5,
        version: String(a.rev),
        editedBy: { id: 'u-teammate' },
      },
      {
        path: 'b/c.md',
        updatedAt: c.updated_at,
        size: 9,
        version: String(c.rev),
        editedBy: { id: 'u-teammate' },
      },
    ]);
    const query = notesSelects()[0]!.query;
    expect(query).toContain(`org_id=eq.${ORG}`);
    expect(query).toContain('deleted=is.false');
    expect(query).toContain('order=path.asc');
    expect(query).toContain('limit=500');
  });

  // PostgREST caps a select at max_rows (1000): one select would silently
  // drop the rest. Keyset pages by path, 500 at a time (CTO G3).
  it('1,001 notes all list, in pages of 500 keyed by the last path', async () => {
    for (let i = 0; i < 1001; i++) server.put(`n/${String(i).padStart(4, '0')}.md`, 'x');
    const files = await orgVaultProvider.list(ORG);
    expect(files).toHaveLength(1001);
    expect(new Set(files.map((f) => f.path)).size).toBe(1001);
    const pages = notesSelects();
    expect(pages).toHaveLength(3);
    expect(pages[0]!.query).not.toContain('path=gt.');
    expect(pages[1]!.query).toContain(`path=gt.${encodeURIComponent('"n/0499.md"')}`);
    expect(pages[2]!.query).toContain(`path=gt.${encodeURIComponent('"n/0999.md"')}`);
  });

  it('a page boundary on a path with reserved characters still resumes after it', async () => {
    for (let i = 0; i < 499; i++) server.put(`a${String(i).padStart(3, '0')}.md`, 'x');
    server.put('b (conflict 2026-01-01 1200), "q".md', 'x');
    server.put('c.md', 'x');
    const files = await orgVaultProvider.list(ORG);
    expect(files.map((f) => f.path).slice(-2)).toEqual([
      'b (conflict 2026-01-01 1200), "q".md',
      'c.md',
    ]);
  });

  it('stops after 100 pages rather than walking forever', async () => {
    mockSelect.mockImplementation((async (table: string) =>
      table === 'org_vault_notes'
        ? Array.from({ length: 500 }, (_, i) => ({
            path: `p${Math.random()}-${i}.md`,
            updated_at: 't',
            updated_by: null,
            rev: 1,
            size: 1,
          }))
        : []) as typeof select);
    const files = await orgVaultProvider.list(ORG);
    expect(files).toHaveLength(50_000);
    expect(mockSelect.mock.calls.filter((c) => c[0] === 'org_vault_notes')).toHaveLength(100);
  });

  it('stat and read answer with the same version as list', async () => {
    const n = server.put('s.md', 'body');
    expect((await orgVaultProvider.stat(ORG, 's.md'))?.version).toBe(String(n.rev));
    expect(await orgVaultProvider.read(ORG, 's.md')).toEqual({
      path: 's.md',
      text: 'body',
      updatedAt: n.updated_at,
      version: String(n.rev),
    });
    expect(await orgVaultProvider.stat(ORG, 'none.md')).toBeUndefined();
    expect(await orgVaultProvider.read(ORG, 'none.md')).toBeUndefined();
  });

  it('a create sends if_absent and answers with the new rev as the version', async () => {
    const r = await orgVaultProvider.write(ORG, 'new.md', 'hi', { ifAbsent: true });
    expect(server.rpcs[0]).toEqual({
      fn: 'org_vault_write',
      args: { p_org: ORG, p_path: 'new.md', p_body: 'hi', p_if_absent: true },
    });
    const rev = server.notes.get('new.md')!.rev;
    expect(r).toEqual({
      ok: true,
      file: {
        path: 'new.md',
        text: 'hi',
        updatedAt: server.notes.get('new.md')!.updated_at,
        version: String(rev),
      },
    });
  });

  it('a save sends its base as a numeric if_match, and the reply is the next base', async () => {
    const n = server.put('a.md', 'one');
    const r1 = await orgVaultProvider.write(ORG, 'a.md', 'two', { ifMatch: String(n.rev) });
    expect(server.rpcs[0]!.args).toEqual({
      p_org: ORG,
      p_path: 'a.md',
      p_body: 'two',
      p_if_match: n.rev,
    });
    expect(r1.ok).toBe(true);
    const r2 = await orgVaultProvider.write(ORG, 'a.md', 'three', {
      ifMatch: r1.ok ? r1.file.version! : '',
    });
    expect(r2.ok).toBe(true);
    expect(server.bytes('a.md')).toBe('three');
  });

  // The orgvault-1 shape, now answered by the server: list and stat run on
  // every foreground and save, and they must never move the base under a
  // stale open draft. The base lives in the open note, so a replay after an
  // interleaved list still carries the version it was typed against.
  it('a replay after an interleaved list is a conflict, with theirs', async () => {
    const n = server.put('n.md', 'mine');
    const opened = await orgVaultProvider.read(ORG, 'n.md');
    server.put('n.md', 'a teammate wrote this');
    const listed = await orgVaultProvider.list(ORG);
    expect(listed[0]!.version).not.toBe(opened!.version);
    await orgVaultProvider.stat(ORG, 'n.md');
    const r = await orgVaultProvider.write(ORG, 'n.md', 'mine plus a keystroke', {
      ifMatch: opened!.version!,
    });
    expect(server.rpcs.at(-1)!.args).toMatchObject({ p_if_match: n.rev });
    expect(r).toMatchObject({
      ok: false,
      conflict: 'changed',
      theirs: { path: 'n.md', text: 'a teammate wrote this' },
    });
    expect(server.bytes('n.md')).toBe('a teammate wrote this');
  });

  it('if_match on a removed note is missing, and nothing is made again', async () => {
    const n = server.put('gone.md', 'x');
    server.drop('gone.md');
    const r = await orgVaultProvider.write(ORG, 'gone.md', 'mine', { ifMatch: String(n.rev) });
    expect(r).toEqual({ ok: false, conflict: 'missing' });
    expect(server.bytes('gone.md')).toBeUndefined();
  });

  it('if_absent on a taken name (any case) is exists, with theirs under its real path', async () => {
    server.put('Plan.md', 'theirs');
    const r = await orgVaultProvider.write(ORG, 'plan.md', 'mine', { ifAbsent: true });
    expect(r).toMatchObject({
      ok: false,
      conflict: 'exists',
      theirs: { path: 'Plan.md', text: 'theirs' },
    });
  });

  it('a conflict without theirs (the server lost the race to name it) has none', async () => {
    mockRpc.mockResolvedValueOnce({ ok: false, conflict: 'exists', theirs: null });
    expect(await orgVaultProvider.write(ORG, 'x.md', 'y', { ifAbsent: true })).toEqual({
      ok: false,
      conflict: 'exists',
    });
  });

  // CTO G3: a stash from before M2 carries an ISO base. It can never equal a
  // rev, so it resolves as keep both, and nothing is sent that could write.
  it('a base that is not a rev never writes: changed with theirs, or missing', async () => {
    server.put('old.md', 'there now');
    const r = await orgVaultProvider.write(ORG, 'old.md', 'mine', {
      ifMatch: '2026-09-01T00:00:00.000Z',
    });
    expect(r).toMatchObject({ ok: false, conflict: 'changed', theirs: { text: 'there now' } });
    expect(await orgVaultProvider.write(ORG, 'nothing.md', 'mine', { ifMatch: 'r5' })).toEqual({
      ok: false,
      conflict: 'missing',
    });
    expect(server.rpcs).toEqual([]);
  });

  it('an unguarded write guards on what is there now', async () => {
    const n = server.put('u.md', 'one');
    expect((await orgVaultProvider.write(ORG, 'u.md', 'two')).ok).toBe(true);
    expect(server.rpcs[0]!.args).toMatchObject({ p_if_match: n.rev });
    expect((await orgVaultProvider.write(ORG, 'fresh.md', 'x')).ok).toBe(true);
    expect(server.rpcs[1]!.args).toMatchObject({ p_if_absent: true });
  });

  it('a guarded remove sends if_match; a stale one is changed and the note stays', async () => {
    const n = server.put('r.md', 'one');
    server.put('r.md', 'someone else wrote this');
    const r = await orgVaultProvider.remove(ORG, 'r.md', { ifMatch: String(n.rev) });
    expect(server.rpcs[0]).toEqual({
      fn: 'org_vault_remove',
      args: { p_org: ORG, p_path: 'r.md', p_if_match: n.rev },
    });
    expect(r).toMatchObject({
      ok: false,
      conflict: 'changed',
      theirs: { text: 'someone else wrote this' },
    });
    expect(server.bytes('r.md')).toBe('someone else wrote this');
    const cur = await orgVaultProvider.stat(ORG, 'r.md');
    expect(await orgVaultProvider.remove(ORG, 'r.md', { ifMatch: cur!.version! })).toEqual({
      ok: true,
    });
    expect(server.bytes('r.md')).toBeUndefined();
  });

  it('an unguarded remove of a note already gone is ok and calls nothing', async () => {
    expect(await orgVaultProvider.remove(ORG, 'never.md')).toEqual({ ok: true });
    expect(server.rpcs).toEqual([]);
  });

  // 0.4 (orgvault-9): a refusal retrying cannot fix is marked permanent, so
  // the store holds the text instead of promising a reconnect that never
  // helps. The 1 MB cap is checked here, before anything is sent.
  it('refuses a body over 1 MB before sending, as a permanent refusal', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024);
    const err = await orgVaultProvider
      .write(ORG, 'big.md', big, { ifAbsent: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrgVaultRefusal);
    expect((err as OrgVaultRefusal).permanent).toBe(true);
    expect((err as Error).message).toMatch(/limited to 1 MB/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('counts the cap in bytes, the way the server does', async () => {
    // 600,000 two-byte characters: under a million UTF-16 units, over 1 MB.
    const err = await orgVaultProvider
      .write(ORG, 'wide.md', 'é'.repeat(600_000), { ifAbsent: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrgVaultRefusal);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("marks a server 4xx as permanent with the server's own line", async () => {
    server.rpcFailure = Object.assign(new Error('that note path is not allowed'), { status: 400 });
    const err = await orgVaultProvider
      .write(ORG, 'a.md', 'hi', { ifAbsent: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrgVaultRefusal);
    expect((err as Error).message).toBe('that note path is not allowed');
  });

  // Round 7 E26: an admin removed this account (0002's is_org_member answers
  // no). Every RPC raises it first, and the selects answer no rows.
  it("reads 'not a member of this org' as a removal, in our words, and tells the store", async () => {
    const heard: string[] = [];
    onOrgVaultNotMember((org) => heard.push(org));
    server.put('a.md', 'there');
    const v = (await orgVaultProvider.stat(ORG, 'a.md'))!.version!;
    server.member = false;
    // The selects answer a removed member with nothing, never an error.
    expect(await orgVaultProvider.list(ORG)).toEqual([]);
    expect(await orgVaultProvider.stat(ORG, 'a.md')).toBeUndefined();
    const calls = [
      orgVaultProvider.write(ORG, 'a.md', 'mine', { ifMatch: v }),
      orgVaultProvider.remove(ORG, 'a.md', { ifMatch: v }),
      orgVaultProvider.rename!(ORG, 'a.md', 'b.md', { ifMatch: v }),
      orgVaultProvider.readConfig!(ORG, 'oscode/vault'),
    ];
    for (const call of calls) {
      const err = await call.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(OrgVaultNotMember);
      expect(err).toBeInstanceOf(OrgVaultRefusal);
      expect((err as OrgVaultNotMember).permanent).toBe(true);
      expect((err as OrgVaultNotMember).notMember).toBe(true);
      expect((err as Error).message).toBe(VAULT_TEAM_NOT_MEMBER_REASON);
      expect((err as Error).message).not.toMatch(/not a member of this org|try again/i);
    }
    expect(heard).toEqual([ORG, ORG, ORG, ORG]);
    // Nothing was touched on the server.
    server.member = true;
    expect(server.bytes('a.md')).toBe('there');
  });

  it('matches the removal by its own words: any other plain raise keeps its line', async () => {
    const heard: string[] = [];
    onOrgVaultNotMember((org) => heard.push(org));
    server.rpcFailure = Object.assign(new Error('that note path is not allowed'), {
      status: 400,
      code: 'P0001',
    });
    const err = await orgVaultProvider
      .write(ORG, 'a.md', 'hi', { ifAbsent: true })
      .catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(OrgVaultNotMember);
    expect((err as Error).message).toBe('that note path is not allowed');
    // A 5xx that happens to say it is not a refusal at all.
    server.rpcFailure = Object.assign(new Error('not a member of this org'), { status: 502 });
    const e5 = await orgVaultProvider
      .write(ORG, 'a.md', 'hi', { ifAbsent: true })
      .catch((e: unknown) => e);
    expect(e5).not.toBeInstanceOf(OrgVaultRefusal);
    expect(heard).toEqual([]);
  });

  it('leaves a network failure, a 5xx, a 401, and a 429 retryable', async () => {
    for (const failure of [
      new TypeError('Failed to fetch'),
      Object.assign(new Error('bad gateway'), { status: 502 }),
      Object.assign(new Error('JWT expired'), { status: 401 }),
      Object.assign(new Error('slow down'), { status: 429 }),
    ]) {
      server.rpcFailure = failure;
      const err = await orgVaultProvider
        .write(ORG, 'a.md', 'hi', { ifAbsent: true })
        .catch((e: unknown) => e);
      expect(err).toBe(failure);
    }
  });

  // A server that has not had migration 0021 yet answers PGRST202 (a 404).
  // Not permanent: the text is stashed and retried, and nothing is written
  // blind through the old last-write-wins function (CTO G3).
  it('PGRST202 (function not found) is non-permanent, for a write and a remove', async () => {
    server.put('a.md', 'there');
    const v = (await orgVaultProvider.stat(ORG, 'a.md'))!.version!;
    for (const failure of [
      Object.assign(new Error('Could not find the function'), { status: 404 }),
      Object.assign(new Error('Could not find the function'), { status: 404, code: 'PGRST202' }),
    ]) {
      server.rpcFailure = failure;
      const w = await orgVaultProvider
        .write(ORG, 'a.md', 'mine', { ifMatch: v })
        .catch((e: unknown) => e);
      expect(w).toBeInstanceOf(OrgVaultNotReady);
      expect(w).not.toBeInstanceOf(OrgVaultRefusal);
      expect((w as { permanent?: unknown }).permanent).toBeUndefined();
      const r = await orgVaultProvider.remove(ORG, 'a.md', { ifMatch: v }).catch((e: unknown) => e);
      expect(r).toBeInstanceOf(OrgVaultNotReady);
    }
    expect(server.rpcs.map((c) => c.fn)).not.toContain('org_vault_put');
    expect(server.bytes('a.md')).toBe('there');
  });

  it('marks a refused delete as permanent too', async () => {
    server.put('a.md', 'x');
    server.rpcFailure = Object.assign(new Error('that note path is not allowed'), { status: 400 });
    await expect(orgVaultProvider.remove(ORG, 'a.md')).rejects.toBeInstanceOf(OrgVaultRefusal);
  });

  it('refuses to act without a session token', async () => {
    setOrgVaultAuth(
      async () => undefined,
      () => true,
    );
    await expect(orgVaultProvider.list(ORG)).rejects.toThrow(/team/i);
    // A save with no team session cannot succeed by retrying, so it is a
    // permanent refusal: never stashed to replay under the next sign-in.
    await expect(
      orgVaultProvider.write(ORG, 'a.md', 'hi', { ifAbsent: true }),
    ).rejects.toBeInstanceOf(OrgVaultRefusal);
  });

  it('passes a token refresh that could not reach the server through as retryable', async () => {
    setOrgVaultAuth(
      async () => {
        throw new TypeError('Failed to fetch');
      },
      () => true,
    );
    const err = await orgVaultProvider
      .write(ORG, 'a.md', 'hi', { ifAbsent: true })
      .catch((e: unknown) => e);
    // Offline is not "signed out": the store stashes this and retries it.
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(OrgVaultRefusal);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('keeps no base revs: the shim the store still imports answers undefined', async () => {
    const n = server.put('a.md', 'hi');
    await orgVaultProvider.read(ORG, 'a.md');
    await orgVaultProvider.write(ORG, 'a.md', 'bye', { ifMatch: String(n.rev) });
    expect(orgVaultBaseRev(ORG, 'a.md')).toBeUndefined();
  });

  it('grants the lease trivially: multi-writer has no single-writer lock', async () => {
    const lease = await orgVaultProvider.acquireLease(ORG, 'me', 1000);
    expect(lease.holder).toBe('me');
    expect(new Date(lease.expiresAt).getTime()).toBeGreaterThan(0);
  });
});

// CTO G6: "Edited by" comes from one cached select of the org's active
// members; the label is the email's local part, never the address.
describe('org vault editedBy', () => {
  beforeEach(() => {
    server.members.push(
      { user_id: 'u-ana', email: 'ana.lopez@example.com', status: 'active' },
      { user_id: 'u-old', email: 'gone@example.com', status: 'revoked' },
      { user_id: null, email: 'invited@example.com', status: 'invited' },
    );
  });

  it('labels an editor by the local part, and an unknown one by id only', async () => {
    server.put('a.md', 'x', 'u-ana');
    server.put('b.md', 'x', 'u-old');
    const n = server.put('c.md', 'x');
    server.notes.set('c.md', { ...n, updated_by: null });
    const files = await orgVaultProvider.list(ORG);
    expect(files.map((f) => f.editedBy)).toEqual([
      { id: 'u-ana', label: 'ana.lopez' },
      { id: 'u-old' },
      undefined,
    ]);
    expect(JSON.stringify(files)).not.toContain('@');
    expect(memberSelects()[0]!.query).toBe(
      `select=user_id,email&org_id=eq.${ORG}&status=eq.active`,
    );
    expect((await orgVaultProvider.stat(ORG, 'a.md'))?.editedBy).toEqual({
      id: 'u-ana',
      label: 'ana.lopez',
    });
  });

  it('asks for the members once per ten minutes, and again after', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    server.put('a.md', 'x', 'u-ana');
    await orgVaultProvider.list(ORG);
    await orgVaultProvider.list(ORG);
    await orgVaultProvider.stat(ORG, 'a.md');
    expect(memberSelects()).toHaveLength(1);
    vi.advanceTimersByTime(ORG_VAULT_MEMBERS_TTL_MS + 1);
    await orgVaultProvider.list(ORG);
    expect(memberSelects()).toHaveLength(2);
  });

  it('a members select that fails never fails the list, and is asked again next time', async () => {
    server.put('a.md', 'x', 'u-ana');
    const real = mockSelect.getMockImplementation()!;
    mockSelect.mockImplementation((async (table: string, tok: string, q: string) => {
      if (table === 'org_members') throw new TypeError('Failed to fetch');
      return real(table, tok, q);
    }) as typeof select);
    const files = await orgVaultProvider.list(ORG);
    expect(files[0]!.editedBy).toEqual({ id: 'u-ana' });
    mockSelect.mockImplementation(real);
    expect((await orgVaultProvider.list(ORG))[0]!.editedBy).toEqual({
      id: 'u-ana',
      label: 'ana.lopez',
    });
  });

  it('forgets the labels on reset, so one account cannot leak into the next', async () => {
    server.put('a.md', 'x', 'u-ana');
    await orgVaultProvider.list(ORG);
    resetOrgVault();
    await orgVaultProvider.list(ORG);
    expect(memberSelects()).toHaveLength(2);
  });
});

// ---- Vault M6 on the team vault (CTO K3, K6, R3; migration 0024) ----------

const rpcsNamed = (fn: string) => server.rpcs.filter((r) => r.fn === fn);
const version = (r: { ok: boolean; file?: { version?: string } }) => (r.ok ? r.file!.version! : '');

describe('org vault rename (org_vault_move)', () => {
  it('moves under the rev, and adopts the path and rev the server answers', async () => {
    const w = await orgVaultProvider.write(ORG, 'Plans.md', 'the plan', { ifAbsent: true });
    const r = await orgVaultProvider.rename!(ORG, 'Plans.md', 'Work/Plans.md', {
      ifMatch: version(w),
    });
    expect(rpcsNamed('org_vault_move')[0]!.args).toEqual({
      p_org: ORG,
      p_from: 'Plans.md',
      p_to: 'Work/Plans.md',
      p_if_match: Number(version(w)),
    });
    const now = server.notes.get('Work/Plans.md')!;
    expect(r).toEqual({
      ok: true,
      file: { path: 'Work/Plans.md', updatedAt: now.updated_at, size: 8, version: String(now.rev) },
    });
  });

  it('adopts a path the server spells differently from the one sent', async () => {
    const w = await orgVaultProvider.write(ORG, 'a.md', 'x', { ifAbsent: true });
    mockRpc.mockImplementationOnce((async () => ({
      ok: true,
      path: 'Work/a.md',
      rev: 42,
      updated_at: '2026-09-27T01:00:00.000Z',
      size: 1,
    })) as typeof rpc);
    const r = await orgVaultProvider.rename!(ORG, 'a.md', 'work/a.md', { ifMatch: version(w) });
    expect(r).toMatchObject({ ok: true, file: { path: 'Work/a.md', version: '42' } });
  });

  it('a base that is not a rev never moves anything', async () => {
    await orgVaultProvider.write(ORG, 'a.md', 'x', { ifAbsent: true });
    const r = await orgVaultProvider.rename!(ORG, 'a.md', 'b.md', {
      ifMatch: '2026-09-01T00:00:00.000Z',
    });
    expect(r).toMatchObject({ ok: false, conflict: 'changed', theirs: { text: 'x' } });
    expect(rpcsNamed('org_vault_move')).toEqual([]);
  });

  it('refuses a name that is not a note before any call', async () => {
    await expect(
      orgVaultProvider.rename!(ORG, 'a.md', '.trash/a.md', { ifMatch: '1' }),
    ).rejects.toBeInstanceOf(OrgVaultRefusal);
    expect(server.rpcs).toEqual([]);
  });

  it('reads the listing only for a name outside ASCII (the folded check)', async () => {
    const w = await orgVaultProvider.write(ORG, 'a.md', 'x', { ifAbsent: true });
    server.selects.length = 0;
    await orgVaultProvider.rename!(ORG, 'a.md', 'b.md', { ifMatch: version(w) });
    // Only the one row at the destination, whether it is in Trash (E22).
    expect(notesSelects().map((q) => q.query)).toEqual([
      `select=path&org_id=eq.${ORG}&path=eq.%22b.md%22&deleted=is.true&limit=1`,
    ]);
  });

  it('never moves a note onto a name in Trash, and never makes one there (E22)', async () => {
    const t = await orgVaultProvider.write(ORG, 'Trashed.md', 'their text', { ifAbsent: true });
    await orgVaultProvider.trash!(ORG, { kind: 'note', path: 'Trashed.md', ifMatch: version(t) });
    const a = await orgVaultProvider.write(ORG, 'a.md', 'mine', { ifAbsent: true });
    const moves = rpcsNamed('org_vault_move').length;
    await expect(
      orgVaultProvider.rename!(ORG, 'a.md', 'Trashed.md', { ifMatch: version(a) }),
    ).rejects.toMatchObject({ name: 'OrgVaultNameInTrash', permanent: true, nameInTrash: true });
    await expect(
      orgVaultProvider.write(ORG, 'Trashed.md', 'new', { ifAbsent: true }),
    ).rejects.toMatchObject({ name: 'OrgVaultNameInTrash' });
    expect(rpcsNamed('org_vault_move').length).toBe(moves);
    expect((await orgVaultProvider.listTrash!(ORG)).map((x) => x.path)).toEqual(['Trashed.md']);
    // Restore still puts it back at its own name.
    expect(await orgVaultProvider.restore!(ORG, 'n:Trashed.md')).toMatchObject({
      ok: true,
      renamed: false,
    });
    expect(server.bytes('Trashed.md')).toBe('their text');
  });
});

describe('org vault Trash (Restore only, R3)', () => {
  it('trashes under the rev and lists it; the entry comes back from its revision', async () => {
    const w = await orgVaultProvider.write(ORG, 'Ideas/x.md', 'body', { ifAbsent: true });
    const t = await orgVaultProvider.trash!(ORG, {
      kind: 'note',
      path: 'Ideas/x.md',
      ifMatch: version(w),
    });
    expect(rpcsNamed('org_vault_remove')[0]!.args).toMatchObject({
      p_path: 'Ideas/x.md',
      p_if_match: Number(version(w)),
    });
    expect(t).toMatchObject({ ok: true, notes: 1, entry: { kind: 'note', path: 'Ideas/x.md' } });
    const listed = await orgVaultProvider.listTrash!(ORG);
    expect(listed).toEqual([
      {
        id: t.ok ? t.entry.id : '',
        path: 'Ideas/x.md',
        kind: 'note',
        size: 0,
        trashedAt: server.revisions.at(-1)!.recorded_at,
      },
    ]);
    const back = await orgVaultProvider.restore!(ORG, listed[0]!.id);
    expect(back).toMatchObject({ ok: true, renamed: false, file: { path: 'Ideas/x.md' } });
    // Restore is org_vault_write with if_absent from the revision's body.
    expect(rpcsNamed('org_vault_write').at(-1)!.args).toMatchObject({
      p_path: 'Ideas/x.md',
      p_body: 'body',
      p_if_absent: true,
    });
  });

  it('lists a tombstone only while its newest revision of any reason is deleted', async () => {
    // Moved away: the old path is a tombstone whose newest revision is renamed.
    const a = await orgVaultProvider.write(ORG, 'moved.md', 'm', { ifAbsent: true });
    await orgVaultProvider.rename!(ORG, 'moved.md', 'elsewhere.md', { ifMatch: version(a) });
    // Deleted, then moved onto and away again: renamed is newest, so not listed.
    // (Made again on the server itself: this client makes no note over a
    // name in Trash, E22.)
    const b = await orgVaultProvider.write(ORG, 'twice.md', 't', { ifAbsent: true });
    await orgVaultProvider.trash!(ORG, { kind: 'note', path: 'twice.md', ifMatch: version(b) });
    const c = server.put('twice.md', 't2', 'u-me');
    await orgVaultProvider.rename!(ORG, 'twice.md', 'other.md', { ifMatch: String(c.rev) });
    // Moved away, then made and deleted there: deleted is newest, so listed.
    const d = await orgVaultProvider.write(ORG, 'back.md', 'd', { ifAbsent: true });
    await orgVaultProvider.rename!(ORG, 'back.md', 'gone.md', { ifMatch: version(d) });
    const e = await orgVaultProvider.write(ORG, 'back.md', 'e', { ifAbsent: true });
    await orgVaultProvider.trash!(ORG, { kind: 'note', path: 'back.md', ifMatch: version(e) });
    // Deleted and made again: live, so not in Trash.
    const f = await orgVaultProvider.write(ORG, 'alive.md', 'f', { ifAbsent: true });
    await orgVaultProvider.trash!(ORG, { kind: 'note', path: 'alive.md', ifMatch: version(f) });
    server.put('alive.md', 'f2', 'u-me');
    expect((await orgVaultProvider.listTrash!(ORG)).map((x) => x.path)).toEqual(['back.md']);
  });

  // Gone is its own answer, never "changed" (round 5, finding 5): the store
  // says the note is gone instead of "changed somewhere else".
  it('a note already gone is missing, and nothing is listed', async () => {
    const w = await orgVaultProvider.write(ORG, 'g.md', 'x', { ifAbsent: true });
    server.drop('g.md');
    server.revisions.length = 0;
    const t = await orgVaultProvider.trash!(ORG, {
      kind: 'note',
      path: 'g.md',
      ifMatch: version(w),
    });
    expect(t).toEqual({ ok: false, conflict: 'missing' });
  });

  it('a second restore of the same entry lands nowhere new', async () => {
    const w = await orgVaultProvider.write(ORG, 'p.md', 'body', { ifAbsent: true });
    const t = await orgVaultProvider.trash!(ORG, {
      kind: 'note',
      path: 'p.md',
      ifMatch: version(w),
    });
    const id = t.ok ? t.entry.id : '';
    const first = await orgVaultProvider.restore!(ORG, id);
    const again = await orgVaultProvider.restore!(ORG, id);
    expect(again).toEqual(first);
    expect([...server.notes.values()].filter((n) => !n.deleted).map((n) => n.path)).toEqual([
      'p.md',
    ]);
  });

  // A folder's Undo brings back what that trash took and nothing else: a note
  // deleted under the folder before it (a teammate's deliberate delete) stays
  // in Trash, and the answer names the note that came back.
  it('a folder restore brings back only the notes its trash took', async () => {
    const old = await orgVaultProvider.write(ORG, 'Work/Old.md', 'old', { ifAbsent: true });
    await orgVaultProvider.write(ORG, 'Work/Plan.md', 'plan', { ifAbsent: true });
    await orgVaultProvider.write(ORG, 'Other.md', 'other', { ifAbsent: true });
    await orgVaultProvider.trash!(ORG, {
      kind: 'note',
      path: 'Work/Old.md',
      ifMatch: version(old),
    });
    const t = await orgVaultProvider.trash!(ORG, { kind: 'folder', path: 'Work' });
    expect(t).toMatchObject({ ok: true, notes: 1, entry: { kind: 'folder', path: 'Work' } });
    const back = await orgVaultProvider.restore!(ORG, t.ok ? t.entry.id : '');
    expect(back).toEqual({
      ok: true,
      renamed: false,
      file: expect.objectContaining({ path: 'Work/Plan.md' }),
    });
    const live = [...server.notes.values()].filter((n) => !n.deleted).map((n) => n.path);
    expect(live.sort()).toEqual(['Other.md', 'Work/Plan.md']);
    expect((await orgVaultProvider.listTrash!(ORG)).map((e) => e.path)).toEqual(['Work/Old.md']);
    // One write went out, for Plan; Old was never asked for.
    const writes = rpcsNamed('org_vault_write').map((r) => r.args.p_path);
    expect(writes.filter((p) => p === 'Work/Old.md')).toEqual(['Work/Old.md']);
    expect(writes.at(-1)).toBe('Work/Plan.md');
  });

  it('a folder id that does not name what it took restores nothing', async () => {
    await orgVaultProvider.write(ORG, 'Work/Plan.md', 'plan', { ifAbsent: true });
    await orgVaultProvider.trash!(ORG, { kind: 'folder', path: 'Work' });
    // The old shape, the folder alone, says nothing about which notes.
    expect(await orgVaultProvider.restore!(ORG, 'f:Work')).toEqual({
      ok: false,
      conflict: 'missing',
    });
    expect(server.bytes('Work/Plan.md')).toBeUndefined();
    // A trash that took nothing restores nothing.
    const none = await orgVaultProvider.trash!(ORG, { kind: 'folder', path: 'Empty' });
    expect(none).toMatchObject({ ok: true, notes: 0 });
    expect(await orgVaultProvider.restore!(ORG, none.ok ? none.entry.id : '')).toEqual({
      ok: false,
      conflict: 'missing',
    });
  });

  it('an entry names the rev its delete took, and its restore reads that revision (E23)', async () => {
    const w = await orgVaultProvider.write(ORG, 'Plan.md', 'mine', { ifAbsent: true });
    const t = await orgVaultProvider.trash!(ORG, {
      kind: 'note',
      path: 'Plan.md',
      ifMatch: version(w),
    });
    expect(t.ok && t.entry.id).toBe(`n:Plan.md@${version(w)}`);
    server.put('Plan.md', 'theirs');
    server.drop('Plan.md');
    server.selects.length = 0;
    const back = await orgVaultProvider.restore!(ORG, t.ok ? t.entry.id : '');
    expect(back).toMatchObject({ ok: true, renamed: true, file: { path: 'Plan (restored).md' } });
    expect(server.bytes('Plan (restored).md')).toBe('mine');
    const body = server.selects.find(
      (q) => q.table === 'org_vault_revisions' && q.query.includes('body'),
    );
    expect(body?.query).toContain(`&rev=eq.${version(w)}`);
    // The listing names the newest delete by its own rev.
    const listed = await orgVaultProvider.listTrash!(ORG);
    const theirs = server.revisions.filter((r) => r.reason === 'deleted').at(-1)!;
    expect(listed.map((e) => e.id)).toEqual([`n:Plan.md@${theirs.rev}`]);
  });

  it("a folder entry names each note's rev (E23)", async () => {
    const a = await orgVaultProvider.write(ORG, 'Work/a.md', 'a', { ifAbsent: true });
    const t = await orgVaultProvider.trash!(ORG, { kind: 'folder', path: 'Work' });
    const id = t.ok ? t.entry.id : '';
    expect(JSON.parse(id.slice(2))).toEqual({
      folder: 'Work',
      took: [['Work/a.md', Number(version(a))]],
    });
  });

  it('has no Empty Trash: the purge takes what has been there 30 days', () => {
    expect(orgVaultProvider.emptyTrash).toBeUndefined();
  });

  it('maps OV403 to the admins-only line, as the whole line', async () => {
    server.settingsRow = {
      settings: {},
      delete_role: 'admin',
      context_folder: null,
      rev: 1,
      updated_at: '2026-09-27T00:00:00.000Z',
      updated_by: null,
    };
    server.isAdmin = false;
    const w = await orgVaultProvider.write(ORG, 'n.md', 'x', { ifAbsent: true });
    const err = await orgVaultProvider.trash!(ORG, {
      kind: 'note',
      path: 'n.md',
      ifMatch: version(w),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrgVaultDeleteRefused);
    expect((err as OrgVaultDeleteRefused).message).toBe(
      'Not deleted. Only admins can delete team notes.',
    );
    expect((err as OrgVaultDeleteRefused).whole).toBe(true);
    expect((err as OrgVaultDeleteRefused).permanent).toBe(true);
    expect(server.bytes('n.md')).toBe('x');
    // A move is not gated by the delete rule (0025, 5.).
    const r = await orgVaultProvider.rename!(ORG, 'n.md', 'm.md', { ifMatch: version(w) });
    expect(r.ok).toBe(true);
  });
});

// ---- Vault M7 on the team vault (CTO L17; CX Y14, Y15; migration 0025) ----

describe('org vault plan (OV402) and settings', () => {
  it('maps OV402 to the calm lapsed state: the line, permanent, and the plan', async () => {
    const heard: unknown[] = [];
    onOrgVaultPlan((org, plan) => heard.push([org, plan]));
    server.entitled = false;
    const err = await orgVaultProvider
      .write(ORG, 'a.md', 'x', { ifAbsent: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrgVaultLapsed);
    expect((err as OrgVaultLapsed).message).toBe(
      'The team plan is not active, so team notes cannot change.',
    );
    expect((err as OrgVaultLapsed).permanent).toBe(true);
    expect(orgVaultPlan(ORG)).toMatchObject({ entitled: false });
    expect(heard).toEqual([[ORG, { entitled: false, isAdmin: false, deleteRole: 'member' }]]);
    // Reading is untouched: a lapsed team still reads and lists.
    server.put('b.md', 'still here');
    expect((await orgVaultProvider.read(ORG, 'b.md'))?.text).toBe('still here');
  });

  it("the settings read brings the plan: admin, delete role, and a never-paid team's date", async () => {
    server.entitledUntil = '2026-11-01T00:00:00.000Z';
    server.isAdmin = false;
    const read = await orgVaultProvider.readConfig!(ORG, 'oscode/vault');
    expect(read).toEqual({ ok: false, reason: 'absent' });
    expect(orgVaultPlan(ORG)).toEqual({
      entitled: true,
      entitledUntil: '2026-11-01T00:00:00.000Z',
      isAdmin: false,
      deleteRole: 'member',
    });
    expect(vaultTeamEditableUntil('2026-11-01T12:00:00.000Z')).toBe(
      'Team notes stay editable until November 1, 2026.',
    );
  });

  it('reads the row as the vault file in jsonb key order, with its rev', async () => {
    server.putSettings({ version: 1, tree: { sort: 'modified' }, links: { style: 'markdown' } });
    const read = await orgVaultProvider.readConfig!(ORG, 'oscode/vault');
    expect(read).toEqual({
      ok: true,
      text: '{\n  "tree": {\n    "sort": "modified"\n  },\n  "links": {\n    "style": "markdown"\n  },\n  "version": 1\n}\n',
      version: '1',
    });
    // Obsidian's files never live on the server.
    expect(await orgVaultProvider.readConfig!(ORG, 'obsidian/app')).toEqual({
      ok: false,
      reason: 'absent',
    });
  });

  it('a server without 0025 reads the defaults', async () => {
    const real = mockRpc.getMockImplementation()!;
    mockRpc.mockImplementation((async (fn: string, tok: string, args: Record<string, unknown>) => {
      if (fn === 'org_vault_settings_get') {
        throw Object.assign(new Error('not found'), { status: 404, code: 'PGRST202' });
      }
      return real(fn, tok, args);
    }) as typeof rpc);
    expect(await orgVaultProvider.readConfig!(ORG, 'oscode/vault')).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });

  it('writes under the rev, echoing who may delete and the folder from the same read', async () => {
    server.settingsRow = {
      settings: { version: 1 },
      delete_role: 'admin',
      context_folder: 'Team/Context',
      rev: 3,
      updated_at: '2026-09-27T00:00:00.000Z',
      updated_by: null,
    };
    const read = await orgVaultProvider.readConfig!(ORG, 'oscode/vault');
    const r = await orgVaultProvider.writeConfig!(
      ORG,
      'oscode/vault',
      '{"version":1,"tree":{"sort":"name"}}',
      {
        ifMatch: read.ok ? read.version : '',
      },
    );
    expect(rpcsNamed('org_vault_settings_put')[0]!.args).toEqual({
      p_org: ORG,
      p_settings: { version: 1, tree: { sort: 'name' } },
      p_delete_role: 'admin',
      p_context_folder: 'Team/Context',
      p_base_rev: 3,
    });
    expect(r).toMatchObject({ ok: true, file: { path: '.oscode/vault.json', version: '4' } });
  });

  it('ifAbsent is rev 0; a row there already is exists with theirs', async () => {
    server.putSettings({ version: 1 });
    const r = await orgVaultProvider.writeConfig!(ORG, 'oscode/vault', '{"version":1}', {
      ifAbsent: true,
    });
    expect(rpcsNamed('org_vault_settings_put')[0]!.args).toMatchObject({ p_base_rev: 0 });
    expect(r).toMatchObject({ ok: false, conflict: 'exists', theirs: { version: '1' } });
  });

  it("a member's write is refused by the server, and nothing changes", async () => {
    server.isAdmin = false;
    await expect(
      orgVaultProvider.writeConfig!(ORG, 'oscode/vault', '{"version":1}', { ifAbsent: true }),
    ).rejects.toBeInstanceOf(OrgVaultRefusal);
    expect(server.settingsRow).toBeUndefined();
  });

  it('a lapsed plan refuses a settings write with OV402', async () => {
    server.entitled = false;
    await expect(
      orgVaultProvider.writeConfig!(ORG, 'oscode/vault', '{"version":1}', { ifAbsent: true }),
    ).rejects.toBeInstanceOf(OrgVaultLapsed);
  });

  it('refuses text that is not one JSON object before any call', async () => {
    await expect(
      orgVaultProvider.writeConfig!(ORG, 'oscode/vault', '[1]', { ifAbsent: true }),
    ).rejects.toThrow(/one JSON object/);
    expect(rpcsNamed('org_vault_settings_put')).toEqual([]);
  });

  // The team review of 2026-09-30: 0025's row may hold `delete: "permanent"`,
  // but every team delete keeps the note in Trash for 30 days, so the key is
  // never read back or sent, and nor are the attachments and templates
  // folders, which a team vault never uses.
  it('declares the settings a team vault does not carry out', () => {
    expect(orgVaultProvider.unappliedSettings).toEqual([
      'delete',
      'attachments.folder',
      'templates.folder',
    ]);
    expect(ORG_VAULT_UNAPPLIED_SETTINGS).toBe(orgVaultProvider.unappliedSettings);
  });

  it('never reads back a stored Delete, attachments folder, or templates folder', async () => {
    server.putSettings({
      version: 1,
      delete: 'permanent',
      attachments: { folder: 'Files' },
      templates: { folder: 'Templates', dateFormat: 'DD/MM' },
      tree: { sort: 'modified' },
    });
    const read = await orgVaultProvider.readConfig!(ORG, 'oscode/vault');
    expect(read.ok).toBe(true);
    const json = JSON.parse(read.ok ? read.text : '{}');
    expect(json).toEqual({
      version: 1,
      templates: { dateFormat: 'DD/MM' },
      tree: { sort: 'modified' },
    });
    expect(read.ok ? read.text : '').not.toMatch(/permanent|"delete"|attachments|Templates/);
    // A conflict's theirs is the same text the read gives.
    const stale = await orgVaultProvider.writeConfig!(ORG, 'oscode/vault', '{"version":1}', {
      ifMatch: '9',
    });
    expect(stale).toMatchObject({ ok: false, conflict: 'changed' });
    expect(stale.ok ? '' : stale.theirs?.text).toBe(read.ok ? read.text : undefined);
  });

  it('never sends Delete, and answers the text the next read gives', async () => {
    server.putSettings({ version: 1 });
    const r = await orgVaultProvider.writeConfig!(
      ORG,
      'oscode/vault',
      '{"version":1,"delete":"permanent","attachments":{"folder":"Files"},"templates":{"folder":"T"},"editor":{"font":"serif"}}',
      { ifMatch: '1' },
    );
    expect(rpcsNamed('org_vault_settings_put')[0]!.args.p_settings).toEqual({
      version: 1,
      editor: { font: 'serif' },
    });
    expect(server.settingsRow?.settings).toEqual({ version: 1, editor: { font: 'serif' } });
    const next = await orgVaultProvider.readConfig!(ORG, 'oscode/vault');
    expect(r).toMatchObject({ ok: true, file: { text: next.ok ? next.text : '' } });
  });

  it('setting who may delete drops a stored Delete from the row it writes', async () => {
    server.putSettings({ version: 1, delete: 'permanent', tree: { sort: 'name' } });
    expect(await setOrgVaultDeleteRole(ORG, 'admin')).toBe('ok');
    expect(rpcsNamed('org_vault_settings_put')[0]!.args.p_settings).toEqual({
      version: 1,
      tree: { sort: 'name' },
    });
  });

  it('orgVaultAppliedSettings never changes its input and tolerates any shape', () => {
    const input = { delete: 'permanent', attachments: { folder: 'F', other: 1 }, v: 2 };
    expect(orgVaultAppliedSettings(input)).toEqual({ attachments: { other: 1 }, v: 2 });
    expect(input).toEqual({ delete: 'permanent', attachments: { folder: 'F', other: 1 }, v: 2 });
    expect(orgVaultAppliedSettings({ templates: 'x' })).toEqual({ templates: 'x' });
    expect(orgVaultAppliedSettings(null)).toEqual({});
    expect(orgVaultAppliedSettings([1])).toEqual({});
  });

  it('an admin sets who may delete, keeping the settings as they are', async () => {
    server.putSettings({ version: 1, tree: { sort: 'name' } });
    expect(await setOrgVaultDeleteRole(ORG, 'admin')).toBe('ok');
    expect(server.settingsRow).toMatchObject({
      delete_role: 'admin',
      settings: { version: 1, tree: { sort: 'name' } },
    });
    expect(orgVaultPlan(ORG)?.deleteRole).toBe('admin');
  });
});

// 0023's free space (the 2026-09-30 review, finding 1): a team with no live
// plan holds 25 MiB of note and revision bytes, and a call that grows its
// notes past that is refused with check_violation (SQLSTATE 23514, a 400).
// Deleting frees nothing until the weekly purge, so that refusal is for good:
// the client says it in 0023's own terms (VAULT_TEAM_FULL), never as a
// failure to try again, and a folder's Restore says what came back.
describe('org vault free space (0023)', () => {
  const fill = (n: number) => 'x'.repeat(n);
  const live = () =>
    [...server.notes.values()]
      .filter((n) => !n.deleted)
      .map((n) => n.path)
      .sort();

  it('maps the refusal to a permanent one in the copy words, and writes nothing', async () => {
    const a = await orgVaultProvider.write(ORG, 'a.md', fill(10), { ifAbsent: true });
    server.freeBytes = server.usage() + 5;
    const grown = await orgVaultProvider
      .write(ORG, 'a.md', fill(30), { ifMatch: version(a) })
      .catch((e: unknown) => e);
    expect(grown).toBeInstanceOf(OrgVaultFull);
    expect(grown).toBeInstanceOf(OrgVaultRefusal);
    expect(grown).toMatchObject({ permanent: true, message: VAULT_TEAM_FULL });
    expect((grown as { whole?: unknown }).whole).toBeUndefined();
    const made = await orgVaultProvider
      .write(ORG, 'b.md', fill(20), { ifAbsent: true })
      .catch((e: unknown) => e);
    expect(made).toBeInstanceOf(OrgVaultFull);
    // The call rolled back: the note, its history and the total are as they were.
    expect(server.bytes('a.md')).toBe(fill(10));
    expect(server.bytes('b.md')).toBeUndefined();
    expect(server.revisions).toEqual([]);
  });

  it('a shrink and a delete near the cap go through', async () => {
    const a = await orgVaultProvider.write(ORG, 'a.md', fill(40), { ifAbsent: true });
    const b = await orgVaultProvider.write(ORG, 'b.md', fill(40), { ifAbsent: true });
    server.freeBytes = server.usage();
    const smaller = await orgVaultProvider.write(ORG, 'a.md', fill(5), { ifMatch: version(a) });
    expect(smaller.ok).toBe(true);
    expect(await orgVaultProvider.remove(ORG, 'b.md', { ifMatch: version(b) })).toEqual({
      ok: true,
    });
  });

  it('a check_violation in other words stays the server line, still permanent', async () => {
    mockRpc.mockRejectedValueOnce(
      Object.assign(new Error('new row violates check constraint "org_vault_settings_ok"'), {
        status: 400,
        code: '23514',
      }),
    );
    const err = await orgVaultProvider
      .write(ORG, 'a.md', 'hi', { ifAbsent: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrgVaultRefusal);
    expect(err).not.toBeInstanceOf(OrgVaultFull);
    expect((err as Error).message).toMatch(/check constraint/);
  });

  it('the refusal reads as 0023 raises it, the code and the words', async () => {
    mockRpc.mockRejectedValueOnce(
      Object.assign(new Error(FREE_SPACE_REFUSAL), { status: 400, code: '23514' }),
    );
    await expect(
      orgVaultProvider.write(ORG, 'a.md', 'hi', { ifAbsent: true }),
    ).rejects.toBeInstanceOf(OrgVaultFull);
  });

  it('a Restore that would pass the cap is refused for good, and the note stays in Trash', async () => {
    const w = await orgVaultProvider.write(ORG, 'Old.md', fill(50), { ifAbsent: true });
    const t = await orgVaultProvider.trash!(ORG, {
      kind: 'note',
      path: 'Old.md',
      ifMatch: version(w),
    });
    // The deleted body still counts (its revision), until the purge.
    server.freeBytes = server.usage() + 10;
    const err = await orgVaultProvider.restore!(ORG, t.ok ? t.entry.id : '').catch((e) => e);
    expect(err).toBeInstanceOf(OrgVaultFull);
    expect(live()).toEqual([]);
    expect((await orgVaultProvider.listTrash!(ORG)).map((e) => e.path)).toEqual(['Old.md']);
  });

  it('a folder Restore brings back what fits, and says how many and which stayed', async () => {
    await orgVaultProvider.write(ORG, 'Work/a.md', fill(5), { ifAbsent: true });
    await orgVaultProvider.write(ORG, 'Work/big.md', fill(60), { ifAbsent: true });
    await orgVaultProvider.write(ORG, 'Work/c.md', fill(5), { ifAbsent: true });
    const t = await orgVaultProvider.trash!(ORG, { kind: 'folder', path: 'Work' });
    server.freeBytes = server.usage() + 20;
    const back = await orgVaultProvider.restore!(ORG, t.ok ? t.entry.id : '');
    expect(back).toEqual({
      ok: true,
      renamed: false,
      file: expect.objectContaining({ path: 'Work/a.md' }),
      partial: { restored: 2, left: ['Work/big.md'], line: VAULT_TEAM_FULL },
    });
    // The smaller note after the refused one was still tried.
    expect(live()).toEqual(['Work/a.md', 'Work/c.md']);
    expect((await orgVaultProvider.listTrash!(ORG)).map((e) => e.path)).toEqual(['Work/big.md']);
  });

  it('a folder Restore where nothing fits is refused for good', async () => {
    await orgVaultProvider.write(ORG, 'Work/a.md', fill(30), { ifAbsent: true });
    await orgVaultProvider.write(ORG, 'Work/b.md', fill(30), { ifAbsent: true });
    const t = await orgVaultProvider.trash!(ORG, { kind: 'folder', path: 'Work' });
    server.freeBytes = server.usage() + 10;
    const err = await orgVaultProvider.restore!(ORG, t.ok ? t.entry.id : '').catch((e) => e);
    expect(err).toBeInstanceOf(OrgVaultFull);
    expect(live()).toEqual([]);
  });

  it('a failure part way lists the rest as not reached, with no reason to give', async () => {
    await orgVaultProvider.write(ORG, 'Work/a.md', 'a', { ifAbsent: true });
    await orgVaultProvider.write(ORG, 'Work/b.md', 'b', { ifAbsent: true });
    await orgVaultProvider.write(ORG, 'Work/c.md', 'c', { ifAbsent: true });
    const t = await orgVaultProvider.trash!(ORG, { kind: 'folder', path: 'Work' });
    let writes = 0;
    mockRpc.mockImplementation(async (fn, token, args) => {
      if (fn === 'org_vault_write' && ++writes === 2) throw new TypeError('Failed to fetch');
      return server.rpc(fn, token, args as Record<string, unknown>);
    });
    const back = await orgVaultProvider.restore!(ORG, t.ok ? t.entry.id : '');
    expect(back).toMatchObject({
      ok: true,
      partial: { restored: 1, left: ['Work/b.md', 'Work/c.md'] },
    });
    expect((back as { partial?: { line?: string } }).partial?.line).toBeUndefined();
  });

  it('a rename at the cap goes through; a team already past it is refused for good', async () => {
    const a = await orgVaultProvider.write(ORG, 'a.md', fill(20), { ifAbsent: true });
    server.freeBytes = server.usage() + 20;
    // 0024 writes the tombstone before the destination: at the cap, a move
    // adds nothing, so it lands (its history copy rides above, as 0023 says).
    const moved = await orgVaultProvider.rename!(ORG, 'a.md', 'b.md', { ifMatch: version(a) });
    expect(moved).toMatchObject({ ok: true, file: { path: 'b.md' } });
    // Past the cap (grandfathered rows, or history above it), it is refused.
    server.freeBytes = server.usage() - 1;
    const err = await orgVaultProvider.rename!(ORG, 'b.md', 'c.md', {
      ifMatch: moved.ok ? moved.file.version! : '',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrgVaultFull);
    expect(live()).toEqual(['b.md']);
  });
});

// The team client inserts beside main's code and never moves it (the
// 2026-09-30 review, finding 2): restoredPath and VAULT_SETTINGS_PATH stay in
// local.ts, where main defines them, and the team vault imports them from
// there. local.ts never imports the team vault, so there is no cycle.
describe("the team client leaves main's modules where they are", () => {
  const src = (f: string) =>
    readFileSync(new URL(`../src/lib/gitos/${f}`, import.meta.url), 'utf8');

  it('reads restoredPath and VAULT_SETTINGS_PATH from local.ts, with no cycle', () => {
    const local = src('local.ts');
    const providers = src('providers.ts');
    expect(local).toMatch(/^export function restoredPath\(path: string, n: number\): string \{$/m);
    expect(local).toMatch(/^export const VAULT_SETTINGS_PATH = /m);
    expect(providers).not.toMatch(/restoredPath|VAULT_SETTINGS_PATH|VAULT_CONFIG_FILES/);
    expect(src('orgVault.ts')).toContain(
      "import { VAULT_SETTINGS_PATH, restoredPath } from './local.js';",
    );
    expect(local).not.toMatch(/from '\.\/orgVault\.js'/);
  });
});
