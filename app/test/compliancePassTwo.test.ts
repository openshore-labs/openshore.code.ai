// App compliance, pass two, part A (2026-09-24): account deletion with Download
// my data, guardrail retention and the keyed fingerprint, and community reviews
// without author ids. SQL cannot run here (no Postgres in CI's unit job), so the
// migrations are pinned the way 0014 to 0018 are: by the shapes that must hold.
// The edge function is Deno, so it is read as text too; its decision core is
// unit-tested in accountDeletion.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');
const m19 = read('supabase', 'migrations', '0019_account_deletion_and_guardrail_retention.sql');
const m20 = read('supabase', 'migrations', '0020_reviews_public_view.sql');
const m18 = read('supabase', 'migrations', '0018_graduated_enforcement.sql');
const edge = read('supabase', 'functions', 'delete-account', 'index.ts');
const config = read('supabase', 'config.toml');
const app = (...p: string[]) => read('app', 'src', ...p);

/** The body of `create or replace function public.<name> () ... $$ ... $$;`. */
function fnBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name} ()`);
  if (start < 0) throw new Error(`${name} not found`);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$', open + 2);
  return sql.slice(open, close + 2);
}

describe('0019: account deletion can succeed', () => {
  it('turns every actor foreign key into ON DELETE SET NULL', () => {
    for (const [table, column] of [
      ['org_members', 'invited_by'],
      ['org_vault_notes', 'updated_by'],
      ['org_projects', 'created_by'],
      ['org_projects', 'updated_by'],
      ['org_project_members', 'granted_by'],
    ]) {
      const name = `${table}_${column}_fkey`;
      expect(m19).toContain(`alter table public.${table} drop constraint if exists ${name};`);
      expect(m19).toMatch(
        new RegExp(
          `add constraint ${name}\\s+foreign key \\(${column}\\) references auth\\.users \\(id\\) on delete set null;`,
        ),
      );
    }
  });

  it('leaves the org owner as RESTRICT, so ownership is settled explicitly', () => {
    expect(m19).not.toMatch(/orgs_owner_uid_fkey/);
    expect(m19).not.toMatch(/alter table public\.orgs\b/);
  });
});

describe('0019: guardrail retention and legal hold', () => {
  it('adds legal_hold_until to the three enforcement tables', () => {
    for (const t of ['guardrail_events', 'enforcement_actions', 'abuse_reports']) {
      expect(m19).toContain(
        `alter table public.${t} add column if not exists legal_hold_until timestamptz;`,
      );
    }
  });

  it('holds a submitted report and the reporter records for at least one year', () => {
    expect(m19).toMatch(/if new\.status is distinct from 'submitted' then\s+return new;/);
    expect(m19).toMatch(/if old\.status = 'submitted' then\s+return new;/);
    expect(m19).toMatch(/v_until := new\.submitted_at \+ interval '1 year'/);
    expect(m19).toMatch(/before insert or update of status on public\.abuse_reports/);
    expect(m19).toMatch(/update public\.guardrail_events\s+set legal_hold_until/);
    expect(m19).toMatch(/update public\.enforcement_actions\s+set legal_hold_until/);
  });

  it('schedules retention at 180 days and two years, skipping held rows, guarded like 0015', () => {
    expect(m19).toMatch(
      /delete from public\.guardrail_events\s+where created_at < now\(\) - interval '180 days'\s+and \(legal_hold_until is null or legal_hold_until <= now\(\)\);/,
    );
    expect(m19).toMatch(
      /delete from public\.enforcement_actions\s+where created_at < now\(\) - interval '2 years'\s+and \(legal_hold_until is null or legal_hold_until <= now\(\)\);/,
    );
    expect(m19).toMatch(/delete from public\.deletion_holds where hold_until <= now\(\);/);
    expect(m19).toMatch(/create extension if not exists pg_cron;/);
    expect(m19).toMatch(/if exists \(select 1 from pg_extension where extname = 'pg_cron'\) then/);
    expect(m19).toMatch(/raise notice 'pg_cron is not installed; guardrail retention/);
  });

  it('keeps held rows past a deletion in a service-role-only table, under a hash', () => {
    expect(m19).toMatch(/create table if not exists public\.deletion_holds/);
    expect(m19).toMatch(
      /user_id_sha256 text not null check \(user_id_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/,
    );
    expect(m19).toMatch(/held_rows jsonb not null/);
    expect(m19).toMatch(/hold_until timestamptz not null/);
    expect(m19).toMatch(/revoke all on public\.deletion_holds from anon, authenticated;/);
  });
});

describe('0019: block rows only, and no names', () => {
  it('purges allowed-with-assertion rows and refuses new ones', () => {
    expect(m19).toMatch(
      /delete from public\.guardrail_events where action = 'allowed-with-assertion';/,
    );
    expect(m19).toMatch(
      /add constraint guardrail_events_blocked_only check \(action = 'blocked'\);/,
    );
  });

  it('clears subject on block rows and holds it null by constraint', () => {
    expect(m19).toMatch(
      /update public\.guardrail_events set subject = null where subject is not null;/,
    );
    expect(m19).toMatch(/add constraint guardrail_events_subject_null check \(subject is null\);/);
  });

  it('leaves likeness_consents in place', () => {
    expect(m19).not.toMatch(/drop table[^;]*likeness_consents/);
    expect(m19).not.toMatch(/insert into public\.likeness_consents/);
  });
});

describe('0019: the keyed fingerprint', () => {
  it('replaces request_hash with an HMAC-SHA256 under the Vault key, before insert', () => {
    expect(m19).toMatch(/before insert on public\.guardrail_events/);
    expect(m19).toContain(
      "new.request_hash := encode(hmac(new.request_hash, v_key, 'sha256'), 'hex');",
    );
    expect(m19).toMatch(/from vault\.decrypted_secrets\s+where name = 'guardrail_hmac_key'/);
    expect(m19).toMatch(/set search_path = public, extensions/);
  });

  it('fails loudly when the secret is missing, and says what to do', () => {
    expect(m19).toMatch(
      /raise exception 'guardrail_hmac_key is missing from Supabase Vault\. Create it \(see migration 0019\)/,
    );
    expect(m19).toMatch(/FOUNDER PREREQUISITE: CREATE THE VAULT SECRET BEFORE APPLYING THIS FILE/);
  });

  it('keeps the 64-hex check and never exposes the key function to clients', () => {
    expect(m19).not.toMatch(/drop constraint[^;]*request_hash/);
    expect(m19).toMatch(
      /revoke execute on function public\.guardrail_hmac \(text\) from public, anon, authenticated;/,
    );
  });
});

describe('0019: record_enforcement', () => {
  it('is 0018 exactly, but for the one published contact address', () => {
    const before = fnBody(m18, 'record_enforcement');
    const after = fnBody(m19, 'record_enforcement');
    expect(after).toContain('os-code@openshorellc.com');
    expect(after).not.toContain('support@openshore.ai');
    expect(after).toBe(before.replace('support@openshore.ai', 'os-code@openshorellc.com'));
  });
});

describe('0019: export_my_data', () => {
  const body = fnBody(m19, 'export_my_data');

  it('is a definer function for signed-in callers only', () => {
    expect(m19).toMatch(
      /create or replace function public\.export_my_data \(\)\s+returns jsonb\s+language plpgsql\s+stable\s+security definer\s+set search_path = public/,
    );
    expect(m19).toMatch(
      /revoke execute on function public\.export_my_data \(\) from public, anon;/,
    );
    expect(m19).toMatch(/grant execute on function public\.export_my_data \(\) to authenticated;/);
    expect(body).toMatch(/v_uid uuid := auth\.uid\(\)/);
  });

  it('covers every table the server holds for a person', () => {
    for (const t of [
      'user_entitlements',
      'apple_links',
      'org_members',
      'orgs',
      'org_projects',
      'org_project_members',
      'org_vault_notes',
      'push_devices',
      'push_grants',
      'model_reviews',
      'review_reports',
      'user_blocks',
      'review_eula_acceptance',
      'guardrail_events',
      'enforcement_actions',
    ]) {
      expect(body, t).toContain(`public.${t} `);
    }
    expect(body).toMatch(/from auth\.users u/);
    expect(body).toMatch(/'email', v_email, 'created_at', v_created/);
  });
});

describe('0019: billing events after a deletion', () => {
  it('drops a Stripe event for an account or team that no longer exists', () => {
    expect(m19).toMatch(
      /if not exists \(select 1 from auth\.users where id = p_user\) then\s+return false;/,
    );
    expect(m19).toMatch(
      /if not exists \(select 1 from public\.orgs where id = p_org\) then\s+return false;/,
    );
    expect(m19).toMatch(
      /grant execute on function public\.apply_org_entitlement_event\([^)]*\)\s+to service_role;/,
    );
  });
});

describe('0019 and 0020: house rules', () => {
  it('has no IP identifier and no column that could hold a prompt', () => {
    for (const sql of [m19, m20]) {
      expect(sql).not.toMatch(/\bip_address\b/i);
      expect(sql).not.toMatch(/\brequest_ip\b/i);
      expect(sql).not.toMatch(/\binet\b/i);
      expect(sql).not.toMatch(/\b(prompt|completion|content|excerpt|text_sample)\s+text\b/i);
    }
  });
});

describe('0020: reviews without author ids', () => {
  it('serves a public view with no user_id column, plus is_staff', () => {
    const view = m20.slice(
      m20.indexOf('create view public.model_reviews_public'),
      m20.indexOf('from public.model_reviews r'),
    );
    const columns = view.slice(view.indexOf('select') + 'select'.length);
    // user_id is used to compute flags, never selected as a column.
    expect(columns).not.toMatch(/^\s*r\.user_id\s*,?\s*$/m);
    expect(columns).not.toMatch(/\bas user_id\b/);
    expect(columns).toMatch(/^\s*r\.id,$/m);
    expect(columns).toMatch(/as is_staff/);
    expect(m20).toMatch(
      /where r\.status = 'visible'\s+and not public\.author_blocked \(r\.user_id\)/,
    );
    expect(m20).toMatch(/grant select on public\.model_reviews_public to anon, authenticated;/);
  });

  it('revokes anonymous reads of the base table; a signed-in author reads only their own', () => {
    expect(m20).toMatch(/revoke select on public\.model_reviews from anon;/);
    expect(m20).toMatch(
      /create policy model_reviews_select on public\.model_reviews for select\s+to authenticated\s+using \(auth\.uid\(\) = user_id\);/,
    );
  });

  it('keeps the aggregate RPCs working for anon as definer functions over visible rows', () => {
    for (const fn of ['model_review_summary', 'model_review_summaries', 'model_review_snapshot']) {
      expect(m20).toMatch(
        new RegExp(
          `create or replace function public\\.${fn} \\([^)]*\\)\\s+returns json\\s+language sql\\s+stable\\s+security definer\\s+set search_path = public`,
        ),
      );
      expect(m20).toMatch(
        new RegExp(`grant execute on function public\\.${fn} \\([^)]*\\) to anon, authenticated;`),
      );
    }
  });

  it('keeps the staff list server-side only, and blocks by review', () => {
    expect(m20).toMatch(/create table if not exists public\.review_staff/);
    expect(m20).toMatch(/revoke all on public\.review_staff from anon, authenticated;/);
    expect(m20).toMatch(
      /create or replace function public\.block_review_author \(p_review_id uuid\)/,
    );
  });

  it('the app reads the view, never the author id, and shows the staff tag', () => {
    const reviews = app('lib', 'reviews.ts');
    expect(reviews).toMatch(/const REVIEWS_PUBLIC = 'model_reviews_public';/);
    expect(reviews).toMatch(/selectPublic<ReviewRow>\(REVIEWS_PUBLIC, q, token\)/);
    const cols = /const REVIEW_COLS =\s*'([^']+)'/.exec(reviews)![1]!;
    expect(cols.split(',')).not.toContain('user_id');
    expect(cols.split(',')).toContain('is_staff');
    expect(reviews).toMatch(
      /rpcPublic\('block_review_author', \{ p_review_id: reviewId \}, token\)/,
    );
    const section = app('components', 'ReviewsSection.tsx');
    expect(section).toMatch(/r\.is_staff \? <span className="review-staff">OpenShore team<\/span>/);
    expect(section).not.toMatch(/user_id/);
  });
});

describe('delete-account, the edge function', () => {
  it('requires a JWT and is registered', () => {
    expect(config).toMatch(/\[functions\.delete-account\]\s+verify_jwt = true/);
  });

  it('checks sign-in age, then asks about owned teams, before touching anything', () => {
    const reauth = edge.indexOf("code: 'reauth_required'");
    const conflict = edge.indexOf("code: 'transfer_or_delete_org'");
    const billing = edge.indexOf('cancelOrgSubscription(org.subscriptionId)');
    const deletes = edge.indexOf(".from('orgs')\n        .delete()");
    const holds = edge.indexOf(".from('deletion_holds').insert(");
    const user = edge.indexOf('auth.admin.deleteUser(uid)');
    expect(reauth).toBeGreaterThan(0);
    expect(edge).toMatch(/isRecentSignIn\(claims, Date\.now\(\)\)/);
    expect(conflict).toBeGreaterThan(reauth);
    expect(edge).toMatch(/409,/);
    expect(billing).toBeGreaterThan(conflict);
    expect(deletes).toBeGreaterThan(billing);
    expect(holds).toBeGreaterThan(deletes);
    expect(user).toBeGreaterThan(holds);
    expect(edge).toMatch(/json\(\{ deleted: true \}, 200, req\)/);
  });

  it('cancels a team plan now with a 14-day refund, and a personal plan at period end', () => {
    expect(edge).toMatch(/stripe\.subscriptions\.cancel\(subscriptionId\)/);
    expect(edge).toMatch(/stripe\.refunds\.create\(/);
    expect(edge).toMatch(/refundEligible\(paidAt, invoice\.amount_paid, Date\.now\(\)\)/);
    expect(edge).toMatch(/cancel_at_period_end: true/);
    expect(edge).toMatch(/Deno\.env\.get\('STRIPE_SECRET_KEY'\)/);
  });

  it('removes memberships by user id and by confirmed email, and hashes held rows', () => {
    expect(edge).toMatch(
      /for \(const table of \['org_members', 'org_project_members'\] as const\)/,
    );
    expect(edge).toMatch(/user\.email && user\.email_confirmed_at/);
    expect(edge).toMatch(/user_id_sha256: await sha256Hex\(uid\)/);
    expect(edge).toMatch(/\.gt\('legal_hold_until', nowIso\)/);
  });
});

describe('the app: Download my data and Delete account', () => {
  const sheet = app('components', 'DeleteAccountSheet.tsx');
  const settings = app('screens', 'SettingsScreen.tsx');

  it('shows both actions in the signed-in account area', () => {
    expect(settings).toMatch(/\{exporting \? 'Preparing your data' : 'Download my data'\}/);
    expect(settings).toMatch(
      /<button className="btn danger press-fb" onClick=\{\(\) => setSheet\('delete'\)\}>\s*Delete account/,
    );
    expect(settings).toMatch(/exportMyData\(authSession\)/);
  });

  it('confirms on the presence-aware Sheet with the agreed words', () => {
    expect(sheet).toMatch(/import \{ Sheet \} from '\.\/Sheet\.js';/);
    expect(sheet).toMatch(/<Sheet open=\{open\}[\s\S]*?variant="confirm">/);
    expect(sheet).toContain("export const DELETE_TITLE = 'Delete your OpenShore account?';");
    expect(sheet).toContain(
      "This removes your account, your reviews, your team memberships, your push devices, and your guardrail history from OpenShore's servers. Chats and keys on this device are not touched; you can clear them below. This cannot be undone.",
    );
    expect(sheet).toContain(
      'Deleting your account does not cancel your Apple subscription. Cancel it in Settings, then your name, then Subscriptions.',
    );
    expect(sheet).toMatch(/openExternal\(APPLE_SUBSCRIPTIONS_URL\)/);
    expect(app('lib', 'legal.ts')).toContain(
      "export const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';",
    );
    expect(sheet).toContain("Transfer isn't available yet; delete the team or keep your account.");
  });

  it('gates Delete on the typed email and marks the commit with a haptic', () => {
    expect(sheet).toMatch(/disabled=\{!canSubmitDeletion\(state, email\)\}/);
    expect(sheet).toMatch(/hapticApproval\(\);\s*dispatch\(\{ type: 'submit' \}\);/);
    expect(sheet).toMatch(/className="btn danger press-fb"/);
  });

  it('offers "Cancel renewal instead" off iOS only, through the existing portal', () => {
    expect(sheet).toMatch(/team\.paid && !isPhone\(\)/);
    expect(app('lib', 'accountDeletion.ts')).toMatch(
      /invokeFunction<\{ url: string \}>\('stripe-portal'/,
    );
  });

  it('after success signs out, forgets the pending Apple link, and offers to clear chats', () => {
    expect(settings).toMatch(
      /void accountDeleted\(\)\.then\(\(\) => \{\s*showToast\('Account deleted\.'\);/,
    );
    expect(settings).toMatch(/setSheet\('clear'\);/);
    const store = app('state', 'store.ts');
    expect(store).toMatch(
      /async accountDeleted\(\) \{\s*await forgetSession\(\);[\s\S]*?await storeDelete\(PENDING_APPLE_LINK_KEY\);/,
    );
  });
});
