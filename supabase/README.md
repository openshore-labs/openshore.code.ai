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

Rule: a secret can live in more than one place. Never put a service-role or
secret key in a `VITE_` var.

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
`APPLE_PRIVATE_KEY` (the .p8), `APPLE_BUNDLE_ID`. Register the
`apple-notifications` URL as the App Store Server Notifications V2 endpoint in
App Store Connect. Both functions are deployed `--no-verify-jwt` where Apple (not
a signed-in user) calls them; `config.toml` sets that for `apple-notifications`.
