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
| Stripe (server)      | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (function secrets)                   | stripe-checkout / -webhook / -portal     |
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

Tests: `supabase test db` runs `tests/rls.test.sql` (pgTAP, 32 assertions
over the cases above). `deno test functions/_shared/entitlement.test.ts` covers
the pure decisions (cross-rail guard, checkout routing, Apple product and
freshness checks, ignored prices).

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
