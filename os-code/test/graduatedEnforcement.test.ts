// The graduated enforcement ladder (board call 6, 2026-09-16): one confirmed
// Tier 1 block warns, a second within the rolling window or an operator's own
// confirmation terminates. A SQL migration cannot run here, so the file is
// pinned the way 0016 and 0017 are: by the shapes that must hold and the
// identifiers that must never return. Tier 1 blocking itself is untouched (the
// chokepoint tests cover that); this is about what happens to the account.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  nextActionFor,
  BLOCK_NEXT_ACTION,
  REFUSALS,
  SUPPORT_EMAIL,
} from '../src/core/ethics/classify.js';

const MIGRATION = join(
  process.cwd(),
  '..',
  'supabase',
  'migrations',
  '0018_graduated_enforcement.sql',
);

describe('the 0018 graduated enforcement migration', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('keeps the same no-argument, server-truth signature the app already calls', () => {
    expect(sql).toMatch(/create or replace function public\.record_enforcement \(\)/);
    expect(sql).toMatch(/v_uid uuid := auth\.uid\(\)/);
    expect(sql).toMatch(
      /from public\.guardrail_events\s*\n\s*where user_id = v_uid and action = 'blocked'/,
    );
  });

  it('warns on the first Tier 1 block instead of terminating', () => {
    // The warn branch: any Tier 1, before the terminate condition is met.
    expect(sql).toMatch(/elsif v_tier1 > 0 then\s*\n\s*v_level := 1;\s*\n\s*v_action := 'warn';/);
    // The old single-strike terminate ("if v_tier1 > 0 then ... terminate") is gone.
    expect(sql).not.toMatch(/if v_tier1 > 0 then\s*\n\s*v_level := 2;/);
  });

  it('terminates only on a second confirmed Tier 1 within the window, or an operator', () => {
    expect(sql).toMatch(/v_operator_terminated or v_confirmed_recent >= 2/);
    // Confirmed means the block named at least one classifier signal.
    expect(sql).toMatch(/cardinality\(signals\) >= 1/);
    // A rolling window, not forever.
    expect(sql).toMatch(/occurred_at >= now\(\) - public\.enforcement_window\(\)/);
    expect(sql).toMatch(/select interval '90 days'/);
    // The operator path is a reviewer-only RPC that records who acted.
    expect(sql).toMatch(/create or replace function public\.admin_confirm_termination/);
    expect(sql).toMatch(/if not public\.is_abuse_reviewer \(\) then/);
    expect(sql).toMatch(/auth\.uid\(\)::text/);
    expect(sql).toMatch(/actor <> 'system'/);
  });

  it('still only prepares a report, never submits one', () => {
    expect(sql).toMatch(/No submission integration is configured, so nothing has been sent\./);
    expect(sql).not.toMatch(/status = 'submitted'/);
  });

  it('names the appeal path in the warning the app shows', () => {
    expect(sql).toMatch(/support@openshore\.ai/);
  });

  it('lets a person delete their own membership row and nothing else', () => {
    expect(sql).toMatch(/create policy members_delete_self on public\.org_members for delete/);
    expect(sql).toMatch(/using \(user_id = auth\.uid\(\) and not public\.is_org_owner\(org_id\)\)/);
  });

  it('has no IP address anywhere and no column that could hold a prompt', () => {
    expect(sql).not.toMatch(/\bip_address\b/i);
    expect(sql).not.toMatch(/\brequest_ip\b/i);
    expect(sql).not.toMatch(/\bip_ban/i);
    expect(sql).not.toMatch(/x-forwarded-for/i);
    expect(sql).not.toMatch(/\binet\b/i);
    expect(sql).not.toMatch(/\b(prompt|completion|content|body|excerpt|text_sample)\s+text\b/i);
  });

  it('has no em dash', () => {
    expect(sql).not.toContain(String.fromCharCode(8212));
  });
});

describe('the block next action', () => {
  it('names the appeal path on the three hard-blocked categories only', () => {
    for (const c of ['csam', 'ncii', 'weapons-uplift'] as const) {
      expect(nextActionFor(c)).toBe(BLOCK_NEXT_ACTION);
    }
    expect(nextActionFor('likeness')).toBeUndefined();
    expect(nextActionFor('check-failed')).toBeUndefined();
    expect(nextActionFor('permitted')).toBeUndefined();
    expect(BLOCK_NEXT_ACTION).toContain(SUPPORT_EMAIL);
    expect(BLOCK_NEXT_ACTION).toMatch(/legitimate work/);
    expect(BLOCK_NEXT_ACTION).not.toContain(String.fromCharCode(8212));
  });

  it('keeps the refusals themselves short: the next action is not folded in', () => {
    for (const message of Object.values(REFUSALS)) {
      expect(message).not.toContain(SUPPORT_EMAIL);
    }
  });
});
