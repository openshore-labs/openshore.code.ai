import { beforeEach, describe, expect, it, vi } from 'vitest';

// The provider talks to Supabase through ../supabase.js; mock that seam so these
// tests exercise the provider's own logic (row mapping, base-rev tracking, the
// RPC it calls) without a network or a live Postgres.
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
  orgVaultBaseRev,
  seedOrgVaultBaseRev,
} from '../src/lib/gitos/orgVault.js';

const ORG = 'org-123';
const mockSelect = vi.mocked(select);
const mockRpc = vi.mocked(rpc);

beforeEach(() => {
  mockSelect.mockReset();
  mockRpc.mockReset();
  setOrgVaultAuth(
    async () => 'tok',
    () => true,
  );
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

  it('lists live notes for the org and maps rows to file meta', async () => {
    mockSelect.mockResolvedValue([
      { path: 'a.md', updated_at: 't1', rev: 3, size: 5 },
      { path: 'b/c.md', updated_at: 't2', rev: 1, size: 9 },
    ]);
    const files = await orgVaultProvider.list(ORG);
    expect(files).toEqual([
      { path: 'a.md', updatedAt: 't1', size: 5 },
      { path: 'b/c.md', updatedAt: 't2', size: 9 },
    ]);
    const query = mockSelect.mock.calls[0]![2];
    expect(query).toContain(`org_id=eq.${ORG}`);
    expect(query).toContain('deleted=is.false');
  });

  it('sends the last-read rev as the write base, then adopts the returned rev', async () => {
    mockSelect.mockResolvedValue([{ path: 'a.md', body: 'hi', updated_at: 't1', rev: 4 }]);
    await orgVaultProvider.read(ORG, 'a.md'); // learns base rev 4

    mockRpc.mockResolvedValue({ path: 'a.md', body: 'bye', updated_at: 't2', rev: 5, size: 3 });
    const saved = await orgVaultProvider.write(ORG, 'a.md', 'bye');
    expect(mockRpc.mock.calls[0]![0]).toBe('org_vault_put');
    expect(mockRpc.mock.calls[0]![2]).toMatchObject({
      p_org: ORG,
      p_path: 'a.md',
      p_body: 'bye',
      p_base_rev: 4,
    });
    expect(saved).toEqual({ path: 'a.md', text: 'bye', updatedAt: 't2' });

    // A second write with no intervening read uses the adopted rev 5 as the base.
    mockRpc.mockResolvedValue({ path: 'a.md', body: 'again', updated_at: 't3', rev: 6, size: 5 });
    await orgVaultProvider.write(ORG, 'a.md', 'again');
    expect(mockRpc.mock.calls[1]![2]).toMatchObject({ p_base_rev: 5 });
  });

  // 0.9 (orgvault-1): list() runs on every foreground, save, and backlink
  // pass. If it advanced the base, a stale open draft would send the
  // teammate's rev as its own and the server would make no conflict copy.
  it('read rev 3, list rev 4, write sends 3', async () => {
    mockSelect.mockResolvedValueOnce([
      { path: 'n.md', body: 'mine', updated_at: 't3', rev: 3, size: 4 },
    ]);
    await orgVaultProvider.read(ORG, 'n.md');
    mockSelect.mockResolvedValueOnce([{ path: 'n.md', updated_at: 't4', rev: 4, size: 9 }]);
    await orgVaultProvider.list(ORG);
    mockRpc.mockResolvedValue({ path: 'n.md', body: 'x', updated_at: 't5', rev: 5, size: 1 });
    await orgVaultProvider.write(ORG, 'n.md', 'mine plus a keystroke');
    expect(mockRpc.mock.calls[0]![2]).toMatchObject({ p_base_rev: 3 });
  });

  it('stat does not advance the base either', async () => {
    mockSelect.mockResolvedValueOnce([
      { path: 's.md', body: 'mine', updated_at: 't1', rev: 1, size: 4 },
    ]);
    await orgVaultProvider.read(ORG, 's.md');
    mockSelect.mockResolvedValueOnce([{ path: 's.md', updated_at: 't2', rev: 2, size: 6 }]);
    expect(await orgVaultProvider.stat(ORG, 's.md')).toMatchObject({ updatedAt: 't2' });
    mockRpc.mockResolvedValue({ path: 's.md', body: 'x', updated_at: 't3', rev: 3, size: 1 });
    await orgVaultProvider.write(ORG, 's.md', 'mine, edited');
    expect(mockRpc.mock.calls[0]![2]).toMatchObject({ p_base_rev: 1 });
  });

  // 0.4 (orgvault-9): a refusal retrying cannot fix is marked permanent, so
  // the store holds the text instead of promising a reconnect that never
  // helps. The 1 MB cap is checked here, before anything is sent.
  it('refuses a body over 1 MB before sending, as a permanent refusal', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024);
    const err = await orgVaultProvider.write(ORG, 'big.md', big).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrgVaultRefusal);
    expect((err as OrgVaultRefusal).permanent).toBe(true);
    expect((err as Error).message).toMatch(/limited to 1 MB/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('counts the cap in bytes, the way the server does', async () => {
    // 600,000 two-byte characters: under a million UTF-16 units, over 1 MB.
    const err = await orgVaultProvider
      .write(ORG, 'wide.md', 'é'.repeat(600_000))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrgVaultRefusal);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("marks a server 4xx as permanent with the server's own line", async () => {
    mockRpc.mockRejectedValue(
      Object.assign(new Error('not a member of this org'), { status: 400 }),
    );
    const err = await orgVaultProvider.write(ORG, 'a.md', 'hi').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrgVaultRefusal);
    expect((err as Error).message).toBe('not a member of this org');
  });

  it('leaves a network failure, a 5xx, and a 401 retryable', async () => {
    for (const failure of [
      new TypeError('Failed to fetch'),
      Object.assign(new Error('bad gateway'), { status: 502 }),
      Object.assign(new Error('JWT expired'), { status: 401 }),
      Object.assign(new Error('slow down'), { status: 429 }),
    ]) {
      mockRpc.mockReset();
      mockRpc.mockRejectedValue(failure);
      const err = await orgVaultProvider.write(ORG, 'a.md', 'hi').catch((e: unknown) => e);
      expect(err).toBe(failure);
    }
  });

  it('marks a refused delete as permanent too', async () => {
    mockRpc.mockRejectedValue(
      Object.assign(new Error('not a member of this org'), { status: 400 }),
    );
    await expect(orgVaultProvider.remove(ORG, 'a.md')).rejects.toBeInstanceOf(OrgVaultRefusal);
  });

  it('uses base 0 for a note it never read, so the server treats a surprise as a conflict', async () => {
    mockRpc.mockResolvedValue({ path: 'fresh.md', body: 'x', updated_at: 't', rev: 1, size: 1 });
    await orgVaultProvider.write('org-xyz', 'fresh.md', 'x');
    expect(mockRpc.mock.calls[0]![2]).toMatchObject({ p_base_rev: 0 });
  });

  it('accepts a single-object or array RPC return', async () => {
    mockRpc.mockResolvedValue([{ path: 'z.md', body: 'q', updated_at: 't9', rev: 2, size: 1 }]);
    const saved = await orgVaultProvider.write(ORG, 'z.md', 'q');
    expect(saved).toEqual({ path: 'z.md', text: 'q', updatedAt: 't9' });
  });

  it('deletes through the tombstone RPC', async () => {
    mockRpc.mockResolvedValue(undefined);
    await orgVaultProvider.remove(ORG, 'a.md');
    expect(mockRpc.mock.calls[0]![0]).toBe('org_vault_delete');
    expect(mockRpc.mock.calls[0]![2]).toMatchObject({ p_org: ORG, p_path: 'a.md' });
  });

  it('refuses to act without a session token', async () => {
    setOrgVaultAuth(
      async () => undefined,
      () => true,
    );
    await expect(orgVaultProvider.list(ORG)).rejects.toThrow(/team/i);
    // A save with no team session cannot succeed by retrying, so it is a
    // permanent refusal: never stashed to replay under the next sign-in.
    await expect(orgVaultProvider.write(ORG, 'a.md', 'hi')).rejects.toBeInstanceOf(OrgVaultRefusal);
  });

  it('passes a token refresh that could not reach the server through as retryable', async () => {
    setOrgVaultAuth(
      async () => {
        throw new TypeError('Failed to fetch');
      },
      () => true,
    );
    const err = await orgVaultProvider.write(ORG, 'a.md', 'hi').catch((e: unknown) => e);
    // Offline is not "signed out": the store stashes this and retries it.
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(OrgVaultRefusal);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('exposes the base rev it holds, and takes one back for a replay after a relaunch', async () => {
    mockSelect.mockResolvedValue([{ path: 'a.md', body: 'hi', updated_at: 't1', rev: 3 }]);
    await orgVaultProvider.read(ORG, 'a.md');
    expect(orgVaultBaseRev(ORG, 'a.md')).toBe(3);
    expect(orgVaultBaseRev(ORG, 'b.md')).toBeUndefined();

    resetOrgVault(); // the relaunch
    expect(orgVaultBaseRev(ORG, 'a.md')).toBeUndefined();
    seedOrgVaultBaseRev(ORG, 'a.md', 3);
    mockRpc.mockResolvedValue({ path: 'a.md', body: 'z', updated_at: 't2', rev: 4, size: 1 });
    await orgVaultProvider.write(ORG, 'a.md', 'z');
    expect(mockRpc.mock.calls[0]![2]).toMatchObject({ p_base_rev: 3 });
    expect(orgVaultBaseRev(ORG, 'a.md')).toBe(4);
  });

  it('forgets base revs on reset, so one account cannot leak into the next', async () => {
    mockSelect.mockResolvedValue([{ path: 'a.md', body: 'hi', updated_at: 't1', rev: 7 }]);
    await orgVaultProvider.read(ORG, 'a.md'); // learns base rev 7

    resetOrgVault(); // sign-out / account switch clears the cache

    mockRpc.mockResolvedValue({ path: 'a.md', body: 'z', updated_at: 't2', rev: 1, size: 1 });
    await orgVaultProvider.write(ORG, 'a.md', 'z');
    // The forgotten rev falls back to base 0, not the stale 7.
    expect(mockRpc.mock.calls[0]![2]).toMatchObject({ p_base_rev: 0 });
  });

  it('grants the lease trivially: multi-writer has no single-writer lock', async () => {
    const lease = await orgVaultProvider.acquireLease(ORG, 'me', 1000);
    expect(lease.holder).toBe('me');
    expect(new Date(lease.expiresAt).getTime()).toBeGreaterThan(0);
  });
});
