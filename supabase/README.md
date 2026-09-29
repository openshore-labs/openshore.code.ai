# OS Code backend (Supabase)

Sign-in, org membership, role enforcement, entitlements, and billing for OS
Code, on the same stack as Uki (Supabase + Stripe). Everything here is inert
until you stand up a project and set the keys; the app runs local-first without
it.

## Integration map (single source of truth)

| Integration          | Secret(s) / home                                                                 | Used by                                  |
| -------------------- | -------------------------------------------------------------------------------- | ---------------------------------------- |
| Supabase (client)    | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (app build; public)                | app sign-in (`src/lib/supabase.ts`)      |
| Supabase (server)    | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (function secrets; NEVER `VITE_`)     | every edge function                      |
| Stripe (client)      | `VITE_STRIPE_PUBLISHABLE_KEY` (app build; public)                                 | web checkout                             |
| Stripe (server)      | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (function secrets)                   | stripe-checkout / -webhook / -portal, delete-account |
| Guardrail HMAC key   | Vault secret `guardrail_hmac_key` (created once in the SQL editor, never committed, never in `config.toml`) | 0019's insert trigger and re-key |
| Stripe prices        | `STRIPE_PRICE_MICRO/SMALL/GROWTH/SCALE` (function secrets)                        | checkout + webhook (commercial tiers)    |
| Stripe price (indiv) | `STRIPE_PRICE_PERSONAL` (function secret)                                         | checkout + webhook (Personal $20/yr)     |
| Stripe ignore list   | `STRIPE_IGNORED_PRICES` (function secret, optional, comma-separated)              | webhook: log-and-200 for listed prices   |
| Apple products       | `APPLE_PRODUCT_IDS` (function secret, comma-separated, REQUIRED for the rail)     | link-apple-purchase, apple-notifications |
| Repo OAuth           | `GITHUB/GITLAB/BITBUCKET_OAUTH_CLIENT_ID/_SECRET` (function secrets)              | repo-oauth (PKCE + fixed error codes)    |

Rule: a secret can live in more than one place. Never put a service-role or
secret key in a `VITE_` var.

## Migration history: production decides what a number means (CTO 4, CTO 11)

The CLI matches a migration by its number only. Production's history
(`supabase_migrations.schema_migrations` on project lzlrlfdffwiypzreoldb) is the
authority on what each number means, and `production-history.tsv` records it:
every applied version, its name, and the SHA-256 of its file. Today production
holds 0001 to 0020. Its 0019 and 0020 are
`0019_account_deletion_and_guardrail_retention.sql` and
`0020_reviews_public_view.sql`, pushed on 2026-09-24 from the privacy branch
(`claude/openshore-privacy-mobile-1ij12h` at `d3d4bb7`) before CTO 4. Main holds
both byte for byte and never edits, renames, renumbers, or re-applies them.
Main's Org Vault v1 file, written as 0019 before anyone knew production had
used the number, is `0021_org_vault_v1.sql` now, bytes unchanged.

Rules (CTO 4, CTO 11):

- Migrations go to production from `main` only, and only through
  `docs/vault-gate1-runbook.md`.
- Never edit an applied file. Any change to an applied object is a new file.
- A new file takes the next number above both main's newest and production's
  newest.
- A session branch that adds a migration says in its commit and in PROGRESS
  that the file is unapplied and must not be pushed.
- Every push command carries `--skip-vault` (below, "Local stack: the Vault
  secret").
- The session that records a push appends its rows to
  `production-history.tsv` in the same change.
- The runbook's 2.2b dashboard check (no automatic deploys, Branching off)
  stays.

Guards: `app/test/supabaseMigrations.test.ts` fails when an applied file is
missing, renamed, or edited, when an unapplied file is numbered at or below
production's newest, when two files share a number or the same bytes, or when
`config.toml` gains a `[db.vault]` section. `.github/workflows/migrations.yml`
runs `node supabase/scripts/check-migrations.mjs --against origin/main` on every
branch push that touches `supabase/` and on every PR, and fails a branch whose
numbers collide with main's or production's.

## Tests

`supabase test db` runs every `.sql` file under `tests/`, each its own
rolled-back transaction with its own plan: `tests/rls.test.sql` (32 assertions
over the 0015 cases below), `tests/org_vault.test.sql` (144 over 0021, 0024 and
0025), `tests/account_deletion.test.sql` (37 over 0022 and 0023), and
`tests/guardrail_privacy.test.sql` (48 over production's 0019 and 0020, 0022's
appeal address, and 0026). Every file scopes its counts to its own ids, since it
also runs on a database that is not empty. (Files outside `tests/`, such as
`replay/`, are not pgTAP files and must stay out of it.)

CI (`.github/workflows/ci.yml`) builds the database two ways, and both must pass
pgTAP:

- **`sql`, from empty:** `bash supabase/scripts/local-vault.sh supabase db
  start`, then `supabase test db`.
- **`sql-replay`, replaying production:**
  1. `node supabase/scripts/replay-split.mjs split` checks every row of
     `production-history.tsv` against its file's hash and sets the other files
     aside.
  2. The database is built from production's files only.
  3. `replay/production_rows.sql` loads rows with production's shape (a team
     with an invite, case-duplicate note paths, a queued report and its repeat,
     a submitted report under legal hold, keyed block rows, reviews) and
     snapshots every fingerprint and hold.
  4. The pending files come back, and the local dry run must list exactly
     them.
  5. `supabase db push --local --skip-vault --yes` applies them the way
     production's push will.
  6. `replay/after_push.sql` checks what must hold (the history, the rename,
     the dedupe, no fingerprint keyed twice, the author keys, the cron jobs, the
     export, the ladder).
  7. The full pgTAP suite runs on the result.
  8. Its schema must equal one built from empty.

`deno test functions/_shared` covers the pure decisions: `entitlement.test.ts`
(cross-rail guard, checkout routing, Apple product and freshness checks, ignored
prices) and `accountDeletion.test.ts` (the deletion plan and the email hash).

## Local stack: the Vault secret

Production's 0019 reads the guardrail HMAC key from Supabase Vault by name and
stops, by design, when it is missing, so a local database needs a throwaway key
before 0019 runs. Build or reset the local stack through the wrapper, never with
a bare `db start`:

```
bash supabase/scripts/local-vault.sh npx --yes supabase@2.118.0 db start
bash supabase/scripts/local-vault.sh npx --yes supabase@2.118.0 db reset --local
npx --yes supabase@2.118.0 test db
npx --yes supabase@2.118.0 stop --no-backup
```

The wrapper appends `[db.vault] guardrail_hmac_key =
"env(OSCODE_LOCAL_GUARDRAIL_HMAC_KEY)"` to `config.toml` with a fresh `openssl
rand -hex 32` key, runs the one command, and restores the file on exit. It
refuses anything that could reach a remote project. The entry is never
committed: the CLI's push upserts every Vault secret `config.toml` resolves
before it migrates (2.118.0: "Vault secrets from config.toml are updated before
migrations unless --skip-vault is set"), so a committed entry with the variable
set would silently rotate production's key and break the link between old and
new fingerprints. That is also why every push command here carries
`--skip-vault`.

## Ship order (CTO 4, CTO 11): production holds 0001 to 0020; the next push is 0021 to 0026, from main

`docs/vault-gate1-runbook.md` is the one verified sequence. In short, from an
up-to-date `main`:

1. Run the runbook's preflights in the SQL editor (4.1 to 4.5, 5.1 and 5.2),
   among them 0021's case duplicates and 0022's two `abuse_reports` queries
   (below), and the Vault secret check
   (`select count(*) from vault.secrets where name = 'guardrail_hmac_key'`
   returns 1; never select the decrypted value).
2. Download production's history as CSV from the SQL editor
   (`select version, name from supabase_migrations.schema_migrations order by
   version`) and run `node supabase/scripts/push-preflight.mjs production.csv`.
   It connects to nothing. It refuses unless the checkout is `main` at
   `origin/main` with a clean tree, the CSV equals `production-history.tsv`
   exactly, and every applied file matches its pinned hash; then it prints the
   list the dry run must show.
3. `supabase db push --linked --dry-run --skip-vault`: exactly 0021 to 0026,
   in order. Then the push itself, which the founder types
   (`supabase db push --linked --skip-vault`).
4. In the hand-off, append the six new rows to `production-history.tsv`.

`supabase functions deploy delete-account` is NOT part of this push. Production
runs the privacy branch's 2026-09-24 function, and it keeps working after 0021
to 0026 land: its tables still exist, and the one new write a deletion causes
(the set-null 0025 puts on a revision's author) is the one update 0022's
trigger allows. Main's function is deployed only once the merged function
(main's planner plus the privacy function's legal-hold copy into
`deletion_holds`, CTO 11 package C) is on main.

## Migration 0019 (account deletion and guardrail retention): applied 2026-09-24

`migrations/0019_account_deletion_and_guardrail_retention.sql` came from the
privacy branch and is applied in production. It is history here: never edit or
re-run it. What it did (its sections A to G):

- **A.** The five actor keys (`org_members.invited_by`,
  `org_vault_notes.updated_by`, `org_projects.created_by` and `updated_by`,
  `org_project_members.granted_by`) became `on delete set null` by their
  default names. `orgs.owner_uid` stays restrict.
- **B.** `legal_hold_until` on `guardrail_events`, `enforcement_actions` and
  `abuse_reports`. A report marked submitted holds itself and the account's
  block rows and actions for at least a year (18 U.S.C. 2258A(h)).
  `deletion_holds` (service role only) keeps held rows past an account
  deletion under a SHA-256 of the user id. The daily pg_cron job
  `oscode_guardrail_retention` (03:41 UTC) deletes block rows after 180 days,
  enforcement actions after two years, and ended holds, skipping anything on
  hold. 0026 re-schedules it with the tombstone line.
- **C.** Block rows only, and no names: allowed-with-assertion rows were
  purged and are dropped on insert; `subject` is cleared and must stay null.
- **D.** The fingerprint is an HMAC-SHA256 under the Vault key, computed on
  insert. The file re-keyed the stored rows once, when it ran; re-running it
  would key them a second time and break the report dedupe, which is one
  reason it is never renumbered.
- **E.** `record_enforcement` with the published appeal address
  (os-code@openshorellc.com). It still had the ambiguous `action` that
  0016 to 0018 had; 0022 fixes it.
- **F.** `export_my_data()`: Download my data, version 1. 0026 makes it
  version 2.
- **G.** Billing events for a deleted account or team are dropped, not
  retried.

What the founder did before it ran, kept as history:

1. Created the key once in the SQL editor:
   `select vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'guardrail_hmac_key');`
   A missing secret makes guardrail inserts fail (the app tolerates that; the
   block itself happens on the device). Rotating it breaks the link between old
   and new fingerprints, so rotate only on a suspected leak.
2. Enabled pg_cron so the retention job would schedule. Whether it was on in
   September is not recorded; the runbook's 5.2 checks, and 0026 schedules the
   job either way.
3. Deployed the privacy branch's `delete-account` (the one production runs).

## Migration 0020 (reviews public view): applied 2026-09-24

`migrations/0020_reviews_public_view.sql` came from the privacy branch too and
is applied in production. It added `review_staff` (service role only; the
"OpenShore team" label), the `model_reviews_public` view (no `user_id`,
`is_staff`, `is_mine`, visible rows only, the reader's blocks applied), took
anon reads off `model_reviews` (a signed-in person reads only their own rows
there), made the three aggregate RPCs SECURITY DEFINER, and added
`block_review_author(review id)`. Main's app still reads `model_reviews`
directly, so every build from main shows signed-out readers no reviews and
signed-in readers only their own until CTO 11 package B (reviews) ports the
view. Seeding the label, if wanted:
`insert into public.review_staff (user_id) select id from auth.users where email = '<address>' on conflict do nothing;`

## Migration 0015 (review 2026-09-05): what changed and how it shipped

`migrations/0015_review_2026_09_05.sql` carries every schema fix from the
2026-09-05 review in one idempotent file. It is applied. It shipped in this
order:

1. A push from main applied 0015. Nothing in it is destructive.
2. Redeploy the functions that call the new RPCs and read the new secrets:
   `supabase functions deploy stripe-webhook stripe-checkout apple-notifications
   link-apple-purchase push-register repo-oauth`.
3. Set `APPLE_PRODUCT_IDS` (the Personal auto-renewable product id from App
   Store Connect). The Apple rail FAILS CLOSED without it: every transaction is
   refused as "not the Personal subscription" until it is set (BE-9).
4. Optionally set `STRIPE_IGNORED_PRICES` (below). Leave it unset unless a
   legacy price is wedging the webhook.
5. Ship the app build that dropped `status` from the review payload (BE-6):
   the old payload is refused by the new column grant, so the app and the
   migration must land together.

What 0015 does, by finding:

- **P0-4** `claim_membership`, `project_level`, and `set_org_project_access`
  require `auth.users.email_confirmed_at` (helper `auth_email_confirmed()`).
  `config.toml` sets `enable_confirmations = true`; see the warning below.
- **BE-1** `org_members` policies are split (insert / update / delete); an
  insert may carry `user_id` only as null or the caller's own uid, and
  `user_id` and `org_id` are never client-updatable.
- **BE-2** Seat ceilings: `tier_max_seats(tier)` (hand-mirrored bands, pinned
  by `app/test/entitlementDrift.test.ts`), `no_entitlement_max_seats()` (null
  today: no cap without an entitlement row, per the beta; the CFO recommends
  5 once billing is live, a one-line migration), `org_seat_ceiling(org)`, and
  two SECURITY DEFINER triggers: a new or re-activated member past the ceiling
  is refused (existing rows are grandfathered on a downgrade), and
  `orgs.seat_count` cannot exceed the band. Both raise `check_violation`.
- **BE-4** `apple_links` gains `status`, `valid_until`, `last_event_at`,
  written by `apple-notifications`; `link-apple-purchase` refuses a JWS that
  is not newer than the link's last event, a refunded or revoked link, and any
  JWS signed more than 48 hours ago. Follow-up: live status from the App Store
  Server API (the `.p8` secrets are already reserved) closes the window
  between notifications.
- **BE-5** `project_level` requires an active `org_members` row, so a removed
  teammate loses shared projects immediately.
- **BE-6** `model_reviews` has column-level insert/update grants (never
  `status`, `flag_count`, `created_at`) and the update policy requires
  `status = 'visible'`, so a hidden review cannot be edited back.
- **BE-8** `apply_user_entitlement_event(...)` and
  `apply_org_entitlement_event(...)` (service-role only) do the
  `last_event_at` comparison inside the write, so parallel deliveries cannot
  let an older event land last. All three entitlement writers call them.
- **BE-10** `org_vault_put` refuses traversal paths (`org_vault_path_ok`) and
  bodies over 1 MiB.
- **BE-13** A weekly pg_cron job (`oscode_ledger_retention`, Sundays 03:17
  UTC) deletes `apple_notifications_seen` and `push_sends` rows older than 30
  days. The block is guarded: where pg_cron is absent it prints a NOTICE and
  the migration still applies. On the hosted project enable pg_cron
  (Dashboard, Database, Extensions) and re-run the block from 0015 in the SQL
  editor if the migration ran before the extension was on. Check with
  `select * from cron.job`.

## Migration 0021 (Org Vault v1): what changed and how to ship it

`migrations/0021_org_vault_v1.sql` (written as 0019; CTO 11 moved it to 0021
with its bytes unchanged, because production's 0019 is the privacy file) gives
the team vault compare-and-swap and a history (Vault v1 plan item 2.3, CTO
ruling G3):

- New RPCs for the v1 client: `org_vault_write(org, path, body, if_match,
  if_absent)` and `org_vault_remove(org, path, if_match)`. A clash comes back
  as a result (`exists`, `missing`, `changed` with `theirs`), never as a copy
  made by the server.
- `org_vault_put` and the two-argument `org_vault_delete` keep working for
  builds in the field (last write wins plus a server copy), now under a lock
  with unique conflict names. Remove them after M8.
- Revs come from one sequence starting at 1,000,000,000, so they never repeat.
- `org_vault_revisions` keeps the displaced version on a teammate's
  overwrite, on an overwrite of anything older than ten minutes, and on every
  delete and rename. It is append-only and members read it through RLS.
- Paths are unique per org under `lower(path)` among live notes, and `size`
  now counts bytes.
- `org_vault_purge()` deletes tombstones and revision rows older than 30
  days, weekly (`oscode_vault_purge`, Sundays 03:29 UTC) in the same guarded
  pg_cron block as 0015.

**Order (founder gate):** push 0021 to production from `main` BEFORE the
team-client change (M2 stream D, `orgVault.ts` calling `org_vault_write`)
merges to main, because Codemagic ships every push to main to TestFlight. Run
the preflight below first. The whole sequence is under Ship order, above.

**Preflight: case duplicates.** The unique index needs live paths in one org
to differ by more than letter case. 0021 renames any that do not (the most
recently updated note keeps its path; each other one moves to a free
"(conflict YYYY-MM-DD HHMM)" name and leaves a revision row), so nothing is
lost, but look first. In the SQL editor, before the push:

```sql
select org_id, lower(path) as folded, count(*) as notes,
       array_agg(path order by updated_at desc) as paths
from public.org_vault_notes
where not deleted
group by org_id, lower(path)
having count(*) > 1
order by org_id, folded;
```

No rows means 0021 changes no data. Each row lists the paths that will be
renamed after the first one; tell the teammates who own them. The replay job
runs this rename against case-duplicate rows on every CI run.

## Migrations 0022 and 0023 (account deletion, free caps): how to ship them

Apple requires in-app account deletion (guideline 5.1.1(v)); the app's
Settings, Your account, Delete account calls the `delete-account` function.
CTO ruling 4 (2026-09-29) numbers these 0022 and 0023. **Push from main only.**
The team vault's move and settings, written as 0020 and 0021 on the held
`vault-m2-team`, are 0024 and 0025 on main and follow them (Ship order, above);
never push from a held branch.

1. Preflight, in the SQL editor. Both queries should return no rows:

   ```sql
   select id, status from public.abuse_reports where request_hash !~ '^[0-9a-f]{64}$';
   select user_id, request_hash, array_agg(status) from public.abuse_reports
    where user_id is not null group by 1, 2 having count(*) > 1;
   ```

   0022 removes a queued report that repeats another for the same account and
   hash, and never one an operator acted on. If rows remain, it prints a
   NOTICE and leaves the new check unvalidated or the unique index uncreated;
   fix the rows by hand and re-run that block. Production's 0019 already keyed
   every unsubmitted hash, so a repeat means the same content, keyed; the
   queries still apply as written.
2. The push from main applies 0021 to 0026 in order (Ship order, above).
3. `delete-account` is not deployed from main in this push (Ship order,
   above). The merged function is CTO 11 package C.

What 0022 does:

- Five author columns (`org_members.invited_by`, `org_vault_notes.updated_by`,
  `org_projects.created_by` and `updated_by`, `org_project_members.granted_by`)
  become `on delete set null`, found by catalog. Production's 0019 already did
  this by name, so on production it changes nothing; it still catches a key
  made in the dashboard under another name.
- `enforcement_tombstones` keeps a SHA-256 of the lowercased email and the
  ladder level when a warned or terminated account is deleted (service role
  only, no policies). `record_enforcement` reads a level 2 tombstone as an
  operator's termination. 0026 deletes a tombstone after two years.
- `record_enforcement` itself works now. In 0016 to 0019 an unqualified
  `action` collided with the function's own output column, so every call
  raised and the server-side ladder never recorded a row (the app swallowed
  the error). Expect `enforcement_actions` rows to start appearing. Its warning
  names os-code@openshorellc.com, the address production publishes (founder
  decision F1 can change it, by a new file).
- `org_vault_revisions` stays append-only except for one update: clearing
  `updated_by`, which the function does for the departing person.
- `abuse_reports.request_hash` must be 64 hex characters, one report per
  account and hash (a repeated `queue_abuse_report` for the same pair raises
  23505; the app does not call it today).

What 0023 does: an account owns at most one org without a live plan
(`no_entitlement_max_owned_orgs()`, 1), and an org without a live plan holds
at most 25 MiB of note plus revision bytes (`no_entitlement_max_org_bytes()`),
counted in `org_storage_usage` by triggers and backfilled by the migration.
Both refuse with `check_violation`, only on growth; deletes always go through.
A deleted note's bytes stay counted in its revision row until the weekly purge,
about 30 days later, and the refusal says so ("start a plan to add more. A
deleted note frees its space when its history is cleared, about a month
later"; CTO 11 resolved the runbook's 0.3a this way while 0023 was
unapplied). "Live plan" is `isEntitled`: `org_entitlements.status` active or
trialing with `valid_until` unset or ahead.

What main's `delete-account` does, in order (reads first, so a refusal never
follows a write): refuses `owns_org` (409) when an owned org has anyone else
active; cancels every Stripe subscription that could still charge (the
person's and each sole-member org's); writes the tombstone; deletes the
sole-member orgs; clears the person from team history and removes their
memberships; then `auth.admin.deleteUser`. It answers `{ ok: true, appleNote
}`, where `appleNote` means an Apple subscription the person must cancel on
their iPhone; errors are the fixed codes `unauthorized`, `owns_org`,
`billing`, `failed`. Each step is safe to repeat, so a retry finishes a partial
run. It does not yet copy held rows into `deletion_holds` before the deletion,
which production's function does; that port is package C, and it is why main's
function is not deployed yet.

## Migration 0024 (Org Vault move): what changed and how to ship it

`migrations/0024_org_vault_move.sql` (written as 0020 on `vault-m2-team`,
renumbered by CTO ruling 4) adds one RPC for the team vault's rename
(Vault v1 plan item 6.2, CTO rulings K3 and K12):

- `org_vault_move(org, from, to, if_match)` moves a live note when its rev is
  still `if_match`. It never replaces: a taken name, judged under
  `lower(path)` like 0021's unique index, answers `exists` with `theirs`; a
  stale rev is `changed` with `theirs`; a source that is gone is `missing`. A
  case-only rename of the same note is allowed and updates that row in place.
- The old version is kept as a `renamed` revision row; a move to a new name
  tombstones the source and writes the destination, each with a sequence rev.
  The revision row is written last, so 0023's cap (which refuses note growth
  only) never counts it against the rename: a free org at 25 MiB can still
  rename a note.
- Same membership rule and grants as `org_vault_write` (authenticated only).

Team Trash needs no SQL of its own (K6, R3): a trash is `org_vault_remove`,
Restore is `org_vault_write` with `if_absent` from the latest `deleted`
revision (at the original path, or `{title} (restored).md` when that name is
taken), and there is no Empty, since `org_vault_purge` from 0021 already
drops tombstones and revision rows after 30 days.

**Order (founder gate):** 0024 goes to production from `main` AFTER 0021 (it
calls 0021's lock, snapshot, and sequence), 0022 and 0023, and before the
team client that calls `org_vault_move` is used. The push applies them in
order.

## Migration 0025 (Org Vault settings and entitlement): what changed and how to ship it

`migrations/0025_org_vault_settings.sql` (written as 0021 on
`vault-m2-team`, renumbered by CTO ruling 4) adds the team vault's settings
and its plan gate (Vault v1 plan item 7.4, CTO ruling L17, CX Y14 and Y15):

- `org_vault_settings`, one row per org: `settings` (the vault conventions as
  jsonb, top-level keys `version`, `newNotes`, `daily`, `templates`,
  `attachments`, `links`, `editor`, `tree`, `delete` only, 64 KB cap),
  `delete_role` (`admin` or `member`, default `member`), `context_folder`
  (column only until v1.1, D15) and `rev`. Members read it through RLS; no
  client writes it directly. No row means the defaults.
- `org_vault_settings_get(org)` answers the row or the defaults, plus
  `entitled`, `entitled_until` and `is_admin`, for members, lapsed or not.
  `org_vault_settings_put(org, settings, delete_role, context_folder,
  base_rev)` is admins (or the owner) only and a compare-and-swap on `rev`
  (0 when there is no row); a stale base answers `changed` with `theirs`.
- `org_vault_entitled(org)`: an `org_entitlements` row decides when there is
  one, by `isEntitled` (status `active` or `trialing` and `valid_until` null
  or in the future); any other row is read-only with export, beta or not. The
  webhook never deletes a row, so no row means never bought: that org's
  members write until `no_entitlement_vault_until()`, a constant function
  shaped like 0015's `no_entitlement_max_seats()`. It returns null in the
  beta, meaning no deadline, so beta teams keep editing. `settings_get`
  returns the deadline as `entitled_until` (null when a row exists).
- Every write RPC (`org_vault_write`, `org_vault_remove`, `org_vault_move`,
  the legacy `org_vault_put` and `org_vault_delete`, and the settings put)
  raises SQLSTATE `OV402` when the org is not entitled. Reads, lists,
  revisions and the purge are untouched, so a lapsed org still reads and
  exports every note.
- With `delete_role = 'admin'`, `org_vault_remove` and `org_vault_delete`
  refuse a non-admin with SQLSTATE `OV403`. A move is not gated by it (a
  rename keeps the note).
- `org_vault_settings.updated_by` and `org_vault_revisions.updated_by` key to
  `auth.users` `on delete set null`, 0022's rule, found by catalog like
  0022's five: deleting an account clears who changed the settings or wrote a
  version and keeps every row, in `auth.admin.deleteUser`'s own transaction,
  so a teammate's overwrite between `delete-account`'s history clear and the
  deletion no longer leaves the id behind. The keys land `NOT VALID`, ids of
  accounts already gone are cleared (0022's trigger allows exactly that
  update), and then they are validated. A partial index on the revisions'
  author serves the set-null.

**Order (founder gate):** 0025 goes to production from `main` AFTER 0021 and
0024 (it re-creates their write RPCs) and after 0022 and 0023, in the same
push, and before the team client that reads settings or maps `OV402` is used.
0023's free caps are triggers, so they hold under the write RPCs 0025
re-creates; 0023's `org_is_entitled` has no beta window for an org with no
entitlement row, so such an org may write team notes under 0025 and 0023 still
caps its bytes.

**When pay gates come back (founder gate).** Ship a one-line migration that
replaces the body of `no_entitlement_vault_until()` with a date at least 30
days after that migration reaches production, for example
`select timestamptz '2027-01-31 00:00+00';`. That date is the notice: the app
shows "Team notes stay editable until <date>" from `entitled_until`. After
it, an org with no entitlement row reads and exports every note, and buying a
plan unlocks editing. Never ship a date inside 30 days: that is the cliff this
function exists to avoid.

## Migration 0026 (Download my data version 2, tombstone retention): what changed and how to ship it

`migrations/0026_export_and_retention.sql` (CTO 11) closes the two gaps the
overlap between production's 0019 and main's files opened. Nothing applied is
edited; both parts are a `create or replace` or a re-schedule.

- `export_my_data()` keeps 0019's nineteen keys, moves `version` to 2, and
  adds `org_vault_revisions_authored` (0021), `org_vault_settings_updated`
  (0025), `enforcement_tombstone` (level and `recorded_at` under the caller's
  email, never the hash; 0022) and `review_staff` (0020). Its header says what
  it leaves out and why: `org_storage_usage` names no person, `deletion_holds`
  is linked to no live account, and `abuse_reports` wait on counsel (founder
  decision F4), so no copy says the export holds everything.
  `app/test/supabaseMigrations.test.ts` classifies every table a migration
  creates as read or left out with a reason.
- `oscode_guardrail_retention` is re-scheduled under the same name and time
  with 0019's three deletes verbatim plus
  `delete from public.enforcement_tombstones where recorded_at < now() -
  interval '2 years'`: a tombstone re-creates the effect of an enforcement
  action, so it may not outlive the two years the 2026-09-24 ruling gives
  those actions. Because it unschedules and schedules the whole job, it also
  schedules it where pg_cron was off when 0019 ran.

**Order:** after 0019, 0021, 0022 and 0025, in the same push as 0021 to 0025.

### Warning: `supabase config push` and email confirmations (P0-4)

`config.toml` now sets `[auth.email] enable_confirmations = true`. Keep it
that way. The newer CLI's `supabase config push` mirrors `[auth]` to the hosted
project, so a local `false` would switch confirmations OFF in production, and
with them off, anyone who signs up with an invited email gets a session whose
JWT carries that email and inherits the seats (admin included). 0015 adds a
SQL check on `email_confirmed_at` as a second lock, but the dashboard toggle
(Authentication, Providers, Email, "Confirm email") must be ON as well. Also
keep "Secure email change" on, since the claim keys on the JWT email.

### `STRIPE_IGNORED_PRICES` (BE-13)

An unmapped Stripe price still throws (a 500 keeps Stripe retrying and emails
the owner; a silent 200 would strand a paid buyer). The one exception is a
price listed in `STRIPE_IGNORED_PRICES` (comma-separated `price_...` ids): the
webhook logs and acks it. Use it for a legacy or test price that has nothing
to do with entitlements. Watch for the Stripe "webhook endpoint failing" email:
that is the signal a real price is unmapped and needs a `STRIPE_PRICE_*`
secret, not an ignore entry.

Entitlements are read straight from `org_entitlements` (webhook-written,
client-read-only) and gated on `status`. There is no signed-claim function; the
old Ed25519 entitlement-claim path was removed as dead code.

Two entitlement rails, one gate. Commercial teams live in `org_entitlements`
(seat-based, org-scoped). The individual Personal plan ($20/yr, unlocks the full
app for one person) lives in `user_entitlements` (keyed by `user_id`, migration
0006), written by the same `stripe-webhook` when a checkout carries
`metadata.userId` instead of `orgId`, and on iOS by the Apple rail (see below).
The app treats EITHER an active individual OR org entitlement as unlocking
(`personalUnlocked` in `app/src/state/store.ts`). Personal accounts stay orgless.

## Phase 0 - get sign-in working (do this first)

1. Create a Supabase project. Copy `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
   into the app's `.env.local`.
2. Create the guardrail Vault secret first (the 0019 section above: 0019
   stops without it), then apply the schema from main:
   `supabase db push --linked --skip-vault` (or run `migrations/0001_orgs.sql`,
   `0002_rls.sql`, `0003_claim.sql` in the SQL editor, in order).
3. Auth settings: enable Email (magic link and/or password). Add the app's
   redirect URLs so the magic-link callback lands on the app's own origin:
   - iOS: `oscode://auth-callback` (register the scheme in the app; wire the
     Capacitor App `appUrlOpen` listener to `completeAuthCallback(url)`).
   - Electron: `http://127.0.0.1:4817/auth-callback`.
   - Web (dev): `http://localhost:5173/auth-callback`.
4. Done when: a teammate an admin invited by email signs in on their own device
   and `refreshOrgRole()` returns their role. No billing needed yet.

## Phase 1 - server-truth RBAC + per-user daemon creds

- The app's `authorizeAdmin()` already round-trips to the server role when signed
  in. As admin-only actions move onto the daemon, gate them with the role the
  daemon now resolves (`osc token mint`, `hasRole`).

## Phase 2 - billing (Stripe, on the web)

1. Create 4 annual commercial prices in Stripe (Micro $20, Small $100, Growth
   $250, Scale $500) plus the individual **Personal $20/yr** price, and set
   `STRIPE_PRICE_MICRO/SMALL/GROWTH/SCALE` + `STRIPE_PRICE_PERSONAL` as function
   secrets.
2. Deploy the functions: `supabase functions deploy stripe-checkout
   stripe-webhook stripe-portal`. The webhook must be deployed with
   `--no-verify-jwt` (Stripe calls it, not a signed-in user); `config.toml`
   already sets that, so a plain `supabase functions deploy` honors it.
3. Set the Stripe webhook to the `stripe-webhook` function URL; copy its signing
   secret into `STRIPE_WEBHOOK_SECRET`. Subscribe it to at least
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, and `invoice.payment_failed`.
4. Apply the entitlement migrations (`0004_entitlement_status.sql`,
   `0005_orgs_rls_lockdown.sql`, `0006_user_entitlements.sql`) BEFORE or WITH
   this deploy: the webhook writes `last_event_at` and the widened status set,
   the seat write depends on the column grants in the lockdown, and the
   individual Personal rail writes `user_entitlements` (0006).

Apple 3.1.1: commercial **seats** and the **individual Personal** plan are bought
on the web (Stripe) here. On iOS the Personal unlock is an Apple In-App Purchase
instead (see Phase 3); the iOS app never opens Stripe Checkout in the WebView.

## Phase 3 - individual Personal via Apple IAP (iOS)

The Personal unlock on iOS is an Apple auto-renewable subscription, not Stripe.
Two functions own the Apple rail (added alongside the Stripe ones):

- `link-apple-purchase` - the app POSTs the signed StoreKit transaction (JWS)
  with the caller's access token; the function verifies it against Apple, binds
  `original_transaction_id -> user_id` in `apple_links` (move-not-duplicate), and
  upserts `user_entitlements` (source `apple`).
- `apple-notifications` - App Store Server Notifications V2 endpoint (the Apple
  analog of `stripe-webhook`): verifies the signed payload, resolves the
  transaction to a user via `apple_links`, and writes the same
  `user_entitlements` row on renew / expire / refund / revoke.

Apple secrets (function secrets): `APPLE_ISSUER_ID`, `APPLE_KEY_ID`,
`APPLE_PRIVATE_KEY` (the .p8), `APPLE_BUNDLE_ID`, `APPLE_APP_APPLE_ID`, the
root CA overrides (`_shared/apple.ts`), and `APPLE_PRODUCT_IDS` (the Personal
product id; the rail refuses everything until it is set, BE-9). Register the
`apple-notifications` URL as the App Store Server Notifications V2 endpoint in
App Store Connect. Both functions are deployed `--no-verify-jwt` where Apple (not
a signed-in user) calls them; `config.toml` sets that for `apple-notifications`.

Replay defence (BE-4, migration 0015): `apple_links` records the
subscription's live state from every notification, and `link-apple-purchase`
refuses a stale, refunded, revoked, or over-48-hour-old JWS. The remaining
follow-up is to ask the App Store Server API for live status with the `.p8`
above, which closes the window between two notifications.

## Phase 4 - connect repos over OAuth (the GitHub App path)

One-tap "Connect GitHub" in the Repositories screen runs the OAuth web flow
(`app/src/lib/gitos/repoOAuth.ts`); the `repo-oauth` function holds the client
secret and does the token exchange. The app only ever sends the public client
id and a redirect address; it never carries the secret.

**The Callback URL is the whole ballgame.** The app sends this exact
`redirect_uri` on the authorize call, and the same string on the token
exchange, both derived from the build's Supabase URL:

```
<VITE_SUPABASE_URL>/functions/v1/repo-oauth/callback
```

For the live OS Code project that is:

```
https://lzlrlfdffwiypzreoldb.supabase.co/functions/v1/repo-oauth/callback
```

A GitHub App requires the `redirect_uri` to match one of its registered
Callback URLs **exactly** (scheme, host, and path, byte for byte). If it does
not, GitHub never shows the consent screen; it shows **"The redirect_uri is not
associated with this application."**

GitHub App "OpenShore Code" (slug `openshore-code`, owned by openshore-labs),
settings:

- **Visibility (read 2026-09-25): the App is PRIVATE.** github.com/apps/openshore-code
  says "OpenShore Code is a private GitHub App", so it can be installed only on
  openshore-labs. Anyone else can sign in but sees no repositories, because a
  GitHub App token reaches only repositories where the App is installed. Before
  anyone outside openshore-labs uses one-tap GitHub, open the App's settings,
  Advanced, and choose **Make public** ("Any account").

- **Callback URL**: the exact string above. A GitHub App created without a
  Callback URL rejects every `redirect_uri`, so this field must be filled in.
- **Permissions**: Contents read/write, Pull requests read/write, Metadata read.
- The App's **Client ID** goes to `VITE_GITHUB_CLIENT_ID` (public, app build,
  a Codemagic build var) and `GITHUB_OAUTH_CLIENT_ID` (function secret); its
  generated **client secret** goes to `GITHUB_OAUTH_CLIENT_SECRET` (function
  secret). GitLab and Bitbucket light up the same way once their `*_CLIENT_ID`
  and `*_CLIENT_SECRET` are set; one Callback URL serves all three.

Deploy: `supabase functions deploy repo-oauth` (verify_jwt is false in
`config.toml`, since the provider redirect carries no bearer).

Which repositories a person sees is decided by the App's **installation**, not
by the sign-in: a GitHub App user token reaches only the repositories that both
the person and the App can reach. An App installed on an organization with
"Only select repositories" shows just those in the repo picker, which now says
so and links to the installation's settings page. `VITE_GITHUB_APP_SLUG`
(`openshore-code`, set in `codemagic.yaml` and `release.yml`) sends a person
with no installation yet to the install page; once any installation exists,
GitHub reports the slug itself. The desktop release builds read
`VITE_GITHUB_CLIENT_ID` (and the GitLab/Bitbucket ids) from repository
variables; add them with the Codemagic group's values, or the desktop keeps
the paste-a-token path.

### Troubleshooting "redirect_uri is not associated with this application"

The address the app sends is not (yet) registered on the App the client id
points at. Walk these, in order:

1. **The GitHub App has that Callback URL.** Open the App the
   `VITE_GITHUB_CLIENT_ID` names, and confirm its Callback URL field contains
   the exact string above. Missing or different is the usual cause; add it.
2. **The client id points at that App.** A stray personal OAuth App with a
   different callback, baked into `VITE_GITHUB_CLIENT_ID`, produces this error
   even though GitHub finds an app. Confirm the build var is the OpenShore Code
   App's client id.
3. **`VITE_SUPABASE_URL` names the right project and has no trailing slash.**
   The redirect is derived from it, so it must be the project whose URL the
   Callback names. The app and the function now trim a trailing slash before
   composing the URL (a `host//functions/...` was one silent way to break the
   exact match), but the two still have to name the same project over https.

The app helps you read the live value: when a one-tap connect fails, the
Repositories screen shows the exact Callback URL this build sends, with a copy
button, so you can paste precisely that string into the App's settings.
