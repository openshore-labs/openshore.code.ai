// Pure mappers between the local Org/OrgMember model and the Supabase rows.
// Kept side-effect-free so the sync rules (who is bound active, how server rows
// rebuild the local org) are unit-tested; the network orchestration lives in the
// store. Server is authoritative for org membership once the user is signed in.
import type { Org, OrgMember, OrgRole } from './types.js';
import type { PlanTierId } from '../lib/plans.js';
import type { Session } from '../lib/supabase.js';

export interface ServerOrg {
  id: string;
  name: string;
  owner_uid: string;
  seat_count: number;
  tier_id: string;
  price_year: number;
}

export interface ServerMember {
  id: string;
  org_id: string;
  user_id: string | null;
  email: string;
  role: OrgRole;
  status: 'invited' | 'active' | 'revoked';
}

const isSelf = (email: string, session: Session): boolean =>
  email.toLowerCase() === (session.user.email ?? '').toLowerCase();

/** The org_members rows to insert when first pushing a local org to the server.
 *  The signed-in owner is bound active immediately; everyone else is invited by
 *  email and becomes active when they sign in (claim_membership). */
export function memberRowsForPush(
  org: Org,
  serverOrgId: string,
  session: Session,
): Record<string, unknown>[] {
  return org.members.map((m) => ({
    org_id: serverOrgId,
    email: m.email,
    role: m.role,
    invited_by: session.user.id,
    ...(isSelf(m.email, session)
      ? { user_id: session.user.id, status: 'active' }
      : { status: 'invited' }),
  }));
}

/** Stamp local members with their server row id + status after a push. */
export function mergeServerMembers(local: OrgMember[], saved: ServerMember[]): OrgMember[] {
  const byEmail = new Map(saved.map((s) => [s.email.toLowerCase(), s]));
  return local.map((m) => {
    const s = byEmail.get(m.email.toLowerCase());
    return s ? { ...m, serverId: s.id, status: s.status === 'active' ? 'active' : 'invited' } : m;
  });
}

export function serverToLocalMember(m: ServerMember, now: string): OrgMember {
  return {
    id: m.id,
    serverId: m.id,
    email: m.email,
    role: m.role,
    status: m.status === 'active' ? 'active' : 'invited',
    addedAt: now,
  };
}

/** Rebuild a local Org from its server rows. Revoked members are dropped. */
export function serverToLocalOrg(srv: ServerOrg, members: ServerMember[], now: string): Org {
  return {
    id: srv.id,
    serverId: srv.id,
    name: srv.name,
    seatCount: srv.seat_count,
    tierId: srv.tier_id as PlanTierId,
    priceYear: srv.price_year,
    members: members.filter((m) => m.status !== 'revoked').map((m) => serverToLocalMember(m, now)),
    createdAt: now,
  };
}
