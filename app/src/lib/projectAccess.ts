// Project access, resolved. Enterprise projects carry per-teammate grants by
// email (Project.access); this module turns a project + the signed-in account
// into the level the current person holds, and answers read/write/edit.
//
// Honest scope (same posture as the Account/Org model in state/types.ts): these
// are a UX affordance, not a security boundary. Projects are device-local
// today, so a grant here only shapes what THIS person's app offers; real
// enforcement lands when org-shared projects are server-backed. The shapes are
// chosen so that server can honor them without a rewrite.
import type { Account, Project, ProjectPermission } from '../state/types.js';
import { isOrgAdmin } from '../state/store.js';

// Coarsest to finest; the index is the rank. edit implies write implies read.
export const PERMISSION_LADDER: ProjectPermission[] = ['read', 'write', 'edit'];

export function permissionRank(level: ProjectPermission): number {
  return PERMISSION_LADDER.indexOf(level);
}

/** Does `held` satisfy the requirement `needed` (ladder-inclusive)? */
export function permits(held: ProjectPermission | undefined, needed: ProjectPermission): boolean {
  return held != null && permissionRank(held) >= permissionRank(needed);
}

/**
 * The level the signed-in person holds on a project:
 *  - a personal account owns everything ('edit');
 *  - a commercial admin always holds 'edit';
 *  - otherwise the grant matching their signed-in email, if any;
 *  - undefined when they have no grant (no access to this project yet).
 * Email match is case-insensitive. No account context (signed out, or accounts
 * not configured) is treated as the owner, so the solo/local experience is
 * unchanged.
 */
export function projectPermissionFor(
  project: Pick<Project, 'access'>,
  account?: Account,
): ProjectPermission | undefined {
  if (!account || account.type === 'personal') return 'edit';
  if (isOrgAdmin(account)) return 'edit';
  const email = account.selfEmail?.trim().toLowerCase();
  if (!email) return undefined;
  const grant = (project.access ?? []).find((a) => a.email.trim().toLowerCase() === email);
  return grant?.level;
}

export const canRead = (level: ProjectPermission | undefined): boolean => permits(level, 'read');
export const canWrite = (level: ProjectPermission | undefined): boolean => permits(level, 'write');
export const canEdit = (level: ProjectPermission | undefined): boolean => permits(level, 'edit');

/** A short human label for a level, for a row or a chip. */
export function permissionLabel(level: ProjectPermission): string {
  switch (level) {
    case 'read':
      return 'Can read';
    case 'write':
      return 'Can write';
    case 'edit':
      return 'Can edit';
  }
}
