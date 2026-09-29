// Daemon control-channel authentication. Tailscale reachability is transport,
// not authorization: every daemon request carries a bearer token that lives
// only on the user's own machines.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { oscHome } from '../../config/load.js';
import {
  loadCredentials,
  resolveDeviceCredential,
  type AuthContext,
  type Role,
} from './credentials.js';

export type { AuthContext, Role } from './credentials.js';

export function generateToken(): string {
  return `osc_${randomBytes(32).toString('base64url')}`;
}

/** Load the daemon token, creating one (mode 600) on first use. */
export function loadOrCreateToken(tokenPath: string): string {
  if (existsSync(tokenPath)) {
    return readFileSync(tokenPath, 'utf8').trim();
  }
  const token = generateToken();
  mkdirSync(dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
  return token;
}

/** Where the legacy shared token lives. */
export function sharedTokenPath(): string {
  return join(oscHome(), 'daemon.token');
}

/**
 * Replace the legacy shared token with a fresh one (`osc token rotate`, the
 * desktop's button). Written to a temp file and renamed over the old one, so
 * a reader never sees half a token. A running daemon picks the new one up on
 * its next request (sharedTokenReader); anything still presenting the old one
 * is refused from then on.
 */
export function rotateSharedToken(tokenPath = sharedTokenPath()): void {
  mkdirSync(dirname(tokenPath), { recursive: true });
  const tmp = `${tokenPath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, `${generateToken()}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, tokenPath);
}

/**
 * The shared token as the daemon checks it: read again whenever the file
 * changes on disk (a rotate from the CLI or the desktop), otherwise from
 * memory, so a rotate takes effect without a restart.
 */
export function sharedTokenReader(tokenPath = sharedTokenPath()): () => string {
  let cached: { stamp: string; token: string } | undefined;
  const stampOf = (): string => {
    try {
      const st = statSync(tokenPath);
      return `${st.ino}:${st.size}:${st.mtimeMs}`;
    } catch {
      return '';
    }
  };
  return () => {
    const stamp = stampOf();
    if (cached && stamp && cached.stamp === stamp) return cached.token;
    const token = loadOrCreateToken(tokenPath);
    cached = { stamp: stampOf(), token };
    return token;
  };
}

/** Whether a request came from this computer itself, judged by the address
 *  of the socket it arrived on (never a header). */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  return a === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

/** Constant-time comparison so the token cannot be guessed byte by byte. */
export function tokenMatches(presented: string | undefined, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Extract a bearer token from an Authorization header value. */
export function bearerFrom(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : undefined;
}

/**
 * Once any device has its own credential, the shared token is honored only
 * from this computer itself (H1): the phones have moved to per-device pairing,
 * so the one token that cannot be revoked per device no longer opens the door
 * from the tailnet. `from` is the socket's remote address; without it (a
 * caller that is not a network request) the shared token is judged as before.
 */
export function legacyTokenRefused(from: string | undefined): boolean {
  if (from === undefined || isLoopbackAddress(from)) return false;
  return loadCredentials().length > 0;
}

/**
 * Resolve a presented token to who is calling and what they may do. Checked in
 * order: the legacy shared token (implicit admin, kept working through the
 * migration so an un-repaired phone is never stranded, and from this computer
 * alone once any device is paired on its own, see legacyTokenRefused), then a
 * minted per-user device credential. A Supabase-verified JWT will slot in as a
 * third source. Returns null when nothing matches (the caller answers 401).
 */
export function resolveAuth(
  presented: string | undefined,
  legacyToken: string,
  opts: { from?: string } = {},
): AuthContext | null {
  if (!presented) return null;
  if (tokenMatches(presented, legacyToken)) {
    if (legacyTokenRefused(opts.from)) return null;
    return { userId: 'legacy', role: 'admin', label: 'shared token', source: 'legacy' };
  }
  return resolveDeviceCredential(presented) ?? null;
}

/** Does this context hold at least the required role? admin outranks member. */
export function hasRole(ctx: AuthContext, required: Role): boolean {
  if (required === 'member') return true;
  return ctx.role === 'admin';
}

/**
 * The daemon may bind loopback or a Tailscale-interface address only.
 * Binding every interface is refused, hard, with no override flag.
 */
export function assertSafeBind(host: string): void {
  const banned = ['0.0.0.0', '::', '*', ''];
  if (banned.includes(host)) {
    throw new Error(
      `Refusing to bind ${host || '(all interfaces)'}. The daemon serves loopback or your tailnet address only. Use --bind loopback or --bind tailscale.`,
    );
  }
}
