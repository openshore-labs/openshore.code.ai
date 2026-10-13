// Credential storage. Preference order:
//   1. The OS keychain via `secret-tool` (libsecret), when the desktop has it.
//   2. An encrypted file at ~/.os-code/credentials (AES-256-GCM, mode 600)
//      whose key is a random 32-byte file key held by the OS: the macOS
//      Keychain (`security`), Windows DPAPI for this user (PowerShell), so a
//      copy of ~/.os-code alone opens nothing (tech review security review 2026-10-01,
//      F2). Where neither exists (Linux without libsecret) the key is derived
//      from the machine identity, the old scheme, and the docs say so.
// A file written under the old hostname-derived key is read once and
// rewritten under the OS-held key. Nothing ever leaves the machine.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { oscHome } from '../config/load.js';

export type StoreBackend = 'keychain' | 'encrypted-file';

/** Where the encrypted file's key lives. */
export type FileKeyHolder = 'macos-keychain' | 'windows-dpapi' | 'machine-derived';

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

/** A file written under an OS-held key starts with this; the old format has
 *  no header (a 12-byte IV first). */
const V2_MAGIC = Buffer.from('OSC2');

// --- The OS-held file key -------------------------------------------------
// One random 32-byte key per machine user, held by the OS secret store. Read
// once per process and cached. `unreadable` (a locked keychain, a failing
// PowerShell) is never treated as `absent`: a fresh key would orphan the file.

type FileKeyOutcome =
  { status: 'found'; key: Buffer } | { status: 'absent' } | { status: 'unreadable' };

interface FileKeyProvider {
  holder: Exclude<FileKeyHolder, 'machine-derived'>;
  load(): FileKeyOutcome;
  /** Store a new key; false when the OS refused. */
  save(key: Buffer): boolean;
}

const MAC_SERVICE = 'os-code';
const MAC_ACCOUNT = 'credentials-file-key';

const macKeychain: FileKeyProvider = {
  holder: 'macos-keychain',
  load() {
    const res = spawnSync(
      'security',
      ['find-generic-password', '-s', MAC_SERVICE, '-a', MAC_ACCOUNT, '-w'],
      { encoding: 'utf8' },
    );
    if (res.status === 0) {
      const hex = (res.stdout ?? '').trim();
      return /^[0-9a-f]{64}$/.test(hex)
        ? { status: 'found', key: Buffer.from(hex, 'hex') }
        : { status: 'unreadable' };
    }
    // 44 is errSecItemNotFound; anything else (a locked keychain, a denied
    // prompt) is a keychain that could not be read.
    return res.status === 44 ? { status: 'absent' } : { status: 'unreadable' };
  },
  save(key) {
    // Through `security -i` on stdin, so the key never sits in a process's
    // argument list where another process could read it.
    const res = spawnSync('security', ['-i'], {
      input: `add-generic-password -U -s ${MAC_SERVICE} -a ${MAC_ACCOUNT} -l "OpenShore credentials" -w ${key.toString('hex')}\n`,
      encoding: 'utf8',
    });
    return res.status === 0 && macKeychain.load().status === 'found';
  },
};

function dpapiPath(): string {
  return join(oscHome(), 'credentials.key');
}

function powershell(script: string, input: string): string | undefined {
  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input,
    encoding: 'utf8',
    windowsHide: true,
  });
  return res.status === 0 ? (res.stdout ?? '').trim() : undefined;
}

const DPAPI_UNPROTECT =
  "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser')))";
const DPAPI_PROTECT =
  "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser')))";

const windowsDpapi: FileKeyProvider = {
  holder: 'windows-dpapi',
  load() {
    let wrapped: string;
    try {
      wrapped = readFileSync(dpapiPath(), 'utf8').trim();
    } catch {
      return { status: 'absent' };
    }
    const out = powershell(DPAPI_UNPROTECT, wrapped);
    if (!out) return { status: 'unreadable' };
    const key = Buffer.from(out, 'base64');
    return key.length === 32 ? { status: 'found', key } : { status: 'unreadable' };
  },
  save(key) {
    const out = powershell(DPAPI_PROTECT, key.toString('base64'));
    if (!out) return false;
    mkdirSync(oscHome(), { recursive: true });
    writeFileSync(dpapiPath(), out, { mode: 0o600 });
    return windowsDpapi.load().status === 'found';
  },
};

let providerOverride: FileKeyProvider | null | undefined;
let cachedFileKey: { key: Buffer; holder: FileKeyHolder } | undefined;

/** Test seam: an in-memory provider, `null` for none (the old scheme), or
 *  undefined to restore the platform's own. Clears the cached key. */
export function _setFileKeyProvider(
  fake:
    | {
        holder?: 'macos-keychain' | 'windows-dpapi';
        key?: Buffer;
        locked?: boolean;
        refuseSave?: boolean;
      }
    | null
    | undefined,
): void {
  cachedFileKey = undefined;
  if (fake === undefined || fake === null) {
    providerOverride = fake;
    return;
  }
  const state = { key: fake.key, locked: fake.locked ?? false };
  providerOverride = {
    holder: fake.holder ?? 'macos-keychain',
    load: () =>
      state.locked
        ? { status: 'unreadable' }
        : state.key
          ? { status: 'found', key: state.key }
          : { status: 'absent' },
    save: (key) => {
      if (state.locked || fake.refuseSave) return false;
      state.key = key;
      return true;
    },
  };
}

function platformProvider(): FileKeyProvider | undefined {
  if (providerOverride !== undefined) return providerOverride ?? undefined;
  if (process.platform === 'darwin') return macKeychain;
  if (process.platform === 'win32') return windowsDpapi;
  return undefined;
}

/** The key for the encrypted file: the OS-held one, created on first use, or
 *  the machine-derived one where the OS holds none. `unreadable` when the OS
 *  store exists but could not be read. */
function fileKey(): { key: Buffer; holder: FileKeyHolder } | 'unreadable' {
  if (cachedFileKey) return cachedFileKey;
  const provider = platformProvider();
  if (!provider) return (cachedFileKey = { key: machineKey(), holder: 'machine-derived' });
  const found = provider.load();
  if (found.status === 'found')
    return (cachedFileKey = { key: found.key, holder: provider.holder });
  if (found.status === 'unreadable') return 'unreadable';
  const fresh = randomBytes(32);
  if (provider.save(fresh)) return (cachedFileKey = { key: fresh, holder: provider.holder });
  // The OS would not hold a key: keep working on the old scheme rather than
  // lose the credentials, and say so in fileKeyHolder().
  return (cachedFileKey = { key: machineKey(), holder: 'machine-derived' });
}

/** Where the encrypted file's key lives on this machine, for doctor and the
 *  privacy copy. */
export function fileKeyHolder(): FileKeyHolder | 'unreadable' {
  const k = fileKey();
  return k === 'unreadable' ? 'unreadable' : k.holder;
}

function decrypt(key: Buffer, body: Buffer): Record<string, string> {
  const iv = body.subarray(0, 12);
  const tag = body.subarray(12, 28);
  const data = body.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(plain) as Record<string, string>;
}

interface FileRead {
  store: Record<string, string>;
  /** The file exists but its key could not be read: callers must not treat
   *  a missing entry as absent (B1). */
  unreadable: boolean;
}

function readFileStoreDetailed(): FileRead {
  let raw: Buffer;
  try {
    raw = readFileSync(filePath());
  } catch {
    return { store: {}, unreadable: false };
  }
  if (raw.subarray(0, 4).equals(V2_MAGIC)) {
    const k = fileKey();
    if (k === 'unreadable') return { store: {}, unreadable: true };
    try {
      return { store: decrypt(k.key, raw.subarray(4)), unreadable: false };
    } catch {
      return { store: {}, unreadable: true };
    }
  }
  // The old format, under the machine-derived key: read it, and move it under
  // the OS-held key when there is one.
  let store: Record<string, string>;
  try {
    store = decrypt(machineKey(), raw);
  } catch {
    return { store: {}, unreadable: false };
  }
  const k = fileKey();
  if (k !== 'unreadable' && k.holder !== 'machine-derived') {
    try {
      writeFileStore(store);
    } catch {
      // The migration retries on the next read; the values are already read.
    }
  }
  return { store, unreadable: false };
}

function writeFileStore(store: Record<string, string>): void {
  const k = fileKey();
  if (k === 'unreadable') {
    throw new Error(
      "This computer's keychain is locked, so OpenShore cannot save the key. Unlock it and try again.",
    );
  }
  mkdirSync(oscHome(), { recursive: true });
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k.key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(store), 'utf8'), cipher.final()]);
  const body = Buffer.concat([iv, cipher.getAuthTag(), data]);
  // The machine-derived key keeps the old headerless format, so an older
  // engine on the same machine still reads it.
  const out = k.holder === 'machine-derived' ? body : Buffer.concat([V2_MAGIC, body]);
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
  // hold a legacy or file-backed key. A file whose OS-held key could not be
  // read counts as an unreadable keychain too (B1).
  const file = readFileStoreDetailed();
  return {
    value: file.store[name],
    keychainUnreadable: kc.status === 'unreadable' || file.unreadable,
  };
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
  const file = readFileStoreDetailed();
  // Never rewrite a file this process could not read: that would drop every
  // key in it but this one.
  if (file.unreadable) {
    throw new Error(
      "This computer's keychain is locked, so OpenShore cannot save the key. Unlock it and try again.",
    );
  }
  file.store[name] = value;
  writeFileStore(file.store);
  return 'encrypted-file';
}

export function deleteCredential(name: string): void {
  if (fakeKeychain) {
    fakeKeychain.entries.delete(name);
  } else if (hasSecretTool()) {
    spawnSync('secret-tool', ['clear', 'service', 'os-code', 'key', name], { stdio: 'ignore' });
  }
  const file = readFileStoreDetailed();
  if (!file.unreadable && name in file.store) {
    delete file.store[name];
    writeFileStore(file.store);
  }
}

/**
 * The names of the credentials kept here that start with `prefix`, never
 * their values (keys on your server, 2026-10-09: forgetting a server deletes
 * every provider key, a stray one included). `unreadable` when the file, or
 * the test keychain, could not be read, so an empty list never reads as
 * "none". A real keychain is searched by attribute; a search that fails
 * leaves its names out, and the per-name reads say whether it is locked.
 */
export function storedCredentialNames(prefix: string): { names: string[]; unreadable: boolean } {
  const names = new Set<string>();
  let unreadable = false;
  if (fakeKeychain) {
    if (fakeKeychain.locked) unreadable = true;
    else for (const name of fakeKeychain.entries.keys()) names.add(name);
  } else if (hasSecretTool()) {
    // Only the `attribute.key = <name>` lines are read; the rest (the values
    // among them) is dropped with the buffer.
    const res = spawnSync('secret-tool', ['search', '--all', 'service', 'os-code'], {
      encoding: 'utf8',
    });
    if (res.status === 0) {
      for (const m of (res.stdout ?? '').matchAll(/^attribute\.key = (\S+)$/gm)) names.add(m[1]!);
    }
  }
  const file = readFileStoreDetailed();
  if (file.unreadable) unreadable = true;
  for (const name of Object.keys(file.store)) names.add(name);
  return { names: [...names].filter((n) => n.startsWith(prefix)).sort(), unreadable };
}

export function credentialsFileExists(): boolean {
  return existsSync(filePath());
}
