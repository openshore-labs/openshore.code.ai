// The client half of Org Projects (the enterprise tier of Projects). A shared
// project lives on the org server (supabase/migrations/0014_org_projects.sql);
// this module maps its rows to the app's Project shape and wraps the RPCs that
// are the only write path. The store owns the session and merges the results
// into settings.projects; nothing here reaches into the store.
//
// Every RPC is enforced server-side by project_level(): the client can ask, but
// the server decides, so a member who edits the JSON gains nothing.
import { rpc } from './supabase.js';
import type { Project, ProjectAccess, ProjectPermission } from '../state/types.js';

/** One row from list_org_projects(): a shared project plus the caller's level
 *  and the full grant roster. */
export interface ServerProjectRow {
  id: string;
  org_id: string;
  name: string;
  instructions: string;
  repo_ids: string[] | null;
  rev: number;
  updated_at: string;
  my_level: ProjectPermission | null;
  access: Array<{ email: string; level: ProjectPermission }> | null;
}

/** Map a server grant list to the app's ProjectAccess shape. grantedAt is not
 *  round-tripped (the roster order is the server's), so it is left blank. */
function toAccess(rows: ServerProjectRow['access']): ProjectAccess[] {
  return (rows ?? []).map((a) => ({ email: a.email, level: a.level, grantedAt: '' }));
}

/** Turn a server row into a Project. A pulled project's local id IS its server
 *  id; the sharer's own copy keeps its original local id and matches on
 *  serverId instead (chats stay filed under the local id either way). */
export function serverRowToProject(row: ServerProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    instructions: row.instructions || undefined,
    repoIds: row.repo_ids ?? [],
    access: toAccess(row.access),
    shared: true,
    serverId: row.id,
    orgId: row.org_id,
    rev: row.rev,
    myLevel: row.my_level ?? undefined,
    createdAt: row.updated_at,
  };
}

/**
 * Reconcile the local projects list against a fresh server pull. Local (device-
 * only) projects are untouched. Each server row updates the matching shared
 * project in place (by serverId, so the sharer's local id and its chats
 * survive), or is added. A previously-shared project the pull no longer returns
 * (unshared, deleted, or access revoked) drops out of the list. Pure, so the
 * merge is unit-tested without a server.
 */
export function mergeSharedProjects(local: Project[], rows: ServerProjectRow[]): Project[] {
  const byServerId = new Map(rows.map((r) => [r.id, r] as const));
  const seen = new Set<string>();
  const merged: Project[] = [];
  for (const p of local) {
    if (!p.shared) {
      merged.push(p);
      continue;
    }
    const row = p.serverId ? byServerId.get(p.serverId) : undefined;
    if (!row) continue; // no longer visible to this person: drop it locally
    seen.add(row.id);
    // Keep the local id (and so its chats); refresh everything the server owns.
    merged.push({ ...p, ...serverRowToProject(row), id: p.id });
  }
  for (const row of rows) {
    if (!seen.has(row.id)) merged.push(serverRowToProject(row));
  }
  return merged;
}

// ---- RPC wrappers. Each takes a fresh access token; the store supplies it. ----

export async function listOrgProjects(token: string): Promise<ServerProjectRow[]> {
  return rpc<ServerProjectRow[]>('list_org_projects', token);
}

export async function createOrgProject(
  token: string,
  input: { orgId: string; name: string; instructions: string; repoIds: string[] },
): Promise<string> {
  return rpc<string>('create_org_project', token, {
    p_org: input.orgId,
    p_name: input.name,
    p_instructions: input.instructions,
    p_repo_ids: input.repoIds,
  });
}

export async function updateOrgProject(
  token: string,
  input: {
    serverId: string;
    name: string;
    instructions: string;
    repoIds: string[];
    baseRev: number;
  },
): Promise<number> {
  return rpc<number>('update_org_project', token, {
    p_id: input.serverId,
    p_name: input.name,
    p_instructions: input.instructions,
    p_repo_ids: input.repoIds,
    p_base_rev: input.baseRev,
  });
}

export async function deleteOrgProject(token: string, serverId: string): Promise<void> {
  await rpc('delete_org_project', token, { p_id: serverId });
}

export async function setOrgProjectAccess(
  token: string,
  serverId: string,
  email: string,
  level: ProjectPermission,
): Promise<void> {
  await rpc('set_org_project_access', token, { p_id: serverId, p_email: email, p_level: level });
}

export async function revokeOrgProjectAccess(
  token: string,
  serverId: string,
  email: string,
): Promise<void> {
  await rpc('revoke_org_project_access', token, { p_id: serverId, p_email: email });
}
