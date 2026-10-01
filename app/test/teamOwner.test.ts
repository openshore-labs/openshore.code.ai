// A team target's storage answers only while its account is the one signed
// in (state/teamOwner.ts, round 7 E5): a call refused for another account or
// for nobody is a permanent refusal, answered as a rejected promise, and
// nothing reaches the provider.
import { describe, expect, it } from 'vitest';
import type { StorageProvider } from '../src/lib/gitos/providers.js';
import { TeamAccountRefusal, ownerBoundProvider } from '../src/state/teamOwner.js';
import { VAULT_TEAM_OTHER_ACCOUNT, VAULT_TEAM_SIGN_IN_LINE } from '../src/lib/vaultCopy.js';

function fakeProvider() {
  const calls: string[] = [];
  const provider = {
    id: 'org',
    compareAndSwap: true,
    async read(_r: string, path: string) {
      calls.push(`read ${path}`);
      return { path, text: 'x', updatedAt: 'a' };
    },
    async write(_r: string, path: string) {
      calls.push(`write ${path}`);
      return { ok: true, file: { path, text: 'x', updatedAt: 'b' } };
    },
  } as unknown as StorageProvider;
  return { provider, calls };
}

describe('ownerBoundProvider', () => {
  it('passes calls through while the account is signed in, and keeps what is not a method', async () => {
    const { provider, calls } = fakeProvider();
    const bound = ownerBoundProvider(provider, 'u1', () => 'u1');
    expect(bound.compareAndSwap).toBe(true);
    expect(bound.id).toBe('org');
    await bound.read('r', 'a.md');
    expect(calls).toEqual(['read a.md']);
  });

  it('refuses for good, with nothing sent, once another account is signed in', async () => {
    const { provider, calls } = fakeProvider();
    let now = 'u1';
    const bound = ownerBoundProvider(provider, 'u1', () => now);
    now = 'u2';
    const err = await bound.write('r', 'a.md', 'words').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TeamAccountRefusal);
    expect((err as TeamAccountRefusal).permanent).toBe(true);
    expect((err as Error).message).toBe(VAULT_TEAM_OTHER_ACCOUNT);
    expect(calls).toEqual([]);
  });

  it('refuses when nobody is signed in, or the target names no account', async () => {
    const { provider, calls } = fakeProvider();
    const signedOut = ownerBoundProvider(provider, 'u1', () => undefined);
    await expect(signedOut.read('r', 'a.md')).rejects.toThrow(VAULT_TEAM_SIGN_IN_LINE);
    const nobody = ownerBoundProvider(provider, undefined, () => undefined);
    await expect(nobody.read('r', 'a.md')).rejects.toThrow(VAULT_TEAM_SIGN_IN_LINE);
    expect(calls).toEqual([]);
  });

  it('is one wrapper per provider and account', () => {
    const { provider } = fakeProvider();
    const who = () => 'u1';
    expect(ownerBoundProvider(provider, 'u1', who)).toBe(ownerBoundProvider(provider, 'u1', who));
    expect(ownerBoundProvider(provider, 'u1', who)).not.toBe(
      ownerBoundProvider(provider, 'u2', who),
    );
  });
});
