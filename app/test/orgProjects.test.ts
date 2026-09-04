import { describe, it, expect } from 'vitest';
import {
  mergeSharedProjects,
  serverRowToProject,
  type ServerProjectRow,
} from '../src/lib/orgProjects.js';
import type { Project } from '../src/state/types.js';

function row(over: Partial<ServerProjectRow> = {}): ServerProjectRow {
  return {
    id: 'srv1',
    org_id: 'org1',
    name: 'Shared',
    instructions: 'be kind',
    repo_ids: ['github:acme/app'],
    rev: 3,
    updated_at: '2026-09-04T00:00:00Z',
    my_level: 'write',
    access: [{ email: 'a@co.com', level: 'edit' }],
    ...over,
  };
}

function local(over: Partial<Project> = {}): Project {
  return { id: 'p1', name: 'Local', repoIds: [], createdAt: 't', ...over };
}

describe('serverRowToProject', () => {
  it('maps a row into a shared Project', () => {
    const p = serverRowToProject(row());
    expect(p).toMatchObject({
      id: 'srv1',
      serverId: 'srv1',
      orgId: 'org1',
      shared: true,
      rev: 3,
      myLevel: 'write',
      repoIds: ['github:acme/app'],
    });
    expect(p.access).toEqual([{ email: 'a@co.com', level: 'edit', grantedAt: '' }]);
  });

  it('tolerates null repo_ids / access', () => {
    const p = serverRowToProject(row({ repo_ids: null, access: null, instructions: '' }));
    expect(p.repoIds).toEqual([]);
    expect(p.access).toEqual([]);
    expect(p.instructions).toBeUndefined();
  });
});

describe('mergeSharedProjects', () => {
  it('leaves local projects untouched and adds new shared ones', () => {
    const merged = mergeSharedProjects([local()], [row()]);
    expect(merged).toHaveLength(2);
    expect(merged.find((p) => p.id === 'p1')?.shared).toBeUndefined();
    expect(merged.find((p) => p.serverId === 'srv1')?.shared).toBe(true);
  });

  it('refreshes a shared project in place, keeping its local id and chats link', () => {
    // The sharer keeps their original local id; match is by serverId.
    const sharer = local({ id: 'p1', name: 'Old name', shared: true, serverId: 'srv1', rev: 1 });
    const merged = mergeSharedProjects([sharer], [row({ name: 'New name', rev: 4 })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe('p1'); // local id preserved
    expect(merged[0]!.name).toBe('New name'); // server content adopted
    expect(merged[0]!.rev).toBe(4);
  });

  it('drops a shared project the pull no longer returns (unshared or access lost)', () => {
    const gone = local({ id: 'g', shared: true, serverId: 'srvGONE' });
    const kept = local({ id: 'k' });
    const merged = mergeSharedProjects([gone, kept], []);
    expect(merged.map((p) => p.id)).toEqual(['k']);
  });
});
