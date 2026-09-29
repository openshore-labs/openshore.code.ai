// The Supabase migrations as a list (CTO ruling 4, 2026-09-29). `supabase db
// push` records a migration by its number, so two files with one prefix would
// leave one of them silently unapplied (0016 was once edited in place for the
// same reason, 0017's header). A held branch renumbers above main's newest
// file when it merges; this fails the merge that forgets to.
//
// And the enforcement ladder, as the newest migration that defines it: the
// function returns a column named `action`, so a bare `action` in its body is
// ambiguous in PL/pgSQL and raises on every call (0016 to 0018 did, 0022 fixed
// it). The pgTAP suite runs it; this catches the slip before CI's database
// job does.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), '..', 'supabase', 'migrations');
const files = () => readdirSync(DIR).filter((f) => f.endsWith('.sql'));

describe('the migration list', () => {
  it('names every file NNNN_words.sql', () => {
    for (const f of files()) expect(f, f).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('never gives two files the same number', () => {
    const byPrefix = new Map<string, string[]>();
    for (const f of files()) {
      const prefix = f.slice(0, 4);
      byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), f]);
    }
    const clashes = [...byPrefix.values()].filter((names) => names.length > 1);
    expect(clashes, 'renumber the newer file above the newest on main').toEqual([]);
  });

  it('holds account deletion and the free caps as 0022 and 0023', () => {
    expect(files()).toContain('0022_account_deletion.sql');
    expect(files()).toContain('0023_org_free_caps.sql');
  });
});

describe('the newest record_enforcement', () => {
  const newest = files()
    .sort()
    .map((f) => readFileSync(join(DIR, f), 'utf8'))
    .filter((sql) => /create or replace function public\.record_enforcement \(\)/.test(sql))
    .pop()!;
  const body = newest.slice(
    newest.indexOf('create or replace function public.record_enforcement ()'),
    newest.indexOf(
      '$$;',
      newest.indexOf('create or replace function public.record_enforcement ()'),
    ),
  );

  it('qualifies every action column, so the call does not raise', () => {
    // `action` alone is the output column; a table's column is `g.action`.
    const bare = body
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .filter((line) => /(?<![.\w])action\s*(=|<>|in\b)/.test(line));
    expect(bare).toEqual([]);
  });

  it('reads a level 2 tombstone as a termination', () => {
    expect(body).toMatch(/from public\.enforcement_tombstones t/);
    expect(body).toMatch(/t\.level = 2/);
    expect(body).toMatch(/v_operator_terminated := v_operator_terminated or v_tombstoned/);
  });

  it('still has no network address in it', () => {
    expect(body).not.toMatch(/\bip_address\b|\brequest_ip\b|x-forwarded-for|\binet\b/i);
  });
});
