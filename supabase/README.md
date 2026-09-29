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
| Stripe prices        | `STRIPE_PRICE_MICRO/SMALL/GROWTH/SCALE` (function secrets)                        | checkout + webhook (commercial tiers)    |
| Stripe price (indiv) | `STRIPE_PRICE_PERSONAL` (function secret)                                         | checkout + webhook (Personal $20/yr)     |
| Stripe ignore list   | `STRIPE_IGNORED_PRICES` (function secret, optional, comma-separated)              | webhook: log-and-200 for listed prices   |
| Apple products       | `APPLE_PRODUCT_IDS` (function secret, comma-separated, REQUIRED for the rail)     | link-apple-purchase, apple-notifications |
| Repo OAuth           | `GITHUB/GITLAB/BITBUCKET_OAUTH_CLIENT_ID/_SECRET` (function secrets)              | repo-oauth (PKCE + fixed error codes)    |

Rule: a secret can live in more than one place. Never put a service-role or
secret key in a `VITE_` var.

## Migration 0015 (review 2026-09-05): what changed and how to ship it

`migrations/0015_review_2026_09_05.sql` carries every schema fix from the
2026-09-05 review in one idempotent file. Ship it in this order:

1. `supabase db push` (applies 0015). Nothing in it is destructive.
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
  5 once billing is live, a one-line 0016), `org_seat_ceiling(org)`, and two
  SECURITY DEFINER triggers: a new or re-activated member past the ceiling is
  refused (existing rows are grandfathered on a downgrade), and
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

Tests: `supabase test db` runs every `tests/*.test.sql` file, each its own
rolled-back transaction with its own plan: `tests/rls.test.sql` (32
assertions over the cases above), `tests/org_vault.test.sql` (125 assertions
over 0019, 0020 and 0021, below) and `tests/account_deletion.test.sql` (37
assertions over 0022 and 0023, below). CI runs the same command in the `sql`
job of `.github/workflows/ci.yml`. `deno test functions/_shared` covers the
pure decisions: `entitlement.test.ts` (cross-rail guard, checkout routing,
Apple product and freshness checks, ignored prices) and
`accountDeletion.test.ts` (the deletion plan and the email hash).
`app/test/supabaseMigrations.test.ts` fails when two migration files share a
number.

## Migration 0019 (Org Vault v1): what changed and how to ship it

`migrations/0019_org_vault_v1.sql` gives the team vault compare-and-swap and
a history (Vault v1 plan item 2.3, CTO ruling G3):

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

**Order (founder gate):** push 0019 to production BEFORE the team-client
change (M2 stream D, `orgVault.ts` calling `org_vault_write`) merges to main,
because Codemagic ships every push to main to TestFlight. Run the preflight
below first.

**Preflight: case duplicates.** The unique index needs live paths in one org
to differ by more than letter case. 0019 renames any that do not (the most
recently updated note keeps its path; each other one moves to a free
"(conflict YYYY-MM-DD HHMM)" name and leaves a revision row), so nothing is
lost, but look first. In the SQL editor, before `supabase db push`:

```sql
select org_id, lower(path) as folded, count(*) as notes,
       array_agg(path order by updated_at desc) as paths
from public.org_vault_notes
where not deleted
group by org_id, lower(path)
having count(*) > 1
order by org_id, folded;
```

No rows means 0019 changes no data. Each row lists the paths that will be
renamed after the first one; tell the teammates who own them.

## Migrations 0022 and 0023 (account deletion, free caps): how to ship them

Apple requires in-app account deletion (guideline 5.1.1(v)); the app's
Settings, Your account, Delete account calls the `delete-account` function.
CTO ruling 4 (2026-09-29) numbers these 0022 and 0023. **Push from main only.**
0020 and 0021 are held on `vault-m2-team`, which renumbers them above main's
newest file when it merges; never push them from the held branch.

1. Preflight, in the SQL editor. Both queries should return no rows:

   ```sql
   select id, status from public.abuse_reports where request_hash !~ '^[0-9a-f]{64}$';
   select user_id, request_hash, array_agg(status) from public.abuse_reports
    where user_id is not null group by 1, 2 having count(*) > 1;
   ```

   0022 removes a queued report that repeats another for the same account and
   hash, and never one an operator acted on. If rows remain, it prints a
   NOTICE and leaves the new check unvalidated or the unique index uncreated;
   fix the rows by hand and re-run that block.
2. `supabase db push` (applies 0022, then 0023).
3. `supabase functions deploy delete-account` (`verify_jwt = true` in
   `config.toml`). It reads `STRIPE_SECRET_KEY` only when the account has a
   Stripe customer or subscription to cancel.

What 0022 does:

- Five author columns (`org_members.invited_by`, `org_vault_notes.updated_by`,
  `org_projects.created_by` and `updated_by`, `org_project_members.granted_by`)
  become `on delete set null`, found by catalog, so deleting someone who ever
  wrote to a team no longer fails on a foreign key.
- `enforcement_tombstones` keeps a SHA-256 of the lowercased email and the
  ladder level when a warned or terminated account is deleted (service role
  only, no policies). `record_enforcement` reads a level 2 tombstone as an
  operator's termination.
- `record_enforcement` itself works now. In 0016 to 0018 an unqualified
  `action` collided with the function's own output column, so every call
  raised and the server-side ladder never recorded a row (the app swallowed
  the error). Expect `enforcement_actions` rows to start appearing.
- `org_vault_revisions` stays append-only except for one update: clearing
  `updated_by`, which the function does for the departing person.
- `abuse_reports.request_hash` must be 64 hex characters, one report per
  account and hash.

What 0023 does: an account owns at most one org without a live plan
(`no_entitlement_max_owned_orgs()`, 1), and an org without a live plan holds
at most 25 MiB of note plus revision bytes (`no_entitlement_max_org_bytes()`),
counted in `org_storage_usage` by triggers and backfilled by the migration.
Both refuse with `check_violation`, only on growth; deletes always go
through. "Live plan" is `isEntitled`: `org_entitlements.status` active or
trialing with `valid_until` unset or ahead.

What `delete-account` does, in order (reads first, so a refusal never follows
a write): refuses `owns_org` (409) when an owned org has anyone else active;
cancels every Stripe subscription that could still charge (the person's and
each sole-member org's); writes the tombstone; deletes the sole-member orgs;
clears the person from team history and removes their memberships; then
`auth.admin.deleteUser`. It answers `{ ok: true, appleNote }`, where
`appleNote` means an Apple subscription the person must cancel on their
iPhone; errors are the fixed codes `unauthorized`, `owns_org`, `billing`,
`failed`. Each step is safe to repeat, so a retry finishes a partial run.

## Migration 0020 (Org Vault move): what changed and how to ship it

`migrations/0020_org_vault_move.sql` adds one RPC for the team vault's rename
(Vault v1 plan item 6.2, CTO rulings K3 and K12):

- `org_vault_move(org, from, to, if_match)` moves a live note when its rev is
  still `if_match`. It never replaces: a taken name, judged under
  `lower(path)` like 0019's unique index, answers `exists` with `theirs`; a
  stale rev is `changed` with `theirs`; a source that is gone is `missing`. A
  case-only rename of the same note is allowed and updates that row in place.
- The old version is kept as a `renamed` revision row; a move to a new name
  tombstones the source and writes the destination, each with a sequence rev.
- Same membership rule and grants as `org_vault_write` (authenticated only).

Team Trash needs no SQL of its own (K6, R3): a trash is `org_vault_remove`,
Restore is `org_vault_write` with `if_absent` from the latest `deleted`
revision (at the original path, or `{title} (restored).md` when that name is
taken), and there is no Empty, since `org_vault_purge` from 0019 already
drops tombstones and revision rows after 30 days.

**Order (founder gate):** 0020 goes to production AFTER 0019 (it calls 0019's
lock, snapshot, and sequence), and before the team client that calls
`org_vault_move` merges to main. `supabase db push` applies them in order.

## Migration 0021 (Org Vault settings and entitlement): what changed and how to ship it

`migrations/0021_org_vault_settings.sql` adds the team vault's settings and
its plan gate (Vault v1 plan item 7.4, CTO ruling L17, CX Y14 and Y15):

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

**Order (founder gate):** 0021 goes to production AFTER 0019 and 0020 (it
re-creates their write RPCs), and before the team client that reads settings
or maps `OV402` merges to main. `supabase db push` applies them in order.

**When pay gates come back (founder gate).** Ship a one-line migration that
replaces the body of `no_entitlement_vault_until()` with a date at least 30
days after that migration reaches production, for example
`select timestamptz '2027-01-31 00:00+00';`. That date is the notice: the app
shows "Team notes stay editable until <date>" from `entitled_until`. After
it, an org with no entitlement row reads and exports every note, and buying a
plan unlocks editing. Never ship a date inside 30 days: that is the cliff this
function exists to avoid.

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
2. Apply the schema: `supabase db push` (or run `migrations/0001_orgs.sql`,
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
