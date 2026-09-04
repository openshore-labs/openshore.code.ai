import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The enforcement boundary is the migration, not the client. Pin its shape so a
// refactor cannot quietly drop a table, an RLS lockdown, or a permission check
// from the RPCs. This asserts structure, not a live database (that lights up
// after `supabase db push`).
const SQL = readFileSync(
  join(process.cwd(), '..', 'supabase', 'migrations', '0014_org_projects.sql'),
  'utf8',
);

describe('org projects migration', () => {
  it('creates the two tables with the grant ladder', () => {
    expect(SQL).toMatch(/create table if not exists public\.org_projects/);
    expect(SQL).toMatch(/create table if not exists public\.org_project_members/);
    expect(SQL).toMatch(
      /level text not null default 'read' check \(level in \('read', 'write', 'edit'\)\)/,
    );
  });

  it('enables RLS and revokes direct writes so the RPCs are the only path', () => {
    expect(SQL).toMatch(/alter table public\.org_projects enable row level security/);
    expect(SQL).toMatch(/alter table public\.org_project_members enable row level security/);
    expect(SQL).toMatch(
      /revoke insert, update, delete on public\.org_projects from authenticated, anon/,
    );
    expect(SQL).toMatch(
      /revoke insert, update, delete on public\.org_project_members from authenticated, anon/,
    );
    expect(SQL).toMatch(
      /revoke select on public\.org_projects, public\.org_project_members from anon/,
    );
  });

  it('resolves the caller`s level server-side, admins always edit', () => {
    expect(SQL).toMatch(/function public\.project_level\(p_project uuid\)/);
    expect(SQL).toMatch(/is_org_admin\(v_org\) or public\.is_org_owner\(v_org\)/);
    // Matches a grant by verified uid OR verified email, never client input.
    expect(SQL).toMatch(
      /m\.user_id = auth\.uid\(\) or lower\(m\.email\) = lower\(coalesce\(auth\.email\(\)/,
    );
  });

  it('every write RPC checks the level before it writes', () => {
    // create requires admin; the mutating RPCs require edit.
    expect(SQL).toMatch(/only an admin can share a project with the team/);
    for (const rpc of [
      'update_org_project',
      'delete_org_project',
      'set_org_project_access',
      'revoke_org_project_access',
    ]) {
      expect(SQL, rpc).toMatch(new RegExp(`function public\\.${rpc}`));
    }
    // The edit gate appears once per mutating RPC that needs it.
    const editGates = SQL.match(/project_level\([^)]*\) is distinct from 'edit'/g) ?? [];
    expect(editGates.length).toBeGreaterThanOrEqual(4);
  });

  it('grants access only to a real org member, never an arbitrary email', () => {
    expect(SQL).toMatch(/that email is not a member of this organization/);
    expect(SQL).toMatch(/from public\.org_members mm[\s\S]*status <> 'revoked'/);
  });

  it('execute is granted to authenticated for the listing and write RPCs', () => {
    expect(SQL).toMatch(/grant execute on function public\.list_org_projects\(\) to authenticated/);
    expect(SQL).toMatch(
      /grant execute on function public\.create_org_project\(uuid, text, text, text\[\]\) to authenticated/,
    );
  });
});
