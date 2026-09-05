// Money-safety guard: the entitlement rules are defined in more than one place
// on purpose (the app for the UI, the Deno edge functions for the server, the
// SQL triggers for the roster ceiling), and none of them can import the other.
// If any pair drifts, a client could be shown one band and charged against
// another, or a status could unlock on the phone and revoke on the server.
// These tests fail the build the moment the copies diverge, so the hand
// mirrors can never rot silently. The edge file and the migration are read as
// text because they are Deno and SQL, not importable into this Node test.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMERCIAL_TIERS } from '../src/lib/plans.js';

const ROOT = join(process.cwd(), '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

const edgeEntitlement = () => read('supabase', 'functions', '_shared', 'entitlement.ts');
const migration0015 = () => read('supabase', 'migrations', '0015_review_2026_09_05.sql');
const appleNotifications = () => read('supabase', 'functions', 'apple-notifications', 'index.ts');
const storeSrc = () => read('app', 'src', 'state', 'store.ts');

/** The quoted strings inside `new Set([...])` following `const NAME`. */
function setLiteral(src: string, name: string): string[] {
  const start = src.indexOf(`const ${name}`);
  if (start < 0) throw new Error(`${name} not found`);
  const open = src.indexOf('[', start);
  const close = src.indexOf(']', open);
  const body = src.slice(open + 1, close);
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

function serverBands(): Array<{ id: string; maxEmployees: number | null }> {
  const src = edgeEntitlement();
  const block = src.slice(
    src.indexOf('COMMERCIAL_BANDS'),
    src.indexOf('];', src.indexOf('COMMERCIAL_BANDS')),
  );
  const re = /\{\s*id:\s*'([^']+)',\s*maxEmployees:\s*(null|\d+)\s*\}/g;
  const out: Array<{ id: string; maxEmployees: number | null }> = [];
  for (let m = re.exec(block); m; m = re.exec(block)) {
    out.push({ id: m[1]!, maxEmployees: m[2] === 'null' ? null : Number(m[2]) });
  }
  return out;
}

/** The CASE arms of public.tier_max_seats in migration 0015. */
function sqlBands(): Array<{ id: string; maxEmployees: number | null }> {
  const src = migration0015();
  const start = src.indexOf('function public.tier_max_seats');
  const block = src.slice(start, src.indexOf('$$;', src.indexOf('as $$', start)));
  const re = /when\s+'([^']+)'\s+then\s+(null|\d+)/g;
  const out: Array<{ id: string; maxEmployees: number | null }> = [];
  for (let m = re.exec(block); m; m = re.exec(block)) {
    out.push({ id: m[1]!, maxEmployees: m[2] === 'null' ? null : Number(m[2]) });
  }
  return out;
}

describe('commercial band mirror', () => {
  const app = () => COMMERCIAL_TIERS.map((t) => ({ id: t.id, maxEmployees: t.maxEmployees }));

  it('server bands match plans.ts exactly (id and seat ceiling, in order)', () => {
    expect(serverBands()).toEqual(app());
  });

  it('the SQL seat-ceiling function (0015 tier_max_seats) matches plans.ts', () => {
    expect(sqlBands()).toEqual(app());
  });
});

describe('entitled status mirror', () => {
  it("the edge ENTITLED set equals the client's ENTITLED_STATUSES", () => {
    const server = setLiteral(edgeEntitlement(), 'ENTITLED').sort();
    const client = setLiteral(storeSrc(), 'ENTITLED_STATUSES').sort();
    expect(server).toEqual(client);
    expect(server.length).toBeGreaterThan(0);
  });

  it('the SQL seat ceiling (0015 org_seat_ceiling) gates on the same statuses', () => {
    const src = migration0015();
    const start = src.indexOf('function public.org_seat_ceiling');
    const block = src.slice(start, src.indexOf('$$;', src.indexOf('as $$', start)));
    const m = /v_status not in \(([^)]+)\)/.exec(block);
    expect(m).not.toBeNull();
    const sql = [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort();
    expect(sql).toEqual(setLiteral(edgeEntitlement(), 'ENTITLED').sort());
  });
});

describe('Apple notification type sets', () => {
  it('ACTIVE_TYPES and REVOKE_TYPES are disjoint and cover the documented events', () => {
    const src = appleNotifications();
    const active = setLiteral(src, 'ACTIVE_TYPES');
    const revoke = setLiteral(src, 'REVOKE_TYPES');
    expect(active.filter((t) => revoke.includes(t))).toEqual([]);
    expect(active).toEqual(expect.arrayContaining(['SUBSCRIBED', 'DID_RENEW']));
    expect(revoke).toEqual(expect.arrayContaining(['EXPIRED', 'REFUND', 'REVOKE']));
    // The link-state map handles each revoke type by name; a new one must be
    // added there too (a fallthrough would mislabel it 'expired').
    for (const t of revoke) {
      expect(t === 'REFUND' || t === 'REVOKE' || t.endsWith('EXPIRED')).toBe(true);
    }
  });

  it('every Apple-written status is one the 0006 CHECK and the entitled set know', () => {
    const src = appleNotifications();
    const written = [...src.matchAll(/status = '([a-z_]+)'/g)].map((m) => m[1]!);
    for (const s of written) expect(['active', 'canceled']).toContain(s);
  });
});
