// The role selectors decide who may change the shared stack and storage. They
// are the founder-visible boundary in a commercial org, so pin them: a personal
// account owns everything, only an admin does in a company, and the member
// preview flips the view without giving up real authority.
import { describe, expect, it } from 'vitest';
import { isOrgAdmin, stackAdmin } from '../src/state/store.js';
import type { Account } from '../src/state/types.js';

function commercial(role: 'admin' | 'member', over: Partial<Account> = {}): Account {
  return {
    type: 'commercial',
    selfEmail: 'me@co.com',
    org: {
      id: 'o1',
      name: 'Co',
      seatCount: 3,
      tierId: 'commercial_micro',
      priceYear: 20,
      members: [
        { id: 'm1', email: 'me@co.com', role, addedAt: '2026-01-01' },
        { id: 'm2', email: 'boss@co.com', role: 'admin', addedAt: '2026-01-01' },
      ],
      createdAt: '2026-01-01',
    },
    ...over,
  };
}

describe('role selectors', () => {
  it('a personal account owns everything', () => {
    expect(isOrgAdmin({ type: 'personal' })).toBe(true);
    expect(stackAdmin({ type: 'personal' })).toBe(true);
  });

  it('no account (legacy install) is treated as owner, never locked out', () => {
    expect(isOrgAdmin(undefined)).toBe(true);
    expect(stackAdmin(undefined)).toBe(true);
  });

  it('a commercial admin has authority; a member does not', () => {
    expect(isOrgAdmin(commercial('admin'))).toBe(true);
    expect(stackAdmin(commercial('admin'))).toBe(true);
    expect(isOrgAdmin(commercial('member'))).toBe(false);
    expect(stackAdmin(commercial('member'))).toBe(false);
  });

  it('member preview hides admin controls but keeps real authority', () => {
    const previewing = commercial('admin', { previewAsMember: true });
    expect(stackAdmin(previewing)).toBe(false); // view is locked
    expect(isOrgAdmin(previewing)).toBe(true); // can still exit preview + act
  });

  it('an unknown self email in the org resolves to no authority', () => {
    expect(isOrgAdmin(commercial('admin', { selfEmail: 'ghost@co.com' }))).toBe(false);
  });
});
