// The Supabase migrations as a list (tech review ruling 4, then tech review 11, 2026-09-29).
// `supabase db push` records a migration by its number, so two files with one
// prefix would leave one of them silently unapplied (0016 was once edited in
// place for the same reason, 0017's header). Production's history decides what
// a number means: supabase/production-history.tsv pins every applied file by
// name and hash, and an unapplied file sits above the newest applied one. A
// held branch renumbers above main's newest file when it merges; this fails the
// merge that forgets to, and the branch that edits or renumbers what production
// ran (production's 0019 and 0020 came from an unmerged branch while main used
// 0019 for another file).
//
// And the enforcement ladder, as the newest migration that defines it: the
// function returns a column named `action`, so a bare `action` in its body is
// ambiguous in PL/pgSQL and raises on every call (0016 to 0019 did, 0022 fixed
// it). The pgTAP suite runs it; this catches the slip before CI's database
// job does.
//
// And Download my data: every table a migration creates is either read by the
// newest export_my_data or left out with a written reason, so a new table
// cannot fall out of the export unnoticed (the house pattern of classifying
// every key).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SUPABASE = join(process.cwd(), '..', 'supabase');
const DIR = join(SUPABASE, 'migrations');
const files = () => readdirSync(DIR).filter((f) => f.endsWith('.sql'));
const read = (f: string) => readFileSync(join(DIR, f));

/** SHA-256 hex with CRLF read as LF, the same as supabase/scripts/history.mjs. */
function sha256(bytes: Buffer): string {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) continue;
    out.push(bytes[i]);
  }
  return createHash('sha256').update(Buffer.from(out)).digest('hex');
}

interface Applied {
  version: string;
  name: string;
  sha256: string;
  note: string;
}

function history(): Applied[] {
  const rows: Applied[] = [];
  let header = false;
  for (const line of readFileSync(join(SUPABASE, 'production-history.tsv'), 'utf8').split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    const [version = '', name = '', hash = '', note = ''] = line.split('\t');
    if (!header) {
      expect([version, name, hash]).toEqual(['version', 'name', 'sha256']);
      header = true;
      continue;
    }
    rows.push({ version, name, sha256: hash, note });
  }
  return rows;
}

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

  it('never holds two files with the same bytes (a renumbered copy would run twice)', () => {
    const byHash = new Map<string, string[]>();
    for (const f of files()) {
      const h = sha256(read(f));
      byHash.set(h, [...(byHash.get(h) ?? []), f]);
    }
    expect([...byHash.values()].filter((names) => names.length > 1)).toEqual([]);
  });

  it('holds account deletion and the free caps as 0022 and 0023', () => {
    expect(files()).toContain('0022_account_deletion.sql');
    expect(files()).toContain('0023_org_free_caps.sql');
  });

  it("holds production's 0019 and 0020 under their names, and org vault v1 as 0021", () => {
    expect(files()).toContain('0019_account_deletion_and_guardrail_retention.sql');
    expect(files()).toContain('0020_reviews_public_view.sql');
    expect(files()).toContain('0021_org_vault_v1.sql');
  });
});

describe("production's history (supabase/production-history.tsv)", () => {
  const rows = history();

  it("lists production's applied versions in order, 0001 to 0020 at least", () => {
    expect(rows.length).toBeGreaterThanOrEqual(20);
    expect(rows.map((r) => r.version)).toEqual([...rows.map((r) => r.version)].sort());
    expect(new Set(rows.map((r) => r.version)).size).toBe(rows.length);
    expect(rows.slice(0, 20).map((r) => r.version)).toEqual(
      Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(4, '0')),
    );
  });

  // 0016's row: production may have run the pre-edit bytes of 0016 (it was
  // once edited in place), which 0017 reconciles; the pin is the file as it
  // stands, the bytes every later database has run.
  it('pins every applied file: on disk, under its name, with the bytes production ran', () => {
    const present = new Set(files());
    for (const r of rows) {
      const file = `${r.version}_${r.name}.sql`;
      expect(present.has(file), `${file} is applied in production and must stay on disk`).toBe(
        true,
      );
      expect(sha256(read(file)), `${file} was edited after production ran it`).toBe(r.sha256);
    }
  });

  it('keeps the 0016 note that production may have run its pre-edit bytes', () => {
    expect(rows.find((r) => r.version === '0016')?.note).toMatch(/pre-edit bytes; 0017 reconciles/);
  });

  it('numbers every unapplied file above the newest applied one', () => {
    const applied = new Set(rows.map((r) => `${r.version}_${r.name}.sql`));
    const newest = rows[rows.length - 1].version;
    const low = files().filter((f) => !applied.has(f) && f.slice(0, 4) <= newest);
    expect(low, `renumber above ${newest}; db push would refuse or skip these`).toEqual([]);
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

  it('names the published appeal address (decision F1)', () => {
    // The same address as the app's SUPPORT_EMAIL: app/test/contactAddress.test.ts.
    expect(body).toMatch(/write to support@openshore\.ai\./);
    expect(body).not.toMatch(/os-code@openshorellc\.com/);
  });

  it('still has no network address in it', () => {
    expect(body).not.toMatch(/\bip_address\b|\brequest_ip\b|x-forwarded-for|\binet\b/i);
  });
});

describe('the Vault secret never reaches a push', () => {
  // `db push` upserts every Vault secret config.toml resolves before it
  // migrates, so a committed [db.vault] entry would rotate production's
  // guardrail key. Local builds add one for one command
  // (supabase/scripts/local-vault.sh), and every push command carries
  // --skip-vault as well.
  it('config.toml has no [db.vault] section', () => {
    expect(readFileSync(join(SUPABASE, 'config.toml'), 'utf8')).not.toMatch(/^\s*\[db\.vault\]/m);
  });

  for (const doc of ['supabase/README.md']) {
    it(`every db push command in ${doc} carries --skip-vault`, () => {
      const text = readFileSync(join(process.cwd(), '..', doc), 'utf8');
      const commands: string[] = [];
      let fenced = false;
      for (const line of text.split('\n')) {
        if (/^\s*```/.test(line)) {
          fenced = !fenced;
          continue;
        }
        if (fenced) {
          if (/\bdb push\b/.test(line)) commands.push(line.trim());
          continue;
        }
        // A command in a code span (not the CLI's own "Finished supabase db
        // push." quoted as output).
        for (const m of line.matchAll(/`([^`]*\bdb push\b[^`]*)`/g)) {
          if (/^(?:sb|supabase|npx|bash)\b/.test(m[1].trim())) commands.push(m[1]);
        }
      }
      expect(commands.length).toBeGreaterThan(0);
      expect(commands.filter((c) => !c.includes('--skip-vault'))).toEqual([]);
    });
  }
});

describe('no file names the old 0019 org vault file', () => {
  it('supabase/ says 0021_org_vault_v1', () => {
    const stale = '0019_org' + '_vault_v1';
    const hits: string[] = [];
    const walk = (dir: string, rel: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path, `${rel}/${entry.name}`);
        else if (readFileSync(path, 'utf8').includes(stale)) hits.push(`${rel}/${entry.name}`);
      }
    };
    walk(SUPABASE, 'supabase');
    expect(hits).toEqual([]);
  });
});

describe('Download my data covers every table', () => {
  // Read: the newest export_my_data reads the table (by `public.<table>`).
  const READ = new Set([
    'orgs',
    'org_members',
    'user_entitlements',
    'apple_links',
    'push_devices',
    'push_grants',
    'org_vault_notes',
    'model_reviews',
    'review_reports',
    'user_blocks',
    'review_eula_acceptance',
    'org_projects',
    'org_project_members',
    'guardrail_events',
    'enforcement_actions',
    'review_staff',
    'org_vault_revisions',
    'enforcement_tombstones',
    'org_vault_settings',
    'push_sends',
    'likeness_consents',
  ]);
  // Left out, each with its reason (0026's header says the same).
  const EXEMPT: Record<string, string> = {
    org_entitlements: "a team's plan, keyed by the team; it names no person",
    apple_notifications_seen: "Apple's notification ids for replay defence; they name no person",
    review_moderators: 'an operator allowlist the service role seeds; 0019 left it out',
    abuse_reports:
      'whether a report prepared under 18 U.S.C. 2258A is disclosed to its subject is a counsel call (F4)',
    abuse_reviewers: 'an operator allowlist the service role seeds; 0019 left it out',
    deletion_holds:
      'copies made while an account is deleted, kept under a hash of its id; no key links them to an account',
    org_storage_usage: "a team's byte count; it names no person",
  };

  const all = files().sort();
  const created = new Set<string>();
  for (const f of all) {
    const sql = readFileSync(join(DIR, f), 'utf8');
    for (const m of sql.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g))
      created.add(m[1]);
    for (const m of sql.matchAll(/drop table (?:if exists )?public\.([a-z_]+)/g))
      created.delete(m[1]);
  }
  const newest = all
    .map((f) => readFileSync(join(DIR, f), 'utf8'))
    .filter((sql) => sql.includes('create or replace function public.export_my_data ()'))
    .pop()!;
  const start = newest.indexOf('create or replace function public.export_my_data ()');
  const body = newest.slice(start, newest.indexOf('$$;', start));

  it('classifies every table a migration creates, and nothing else', () => {
    const classified = new Set([...READ, ...Object.keys(EXEMPT)]);
    expect([...created].filter((t) => !classified.has(t)).sort(), 'classify the new table').toEqual(
      [],
    );
    expect([...classified].filter((t) => !created.has(t)).sort(), 'a stale entry').toEqual([]);
    expect([...READ].filter((t) => t in EXEMPT)).toEqual([]);
  });

  it('reads every table classified as read', () => {
    expect([...READ].filter((t) => !new RegExp(`public\\.${t}\\b`).test(body))).toEqual([]);
  });

  it('gives every left-out table a reason, and reads none of them', () => {
    for (const [t, why] of Object.entries(EXEMPT)) expect(why.length, t).toBeGreaterThan(20);
    expect(Object.keys(EXEMPT).filter((t) => new RegExp(`public\\.${t}\\b`).test(body))).toEqual(
      [],
    );
  });

  it('is version 2 and never exports the tombstone hash', () => {
    expect(body).toMatch(/'version', 2,/);
    expect(body).not.toMatch(/'email_sha256'|to_jsonb\(t\) from public\.enforcement_tombstones/);
  });
});

describe("0026's retention re-schedule", () => {
  // pg_cron unschedules by name only among the current role's own jobs, while
  // the role a push runs as sees every role's (review 2026-09-30). A job of
  // this name that another role owns must stop the migration with the
  // owner's name, before the unschedule that would fail with pg_cron's own
  // "could not find valid entry" or leave a second job beside it.
  it('stops on a job another role owns, before it unschedules', () => {
    const sql = read('0026_export_and_retention.sql').toString('utf8');
    const check = sql.indexOf(
      "where jobname = 'oscode_guardrail_retention' and username <> current_user",
    );
    const unschedule = sql.indexOf("perform cron.unschedule('oscode_guardrail_retention')");
    expect(check).toBeGreaterThan(-1);
    expect(unschedule).toBeGreaterThan(check);
    expect(sql.slice(check, unschedule)).toMatch(
      /raise exception 'cron job oscode_guardrail_retention belongs to %/,
    );
  });
});
