// Credential storage. Preference order:
//   1. The OS keychain via `secret-tool` (libsecret), when the desktop has it.
//   2. An encrypted file at ~/.os-code/credentials (AES-256-GCM, key derived
//      from the machine identity, mode 600).
// The file path is honest obfuscation, not a vault: it keeps keys out of
// plain text and out of accidental backups/greps, and the docs say exactly
// that. Nothing ever leaves the machine.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { oscHome } from '../config/load.js';

export type StoreBackend = 'keychain' | 'encrypted-file';

let secretToolChecked: boolean | undefined;

function hasSecretTool(): boolean {
  if (secretToolChecked === undefined) {
    secretToolChecked = spawnSync('secret-tool', ['--help'], { stdio: 'ignore' }).status === 0;
  }
  return secretToolChecked;
}

/** Test seam. */
export function _setSecretTool(v: boolean | undefined): void {
  secretToolChecked = v;
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

export function getCredential(name: string): string | undefined {
  if (hasSecretTool()) {
    const res = spawnSync('secret-tool', ['lookup', 'service', 'os-code', 'key', name], {
      encoding: 'utf8',
    });
    if (res.status === 0 && res.stdout) return res.stdout.trim() || undefined;
    // Fall through: the key may predate the keychain, or lookup failed.
  }
  return readFileStore()[name];
}

export function setCredential(name: string, value: string): StoreBackend {
  if (hasSecretTool()) {
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
  if (hasSecretTool()) {
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
