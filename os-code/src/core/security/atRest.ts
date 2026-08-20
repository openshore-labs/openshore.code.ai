// At-rest sealing for the engine's own files: AES-256-GCM in exactly the
// app-side format (app/src/lib/crypto.ts), `enc:v1:<b64url(iv)>:<b64url(ct+tag)>`,
// so a blob sealed by either side opens on the other. WebCrypto emits
// ciphertext||tag as one buffer; node:crypto keeps them separate, so seal
// concatenates and open splits the last 16 bytes back off.
//
// The data key rides the existing credential store (auth/store.ts): the OS
// keychain via secret-tool when the desktop has one, else the machine-keyed
// encrypted file. Which backend holds the key is reported honestly, because the
// Stack Health seal only claims full marks on a real keychain.
//
// Readers tolerate plaintext (a value that predates encryption passes through)
// and a failed decrypt returns null rather than destroying data.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, rmdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { oscHome } from '../../config/load.js';
import { getCredential, setCredential, storeBackend, type StoreBackend } from '../../auth/store.js';

const PREFIX = 'enc:v1:';
const DATA_KEY_NAME = 'data-key';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type KeyProtection = StoreBackend; // 'keychain' | 'encrypted-file'

export interface DataKey {
  key: Buffer;
  protection: KeyProtection;
}

function toB64Url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

function fromB64Url(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

/** True if a stored string is one of our sealed blobs. */
export function isSealed(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** Seal a plaintext string with a fresh IV. */
export function sealString(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const withTag = Buffer.concat([ct, cipher.getAuthTag()]);
  return `${PREFIX}${toB64Url(iv)}:${toB64Url(withTag)}`;
}

/**
 * Open a stored value. Plaintext passes through unchanged so data that
 * predates encryption still reads. A sealed value that fails to decrypt
 * returns null; the caller must NOT delete it, so a transient key problem
 * never loses data.
 */
export function openString(key: Buffer, value: string): string | null {
  if (!isSealed(value)) return value;
  const [ivPart, ctPart] = value.slice(PREFIX.length).split(':');
  if (!ivPart || !ctPart) return null;
  try {
    const iv = fromB64Url(ivPart);
    const withTag = fromB64Url(ctPart);
    if (withTag.length < TAG_BYTES) return null;
    const ct = withTag.subarray(0, withTag.length - TAG_BYTES);
    const tag = withTag.subarray(withTag.length - TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

let cached: DataKey | undefined;

function safeBackend(): StoreBackend {
  try {
    return storeBackend();
  } catch {
    return 'encrypted-file';
  }
}

/** Synchronous bounded sleep for the first-run wait loop (Node permits
 *  Atomics.wait on the main thread). */
function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const CREATE_LOCK_STALE_MS = 10_000;

/**
 * O_EXCL-style cross-process lock around first-run key creation. Returns a
 * release function, or undefined when another live process holds it. A lock
 * left behind by a crashed creator goes stale after ten seconds and is broken.
 */
function acquireCreateLock(): (() => void) | undefined {
  const lock = join(oscHome(), 'data-key.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(lock);
      return () => {
        try {
          rmdirSync(lock);
        } catch {}
      };
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > CREATE_LOCK_STALE_MS) {
          rmdirSync(lock);
          continue;
        }
      } catch {}
      return undefined;
    }
  }
  return undefined;
}

/**
 * The engine's data-encryption key, created on first use and cached for the
 * process. One key per environment (per OSC_HOME), shared by every engine
 * entrypoint (Electron host, daemon, CLI) so any of them can read what any
 * other sealed. Returns undefined only when no key can be read, adopted, or
 * created this run, in which case callers write plaintext rather than losing
 * data (and the seal reports it).
 */
export function loadOrCreateDataKey(): DataKey | undefined {
  if (cached) return cached;

  let raw: string | undefined;
  try {
    raw = getCredential(DATA_KEY_NAME);
  } catch {
    return undefined;
  }

  let protection: StoreBackend;
  if (raw) {
    // Existing key: re-store so it migrates up into a keychain when one
    // appears and the reported backend is the one that actually holds it. A
    // failed re-store must never discard a key that was just read; degrade to
    // the current backend's best guess instead.
    try {
      protection = setCredential(DATA_KEY_NAME, raw);
    } catch {
      protection = safeBackend();
    }
  } else {
    // First run. Another engine process (the CLI daemon and the desktop app,
    // say) may be first-running at the same moment, and two generated keys
    // would strand whatever the loser sealed. Creation happens under an
    // exclusive cross-process lock; a process that loses the lock waits
    // briefly for the winner's key and adopts it.
    try {
      mkdirSync(oscHome(), { recursive: true });
    } catch {}
    const release = acquireCreateLock();
    if (release) {
      try {
        try {
          raw = getCredential(DATA_KEY_NAME); // re-check inside the lock
        } catch {}
        if (raw) {
          protection = safeBackend();
        } else {
          const fresh = randomBytes(32).toString('base64url');
          try {
            protection = setCredential(DATA_KEY_NAME, fresh);
          } catch {
            return undefined;
          }
          // Adopt whatever the store reads back: if a racer slipped past a
          // broken stale lock, the store's winner is the one true key.
          try {
            raw = getCredential(DATA_KEY_NAME) ?? fresh;
          } catch {
            raw = fresh;
          }
        }
      } finally {
        release();
      }
    } else {
      for (let i = 0; i < 100 && !raw; i++) {
        sleepMs(20);
        try {
          raw = getCredential(DATA_KEY_NAME);
        } catch {}
      }
      if (!raw) return undefined; // could not create nor adopt this run
      protection = safeBackend();
    }
  }

  const key = fromB64Url(raw);
  if (key.length !== 32) return undefined;
  cached = { key, protection };
  return cached;
}

/** Test seam: forget the cached key (tests swap OSC_HOME between cases). */
export function _resetDataKeyCache(): void {
  cached = undefined;
}
