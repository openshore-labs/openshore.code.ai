// osc token: mint, list, and revoke per-user daemon credentials. An admin runs
// `osc token mint --role member --label "Alice iPhone"` on the desktop, then
// hands the printed token to that person to paste when they pair. The daemon
// resolves each token to a user and a role, so admin-only actions can be
// enforced server-side instead of trusting the client.
import { t } from '../brand/theme.js';
import {
  loadCredentials,
  mintCredential,
  revokeCredential,
  type Role,
} from '../core/security/credentials.js';
import { header, okLine, out, warnLine } from './util.js';

function parseRole(role?: string): Role {
  return role === 'admin' ? 'admin' : 'member';
}

export function tokenMintCommand(options: { role?: string; label?: string; ttl?: string }): void {
  const role = parseRole(options.role);
  const label = options.label?.trim() || `${role} device`;
  const ttlDays = options.ttl ? Number(options.ttl) : undefined;
  const { token, credential } = mintCredential({ role, label, ttlDays });

  header('New daemon credential');
  okLine(`role   ${credential.role}`);
  okLine(`label  ${credential.label}`);
  if (credential.expiresAt) okLine(`expires ${credential.expiresAt.slice(0, 10)}`);
  out();
  out(t.bold('Paste this token on the paired device. It is shown once:'));
  out(t.local(token));
  out();
  out(t.muted('It is stored here only as a hash; you cannot recover it later, only mint a new one.'));
}

export function tokenListCommand(): void {
  const creds = loadCredentials();
  header('Daemon credentials');
  if (!creds.length) {
    warnLine('None minted yet. The shared token still works as admin. Run osc token mint to add one.');
    return;
  }
  for (const c of creds) {
    const exp = c.expiresAt ? ` expires ${c.expiresAt.slice(0, 10)}` : '';
    okLine(`${c.role.padEnd(6)} ${c.label}  ${t.muted(`${c.tokenHash.slice(0, 8)}${exp}`)}`);
  }
}

export function tokenRevokeCommand(match: string): void {
  const removed = revokeCredential(match);
  if (removed > 0) okLine(`Revoked ${removed} credential${removed > 1 ? 's' : ''}.`);
  else warnLine('Nothing matched that label or token-hash prefix. Run osc token list.');
}
