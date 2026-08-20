// Credential storage. Preference order:
//   1. The OS keychain via `secret-tool` (libsecret), when the desktop has it.
//   2. An encrypted file at ~/.os-code/credentials (AES-256-GCM, key derived
//      from the machine identity, mode 600).
// The file path is honest obfuscation, not a vault: it keeps keys out of
// plain text and out of accidental backups/greps, and the docs say exactly
// that. Nothing ever leaves the machine.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { oscHome } from '../config/load.js';

export type StoreBackend = 'keychain' | 'encrypted-file';

let secretToolChecked: boolean | undefined;

function hasSecretTool(): boolean {
  if (fakeKeychain) return true;
  if (secretToolChecked === undefined) {
    secretToolChecked = spawnSync('secret-tool', ['--help'], { stdio: 'ignore' }).status === 0;
  }
  return secretToolChecked;
}

/** Test seam. */
export function _setSecretTool(v: boolean | undefined): void {
  secretToolChecked = v;
}

// --- Test seam: an injectable, in-memory keychain --------------------------
// Real libsecret needs D-Bus and a login session, absent in CI, so the
// key-shadowing hazard (a keychain that is PRESENT but temporarily unreadable
// must never trigger a fresh data-key mint) is exercised through this fake.
// `locked` models exactly that state: reads report "unreadable", not "absent".
interface FakeKeychain {
  entries: Map<string, string>;
  locked: boolean;
}
let fakeKeychain: FakeKeychain | undefined;

export function _setFakeKeychain(
  fk: { entries?: Map<string, string>; locked?: boolean } | undefined,
): void {
  fakeKeychain = fk ? { entries: fk.entries ?? new Map(), locked: fk.locked ?? false } : undefined;
}

type KeychainOutcome =
  { status: 'found'; value: string } | { status: 'absent' } | { status: 'unreadable' };

/**
 * Read one entry from the keychain, distinguishing three outcomes. "absent"
 * (genuinely not there) and "unreadable" (present but locked/errored) must
 * never be conflated: treating an unreadable keychain as "absent" is what lets
 * loadOrCreateDataKey mint a second, shadowing data key (B1).
 */
function keychainLookup(name: string): KeychainOutcome {
  if (fakeKeychain) {
    if (fakeKeychain.locked) return { status: 'unreadable' };
    const v = fakeKeychain.entries.get(name);
    return v === undefined ? { status: 'absent' } : { status: 'found', value: v };
  }
  if (!hasSecretTool()) return { status: 'absent' };
  const res = spawnSync('secret-tool', ['lookup', 'service', 'os-code', 'key', name], {
    encoding: 'utf8',
  });
  if (res.status === 0) {
    const v = res.stdout ? res.stdout.trim() : '';
    return v ? { status: 'found', value: v } : { status: 'absent' };
  }
  // secret-tool exits 1 for a genuine miss; anything else (spawn error, D-Bus
  // failure, a locked collection) means the keychain could not be read.
  if (res.status === 1) return { status: 'absent' };
  return { status: 'unreadable' };
}

function machineKey(): Buffer {
  let machineId = hostname();
  try {
    machineId += readFileSync('/etc/machine-id', 'utf8').trim();
  } catch {}
  return scryptSync(machineId, 'os-code-credentials-v1', 32);
}

function filePath(): string {
  return join(oscHome(), 'credentials');
}

function readFileStore(): Record<string, string> {
  try {
    const raw = readFileSync(filePath());
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', machineKey(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return JSON.parse(plain);
  } catch {
    return {};
  }
}

function writeFileStore(store: Record<string, string>): void {
  mkdirSync(oscHome(), { recursive: true });
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', machineKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(store), 'utf8'), cipher.final()]);
  const out = Buffer.concat([iv, cipher.getAuthTag(), data]);
  writeFileSync(filePath(), out, { mode: 0o600 });
  chmodSync(filePath(), 0o600);
}

export function storeBackend(): StoreBackend {
  return hasSecretTool() ? 'keychain' : 'encrypted-file';
}

export interface CredentialRead {
  value: string | undefined;
  /**
   * True when a keychain is present but could not be read (locked/errored), so
   * `value === undefined` does NOT prove the credential is absent. Callers that
   * would otherwise mint a fresh secret must treat this as "unknown" and refuse
   * to mint (B1).
   */
  keychainUnreadable: boolean;
}

/** Read a credential, surfacing whether the keychain itself was unreadable. */
export function readCredential(name: string): CredentialRead {
  const kc = keychainLookup(name);
  if (kc.status === 'found') return { value: kc.value, keychainUnreadable: false };
  // The keychain had nothing (or could not be read); the file store may still
  // hold a legacy or file-backed key.
  return { value: readFileStore()[name], keychainUnreadable: kc.status === 'unreadable' };
}

export function getCredential(name: string): string | undefined {
  return readCredential(name).value;
}

export function setCredential(name: string, value: string): StoreBackend {
  if (fakeKeychain) {
    if (!fakeKeychain.locked) {
      fakeKeychain.entries.set(name, value);
      return 'keychain';
    }
    // A locked keychain cannot accept a write; fall through to the file store.
  } else if (hasSecretTool()) {
    const res = spawnSync(
      'secret-tool',
      ['store', '--label', `OS Code (${name})`, 'service', 'os-code', 'key', name],
      { input: value, encoding: 'utf8' },
    );
    if (res.status === 0) return 'keychain';
  }
  const store = readFileStore();
  store[name] = value;
  writeFileStore(store);
  return 'encrypted-file';
}

export function deleteCredential(name: string): void {
  if (fakeKeychain) {
    fakeKeychain.entries.delete(name);
  } else if (hasSecretTool()) {
    spawnSync('secret-tool', ['clear', 'service', 'os-code', 'key', name], { stdio: 'ignore' });
  }
  const store = readFileStore();
  if (name in store) {
    delete store[name];
    writeFileStore(store);
  }
}

export function credentialsFileExists(): boolean {
  return existsSync(filePath());
}
