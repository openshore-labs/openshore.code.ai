import { describe, it, expect } from 'vitest';
import {
  canEdit,
  canRead,
  canWrite,
  permits,
  projectPermissionFor,
} from '../src/lib/projectAccess.js';

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
  it('a local project is the owner`s own: always edit', () => {
    expect(projectPermissionFor({})).toBe('edit');
    expect(projectPermissionFor({ shared: false })).toBe('edit');
    // A drafted roster on a local project never restricts the owner.
    expect(projectPermissionFor({ shared: false, myLevel: 'read' })).toBe('edit');
  });

  it('a shared project reflects the server-resolved level', () => {
    expect(projectPermissionFor({ shared: true, myLevel: 'read' })).toBe('read');
    expect(projectPermissionFor({ shared: true, myLevel: 'write' })).toBe('write');
    expect(projectPermissionFor({ shared: true, myLevel: 'edit' })).toBe('edit');
    // No synced level yet: no access resolved.
    expect(projectPermissionFor({ shared: true })).toBeUndefined();
  });
});
