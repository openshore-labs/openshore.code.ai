// Which folders on this machine an unattended or remote actor may work in.
// Admin-provisioned workspaces are the repos cloned under ~/OSCode (by the
// daemon's clone route or the desktop app); the outbox roots are the explicit
// extra repos an admin listed in daemon config. Both predicates resolve real
// paths on both sides, so a symlink planted inside a managed root that points
// outside it can never pass as inside (P0-1), and a managed root that is
// itself a symlink still contains its real children.
//
// Lives here, below the daemon, so the routine scheduler (which the daemon
// starts) can share the exact same gate without a circular import.
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { realpathSync } from 'node:fs';
import { loadDaemonConfig, type DaemonConfig } from '../../config/load.js';
import type { OscConfig } from '../../config/schema.js';

/** Resolve a path to its real location when it exists (symlinks followed),
 *  else to its lexical absolute form. */
export function realOrResolve(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

export function within(target: string, root: string): boolean {
  return target === root || target.startsWith(root + sep);
}

export function managedRoot(): string {
  return realOrResolve(join(homedir(), 'OSCode'));
}

/**
 * Admin-provisioned workspaces are the repos an admin cloned onto the home
 * machine (under ~/OSCode). A member may only open sessions inside one of
 * these: without this a member token could point a session at any path on
 * disk as its jail root and drive it (D1). Admins (and the legacy shared
 * token, which resolves as admin) are unrestricted for attended sessions.
 */
export function isAdminProvisionedWorkspace(cwd: string): boolean {
  return within(realOrResolve(cwd), managedRoot());
}

/**
 * The outbox apply/verify endpoints, and every unattended routine, take a repo
 * path. Both are restricted to the admin-provisioned workspaces plus any
 * explicit daemon.outboxAllowedRoots (a home repo outside ~/OSCode). Enforced
 * for every caller, admins included: a bot that runs while the person sleeps
 * must never be pointed at an arbitrary folder.
 */
export function isOutboxAllowedPath(
  cwd: string,
  // The roots come from the GLOBAL config alone (DAE-9); a whole OscConfig is
  // accepted for callers that already hold one.
  config: OscConfig | DaemonConfig = loadDaemonConfig(),
): boolean {
  if (isAdminProvisionedWorkspace(cwd)) return true;
  const daemon = 'daemon' in config ? config.daemon : config;
  const target = realOrResolve(cwd);
  for (const root of daemon.outboxAllowedRoots ?? []) {
    if (within(target, realOrResolve(root))) return true;
  }
  return false;
}
