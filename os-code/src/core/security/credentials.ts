// Per-user daemon credentials. The daemon used to hold one shared token, so it
// could not tell one paired device from another and could not enforce roles.
// This store mints an opaque token per device, each carrying a userId and a
// role, so the daemon resolves WHO is calling and WHAT they may do. Tokens are
// stored only as SHA-256 hashes (mode 600), compared in constant time, and can
// carry an expiry. It works with zero backend (an admin mints on the desktop
// and hands the token to the member in the pair flow); a Supabase-verified JWT
// is a second, later source that resolves to the same AuthContext shape.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { oscHome } from '../../config/load.js';

export type Role = 'admin' | 'member';

export interface AuthContext {
  userId: string;
  role: Role;
  label: string;
  source: 'legacy' | 'device' | 'jwt';
}

export interface DeviceCredential {
  tokenHash: string;
  userId: string;
  role: Role;
  label: string;
  createdAt: string;
  /** ISO expiry; absent means it never expires. */
  expiresAt?: string;
}

export function credentialsPath(): string {
  return join(oscHome(), 'daemon-credentials.json');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function loadCredentials(): DeviceCredential[] {
  const path = credentialsPath();
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { credentials?: DeviceCredential[] };
    return Array.isArray(parsed.credentials) ? parsed.credentials : [];
  } catch {
    return [];
  }
}

function saveCredentials(credentials: DeviceCredential[]): void {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ credentials }, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

export interface MintOptions {
  role: Role;
  label: string;
  userId?: string;
  ttlDays?: number;
}

/** Mint a new device credential. Returns the clear token ONCE (never stored). */
export function mintCredential(opts: MintOptions): { token: string; credential: DeviceCredential } {
  const token = `osc_${randomBytes(32).toString('base64url')}`;
  const credential: DeviceCredential = {
    tokenHash: hashToken(token),
    userId: opts.userId ?? `user_${randomBytes(6).toString('hex')}`,
    role: opts.role,
    label: opts.label,
    createdAt: new Date().toISOString(),
    expiresAt: opts.ttlDays
      ? new Date(Date.now() + opts.ttlDays * 86_400_000).toISOString()
      : undefined,
  };
  saveCredentials([...loadCredentials(), credential]);
  return { token, credential };
}

/** Revoke by label or by a token-hash prefix (the CLI's `osc token revoke`).
 *  Returns how many were removed. An empty or blank match removes nothing:
 *  every hash starts with the empty string, so it would cut every device. */
export function revokeCredential(match: string): number {
  if (!match.trim()) return 0;
  const before = loadCredentials();
  const after = before.filter((c) => c.label !== match && !c.tokenHash.startsWith(match));
  if (after.length !== before.length) saveCredentials(after);
  return before.length - after.length;
}

/** A credential's handle as the desktop's revoke list carries it: the whole
 *  SHA-256 token hash, 64 lowercase hex characters. */
export function isTokenHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** Revoke exactly one device by its whole token hash (the desktop's revoke
 *  list). Never a prefix and never a label, so one tap cuts one device.
 *  Returns how many were removed: 0 or 1. */
export function revokeCredentialByHash(tokenHash: string): number {
  if (!isTokenHash(tokenHash)) return 0;
  const before = loadCredentials();
  const after = before.filter((c) => c.tokenHash !== tokenHash);
  if (after.length !== before.length) saveCredentials(after);
  return before.length - after.length;
}

function notExpired(cred: DeviceCredential, now = Date.now()): boolean {
  return !cred.expiresAt || Date.parse(cred.expiresAt) > now;
}

/** Resolve a presented token to its credential, constant-time and expiry-aware. */
export function resolveDeviceCredential(presented: string): AuthContext | undefined {
  const presentedHash = Buffer.from(hashToken(presented));
  for (const cred of loadCredentials()) {
    const stored = Buffer.from(cred.tokenHash);
    if (
      stored.length === presentedHash.length &&
      timingSafeEqual(stored, presentedHash) &&
      notExpired(cred)
    ) {
      return { userId: cred.userId, role: cred.role, label: cred.label, source: 'device' };
    }
  }
  return undefined;
}
