import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeOrgVaultServer,
  type FakeOrgVaultServer,
} from './fixtures/fakeOrgVaultServer.js';

// The provider talks to Supabase through ../supabase.js; mock that seam so these
// tests exercise the provider's own logic (row mapping, versions, paging, the
// RPCs it calls and how it reads their answers) without a network or a live
// Postgres. The fake speaks migration 0019's RPC semantics.
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
} from '../src/lib/gitos/orgVault.js';

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
    server.rpcFailure = Object.assign(new Error('not a member of this org'), { status: 400 });
    const err = await orgVaultProvider
      .write(ORG, 'a.md', 'hi', { ifAbsent: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrgVaultRefusal);
    expect((err as Error).message).toBe('not a member of this org');
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

  // A server that has not had migration 0019 yet answers PGRST202 (a 404).
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
    server.rpcFailure = Object.assign(new Error('not a member of this org'), { status: 400 });
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
