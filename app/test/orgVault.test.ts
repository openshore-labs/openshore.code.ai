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
  });

  it('grants the lease trivially: multi-writer has no single-writer lock', async () => {
    const lease = await orgVaultProvider.acquireLease(ORG, 'me', 1000);
    expect(lease.holder).toBe('me');
    expect(new Date(lease.expiresAt).getTime()).toBeGreaterThan(0);
  });
});
