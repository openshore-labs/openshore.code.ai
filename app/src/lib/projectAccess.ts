// Project access, resolved. A SHARED (enterprise) project is enforced on the
// server (supabase/migrations/0014_org_projects.sql); the client reflects the
// level the server resolved for this person. A LOCAL project is the owner's own
// device project, so the owner always holds edit; its grant roster is a draft
// that becomes the server's the moment the project is shared. This module turns
// a project into the level the current person holds, and answers read/write/edit.
import type { Project, ProjectPermission } from '../state/types.js';

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
 *  - a SHARED project reflects the server-resolved `myLevel` (RLS is the truth);
 *  - a LOCAL project is the owner's own, so they always hold 'edit'. Its grant
 *    roster is a draft, never a restriction on the owner.
 * `account` is accepted for call-site symmetry but no longer needed.
 */
export function projectPermissionFor(
  project: Pick<Project, 'shared' | 'myLevel'>,
): ProjectPermission | undefined {
  return project.shared ? project.myLevel : 'edit';
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
