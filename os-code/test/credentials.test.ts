// Per-user daemon credentials decide who is calling and what they may do, so
// pin the store: a minted token resolves to its role, a wrong token resolves to
// nothing, expiry is honored, the legacy shared token stays admin, and revoke
// removes access. Tokens are never stored in the clear.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  credentialsPath,
  isTokenHash,
  loadCredentials,
  mintCredential,
  resolveDeviceCredential,
  revokeCredential,
  revokeCredentialByHash,
} from '../src/core/security/credentials.js';
import { resolveAuth, hasRole } from '../src/core/security/daemonAuth.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'oschome-'));
  process.env.OSC_HOME = home;
});
afterEach(() => {
  delete process.env.OSC_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe('device credentials', () => {
  it('mints a token that resolves to its role', () => {
    const { token } = mintCredential({ role: 'member', label: 'Alice iPhone' });
    const ctx = resolveDeviceCredential(token);
    expect(ctx?.role).toBe('member');
    expect(ctx?.label).toBe('Alice iPhone');
    expect(ctx?.source).toBe('device');
  });

  it('never stores the token in the clear', () => {
    const { token } = mintCredential({ role: 'admin', label: 'Owner laptop' });
    const onDisk = readFileSync(credentialsPath(), 'utf8');
    expect(onDisk).not.toContain(token);
    expect(loadCredentials()[0]!.tokenHash).toHaveLength(64);
  });

  it('rejects an unknown token', () => {
    mintCredential({ role: 'member', label: 'x' });
    expect(resolveDeviceCredential('osc_not-a-real-token')).toBeUndefined();
  });

  it('honors expiry', () => {
    const { token } = mintCredential({ role: 'member', label: 'temp', ttlDays: -1 });
    expect(resolveDeviceCredential(token)).toBeUndefined();
  });

  it('revokes by label', () => {
    const { token } = mintCredential({ role: 'member', label: 'Bob phone' });
    expect(resolveDeviceCredential(token)).toBeDefined();
    expect(revokeCredential('Bob phone')).toBe(1);
    expect(resolveDeviceCredential(token)).toBeUndefined();
  });

  // Every hash starts with the empty string, so a prefix match on '' used to
  // revoke every paired device at once (the D2 shell package).
  it('an empty or blank match revokes nothing', () => {
    mintCredential({ role: 'admin', label: 'Phone' });
    mintCredential({ role: 'admin', label: 'Tablet' });
    expect(revokeCredential('')).toBe(0);
    expect(revokeCredential('   ')).toBe(0);
    expect(loadCredentials()).toHaveLength(2);
  });

  it('the desktop revoke matches one whole hash exactly, never a prefix or a label', () => {
    const phone = mintCredential({ role: 'admin', label: 'Phone' });
    const tablet = mintCredential({ role: 'admin', label: 'Tablet' });
    const hash = phone.credential.tokenHash;
    expect(isTokenHash(hash)).toBe(true);
    expect(revokeCredentialByHash('')).toBe(0);
    expect(revokeCredentialByHash(hash.slice(0, 8))).toBe(0);
    expect(revokeCredentialByHash('Phone')).toBe(0);
    expect(revokeCredentialByHash(hash.toUpperCase())).toBe(0);
    expect(loadCredentials()).toHaveLength(2);
    expect(revokeCredentialByHash(hash)).toBe(1);
    expect(resolveDeviceCredential(phone.token)).toBeUndefined();
    expect(resolveDeviceCredential(tablet.token)?.label).toBe('Tablet');
  });
});

describe('resolveAuth', () => {
  it('treats the legacy shared token as admin', () => {
    const ctx = resolveAuth('shared-legacy', 'shared-legacy');
    expect(ctx?.role).toBe('admin');
    expect(ctx?.source).toBe('legacy');
  });

  it('resolves a minted member token to a member context', () => {
    const { token } = mintCredential({ role: 'member', label: 'Alice' });
    const ctx = resolveAuth(token, 'shared-legacy');
    expect(ctx?.role).toBe('member');
  });

  it('returns null for a token that matches nothing', () => {
    expect(resolveAuth('nope', 'shared-legacy')).toBeNull();
    expect(resolveAuth(undefined, 'shared-legacy')).toBeNull();
  });

  it('admin outranks member; member does not reach admin', () => {
    expect(hasRole({ userId: 'u', role: 'admin', label: '', source: 'device' }, 'admin')).toBe(
      true,
    );
    expect(hasRole({ userId: 'u', role: 'admin', label: '', source: 'device' }, 'member')).toBe(
      true,
    );
    expect(hasRole({ userId: 'u', role: 'member', label: '', source: 'device' }, 'admin')).toBe(
      false,
    );
    expect(hasRole({ userId: 'u', role: 'member', label: '', source: 'device' }, 'member')).toBe(
      true,
    );
  });
});
