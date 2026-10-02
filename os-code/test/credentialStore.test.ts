// The engine's credential file is sealed under a key the OS holds (the macOS
// Keychain, Windows DPAPI), not one derived from the hostname, so a copy of
// ~/.os-code alone opens nothing (CTO security review 2026-10-01, F2). An old
// file moves under the OS-held key on first read, and a locked keychain never
// reads as "absent" or clobbers the file.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import {
  _setFakeKeychain,
  _setFileKeyProvider,
  _setSecretTool,
  deleteCredential,
  fileKeyHolder,
  getCredential,
  readCredential,
  setCredential,
} from '../src/auth/store.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'oscstore-'));
  process.env.OSC_HOME = home;
  _setFakeKeychain(undefined);
  _setSecretTool(false);
});
afterEach(() => {
  _setFileKeyProvider(undefined);
  _setSecretTool(undefined);
  delete process.env.OSC_HOME;
  rmSync(home, { recursive: true, force: true });
});

function legacyFile(store: Record<string, string>): void {
  let id = hostname();
  try {
    id += readFileSync('/etc/machine-id', 'utf8').trim();
  } catch {}
  const key = scryptSync(id, 'os-code-credentials-v1', 32);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(store), 'utf8'), c.final()]);
  writeFileSync(join(home, 'credentials'), Buffer.concat([iv, c.getAuthTag(), data]));
}

describe('the credential file key', () => {
  it('lives with the OS, and the file opens nothing without it', () => {
    _setFileKeyProvider({ holder: 'macos-keychain' });
    setCredential('OPENAI_API_KEY', 'sk-test-value');
    expect(fileKeyHolder()).toBe('macos-keychain');
    const raw = readFileSync(join(home, 'credentials'));
    expect(raw.subarray(0, 4).toString()).toBe('OSC2');
    expect(raw.includes(Buffer.from('sk-test-value'))).toBe(false);
    expect(getCredential('OPENAI_API_KEY')).toBe('sk-test-value');
    // A copy of the folder on another machine (a different OS-held key) reads nothing.
    _setFileKeyProvider({ holder: 'macos-keychain', key: randomBytes(32) });
    expect(getCredential('OPENAI_API_KEY')).toBeUndefined();
    expect(readCredential('OPENAI_API_KEY').keychainUnreadable).toBe(true);
  });

  it('moves an old hostname-sealed file under the OS-held key on first read', () => {
    legacyFile({ GITHUB_TOKEN: 'ghp_old' });
    _setFileKeyProvider({ holder: 'windows-dpapi' });
    expect(getCredential('GITHUB_TOKEN')).toBe('ghp_old');
    expect(readFileSync(join(home, 'credentials')).subarray(0, 4).toString()).toBe('OSC2');
    expect(getCredential('GITHUB_TOKEN')).toBe('ghp_old');
  });

  it('a locked keychain reads as unreadable, never absent, and never clobbers the file', () => {
    const key = randomBytes(32);
    _setFileKeyProvider({ key });
    setCredential('A', 'one');
    setCredential('B', 'two');
    _setFileKeyProvider({ key, locked: true });
    const read = readCredential('A');
    expect(read.value).toBeUndefined();
    expect(read.keychainUnreadable).toBe(true);
    expect(() => setCredential('C', 'three')).toThrow(/locked/);
    deleteCredential('A');
    _setFileKeyProvider({ key });
    expect(getCredential('A')).toBe('one');
    expect(getCredential('B')).toBe('two');
  });

  it('keeps working on the old scheme where the OS holds no key', () => {
    _setFileKeyProvider(null);
    setCredential('X', 'y');
    expect(fileKeyHolder()).toBe('machine-derived');
    expect(readFileSync(join(home, 'credentials')).subarray(0, 4).toString()).not.toBe('OSC2');
    expect(getCredential('X')).toBe('y');
  });

  it('falls back to the old scheme when the OS refuses to hold a key', () => {
    _setFileKeyProvider({ refuseSave: true });
    setCredential('X', 'y');
    expect(fileKeyHolder()).toBe('machine-derived');
    expect(getCredential('X')).toBe('y');
  });

  // The real thing, on the Windows CI runner: DPAPI through PowerShell.
  it.runIf(process.platform === 'win32')('round-trips through real Windows DPAPI', () => {
    _setFileKeyProvider(undefined);
    setCredential('REAL', 'value');
    expect(fileKeyHolder()).toBe('windows-dpapi');
    _setFileKeyProvider(undefined);
    expect(getCredential('REAL')).toBe('value');
  });
});
