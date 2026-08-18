// Daemon control-channel authentication. Tailscale reachability is transport,
// not authorization: every daemon request carries a bearer token that lives
// only on the user's own machines.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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
