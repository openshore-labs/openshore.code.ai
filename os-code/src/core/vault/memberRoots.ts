// Whose vault a caller works on (Vault M5, tech review J7, J8). One machine, one
// owner's vault (the machine config's vault.dir, ~/OSCode/Vault by default),
// and on a shared hub one private root per member, so a member's phone, a
// member's agent, and a member's Crew notes land in that member's own folder
// and never in the owner's.
//
// A member's root is oscHome()/vaults/members/<sha256(userId), 16 hex>, mode
// 0700, made on first use. It sits outside ~/OSCode and so outside every
// admin-provisioned workspace (a member may only open a session under
// ~/OSCode), and the daemon also refuses a member workspace that overlaps
// any root (workspaces.ts overlapsVault).
//
// Honesty (plan 0.13): these roots keep the daemon's own routes and a
// member's agent tools apart. They are not a wall against a member's own
// approved shell command on the same computer, so no copy may say members
// cannot see each other's notes.
//
// When the JWT AuthContext lands, only this helper and the daemon's
// ownerHoldsAdmin change.
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureVaultRoot, loadVaultDir, oscHome } from '../../config/load.js';
import { loadCredentials, type AuthContext } from '../security/credentials.js';

/** The folder every member root lives in. */
export function memberVaultsDir(): string {
  return join(oscHome(), 'vaults', 'members');
}

/** A member's own root: the first 16 hex digits of sha256(userId). */
export function memberVaultRoot(userId: string): string {
  const key = createHash('sha256').update(userId, 'utf8').digest('hex').slice(0, 16);
  return join(memberVaultsDir(), key);
}

/** The machine owner's vault (the machine config's vault.dir). */
export function ownerVaultRoot(): string {
  return loadVaultDir().dir;
}

/** Whether a stored owner holds admin: no recorded owner and the legacy shared
 *  token are the machine owner; anyone else is judged by their credential. */
export function ownerIsAdmin(userId: string | undefined): boolean {
  if (userId === undefined || userId === 'legacy') return true;
  return loadCredentials().some((c) => c.userId === userId && c.role === 'admin');
}

/** The vault root for a caller: an admin (and the legacy shared token, which
 *  resolves as admin) gets the owner's vault, a member their own. */
export function vaultRootFor(auth: Pick<AuthContext, 'userId' | 'role'>): string {
  if (auth.role === 'admin') return ownerVaultRoot();
  return memberVaultRoot(auth.userId);
}

/** The vault root for a stored owner (a rehydrated session, a routine). The
 *  caller may pass what it already knows about the owner's role. */
export function vaultRootForOwner(
  userId: string | undefined,
  admin: boolean = ownerIsAdmin(userId),
): string {
  if (admin || userId === undefined) return ownerVaultRoot();
  return memberVaultRoot(userId);
}

/** Whether a path is a member root (or inside one). */
export function isMemberVaultRoot(dir: string): boolean {
  const base = resolve(memberVaultsDir());
  const target = resolve(dir);
  return target.startsWith(base + '/') || target.startsWith(base + '\\');
}

/**
 * A root, ready to use: a member root is made on first use with mode 0700
 * (its parents too, so the members folder is never world readable); the
 * owner's follows the engine's one rule (the default is made, a configured
 * folder that went missing stays missing and throws VAULT_FOLDER_MISSING).
 */
export function ensureVaultRootAt(dir: string): string {
  if (!isMemberVaultRoot(dir)) return ensureVaultRoot(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const p of [join(oscHome(), 'vaults'), memberVaultsDir(), dir]) {
    try {
      chmodSync(p, 0o700);
    } catch {
      // Windows has no modes; the folder is still there.
    }
  }
  return dir;
}
