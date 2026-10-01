// osc token: mint, list, and revoke per-user daemon credentials, and rotate
// the legacy shared token. An admin runs
// `osc token mint --role member --label "Alice iPhone"` on the desktop, then
// hands the printed token to that person to paste when they pair. The daemon
// resolves each token to a user and a role, so admin-only actions can be
// enforced server-side instead of trusting the client. Every credential ends
// after DEVICE_CREDENTIAL_TTL_DAYS unless --ttl says otherwise (H1).
import { t } from '../brand/theme.js';
import {
  DEVICE_CREDENTIAL_TTL_DAYS,
  credentialExpiresAt,
  loadCredentials,
  mintCredential,
  revokeCredential,
  type Role,
} from '../core/security/credentials.js';
import { rotateSharedToken } from '../core/security/daemonAuth.js';
import { header, okLine, out, warnLine } from './util.js';

function parseRole(role?: string): Role {
  return role === 'admin' ? 'admin' : 'member';
}

export function tokenMintCommand(options: { role?: string; label?: string; ttl?: string }): void {
  const role = parseRole(options.role);
  const label = options.label?.trim() || `${role} device`;
  let ttlDays: number | undefined;
  if (options.ttl !== undefined) {
    const asked = Number(options.ttl);
    if (Number.isInteger(asked) && asked > 0) ttlDays = asked;
    else warnLine(`--ttl takes a whole number of days; using ${DEVICE_CREDENTIAL_TTL_DAYS}.`);
  }
  const { token, credential } = mintCredential({ role, label, ttlDays });

  header('New daemon credential');
  okLine(`role   ${credential.role}`);
  okLine(`label  ${credential.label}`);
  if (credential.expiresAt) okLine(`expires ${credential.expiresAt.slice(0, 10)}`);
  out();
  out(t.bold('Paste this token on the paired device. It is shown once:'));
  out(t.local(token));
  out();
  out(
    t.muted('It is stored here only as a hash; you cannot recover it later, only mint a new one.'),
  );
}

export function tokenListCommand(): void {
  const creds = loadCredentials();
  header('Daemon credentials');
  if (!creds.length) {
    warnLine(
      'None minted yet. The shared token still works as admin. Run osc token mint to add one.',
    );
    return;
  }
  const now = Date.now();
  for (const c of creds) {
    const ends = credentialExpiresAt(c);
    const exp = Date.parse(ends) > now ? ` expires ${ends.slice(0, 10)}` : ' expired';
    okLine(`${c.role.padEnd(6)} ${c.label}  ${t.muted(`${c.tokenHash.slice(0, 8)}${exp}`)}`);
  }
}

export function tokenRevokeCommand(match: string): void {
  const removed = revokeCredential(match);
  if (removed > 0) okLine(`Revoked ${removed} credential${removed > 1 ? 's' : ''}.`);
  else warnLine('Nothing matched that label or token-hash prefix. Run osc token list.');
}

/** Replace the legacy shared token (~/.os-code/daemon.token) with a new one.
 *  A running daemon takes the new one on its next request; the old one opens
 *  nothing from then on. The token itself is never printed. */
export function tokenRotateCommand(): void {
  try {
    rotateSharedToken();
  } catch (err) {
    warnLine(`Could not replace the shared token: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }
  okLine('Replaced the shared token at ~/.os-code/daemon.token.');
  out(
    t.muted(
      '  Tools on this computer read the new one on their own. A device that still used the old one pairs again from Pairing.',
    ),
  );
}
