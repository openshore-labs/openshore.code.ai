// The org sync mappers decide who is bound active vs invited on push, and how
// server rows rebuild the local org. Pin those rules.
import { describe, expect, it } from 'vitest';
import type { Org, OrgMember } from '../src/state/types.js';
import type { Session } from '../src/lib/supabase.js';
import {
  memberRowsForPush,
  mergeServerMembers,
  serverToLocalOrg,
  type ServerMember,
} from '../src/state/orgSync.js';

const session: Session = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresAt: Date.now() + 3600_000,
  user: { id: 'uid-owner', email: 'owner@co.com' },
};

function member(email: string, over: Partial<OrgMember> = {}): OrgMember {
  return { id: `local-${email}`, email, role: 'member', addedAt: '2026-01-01T00:00:00Z', ...over };
}

const org: Org = {
  id: 'local-org',
  name: 'Co',
  seatCount: 3,
  tierId: 'commercial_5' as Org['tierId'],
  priceYear: 20,
  members: [member('owner@co.com', { role: 'admin' }), member('two@co.com')],
  createdAt: '2026-01-01T00:00:00Z',
};

describe('org sync mappers', () => {
  it('binds the signed-in owner active and invites everyone else', () => {
    const rows = memberRowsForPush(org, 'srv-org', session);
    const owner = rows.find((r) => r.email === 'owner@co.com')!;
    const other = rows.find((r) => r.email === 'two@co.com')!;
    expect(owner).toMatchObject({
      org_id: 'srv-org',
      user_id: 'uid-owner',
      status: 'active',
      role: 'admin',
    });
    expect(other).toMatchObject({ status: 'invited', role: 'member' });
    expect(other.user_id).toBeUndefined();
  });

  it('is case-insensitive matching the owner to their seat', () => {
    const upper = { ...session, user: { ...session.user, email: 'OWNER@CO.COM' } };
    const rows = memberRowsForPush(org, 'srv-org', upper);
    expect(rows.find((r) => r.email === 'owner@co.com')).toMatchObject({ status: 'active' });
  });

  it('stamps local members with their server id and status after a push', () => {
    const saved: ServerMember[] = [
      {
        id: 's1',
        org_id: 'srv',
        user_id: 'uid-owner',
        email: 'owner@co.com',
        role: 'admin',
        status: 'active',
      },
      {
        id: 's2',
        org_id: 'srv',
        user_id: null,
        email: 'two@co.com',
        role: 'member',
        status: 'invited',
      },
    ];
    const merged = mergeServerMembers(org.members, saved);
    expect(merged[0]).toMatchObject({ serverId: 's1', status: 'active' });
    expect(merged[1]).toMatchObject({ serverId: 's2', status: 'invited' });
  });

  it('rebuilds a local org from server rows and drops revoked members', () => {
    const srv = {
      id: 'srv-org',
      name: 'Co',
      owner_uid: 'uid-owner',
      seat_count: 5,
      tier_id: 'commercial_30',
      price_year: 100,
    };
    const members: ServerMember[] = [
      {
        id: 's1',
        org_id: 'srv-org',
        user_id: 'uid-owner',
        email: 'owner@co.com',
        role: 'admin',
        status: 'active',
      },
      {
        id: 's2',
        org_id: 'srv-org',
        user_id: null,
        email: 'gone@co.com',
        role: 'member',
        status: 'revoked',
      },
    ];
    const local = serverToLocalOrg(srv, members, '2026-02-02T00:00:00Z');
    expect(local.serverId).toBe('srv-org');
    expect(local.seatCount).toBe(5);
    expect(local.members).toHaveLength(1);
    expect(local.members[0]).toMatchObject({
      email: 'owner@co.com',
      serverId: 's1',
      status: 'active',
    });
  });
});
