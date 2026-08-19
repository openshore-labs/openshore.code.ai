// AES-256-GCM sealing for data at rest. This module is pure: it knows how to
// turn a key plus a string into a sealed blob and back, and nothing about where
// the key lives (platform.ts owns that). The sealed format is
// `enc:v1:<b64url(iv)>:<b64url(ciphertext+tag)>`. Readers tolerate plaintext,
// so a device that predates encryption migrates in place, and a failed decrypt
// returns null rather than destroying the stored value.
const PREFIX = 'enc:v1:';

function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function utf8(s: string): Uint8Array<ArrayBuffer> {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return out;
}

/** True if a stored string is one of our sealed blobs. */
export function isSealed(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** A fresh random 256-bit key, encoded for the secret store. */
export function generateRawDek(): string {
  return toB64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Import a stored raw key into a non-extractable AES-GCM CryptoKey. */
export async function importDek(rawB64Url: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromB64Url(rawB64Url), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Seal a plaintext string with a fresh IV. */
export async function seal(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8(plaintext)),
  );
  return `${PREFIX}${toB64Url(iv)}:${toB64Url(ct)}`;
}

/**
 * Open a stored value. Plaintext (unsealed) passes through unchanged so old
 * data still reads. A sealed value that fails to decrypt returns null; the
 * caller must NOT delete it, so a transient key problem never loses data.
 */
export async function open(key: CryptoKey, value: string): Promise<string | null> {
  if (!isSealed(value)) return value;
  const [ivPart, ctPart] = value.slice(PREFIX.length).split(':');
  if (!ivPart || !ctPart) return null;
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64Url(ivPart) },
      key,
      fromB64Url(ctPart),
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
