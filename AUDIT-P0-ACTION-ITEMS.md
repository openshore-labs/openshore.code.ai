# OS Code P0 Beta: Action Items (founder step-by-step)

This is the checklist we work through together, one step at a time. The code is
built and gate-green on branch `claude/openshore-audit-p0-roadmap-o1e3vj`
(app + engine tests, lint, typecheck all pass). What is left is the work only
you can do (secrets, App Store Connect, OAuth consoles) plus on-device
verification of the native pieces I cannot run in a headless session.

Everything below is grouped so we can go in order. Each item says what to do,
why, and how we will know it worked. Commands are given one at a time per your
standing rule; where a step is interactive, I say exactly what to paste when
prompted.

Legend: [CONFIG] you set a secret or a console setting. [VERIFY] you run or tap
something on a real device/build and confirm. [CODE-LATER] a scoped follow-up I
can build next; not P0-blocking.

---

## Decision (2026-08-31): Personal is an Apple subscription, not Stripe

Per the founder: the Personal tier ($20/yr) is bought ONLY as an Apple
auto-renewable subscription in the app on iPhone/iPad. There is no Stripe
purchase for Personal. On web/desktop the paywall points the user to buy it on
their iPhone, then "I bought it" refreshes the entitlement to unlock the same
account on that computer (the entitlement is one row, read on every device).
The app code already reflects this (`buyPersonal`/`Paywall`). Stripe stays ONLY
for commercial team plans (seat-based SaaS, which Apple forbids in-app anyway),
which are not required for the iOS beta.

So do **Group A (Apple)** to turn on paid beta. **Group A-Stripe is optional**,
only if you want to sell commercial team plans during the beta.

---

## Group A: Turn on Personal (Apple subscription), do first

### A1. [CONFIG] Create the subscription product
- In App Store Connect, create the auto-renewable subscription
  `ai.openshore.oscode.personal.yearly` at $20/yr.
- Enable the In-App Purchase capability on the App ID.
- Confirm `cap sync ios` links the `oscode-iap` plugin.

### A2. [CONFIG] Apply migrations + deploy the functions
- Run `supabase db push` (applies through `0010`, including `user_entitlements`
  and the Apple-notification dedupe table).
- Deploy: `supabase functions deploy link-apple-purchase apple-notifications checkout-return`
Why: `link-apple-purchase` verifies the StoreKit transaction and writes the
entitlement; `apple-notifications` keeps it in sync on renew/cancel/refund.
(`checkout-return` is only used by commercial Stripe purchases; deploying it now
is harmless and keeps the set complete.)

### A3. [CONFIG] Apple verification secrets (the current hard blocker)
The four Apple Root CA constants in `supabase/functions/_shared/apple.ts` are
still placeholder strings, so every Apple purchase verification throws today.
- Set `APPLE_ROOT_CA_G3_DER_BASE64` (real base64 DER of Apple's root CA) as a
  function secret, OR paste the real DER into `apple.ts`.
- Set `APPLE_BUNDLE_ID` and `APPLE_APP_APPLE_ID`.
- Register the `apple-notifications` function URL as the App Store Server
  Notifications V2 endpoint.
Why: without a real root cert, a real iOS buyer is charged and stays locked.

### A4. [CONFIG] Sandbox toggle, only during review
- Set `APPLE_ALLOW_SANDBOX=1` ONLY while Apple is reviewing the build, and
  clear it afterward. Leaving it on in production accepts $0 sandbox purchases
  as real unlocks.

### A5. [VERIFY] Sandbox purchase + restore on a real device
- On a TestFlight/sandbox device, buy Personal, confirm the app unlocks and an
  App Store Server Notification is received, then restore on the same device
  and (optionally) sign in on desktop and use "I bought it" to confirm the
  entitlement unlocks that computer too.

### A6. [CONFIG] Update the public pricing page (marketing repo)
- The `Open-Shore-LLC-Homepage` pricing page still has a Stripe "Get Personal"
  buy button. With Personal now Apple-only, change that to a "Download on the
  App Store / buy Personal in the app" call to action. Commercial tiers keep
  their Stripe buttons. (Separate repo; say the word and I will do it.)

---

## Group A-Stripe (OPTIONAL): Commercial team plans only

Skip this entirely unless you want to sell commercial (team, seat-based) plans
during the beta. Personal does NOT use any of it.
- [CONFIG] Confirm `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are the real
  live values (a past incident had them blank, which 401'd checkout), the four
  commercial price ids are set, and the webhook endpoint is live.
- [CONFIG] Deploy `stripe-checkout stripe-webhook stripe-portal`.
- The commercial checkout return path already deep-links back into the app via
  `checkout-return` (no extra config for the happy path); set
  `CHECKOUT_FALLBACK_URL` only to override the fallback link target.
- [VERIFY] One real, refundable commercial purchase proves the secret values,
  which cannot be read back.

---

## Group C: Get the app onto testers' devices

### C1. [CONFIG] Persist the iOS signing certificate
- Paste `CERTIFICATE_PRIVATE_KEY` into the Codemagic `Harbor-os-code` variable
  group so builds reuse one distribution cert instead of minting a new one
  each run (which eventually hits Apple's cert cap).

### C2. [VERIFY] Run the first TestFlight build
- Trigger the `ios-testflight` Codemagic workflow. Expect one round of Swift
  fixes on the first-ever native compile; tell me the errors and I will fix
  them. Note the pipeline now runs the full test suite first and will stop on a
  red test.
Verify: a build reaches TestFlight and installs on your device.

### C3. [CONFIG] Enable external TestFlight (when ready for non-founder testers)
- Fill in Beta App Information and Beta App Review contact info in App Store
  Connect, flip `submit_to_testflight: true` in `codemagic.yaml`, and add an
  external test group (see `docs/TESTFLIGHT.md` section 6).
Why: today only internal testers you add manually can receive a build.

### C4. [VERIFY] First desktop run + closed-beta artifacts
- On your Pop!_OS machine: `cd ~/openshore.code.ai && pnpm install`, then
  `pnpm --filter os-code build`, then from `app/`: `pnpm run desktop` to
  confirm the app launches against real Ollama.
- To produce a beta installer: `pnpm run package:linux` (also `package:mac` /
  `package:win` on those OSes). These are unsigned for closed beta, so first
  launch shows a Gatekeeper/SmartScreen warning; testers use right-click Open
  (mac) or "More info > Run anyway" (Windows). Auto-update is intentionally not
  wired yet (waits for signing).

---

## Group D: Capabilities that block the next distribution build

### D1. [CONFIG] iCloud capability
- Enable the iCloud capability with container `iCloud.ai.openshore.oscode` on
  the App ID before the next distribution build, or signing fails.

### D2. [CONFIG] Push Notifications capability + APNs
- Enable Push on the App ID. When you want push live, create the APNs key and
  set the `APNS_*` secrets per `docs/PUSH-SETUP.md`, then deploy the push
  functions. Not P0-blocking; the client ships dormant.

### D3. [CONFIG] Google Drive OAuth (only if you want Drive storage in P0)
- Register an iOS and a Desktop OAuth client in Google Cloud Console and set
  `VITE_GDRIVE_IOS_CLIENT_ID`, `VITE_GDRIVE_DESKTOP_CLIENT_ID`,
  `VITE_GDRIVE_DESKTOP_CLIENT_SECRET`. Until then, Drive stays hidden and the
  vault storage sheet shows Local (and This folder on desktop) only.

### D4. [CONFIG] Supabase Auth redirect URLs
- In the Supabase Auth dashboard, add every redirect URL to the allow list:
  the web origin's `/auth-callback`, `oscode://auth-callback`, and
  `oscode://checkout-success`. Confirm the Site URL fallback is sane.
Why: the new desktop auth + checkout deep links use `oscode://`.

### D5. [PROCESS] App Store review notes
- Before submitting, paste the ATS justification from
  `docs/app-review-notes.md` into the App Store Connect review-notes field
  (the daemon is reached over plain HTTP inside the Tailscale tunnel, so
  `NSAllowsArbitraryLoads` is required and expected for this class of app).

---

## Group E: Verify the Phase 0-4 code on real devices

These are things I built but cannot run headlessly. Please confirm on a real
build:
- [VERIFY] Empty-state first message with no model/computer/key opens the model
  chooser and sends the held message once a working brain is picked (iOS and
  desktop).
- [VERIFY] Desktop sign-in via magic link / email confirmation / password reset
  all return into the app over `oscode://` (this replaced the dead
  127.0.0.1:4817 redirect).
- [VERIFY] After a Stripe purchase, returning to the app unlocks without a
  manual refresh.
- [VERIFY] The trimmed sidebar (primary five + "More rooms") reads well on
  phone and desktop.

---

## Group F: Scoped follow-ups I can build next (not P0-blocking)

Say the word and I will build any of these:
- [CODE-LATER] QR-scan pairing on the phone (a camera/barcode plugin), so a
  user never hand-types a Tailscale IP and token. Native, so it needs a
  TestFlight verify after.
- [CODE-LATER] One-tap free starter local model install on desktop (via the
  existing Ollama install bridge), so free desktop users get a local chat model
  without touching the Personal Marketplace. Needs desktop verification.
- [CODE-LATER] First-repo golden path on desktop: from an empty Repositories
  screen, one card to open/clone straight into a coding session, verified end
  to end (read, edit-with-approval, run, commit) on your machine. Closes the
  standing "first desktop run" item.
- [CODE-LATER] Low-storage preflight before a model download (free-space check
  and a friendly "free up about X GB" message) in the iOS llama plugin.
- [CODE-LATER] Focus traps on sheets + a polish-standards guard test (the last
  a11y item the project flagged).
- [CODE-LATER] Quick-chat "Keep this chat?" prompt before a long throwaway
  conversation is discarded.
- [CODE-LATER] Claude subscription sign-in (finish the OAuth stub) so a
  claude.ai subscriber connects without a Console API key. CFO flagged a CTO
  pass on Anthropic's OAuth/ToS terms before building.
- [CODE-LATER] BYOM true streaming + cancel on iOS/Electron (needs an Electron
  IPC stream channel and an iOS URLSession SSE bridge).

---

## When we are done with Groups A-D

The P0 beta bar is met: a non-founder can get the app, sign in, recover a
password, pay $20 on either rail and see it unlock, and always get a real first
answer or an honest next step. At that point we decide whether to merge the
branch to `main` (it currently carries only this remediation) and cut the first
external beta.
