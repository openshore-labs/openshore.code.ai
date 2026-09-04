import { describe, it, expect } from 'vitest';
import {
  canEdit,
  canRead,
  canWrite,
  permits,
  projectPermissionFor,
} from '../src/lib/projectAccess.js';
import type { Account, Project } from '../src/state/types.js';

const base: Pick<Project, 'access'> = {
  access: [
    { email: 'reader@co.com', level: 'read', grantedAt: 't' },
    { email: 'Writer@Co.com', level: 'write', grantedAt: 't' },
  ],
};

function commercial(selfEmail: string | undefined, role: 'admin' | 'member'): Account {
  return {
    type: 'commercial',
    selfEmail,
    org: {
      id: 'o1',
      name: 'Co',
      seatCount: 3,
      tierId: 'commercial_small',
      priceYear: 0,
      createdAt: 't',
      members: [
        { id: 'm1', email: 'admin@co.com', role: 'admin', addedAt: 't' },
        { id: 'm2', email: 'writer@co.com', role: 'member', addedAt: 't' },
        { id: 'm3', email: 'reader@co.com', role: 'member', addedAt: 't' },
      ],
    },
  };
}

describe('the permission ladder', () => {
  it('edit implies write implies read', () => {
    expect(permits('edit', 'read')).toBe(true);
    expect(permits('edit', 'write')).toBe(true);
    expect(permits('write', 'read')).toBe(true);
    expect(permits('write', 'edit')).toBe(false);
    expect(permits('read', 'write')).toBe(false);
    expect(permits(undefined, 'read')).toBe(false);
  });

  it('canRead/canWrite/canEdit read the ladder', () => {
    expect(canRead('read')).toBe(true);
    expect(canWrite('read')).toBe(false);
    expect(canWrite('write')).toBe(true);
    expect(canEdit('write')).toBe(false);
    expect(canEdit('edit')).toBe(true);
  });
});

describe('projectPermissionFor', () => {
  it('a personal (or no) account owns everything', () => {
    expect(projectPermissionFor(base, { type: 'personal' })).toBe('edit');
    expect(projectPermissionFor(base, undefined)).toBe('edit');
  });

  it('a commercial admin always holds edit, listed or not', () => {
    expect(projectPermissionFor(base, commercial('admin@co.com', 'admin'))).toBe('edit');
  });

  it('a member gets exactly their grant, case-insensitively', () => {
    expect(projectPermissionFor(base, commercial('reader@co.com', 'member'))).toBe('read');
    // Grant email cased differently from the signed-in email still matches.
    expect(projectPermissionFor(base, commercial('writer@co.com', 'member'))).toBe('write');
  });

  it('a member with no grant has no access', () => {
    expect(projectPermissionFor(base, commercial('stranger@co.com', 'member'))).toBeUndefined();
  });
});
