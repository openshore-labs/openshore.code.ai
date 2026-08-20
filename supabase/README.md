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
| Stripe prices        | `STRIPE_PRICE_MICRO/SMALL/GROWTH/SCALE` (function secrets)                        | checkout + webhook (price <-> tier)      |

Rule: a secret can live in more than one place. Never put a service-role or
secret key in a `VITE_` var.

Entitlements are read straight from `org_entitlements` (webhook-written,
client-read-only) and gated on `status`. There is no signed-claim function; the
old Ed25519 entitlement-claim path was removed as dead code.

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

1. Create 4 annual prices in Stripe (Micro $20, Small $100, Growth $250, Scale
   $500) and set `STRIPE_PRICE_*` as function secrets.
2. Deploy the functions: `supabase functions deploy stripe-checkout
   stripe-webhook stripe-portal`. The webhook must be deployed with
   `--no-verify-jwt` (Stripe calls it, not a signed-in user); `config.toml`
   already sets that, so a plain `supabase functions deploy` honors it.
3. Set the Stripe webhook to the `stripe-webhook` function URL; copy its signing
   secret into `STRIPE_WEBHOOK_SECRET`. Subscribe it to at least
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, and `invoice.payment_failed`.
4. Apply the entitlement migrations (`0004_entitlement_status.sql`,
   `0005_orgs_rls_lockdown.sql`) BEFORE or WITH this deploy: the webhook writes
   `last_event_at` and the widened status set, and the seat write depends on the
   column grants in the lockdown.

Apple 3.1.1: seats are bought on the web only. The iOS app signs in and reads
the entitlement; it never opens Stripe Checkout in the WebView.
