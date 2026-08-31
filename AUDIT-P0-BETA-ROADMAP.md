# OS Code P0 Beta Audit and Build Roadmap

Date: 2026-08-31. Repo state audited: `378d0fc` on `main`.
Audience: **Opus 4.8, the builder.** This document is your work order. Read it
top to bottom before writing code. Findings carry file:line evidence from a
four-track audit (auth/billing, onboarding-to-first-build, UI/UX completeness,
delivery/ops readiness) of the full codebase.

## How to use this document (read first)

1. **The mission scenario.** A new user signs in, pays for the base Personal
   subscription ($20/yr), and starts building immediately, as easily as in the
   Claude app. Every finding below is graded against that journey.
2. **Work the phases in order.** Phase 0 items are truthfulness and money-path
   bugs; nothing else matters while a paying user can get a fake answer or pay
   and stay locked. Later phases assume earlier ones landed.
3. **Honor the repo's standing rules** (`CLAUDE.md`): no em dashes anywhere in
   tracked source (the policy test fails the build); foundations are
   load-bearing, build additively, never renovate a working foundation without
   the founder's express approval; run the full gate before every push
   (`pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test`, `vite build`).
4. **Decision points are marked `FOUNDER DECISION`.** Do not guess these
   silently. Present them, wait for the answer, then build. Items marked
   `FOUNDER CONFIG` cannot be built in code at all; they are ops steps only the
   founder can perform (secrets, App Store Connect, OAuth consoles). Surface
   the checklist in Part 4 to the founder early, because several of them block
   everything else from being verifiable.
5. **Each work item has acceptance criteria.** A phase is done when its
   criteria pass, not when the code compiles.

## Part 1: State of the product (what the audit found)

### What is genuinely strong (build on it, do not rework it)

- The entitlement core: `personalUnlocked` resolver and the single gate
  chokepoint in `newConversation` (`app/src/state/store.ts:704-716`,
  `1529-1540`); Stripe webhook ordering/idempotency discipline
  (`supabase/functions/stripe-webhook/index.ts`); Apple JWS verification with
  cross-rail conflict handling (`supabase/functions/link-apple-purchase`).
- The desktop-paired path engineering: `RemoteDriver` SSE resume, PTY
  terminal multiplexing, per-device revocable credentials
  (`app/src/drivers/remoteDriver.ts`, `app/src/screens/TerminalScreen.tsx`).
- Background-safe iOS model downloads (survive suspend/kill, resume on
  relaunch, real progress).
- The BYOK connect UX (`app/src/screens/ConnectionsScreen.tsx`) plus
  `CloudClaudeDriver`: today's one true "type a prompt, get a great answer"
  path.
- Polished screens worth copying patterns from: StackHealthScreen (four
  distinct load/error/empty states), Paywall (correct IAP/Stripe branching),
  SourcePicker ("never a dead end" principle), VaultScreen's empty/error pair.
- CI on `main` runs the full suite with no skipped tests.

### The five journey-breaking findings (severity order)

**F1. Desktop chat silently returns a FAKE canned answer.** On Electron the
`OscodeLlama` Capacitor plugin has no native implementation, so
`registerPlugin('OscodeLlama', { web: () => new LlamaWeb() })`
(`app/src/lib/llamaPlugin.ts:184-186`) falls back to the `LlamaWeb` demo mock,
whose `load()` always returns ok and whose `generate()` fabricates
"(demo) A local model would answer ... right here, fully offline"
(`llamaPlugin.ts:118-131`). The empty chat defaults `selectedSource` to
`{kind:'stack'}` (`app/src/screens/ChatScreen.tsx:124`), and with no stack
configured `buildDriver` uses `emptyStack()` whose reasoning anchor is Harbor
Mini on-device (`app/src/state/store.ts:845-869`, `app/src/lib/stack.ts:99-103`).
Net: a paying desktop user who skips onboarding and types their first message
gets a fake response that looks real. This is the single worst bug in the
product.

**F2. iOS first message can dead-end on a raw native error.** Same default
path on iOS: if Harbor Mini was never downloaded ("Skip for now" skips it),
`StackDriver.runDevice` fails `Llama.load` and the turn ends in a raw
"would not load" error (`app/src/drivers/stackDriver.ts:260-265,335-350`),
with no nudge toward downloading a model. The Model Sheet has the readiness
check (`app/src/components/ModelSheet.tsx:118,203-213`) but the default
composer path bypasses the sheet entirely.

**F3. Paid but still locked.** After Stripe checkout in the external browser,
the success URL is the marketing site (`supabase/functions/stripe-checkout/index.ts:34`,
`?checkout=success` is parsed nowhere in the app), and no
foreground/visibility listener re-fetches entitlement (the only
`refreshEntitlement` calls are at init, auth callback, and the iOS IAP branch:
`app/src/state/store.ts:1093,1358-1362,1460`). The user returns to an app that
still shows the paywall until they find "Already bought? Refresh your license"
or relaunch. On iOS the deeper break: the four Apple Root CA constants are
literal `PASTE_REAL_BASE64_DER_HERE_` placeholders
(`supabase/functions/_shared/apple.ts:65-69`), so with no secret set EVERY
Apple purchase verification throws. Apple charges the user; the app stays
locked.

**F4. No route to a real answer for a user with nothing.** There is no hosted
model and no Claude subscription sign-in (`os-code/src/auth/claude.ts:71-74`
is an explicit stub; connecting Claude requires a separately funded Anthropic
Console API key). Harbor guides are iOS-only and explicitly "not a coder."
Desktop onboarding's own primary card ("Set up your local stack") routes
into the Marketplace paywall for free users (`app/src/components/StartingPaths.tsx:202-209`,
`app/src/state/store.ts:1418-1424`), contradicting the public "Free to chat"
headline on desktop.

**F5. No self-serve way to get the product.** TestFlight is internal-only
(`codemagic.yaml:114-124` has `submit_to_testflight: false`) and the first
Codemagic build has never run; desktop ships only as a source build
(`pnpm desktop`) with a Linux-only electron-builder target, no installer
artifact hosted anywhere, no auto-update, no mac/win targets
(`app/package.json:14-16,63-82`); no Android, no web app. Codemagic also runs
no test suite before shipping to TestFlight (`codemagic.yaml:40-62`).

### Full findings ledger (work these into the phases below)

Auth and account:
- A1. Electron auth redirect `http://127.0.0.1:4817/auth-callback`
  (`app/src/state/store.ts:886-897`) has no listener anywhere; the only
  loopback server is Google Drive OAuth on a dynamic port
  (`app/electron/main.ts:228-269`). Desktop magic-link and email-confirmation
  sign-in dead-ends at connection refused.
- A2. Password sign-up sends no `email_redirect_to`
  (`app/src/lib/supabase.ts:76-85`, contrast `:89-96`), so the confirmation
  link lands on the Supabase dashboard Site URL, not back in the app.
- A3. No forgot/reset password flow at all (absent from `supabase.ts` and
  `SignInCard.tsx`).
- A4. No resend-confirmation affordance.

Billing:
- B1. Foreground entitlement refresh missing (F3).
- B2. Checkout success URL not deep-linked back to the app (F3).
- B3. Apple root CA placeholders (F3, plus FOUNDER CONFIG).
- B4. `STRIPE_PRICE_PERSONAL` unset; migrations 0006-0008 and function
  deploys unconfirmed on the live project (FOUNDER CONFIG,
  `os-code/PROGRESS.md` "[TOP]" entry).
- B5. Commercial account setup says "Billing is not live in this build"
  (`app/src/components/AccountSetup.tsx:119-122`).
- B6. Pricing bands hand-mirrored in two files with a drift warning
  (`app/src/lib/plans.ts:43-76` vs `supabase/functions/_shared/entitlement.ts:44-49`).

First-run and model path:
- M1. Fake demo reply on desktop (F1). M2. iOS dead-end first message (F2).
- M3. Stack-readiness check lives only in ModelSheet, not in
  `newConversation`/`buildDriver`.
- M4. No hosted fallback, no Claude subscription sign-in (F4).
- M5. Desktop free onboarding path paywalled (F4).
- M6. No low-storage preflight or "free up space" message on 1.1GB downloads
  (`ModelStore.swift:250-280` forwards raw URLSession errors).
- M7. BYOM/OpenAI-compatible responses buffer-then-dump on iOS/Electron, no
  streaming or cancel (`app/src/drivers/stackDriver.ts:442-461`).
- M8. Phone task router is a keyword regex placeholder
  (`stackDriver.ts:9-13,54`).

Coding agent and pairing:
- P1. Phone pairing screen says "paste or scan" but has no scanner; users
  hand-type a Tailscale IP and an `osc_...` token
  (`app/src/screens/PairScreen.tsx:2,168,170,230-362`).
- P2. Pairing hard-requires Tailscale on both devices; daemon supports only
  loopback or tailscale binds, no LAN option
  (`os-code/src/daemon/serve.ts:75-86`).
- P3. Phone-only Repositories collapses to a static card, yet the GitHub
  token connect section above it stays live and leads nowhere
  (`app/src/screens/ReposScreen.tsx:43,60-76,106-158,388-401`; PROGRESS PAR-3:
  no push path for platform-remote repos).
- P4. Daemon install story is source-only; no packaged path for the machine
  side of pairing.
- P5. ATS fully disabled (`NSAllowsArbitraryLoads=true`) for the plain-HTTP
  Tailscale transport (`docs/app-review-notes.md:6-35`), an App Review risk.

UI/UX coherence:
- U1. 12-13 top-level nav destinations on day one
  (`app/src/components/Sidebar.tsx:18-31`); onboarding shows 4-5 path cards
  before the first chat. Overwhelming versus the Claude bar.
- U2. Three of four credential flows save without validation and show
  "connected" for a bad key (ConnectionsScreen, ReposScreen GitHub token,
  LaunchScreen Codemagic, BYOM); only PairScreen health-checks first
  (`PairScreen.tsx:249-263`).
- U3. Dropbox and Proton render as tappable storage rows that toast and do
  nothing (`app/src/lib/gitos/providers.ts:121-144`,
  `app/src/screens/VaultScreen.tsx:659-676`); Google Drive is inert until
  `VITE_GDRIVE_*` ids exist (FOUNDER CONFIG).
- U4. CrewScreen promises per-agent stats that Stack Health explicitly says
  are "coming" (`app/src/screens/StackHealthScreen.tsx:380-382`).
- U5. No focus trap on any sheet (repo-wide grep confirms), a known polish
  hole per PROGRESS.
- U6. Quick chat is destroyed on exit with no warning before a long
  conversation is invested in it (`Sidebar.tsx:265`, `ChatsScreen.tsx:96`).
- U7. TerminalScreen renders a bare black div during `connecting`
  (`TerminalScreen.tsx:34-58,213-238`).
- U8. AdminScreen footnotes that roles are only client-enforced
  (`AdminScreen.tsx:242-245`).
- U9. `REPO_OUTBOX_ENABLED = false` hides a built home-repo feature with no
  trace (`ReposScreen.tsx:21-22`), fine for P0 but keep hidden knowingly.

Delivery:
- D1. External TestFlight off; first Codemagic build never run (FOUNDER
  CONFIG + verification).
- D2. Codemagic has no test gate before TestFlight (needs code:
  wire `pnpm -r test` into `codemagic.yaml`).
- D3. Desktop: no installer channel, Linux-only target, no auto-update, no
  signing (needs code + release pipeline).
- D4. Push notifications ship dormant pending APNs config
  (`docs/PUSH-SETUP.md`, FOUNDER CONFIG).
- D5. Engine parity gaps named in the project's own roadmap: MCP-stdio,
  checkpoints/rewind, vision beyond Claude (post-P0).

## Part 2: The P0 definition

P0 beta = one person who is not the founder can, unassisted:
1. Get the app (external TestFlight on iOS; a downloadable desktop build).
2. Create an account, confirm email, recover a password, and sign in on both
   platforms.
3. Pay $20 for Personal on either rail and see the app unlock within seconds
   of returning, every time.
4. Type a first message and always get a real answer or an honest, guided
   next step. Never a fake answer, never a raw native error.
5. Reach a real coding-agent session on a real repo from the desktop app, and
   from the phone when paired, with pairing achievable by a motivated
   non-expert in under ten minutes.
6. See no dead controls: everything tappable either works or says exactly
   what it needs.

Explicitly NOT P0: Android, web app, MCP, checkpoints/rewind, org Vault
multi-writer, BYOM true streaming, home-repo outbox, cross-user popularity,
vision beyond Claude. Do not let these creep in.

## Part 3: The build plan (work in this order)

### Phase 0: Never lie to the user, never take money without unlocking
(highest priority, smallest diffs, all buildable now)

**0.1 Kill the fake demo reply (M1, F1).**
- In `llamaPlugin.ts`, stop registering `LlamaWeb` as a functional fallback on
  non-native platforms. Replace its `load`/`generate` with implementations
  that throw a typed `DeviceModelUnavailable` error (keep the class if tests
  rely on it, but it must never fabricate an answer in a shipping build).
- Acceptance: on Electron, sending a message routed to a device model
  produces the guided empty-stack flow from 0.2, never a "(demo)" string. Add
  a regression test asserting no reachable code path returns the demo text.

**0.2 Stack readiness gate at the chokepoint (M2, M3, F2).**
- Add a `stackReady(settings, platform)` helper (export from
  `app/src/lib/stack.ts`) that answers: does the selected source have a
  loadable reasoning anchor right now (model downloaded on iOS, daemon or
  Ollama reachable on desktop, cloud provider key present for cloud refs)?
- Call it in `newConversation`/`startWith` for `kind:'stack'` and `'device'`
  BEFORE building a driver. When not ready, do not error: open a "Pick where
  your first answer comes from" sheet reusing the existing `StartingPaths`
  cards (download Harbor Mini, connect your computer, connect a cloud key),
  scoped to the platform. Mirror the logic ModelSheet already has at
  `ModelSheet.tsx:203-213`; do not fork a second readiness definition,
  extract and share one.
- If Harbor Mini exists but a load fails anyway, map the failure to human
  copy ("Harbor Mini could not start. Free up memory or pick another model.")
  with a retry and a "choose another model" action. No raw plugin errors in
  the transcript. Remember the em dash rule in all new copy.
- Acceptance: fresh install, skip onboarding, type a message on both
  platforms; the user always lands in a guided chooser, and after completing
  any one card the original message sends automatically.

**0.3 Entitlement refresh on return (B1, F3).**
- Add a single app-level listener (Capacitor `appStateChange` on native,
  `visibilitychange` on web/Electron) that calls `refreshEntitlement()` when
  the app foregrounds AND a session exists AND the paywall was shown this
  session or entitlement is currently empty. Debounce to at most once per 30s.
- In `buyPersonal()`'s Stripe branch, after opening the browser, start a short
  poll (every 5s for 2 minutes) of `refreshEntitlement()` so the unlock lands
  even if the user never re-foregrounds cleanly. Stop on success.
- Acceptance: simulate a webhook-written entitlement while the app is open on
  the paywall; the paywall dismisses itself within seconds of foregrounding,
  with a success toast ("Personal is unlocked. Welcome.").

**0.4 Checkout return path (B2).**
- Change the default `SUCCESS_URL`/`CANCEL_URL` in
  `stripe-checkout/index.ts` to a small static success page that attempts the
  app's deep link (`oscode://checkout-success` on iOS, the web/app origin
  elsewhere) and shows "Return to OS Code" as the manual fallback. Handle the
  deep link in `useAuthDeepLink`'s listener path to trigger
  `refreshEntitlement()` and dismiss the paywall.
- FOUNDER DECISION: where the success page is hosted (recommend a page under
  the marketing site's `/os-code/` path, since the checkout function already
  points there; the marketing repo owns that surface).
- Acceptance: complete a test-mode checkout; landing page offers the app
  link; returning to the app shows unlocked state without manual refresh.

**0.5 Auth dead ends (A1-A4).**
- A1: implement the Electron loopback listener. Recommended: reuse the
  pattern from `app/electron/main.ts:228-269` but on the fixed port 4817,
  started when a magic link or confirmation is requested, forwarding the
  callback URL into the renderer exactly as `useAuthDeepLink` expects, then
  serving a "You are signed in, return to OS Code" page. Alternatively
  register a custom protocol handler; pick one, implement fully, and update
  `supabase/README.md`'s redirect list to match reality.
- A2: pass `email_redirect_to` (same `authRedirectTo()` value) in `signUp`.
- A3: add `resetPasswordForEmail` to the supabase wrapper
  (`POST /auth/v1/recover` with `redirect_to`), a "Forgot password?" link in
  `SignInCard`, and a new-password form when the recovery callback arrives
  (the callback already flows through `parseAuthCallback`; handle
  `type=recovery`).
- A4: add a "Resend confirmation" action when sign-in fails with an
  unconfirmed-email error.
- Acceptance: on desktop and iOS, each of magic link, signup confirmation,
  and password recovery round-trips back into a signed-in app.

**0.6 Money-path config verification harness (B3, B4, supports FOUNDER CONFIG).**
- You cannot set the secrets, but you can make their absence loud. Add a tiny
  authenticated `billing-health` check (either a new function or a mode on
  stripe-checkout) that reports, without leaking values: which of
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PERSONAL`,
  `APPLE_ROOT_CA_G3_DER_BASE64`/non-placeholder root, `APPLE_BUNDLE_ID` are
  set. Surface it in the app's Admin/Settings for the founder only, and in
  `osc doctor`. This converts silent 401s into a named checklist.
- Acceptance: with a blank secret, the health check names it; with all set,
  it reports green.

### Phase 1: A great first answer for everyone (the "like Claude" gap)

**1.1 FOUNDER DECISION, present before building: the no-hardware fallback.**
The product currently has no path to a real answer for a user with no
capable device, no second computer, and no API key (F4). Options:
  a. Celebrated BYOK: keep no hosted model; make "Connect Claude/OpenAI/
     Gemini" a first-class onboarding card with in-app browser key creation,
     validation, and a 60-second path to a great cloud answer. Cheapest,
     honest, but requires the user to hold a funded API account.
  b. Hosted starter model: OpenShore-run inexpensive hosted endpoint free or
     included in Personal, used only until a local stack exists. Best "like
     Claude" feel; new infra, new costs, and it bends the local-first story.
  c. Claude subscription sign-in: finish the OAuth stub
     (`os-code/src/auth/claude.ts`) so a claude.ai subscriber signs in
     without an API key. Highest delight for Claude users; depends on
     external OAuth availability and is the least certain to ship.
Recommend (a) for P0 with (c) tracked, and note (b) is a business-model call
for the CFO/Board, not an engineering default. Wait for the founder's pick.

**1.2 One guided golden path in onboarding (M5, U1).**
- Fix the desktop free-path paywall contradiction: on desktop, the free local
  route must not dead-end in the Marketplace paywall. Either exempt a minimal
  "get one local model via Ollama" flow from the Marketplace gate, or point
  the card at a free stack-setup surface. FOUNDER DECISION on which
  (recommend: free users may install ONE starter local model; the full
  Marketplace stays Personal).
- Restructure onboarding to one recommended card per platform (iOS: Harbor
  Mini; desktop: the 1.1 fallback or Ollama), with the rest behind "More
  ways to start". After the first successful answer, surface the next step
  ("Ready to build? Unlock Personal") contextually, not as a wall.
- Acceptance: a new user on either platform reaches a real first answer with
  at most two taps plus one download/connect step, without seeing a paywall
  before their first answer.

**1.3 Credential validation everywhere (U2).**
- Extract PairScreen's validate-before-save pattern into a shared helper and
  apply it to ConnectionsScreen (one cheap provider ping per key),
  BYOM connect (hit the endpoint's models/completions probe), ReposScreen
  GitHub token (GET the token's user), LaunchScreen Codemagic token. Failure
  keeps the sheet open with the provider's error and a retry; success shows
  "connected" honestly.
- Acceptance: a mistyped key can no longer produce a "connected" state.

**1.4 Beta nav trim (U1, U9).**
- Introduce a simple/advanced split in the sidebar for P0: primary = Chats,
  Projects, Repositories, Your stack, Settings; everything else (Crew, Stack
  Health, Marketplace, Vault, Launch, Cloud Connections, Desktop+phone) under
  an "Explore" group or reachable from context. Purely presentational,
  no screen removals, no foundation changes. FOUNDER DECISION: confirm the
  exact primary set before building; propose the above as the default.
- Hide Dropbox/Proton rows behind an honest single "More storage arriving"
  line instead of tappable no-ops (U3); hide Google Drive until its
  `VITE_GDRIVE_*` ids exist at build time.
- Soften U4: change the Crew screen's stats promise to match reality until
  Stack Health Phase 2 lands.

### Phase 2: They can actually get it (distribution)

**2.1 iOS pipeline (D1, D2).**
- Wire `pnpm -r test` (plus lint/typecheck) as a blocking step in
  `codemagic.yaml` before the build.
- FOUNDER CONFIG (present as a numbered walk-through, one step at a time per
  the founder's standing rule): `CERTIFICATE_PRIVATE_KEY` in Codemagic; Beta
  App Information in App Store Connect; then flip
  `submit_to_testflight: true` and add an external group per
  `docs/TESTFLIGHT.md` section 6. Expect one round of Swift fixes on the
  first-ever Codemagic build; budget for it.
- Acceptance: a non-founder Apple ID receives and installs a TestFlight
  build.

**2.2 Desktop packaging (D3).**
- Add mac (dmg/zip, arm64+x64) and windows (nsis) targets to the
  electron-builder config alongside linux; add a GitHub Actions release
  workflow that builds all three on tag, runs the test gate first, and
  uploads artifacts to a GitHub Release; wire `electron-updater` against
  that release feed.
- FOUNDER CONFIG: Apple Developer ID signing + notarization credentials and
  a Windows signing story (or ship unsigned for closed beta with clear
  install instructions). FOUNDER DECISION: signed public artifacts vs
  unsigned closed-beta downloads for P0 (recommend unsigned closed beta to
  unblock, signing before public).
- Acceptance: a tester on each OS downloads one file, installs, launches,
  and later receives an auto-update (linux/mac at minimum; windows may trail
  if signing blocks).

**2.3 Daemon reachability for the machine side (P4).**
- The desktop app already embeds daemon start ("Turn on",
  `PairScreen.tsx:146-163`). Make that the only story for P0: pairing docs
  and UI should never send a normal user to `osc serve`/Termius. Update the
  CLI pairing wizard copy to reference the desktop app as the default path.

### Phase 3: The coding-agent on-ramp

**3.1 QR scan on the phone (P1).**
- Add a camera scan control to `PhonePair` (Capacitor barcode/camera plugin;
  pick one already maintained, e.g. `@capacitor-mlkit/barcode-scanning`),
  scanning the QR the desktop already renders, filling address+token, then
  auto-running the existing `connect()` health check. Keep manual entry as
  the fallback. Native code, so mark it "verify on TestFlight" in PROGRESS.
- Acceptance: pairing via scan is address-typing-free end to end.

**3.2 Pairing guidance, not protocol changes (P2, P5).**
- Do NOT change the daemon bind model without founder approval (security
  foundation; loopback/tailscale-only is a deliberate CTO-ruled posture).
  Instead: a step-by-step in-app pairing checklist with live state (Tailscale
  installed? logged in? daemon on? reachable?), each failing step linking its
  fix. If the founder wants a LAN bind option to drop the Tailscale
  requirement, that is a FOUNDER DECISION with a security review, and it is
  post-P0 by default.
- P5 (ATS exception) stays as documented for P0; keep
  `docs/app-review-notes.md` current, it is the App Review defense.

**3.3 Phone Repos honesty (P3).**
- When unpaired on phone, move the GitHub-token connect section behind the
  same "Connect your desktop first" card so a token can only be added
  somewhere it can be used, or keep it but with explicit copy that it
  activates after pairing. No more connect-then-nothing.

**3.4 First-repo golden path on desktop.**
- From an empty Repositories screen on desktop, one card: "Open a folder" or
  "Clone a repo", then straight into a `kind:'desktop'` conversation seeded
  with a "what should we build?" prompt. Verify the whole loop (read, edit
  with approval diff, run, commit) once end to end on the founder's machine
  and record it in PROGRESS (this closes the standing "first desktop run"
  item).

### Phase 4: Trust and polish sweep (bar: Claude iOS)

- 4.1 Focus traps on all sheets (U5); extend `polish-standards.test.ts` to
  guard it per the "enforcement, not memory" pattern.
- 4.2 TerminalScreen connecting state (U7): a labeled spinner until the PTY
  opens or fails.
- 4.3 Quick-chat data-loss guard (U6): on navigating away from a quick chat
  with 3+ user turns, offer "Keep this chat?" once.
- 4.4 Low-storage preflight (M6): before a download, check free space vs
  model size (iOS: `URL.resourceValues` volume capacity in the plugin;
  desktop asks the daemon); friendly "free up about X GB" message; map
  disk-full errors mid-download to the same copy.
- 4.5 Copy/clipboard no-ops (cross-platform): hide or swap for a share-sheet
  where clipboard is unavailable instead of toasting failure.
- 4.6 AdminScreen (U8): move the client-side-enforcement caveat to the
  add-member moment where it matters, worded plainly.
- 4.7 Pricing-band drift guard (B6): a test that asserts `plans.ts` bands
  equal `_shared/entitlement.ts` bands (share a JSON fixture if the deno/node
  split forces it).
- 4.8 Commercial honesty (B5): if commercial checkout is live by then, wire
  AccountSetup to it; if not, the copy must say what will happen and when.

### Post-P0 backlog (do not build now; keep visible)

MCP-stdio on the engine; checkpoints/rewind; Claude subscription OAuth (if
not chosen in 1.1); BYOM true streaming + cancel (needs Electron IPC stream
channel and iOS URLSession SSE bridge); replace the regex task router with a
Harbor Mini classification call; vision beyond Claude; org Vault multi-writer
UI polish; home-repo outbox producer; Android; web app; LAN pairing bind.

## Part 4: FOUNDER CONFIG checklist (blocking, not buildable in code)

Present these to the founder one at a time, in this order (his standing rule:
one command per message, wait for the result):
1. Stripe: create the $20/yr Personal price; set `STRIPE_PRICE_PERSONAL`
   function secret; `supabase db push` (0006-0010) and redeploy the five
   billing functions. Then one refundable live purchase to prove the values.
2. Apple IAP: create `ai.openshore.oscode.personal.yearly`; enable the IAP
   capability; set `APPLE_ROOT_CA_G3_DER_BASE64` (real DER), `APPLE_BUNDLE_ID`,
   `APPLE_APP_APPLE_ID`; register the apple-notifications URL for Server
   Notifications V2; `APPLE_ALLOW_SANDBOX=1` only during review; sandbox
   validate purchase/restore on device.
3. Codemagic: paste `CERTIFICATE_PRIVATE_KEY`; run the first ios-testflight
   build; fix the first-compile fallout; enable external TestFlight.
4. Apple portal: enable the iCloud capability (container
   `iCloud.ai.openshore.oscode`) and Push on the App ID before the next
   distribution build (signing fails otherwise, per DECISIONS).
5. Google Cloud: register the iOS and Desktop OAuth clients; fill
   `VITE_GDRIVE_IOS_CLIENT_ID`, `VITE_GDRIVE_DESKTOP_CLIENT_ID`,
   `VITE_GDRIVE_DESKTOP_CLIENT_SECRET` (or Drive stays hidden per 1.4).
6. APNs: key + secrets per `docs/PUSH-SETUP.md` when push matters (not P0
   blocking).
7. Supabase Auth dashboard: add every redirect URL Phase 0.5 standardizes
   (web origin, `oscode://auth-callback`, the Electron loopback), and confirm
   the Site URL fallback is sane.

## Part 5: Working agreements for the builder

- Verify before push: full gate (`pnpm -r lint`, `pnpm -r typecheck`,
  `pnpm -r test`, `vite build`), plus `npx cap sync ios` when native config
  changes. Anything iOS-native lands marked "not device-verified" in
  PROGRESS with the founder as the TestFlight verifier.
- Update `os-code/PROGRESS.md` per its format after each phase lands, and
  `DECISIONS.md` with one line per FOUNDER DECISION outcome.
- Small, phase-scoped pushes. Phase 0 items are independent; do not bundle
  them with Phase 1 UX changes.
- Copy rules: no em dashes anywhere in this repo, ever; keep the honest,
  calm OS Code voice; money copy is one guarantee per sentence, full stops.
- The sign-off gate applies: this whole roadmap, and each FOUNDER DECISION
  within it, needs the founder's explicit yes before the corresponding code
  is written. Phase 0.1 and 0.2 are the exception worth pressing for
  immediately: a product that fabricates answers is the one thing that
  cannot wait.
