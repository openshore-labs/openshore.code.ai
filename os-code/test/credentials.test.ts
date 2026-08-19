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
  loadCredentials,
  mintCredential,
  resolveDeviceCredential,
  revokeCredential,
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
    expect(hasRole({ userId: 'u', role: 'admin', label: '', source: 'device' }, 'admin')).toBe(true);
    expect(hasRole({ userId: 'u', role: 'admin', label: '', source: 'device' }, 'member')).toBe(true);
    expect(hasRole({ userId: 'u', role: 'member', label: '', source: 'device' }, 'admin')).toBe(false);
    expect(hasRole({ userId: 'u', role: 'member', label: '', source: 'device' }, 'member')).toBe(true);
  });
});
