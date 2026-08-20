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
import { getCredential, setCredential, type StoreBackend } from '../../auth/store.js';

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

/**
 * The engine's data-encryption key, created on first use and cached for the
 * process. One key per environment (per OSC_HOME), shared by every engine
 * entrypoint (Electron host, daemon, CLI) so any of them can read what any
 * other sealed. Returns undefined only if the credential store itself fails,
 * in which case callers write plaintext rather than losing data.
 */
export function loadOrCreateDataKey(): DataKey | undefined {
  if (cached) return cached;
  try {
    let raw = getCredential(DATA_KEY_NAME);
    if (!raw) {
      raw = randomBytes(32).toString('base64url');
    }
    // Always (re)store: setCredential reports the backend that actually holds
    // the key, and a key that predates the keychain migrates up into it the
    // first time one is available. Honest protection, not assumed protection.
    const protection = setCredential(DATA_KEY_NAME, raw);
    const key = fromB64Url(raw);
    if (key.length !== 32) return undefined;
    cached = { key, protection };
    return cached;
  } catch {
    return undefined;
  }
}

/** Test seam: forget the cached key (tests swap OSC_HOME between cases). */
export function _resetDataKeyCache(): void {
  cached = undefined;
}
