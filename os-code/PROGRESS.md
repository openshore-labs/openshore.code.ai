# PROGRESS

The recent-state source of truth for OS Code, kept in the same spirit as the
Uki app repo: current state first, then what remains, then the log.

## Current state (2026-08-31, P0 beta remediation)

**Full P0 beta audit + first four remediation phases landed on the feature
branch `claude/openshore-audit-p0-roadmap-o1e3vj` (NOT main).** A four-track
audit of the sign-in, pay, and start-building journey is written up in
`AUDIT-P0-BETA-ROADMAP.md`; the founder-facing config/verification checklist
is `AUDIT-P0-ACTION-ITEMS.md`. What was built (all gate-green: workspace
lint/typecheck, os-code 302 tests, app 268 tests):

- **Phase 0, truthfulness + money path.** The web/desktop llama fallback no
  longer fabricates a "(demo)" answer: it reports the device unsupported,
  fails load with a real message, and refuses to generate. A shared stack
  readiness definition (`stackReady`/`refReady` in `app/src/lib/stack.ts`)
  gates the empty-state composer, so a first message opens a guided model
  chooser instead of dead-ending. Entitlement now re-checks on app foreground
  and polls after Stripe checkout; a new `checkout-return` edge function
  deep-links back into the app over `oscode://checkout-success`, and the
  Electron `oscode://` protocol handler is wired (the old 127.0.0.1:4817
  redirect had no listener). Auth dead ends closed: sign-up confirmation
  redirect, forgot-password (recover + set-new-password), resend confirmation.
- **Phase 1, honest first-answer paths + calmer nav.** Sidebar trimmed to a
  primary five (Chats, Projects, Repositories, Your stack, Settings) with the
  rest under "More rooms" (CMO). BYOK reframed as the free on-ramp (CMO copy);
  desktop free onboarding no longer dead-ends at the Marketplace paywall (CFO:
  Marketplace stays Personal). Provider keys are validated before "connected".
  Inert Dropbox/Proton storage rows collapsed to one "arriving" line.
- **Phase 2, distribution config.** Codemagic gates on the test suite before
  TestFlight; mac/win electron-builder targets added (unsigned closed beta, no
  auto-update yet, per CTO); `oscode://` registered.
- **Phases 3-4, honesty + money-safety.** Phone Repos says tokens activate
  after pairing; terminal shows a Connecting state; a drift test fails the
  build if the commercial seat bands in `plans.ts` and the server
  `entitlement.ts` diverge.

Advisor rulings that shaped the forks are recorded in the action-items doc
(CFO: BYOK-only fallback, one free starter model; CMO: primary nav + BYOK
framing; CTO: checkout-return host, unsigned desktop beta, keep Tailscale-only
bind). Remaining P0 work is founder config + on-device verification + a few
native items (QR pairing, low-storage preflight, first-repo desktop golden
path), all listed in `AUDIT-P0-ACTION-ITEMS.md`. Nothing here has shipped to
main or been device-verified.

## Current state (2026-08-27, greeting)

**Long-press language reveal added to the greeting line.** A second, quieter
Easter egg alongside the existing tap-to-rotate: holding the greeting line
down for 450ms now pops a small pill bubble above it naming the language's
English name (e.g. "Hungarian"), fires a light haptic tick, and fades the
bubble out again after 1.4s or on release. A `longPressFired` ref suppresses
that gesture's own click so it never also triggers the tap-to-rotate. Bubble
styling rides the existing motion tokens (`--ease-spring`/`--ease-standard`,
`--dur-3`/`--dur-4`) and the base UI font rather than the greeting's display
serif; relies on the global `prefers-reduced-motion` reset rather than a
separate override, since it is a plain transition, not a keyframed animation.
Code in `app/src/screens/ChatScreen.tsx` and `.greeting-lang-bubble` in
`app/src/theme.css`.
Gates green: 41 files / 258 tests, typecheck (app + electron), lint
--max-warnings 0, Prettier clean. Pushed straight to `main` (fast-forward,
commit `9291d76`), which fires deploy.yml. Not device-verified.

## Current state (2026-08-26, keyboard)

**Greeting-anchoring saga closed out: stopped WKWebView from scrolling the
page for the keyboard, instead of continuing to chase it from the web layer.**
The empty-chat greeting kept moving whenever the keyboard opened or retracted,
across many rounds of founder-tested-on-device fixes this session: a
`--kb-inset` threshold, that threshold plus a settle debounce, watching the
composer's own position, a static pixel-measured height with no JS at all, and
finally `position: fixed` with a `translateY(visualViewport.offsetTop)`
compensation for the classic WebKit "fixed elements drift during a scroll"
bug (commit `3676c21`). Each still let the greeting move on the founder's
actual device in some new way (most recently: header scrolling fully
off-screen and the greeting overlapping the composer). The real cause was
never in the web layer: WKWebView itself was performing a genuine native
scroll to keep the focused composer above the keyboard, which no
`visualViewport`-based trick can fully out-guess.
- Installed `@capacitor/keyboard` and set `resize: 'none'` in
  `capacitor.config.ts`, which stops WKWebView from resizing or scrolling the
  page at all when the keyboard shows. With nothing left to drag it, the
  greeting's existing `position: fixed` + static pixel-measured height (see
  `.greeting`'s touch rule in `app/src/theme.css`) simply holds, with zero JS
  involvement, for both keyboard states.
- The composer's gap above the keyboard (`--kb-inset`, in `ChatScreen.tsx`)
  and `App.tsx`'s "recenter a focused field the keyboard is covering" effect
  (for non-composer inputs elsewhere in the app) both used to read
  `visualViewport`, which no longer shrinks under `resize: none`. Both now
  read the real keyboard height directly from the plugin's
  `keyboardWillShow`/`keyboardWillHide` events instead.
Gates green: 41 files / 258 tests, typecheck, lint --max-warnings 0, Prettier,
vite build, `npx cap sync ios` (confirms the plugin registers and
`resize: 'none'` lands in the native config). Pushed straight to `main`
(fast-forward, commit `c0d5a9f`). **Founder-confirmed on device: the greeting
holds its spot through both keyboard states.** This closes out the saga; the
greeting's positioning is locked in and should not be revisited without a new
founder ask.

**Follow-on polish, same day:** the composer's padding-bottom jump when
`kb-open` toggled had no transition, so it snapped to its final position the
instant `keyboardWillShow` reported a height instead of riding up with the
keyboard's own slide. Added a `transition: padding-bottom var(--dur-4)
var(--ease-standard)` on `.composer-wrap` (touch only, killed under
`prefers-reduced-motion`), matching the keyboard's own animation duration.
Positioning math untouched, only how the change between states plays out.
Gates green (same suite), pushed straight to `main` (fast-forward, commit
`14072c7`). Not yet device-verified.

**Second follow-on, same day:** founder caught the mark itself moving too,
on languages whose greeting wraps to two lines at phone width (English
mostly does not, several others do). The column is flex-end anchored from
its bottom, so a second line grew the stack and dragged the mark and first
line up with it. Capped `.greeting-line`'s own box to exactly one line
(`1lh`, with an `em` fallback for pre-16.4 iOS, plus `min-height: 0` to
defeat flexbox's automatic content-based minimum size), so a second line now
spills below the capped box instead of pushing anything above it. Gates
green (same suite), compiled output checked for the rule, pushed straight to
`main` (fast-forward, commit `84a5cfa`). Not yet device-verified.

## Current state (2026-08-26, greeting)

**Empty-state greeting reworked, composer moved back to the bottom, plus a
polish pass.** Two founder-requested changes to the chat splash, then a polish
follow-on, all on main.
- **Composer back at the bottom.** The earlier keyboard-steady work pinned the
  greeting out of flow (position: fixed on pointer: coarse) so the keyboard
  could not drag it, which left the composer with nothing to push it down and it
  floated up under the header. Anchored it with margin-top: auto scoped to
  pointer: coarse, the spot it holds once a transcript is open. Desktop is
  unchanged (the flex:1 greeting already keeps it at the foot of the column).
- **English lands, tap rotates languages.** English is now the landing line on
  every startup and every return to the empty state, instead of a random
  language. Tapping the line rotates on through the languages (replacing the old
  tap-to-translate toggle), in an order freshly shuffled each time we reach the
  empty state so the sequence past English differs on every launch. Expanded the
  set from 18 to 53 languages. `buildRotation()` puts English first, then a
  Fisher-Yates shuffle of the rest; the English translation rides along as the
  accessible label so a screen reader still announces the meaning of a
  non-English line. Code in `app/src/lib/greeting.ts` (ENGLISH_GREETING,
  GREETINGS, buildRotation) and `app/src/screens/ChatScreen.tsx`.
- **Polish.** The language swap crossfades (outgoing word lifts up and fades,
  incoming rises in beneath it, sharing one inline-grid cell so neither reflows
  the centered line; the exiting layer drops itself on animationend). A single
  slow one-time discovery nudge a beat after landing hints the line is tappable
  without breaking the Easter-egg quiet, riding translateY not scale so it never
  fights the press-fb press. A light haptic tick fires on each rotate through
  the haptics bus (silent no-op off device). Reduced motion is honored: the
  incoming word appears instantly, but the exiting layer stays on the global
  reset rather than animation:none so its animationend still fires and layers
  never pile up.
Gates green: app 41 files / 247 tests (em-dash, motion-tokens, and
polish-standards fill-mode guards included), typecheck (app + electron), lint
--max-warnings 0, Prettier clean. Straight to main (fast-forward, commits
`fbffc50` then `a6b44aa`), which fires deploy.yml. Not device-verified (no iOS
here); founder to confirm the bottom composer, tap-to-rotate, and the swap
crossfade on device.

## Current state (2026-08-26, later)

**Your model, on your machine, from your phone (the daemon path, celebrated).**
Founder call: rather than build phone-side BYOM streaming (R-16, which makes
the phone run the loop and fights iOS suspension), deliver the same vision the
durable way, on the already-built desktop-daemon path where the box runs the
loop and the phone is the remote control. Two pieces landed:
- The model sheet now shows a "My computer" group on the phone: it reads the
  paired box's stack (daemonStack / the /stack endpoint) and, picking it,
  starts a box-run session over the daemon (RemoteDriver), so the model runs on
  the machine and a long answer keeps going when the app is backgrounded. States
  cover not-paired ("Connect your computer" to pairing), unreachable
  ("Reconnect"), and no-model-configured. A box model can be any provider the
  box config names, including an OpenAI-compatible BYOM endpoint the box reaches
  (the engine's provider schema already expresses this, so no engine change was
  needed).
- Pairing is now the celebrated first-run path: the onboarding "Connect your
  computer" card is primary and framed around the value prop (your machine does
  the work, nothing drains the phone, nothing gets cut off on background), and
  the PairScreen lead matches. Daemon tests added for the box-run path (the
  /stack report and a no-cwd box-run session). R-16 stays the narrow escape
  hatch for bare hosted endpoints with no daemon, still deferred.
Gates (on the merged tree, after rebasing onto the parallel review-remediation
pass already on main): os-code 34 files / 276 tests, app 39 files / 226 tests,
lint/typecheck clean, vite build passes.

## Current state (2026-08-26)

**Chat-surface refinements + a polish pass landed on main.** Four
founder-requested changes to the chat surfaces, then a polish follow-on. The
menu (hamburger) is a drawn, fuller-weight glyph on a larger tap target; the
empty-state greeting is anchored just above the composer (Claude-style) so the
keyboard lifts it with the composer instead of shoving it into the status bar; a
freshly downloaded guide (Harbor or Harbor Mini) is promoted to the stack's
Reasoning anchor, with an init reconcile that heals a seeded-but-absent Mini
anchor, so "My Stack" chat starts right away; and chat history moved out of the
drawer into a new Chats room reached from a nav button. Polish: capped
easeOutQuint row stagger, an opacity-only room cross-fade (keyed on the view so
a live transcript never remounts mid-stream), a menu-glyph press spring, and
grouped flat rows that swipe left to delete behind a confirm. Gates green: app
37 files / 209 tests, typecheck (app + electron), lint --max-warnings 0, vite
build, em-dash, and the polish-standards fill-mode rule (animations use
`backwards`, never `both`). Not device-verified (no iOS here); founder confirms
the keyboard-anchored greeting and swipe-delete on device.

**Review close-out: dark-mode audit + remaining polish and vault follow-ups.**
The deferred items from the remediation are now done: the dark theme's
elevation shadows are tokenized to flip to a black base on dark (syntax tints,
accents, and status colors were already token-driven, so they flip too); the
Tier 2/3 UI polish landed (download progress animates a transform not width,
small icon buttons get ~44pt hit areas, landscape safe-area insets,
room-change fade-and-rise on screen navigation, Escape-closes-sheets, toast
role=status, press feedback broadened to the primary navigation and vault
rows); and the vault got a body cache so backlink derivation re-reads only
changed files (R-8) plus an export that clears stale files and reports a real
device error distinctly (R-13). BYOM/OpenAI-compatible on-device streaming
(R-16) is the one item left deferred: it needs new native plumbing (an
Electron IPC streaming channel and an iOS URLSession SSE bridge) that cannot
be verified in a headless web session, so it stays a scoped follow-up rather
than ship untested native code. Gates green: os-code 30 files / 238 tests,
app 37 files / 210 tests, lint/typecheck clean, vite build passes.

## Current state (2026-08-25)

**Local-first review remediation landed (7 waves).** A full review
(`CODE-REVIEW-LOCAL-FIRST.md`) covering the Vault, gitOS, the driver/model
stack, and the UI against the Uki polish bar was addressed end to end:
Vault data-loss holes (autosave flush, offline save error surfacing with
draft rescue, iCloud placeholder clobber, path jail), the dead wikilink
renderer, mid-chat switch reseed and rollback, driver abort and stack
degradation, the daemon outbox path allowlist, the Drive sync data-loss
cluster (index merge with tombstones, conflict copies, dup-root and delete
fallthrough) behind a new mock-transport harness, the motion-token vocabulary
and two enforcement tests, the sheet-exit sweep, chat autoscroll, warm dark
mode, and the single-writer lease wiring. Gates green: os-code 30 files / 238
tests, app 37 files / 209 tests, `pnpm -r lint`/`typecheck` clean, `vite
build` passes. Founder decision points were resolved by the advisors (CTO on
the outbox gating, lease, and daemon allowlist; Creative Studio on warm dark
mode). Follow-ups captured below.

## Current state (2026-08-20)

**All planned layers are built, tested, polished, and green.** `pnpm install
&& pnpm build` compiles clean; `pnpm typecheck`, `pnpm lint --max-warnings 0`,
and the test suites (os-code 28 files / 222 tests, app 16 files / 90 tests,
plus a passing `vite build`) all pass, both locally and in CI on every push to
`main`. Live commercial platform is wired:
Supabase sign-in, org write-through, and web-only Stripe billing (Apple 3.1.1
compliant, no in-app purchase). Two dashboards shipped this cycle: a rich
Marketplace storefront fed by a CI catalog builder, and Stack Health, a fully
local read of how the stack is being used. The public product page lives at
openshore.ai/os-code (a scoped "Nightshore" dark theme), linked from Products,
not the landing. The CLI runs end to end:
`osc doctor` renders the full health report on a bare machine, and the
complete task path (read, web search, edit with approval and diff, run a
command, commit) passes against the mock provider in `test/endToEnd.test.ts`.
Proven live over real HTTP against a scripted Ollama-protocol server: `osc
run` streams and exits clean, and the daemon serves token-authed sessions with
full SSE replay. On a machine with Ollama, the same path runs against a real
local model with `osc init` then `osc`.

Layer status:

- **Core (agent loop, tools, web, edit engine, local provider, TUI):** built
  and tested. Streaming Ink TUI with static-scrollback transcript, status
  line, approval prompts with diffs, citations panel, slash commands, and a
  considered `--plain` fallback.
- **Security:** enforced, not deferred. Jail, redaction, egress policy,
  daemon bearer auth with a hard no-`0.0.0.0` bind rule, default-deny shell,
  stricter phone/headless profiles, and guardrails that actually halt.
- **Breadth:** router/stack with graceful degradation, cloud escalation with
  confirm-before-spend, RAG (embedding index + keyword fallback) and code
  map, marketplace catalog with hardware fit ratings and preset stacks,
  daemon + reattach + pairing wizard, vision ingest inbox.
- **Polish (delight pass):** streaming smoother (bursty local token streams
  read as calm typing, `tui/smoothing.ts`); a model-load ticker that names
  GPU warmup time instead of a silent hang (`statusLine.busyNote`);
  syntax-tinted diffs at the approval moment (warm strings, teal keywords, dim
  comments, `tui/syntax.ts` + `DiffLine`); a blinking input cursor and a
  pressed-state flash on approval keys; a real byte-level download progress bar
  driven by the Ollama `/api/pull` stream (with a CLI fallback); a low-color
  terminal fallback that downsamples truecolor to xterm-256 or ANSI-16 by
  detected depth (`theme.colorDepth`/`fgSequence`); and a `/find` transcript
  search in both the TUI and plain renderers. All covered by
  `test/polish.test.ts`.

## What remains (known follow-ups, none blocking)

- [ ] **BYOM on-device streaming (R-16), still deferred:** true streaming and
      cancel for BYOM/OpenAI-compatible endpoints on iOS and Electron
      (buffer-then-dump today). Needs an Electron IPC streaming channel and an
      iOS URLSession SSE bridge, both native and unverifiable in a web session.
      The full press-fb adoption sweep across every remaining chip/row, and a
      focus-trap on sheets, are the last cosmetic bits of the UI polish (Escape,
      dialog roles, and primary-navigation press feedback already landed).
- [ ] **Repositories offload: wire the producer + homePath picker** to flip
      `REPO_OUTBOX_ENABLED` on (its own scoped feature, per CTO FD-1). Also
      PAR-3: platform-remote (GitHub/GitLab) home repos have no push path yet.
- [ ] **Claude Code parity roadmap (Part 5a)**, remaining after the
      pair-your-box work landed: MCP-stdio on the engine; checkpoints/rewind;
      replace the stack regex classifier with a Harbor Mini classification call;
      vision beyond Claude; a phone-side read-only tool slice for the pure-chat
      case. (Making desktop pairing the celebrated first-run path, and routing a
      box-hosted BYOM model through the daemon, are DONE.)
- [ ] **Founder config before Drive/dark ship:** Google OAuth client ids (see
      DECISIONS gdrive entry); the warm dark palette accents are a first pass,
      a designer contrast/shadow audit pass is the polish (Creative Studio
      flagged it as the non-mechanical half of dark mode).
- [x] **Native iOS voice dictation: BUILT (2026-08-25), on-device only.**
      Founder chose on-device-only (mic audio never leaves the phone) and to
      build now rather than wait for the clean TestFlight. New `oscode-speech`
      Capacitor plugin (SFSpeechRecognizer + AVAudioEngine, JS-registered so no
      pbxproj linking). See the log entry. Not device-verified (no iOS here);
      first real dictation on TestFlight is the proof.
- [x] **Mid-chat model switching, Claude-style: BUILT (2026-08-25).** Founder
      wanted the Claude behavior (keep the thread, change the model for the next
      turn). Not the CTO's feared live hot-swap: switch only when idle, reseed
      the new driver with the transcript, keep the same conversation. See the
      log entry.
- [ ] **Vision beyond Claude:** extend `sourceSupportsVision` when a direct
      BYOM/OpenAI/Gemini vision chat, a vision pocket model, or image blocks over
      the desktop-daemon SSE protocol land (daemon is text-only for now).
- [ ] **[TOP] Individual Personal tier + free/paid gating + iOS IAP -- BUILT
      (2026-08-21), pending founder config + sandbox validation before deploy.**
      Model: FREE = chat only (Harbor/Ollama + stack chat); PERSONAL = $20/yr
      unlocks the coding agent + Marketplace for one person, via Apple IAP on iOS
      and Stripe on web/desktop; commercial teams unchanged. All four phases are
      built, CTO-reviewed (money-path + Apple crypto), gated, and pushed to main.
      **Founder config before deploy (one at a time):**
      1. Stripe: create a $20/yr **Personal** price; set `STRIPE_PRICE_PERSONAL`
         as a function secret.
      2. `supabase db push` (applies 0006, 0007, 0008) then
         `supabase functions deploy stripe-checkout stripe-webhook stripe-portal
         link-apple-purchase apple-notifications`.
      3. Apple: create the auto-renewable sub `ai.openshore.oscode.personal.yearly`
         in App Store Connect; add `oscode-iap` to app/package.json is done, but
         confirm `cap sync ios` links it; enable the In-App Purchase capability.
      4. Apple secrets: paste the real Apple Root CA DER base64 into
         `_shared/apple.ts` (egress here blocked www.apple.com) OR set
         `APPLE_ROOT_CA_G3_DER_BASE64`; set `APPLE_BUNDLE_ID`, `APPLE_APP_APPLE_ID`.
         Register the `apple-notifications` URL as the App Store Server
         Notifications V2 endpoint. Set `APPLE_ALLOW_SANDBOX=1` ONLY during Apple
         review, clear it after.
      5. Sandbox-validate the Apple purchase/restore + notification loop on device.
      **Deferred (CTO F4/F5, low):** apple-notifications rollback-delete
      escalation; pre-link refund/revoke handling via App Store Server API lookup.
      **Public pricing page: LIVE (2026-08-21).** Open-Shore-LLC-Homepage
      `main` `bab2418` -- founder picked "Free to chat. $20 to build." for the
      headline and the feature-led paywall subhead. Free / Personal ("Most
      popular", $20/yr, App Store fine print, real Stripe individual buy button)
      / four commercial tiers, reassurance row. Founder must still: purge
      Cloudflare cache (edge-cached HTML) for it to show at openshore.ai/os-code,
      and finish step 1-2 above (`STRIPE_PRICE_PERSONAL` + redeploy) before the
      Get Personal button actually completes checkout instead of erroring.
- [ ] **Live billing config was blank (fixed 2026-08-21).** On project
      lzlrlfdffwiypzreoldb, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` were
      set to EMPTY strings (digest = SHA256 of ""), so checkout 401'd from
      Stripe. Founder pasted real live values; a live $20 Micro purchase then
      succeeded end to end (checkout + webhook + entitlement write), confirming
      P0-1. Migrations 0004/0005 applied and stripe-checkout/-webhook/-portal
      redeployed on that project; refresh-token rotation already on. Refund the
      $20 test charge + cancel that sub.
- [ ] **First desktop run on the founder's machine** (`pnpm install` then
      `pnpm desktop`) against real Ollama models.
- [ ] **First Codemagic build to TestFlight** (walkthrough in
      `docs/TESTFLIGHT.md`); the Swift side compiles for the first time
      there, so expect one round of fixes. Founder confirmed the one-time
      Apple/Codemagic setup is done; trigger the `ios-testflight` workflow on
      the `claude/os-code-openshore-styling-4bk7mp` branch.
- [x] **At-rest journal encryption:** done. Engine-side sealing
      (`core/security/atRest.ts`) in the exact app `enc:v1:iv:ct` format
      (bidirectional WebCrypto cross-test), data key in the OS keychain via the
      existing credential store (encrypted-file fallback at 600, honest backend
      reporting, self-upgrades into a keychain), per-line journal + title
      sealing tolerant of legacy plaintext, atomic idempotent boot migration in
      both the Electron host and the daemon. The Stack Health seal is now
      measured: green only when the keychain holds the key AND a full-disk scan
      finds zero plaintext lines.
- [ ] **Stack Health Phase 2 (named agents):** add an `agents` record to
      `ConfigSchema` and an opaque `agentId` to `task-start`/`turn-start`
      (stamped as a stable record key, never a display name), threaded through
      `loop.ts` and `router.delegate`. Upgrades the crew view from stack roles
      to the user's named agents with per-agent stats. Phase 3: one-tap
      suggestions + thumbs feedback.
- [x] **Catalog builder wired in CI and publishing.**
      `.github/workflows/catalog.yml` (weekly + on curation/builder/schema change + manual) builds, gates, and publishes `catalog.json` by committing it to
      the marketing repo at `src/static/os-code/catalog.json`, which Cloudflare
      Pages serves at `openshore.ai/os-code/catalog.json` (the default
      `config.catalog.url`). Verified end to end: run #3 published commit
      `aca6186` to the marketing `main`. Auth is a classic PAT in the
      `MARKETING_DEPLOY_TOKEN` repo secret (an earlier fine-grained token 403'd
      on a wrong-repo selection; fixed).
      Follow-up: (1) DONE, the builder now carries the previous `updated` stamp
      forward on a true no-op build (chooseUpdated/contentSignature in
      enrich.ts), so an unchanged run no longer commits. Seed
      `os-code/curation/*.json` as the roster grows.
- [x] **Marketplace popularity axes + landscape breadth.** Two honest axes plus
      an editorial shelf, no telemetry. LANDSCAPE ("Popular across local LLMs"):
      fixed the enrichment that published empty (HF per-segment slash encoding;
      removed the phantom Ollama JSON endpoint for an optional back-compat
      `source.popularityRef` naming each Ollama model's HF GGUF home; per-ref
      resolution logging + soft online-only 0-popularity warning; fixture tests).
      Broadened the catalog 12 -> 27 (real refs, licenses on the allow-list, no
      fabricated stars: the 15 new models show "Not yet rated"). INTERNAL ("Your
      most-used"): fully local, from StackHealth `modelUsage` (existing
      `turnsByModel`), read via the stackHealth bridge, hidden when no bridge or
      no usage; never cross-user. EDITORIAL ("Staff picks", "chosen not counted")
      from recommended/curation. Gates green (os-code 177 tests, app 76, vite
      build).
- [ ] **PARKED (founder-gated): cross-user "Popular in OS Code" leaderboard.**
      A real cross-user popularity number requires a first-ever phone-home and a
      rewrite of the Stack Health privacy seal, which literally promises "no
      telemetry." Both CTO and CMO ruled it out without an explicit, anonymized,
      OPT-IN community-share designed as its own build (edge function + aggregate
      table + consent UX + state-aware seal). Deliberately NOT built; the three
      honest axes cover the user job. Build only on the founder's explicit yes.
- [~] **Stripe went live + email confirmation ON.** Supabase "Confirm email" is
  ON (verified in the dashboard). Stripe is in live mode: live secret key,
  the OS Code webhook (`lzlrlfdffwiypzreoldb.../stripe-webhook`) enabled and
  livemode, and all four prices live and yearly. Caught and fixed a Scale
  price that was created as $500/MONTH instead of $500/year (a 12x
  overcharge); its price id is unchanged, so `STRIPE_PRICE_SCALE` needed no
  update. Verified against the Stripe API directly (key mode, per-price
  interval, webhook status). NOTE: this account is shared with another
  product (a second `riziqavmckobtcyiazht` webhook is Uki's); each webhook
  ignores prices it does not recognize, so cross-talk is safe.
  **Still open:** one real end-to-end purchase to prove the Supabase
  function secret VALUES (live key, THIS webhook's signing secret, the four
  price ids) are wired. Secret values cannot be read back from Supabase; a
  live transaction (refundable) is the only proof, and its success or its
  failure point names any stale secret.
- [x] **Slim git history:** done, founder approved. `git filter-repo`
      stripped node_modules from every commit on `main` and this session
      branch (verified: identical tree hash at HEAD before/after, file
      lists match, workspace gate still green post-rewrite). Fresh clone
      is now 680K instead of ~177MB. Anyone with an existing local clone
      needs to re-clone or hard-reset to the new hashes; a third,
      unrelated branch on the remote was left untouched.
- [x] **Real openshore.ai brand palette: finalized (already matched).** Verified
      the app's tokens against the canonical brand in the marketing repo
      (`Open-Shore-LLC-Homepage/src/static/styles.css`): paper/ink/ink-soft/
      ink-faint/water/water-deep/hairline and Fraunces+Inter all match
      token-for-token. The `OPENSHORE:` markers were gone because the real values
      were already in; the to-do was stale. Amber (`--cloud`) is the intentional
      OS Code product accent on top of the OpenShore base (teal = local/private,
      amber = cloud/spend). No palette value changed.
- [x] **Brand audit + finalization (Brand Exec + CMO).** One audit pass, all
      consistency fixes, no foundation change. Replaced the sidebar's mismatched
      Unicode nav glyphs (several rendered as color emoji, breaking the palette)
      with a coherent hand-drawn inline-SVG line-icon set in the wave-mark
      language, currentColor so the active state tints teal. Reserved teal for
      local/private only: connection/build "connected"/"finished"/"connected"
      status moved off `pill local` to a neutral `pill ok`, plan price to a
      `pill price` (spend). Token-routed the Stack Health ring gradients + legend
      (added additive `--flow`/`--flow-deep`/`--cloud-bright` naming existing
      values; rings render identically), unified the mono font on code surfaces
      (`--font-mono`), added `--code-surface`, and swapped the last stray text
      glyphs (check/X/arrow/chevron) to inline SVG. Gates green (app 76 tests +
      vite build). BrandMark and the frozen mark SVGs/PNGs left untouched.
- [x] **App polish bundle, Tier 1:** done. Navy launch continuity (iOS),
      sheet spring physics, haptics (first token, approval, download
      success), token-stream smoothing in the app transcript.
- [ ] **App polish, Tier 2** (proposed, not yet picked): drag-to-dismiss
      with rubber-banding on sheets, a "new tokens" scroll pill, dark/
      tinted iOS 18 icon variants, model-chip shared-element morph.
- [ ] **Live-fire pass on a machine with Ollama + a GPU.** Everything is
      wired and covered by tests against the mock and mocked HTTP; the first
      session against real weights should confirm streaming feel and the
      capability probe on all four backends (Ollama, LM Studio, llama.cpp,
      vLLM).
- [ ] **ComfyUI image path** needs a bundled txt2img workflow graph (A1111
      and OpenAI-images endpoints work today).
- [ ] **Tree-sitter code map** behind the existing `extractSymbols` seam,
      when install-weight is worth it.
- [ ] **Hosted license-verify endpoint** (documented stub; client is real).
- [x] **A11y pass over TUI colors** for low-color terminals: done. Ink
      downsamples on its own; the hand-rolled ANSI surfaces now do too, by
      detected color depth.
- [x] **In-TUI transcript search:** done via `/find` (TUI and plain). A custom
      mouse-free scrollback pager was deliberately NOT built: over SSH the
      terminal's own scrollback already pages, and a custom pager fights it;
      `/find` is the genuinely additive capability.

### Parked feature ideas (founder-requested build prompts)

> Captured 2026-08-24 from founder voice notes. Full, build-ready prompts
> written to hand straight to Opus 4.8.
>
> STATUS (2026-08-25): ALL THREE ARE BUILT and on `main`. BYOM shipped
> 2026-08-24 (`243e43e`); Vault + the gitOS storage seam shipped 2026-08-25
> (`b8e1658`, `ac74f77`, `3b28146`; gitOS ships as "Repositories"). The
> standing "surface until built" reminder is RETIRED now that every checkbox
> below is checked. The build prompts are kept only as historical reference.
> Remaining follow-up: Vault's ORGANIZATION tier still needs a real
> multi-writer backend (tracked as its own item, not a reason to re-surface).

- [x] **Scope and build gitOS: BUILT (2026-08-25).** Shipped as "Repositories"
      (gitOS is the internal name for the storage seam). Framing + seam in
      `b8e1658`, iCloud Drive provider in `ac74f77`, Google Drive provider
      (OAuth PKCE, drive.file) in `3b28146`. Code lives in
      `app/src/lib/gitos/`. The original build prompt is kept below for history.
      (decentralized, local-first Git hosting; storage location chosen per repo
      instead of centralized hosting).

      **Partial (2026-08-25): the storage seam is framed and live, and the
      full advisory org ruled on every decision point** (founder delegated
      the calls to the advisors, then build; rulings logged in DECISIONS.md).
      Shipped: `app/src/lib/gitos/` with the path/bytes StorageProvider seam
      (list/stat/read/write/remove plus single-writer lease ops, per the CTO
      must-fix), the Local provider over the sealed store, and the provider
      roster with Dropbox/Proton registered but honestly marked not ready
      pending OAuth wiring. Vault ships as the seam's first consumer (see the
      Vault item). Two cloud providers landed the same day: iCloud (native
      Capacitor plugin, `app/plugins/oscode-icloud/`, ubiquity container,
      needs the App ID capability enabled in the Apple Developer portal
      before each distribution build) and Google Drive (`app/src/lib/gitos/
      gdrive.ts` + `gdriveAuth.ts`, drive.file scope only per the CFO, real
      folder tree with a `.oscode/index.json` cache, OAuth PKCE with an iOS
      client via the app's own URL scheme and a Desktop client via a
      loopback redirect for Electron, per the CTO's architecture ruling;
      founder still needs to register both OAuth clients in Google Cloud
      Console and fill in `VITE_GDRIVE_*` before either build can connect).
      STILL OPEN: real-git shell-out on the desktop engine, the Repositories
      surface merge, Dropbox (app-folder scope per CTO), Proton (no public
      OAuth API today, stays an honest stub), a Google Drive disconnect
      affordance beyond the storage sheet's inline button, and the per-repo
      secrets key model. Ships as "Repositories"; gitOS is the internal name
      (CMO, Git trademark policy). Personal-gated (CFO).

  ```
  ROLE
  You are the lead engineer scoping and building gitOS. Work in strict phases:
  deliver a plan and get it approved BEFORE writing any feature code. Where a
  decision below is unresolved, ASK the founder rather than assume. A wrong
  assumption at the storage/secrets seam is very expensive to unwind later, so
  treat the "resolve first" list as a hard gate, not a formality.

  MISSION (one sentence)
  GitHub, functionally identical, except the user chooses WHERE each repository
  physically lives at creation time (their own device, their own network
  storage, or a cloud drive they already pay for) instead of it being centrally
  hosted on someone else's servers.

  THE INSIGHT THAT DRIVES THE ARCHITECTURE
  A Git host is a specialized file store wrapped in a UI plus an
  integration/secrets layer. gitOS keeps the UI and the integration layer and
  hands the file store to the user. So the entire design pivots on ONE seam: a
  storage-provider interface that the Git logic and the UI never see past. Get
  that seam right and every backend (local, iCloud, Dropbox, Drive, Proton)
  becomes an additive plugin. Get it wrong and the Git logic leaks
  provider-specific assumptions everywhere. Spend your hardest thinking here.

  THIS STORAGE SEAM IS SHARED WITH VAULT, DESIGN IT ONCE
  Vault (the parked prompt below, likely built in the same cycle) needs the
  exact same thing: a folder of files on a storage location chosen per resource
  (local, iCloud, Dropbox, Drive, Proton), synced across the user's own
  devices. The storage-provider interface you design here IS that shared
  abstraction. Design it so a Vault folder is just another resource sitting on
  it, not a Git repo, and do not let Git-specific concerns leak into the
  interface. If you build gitOS first, name this seam as the thing Vault will
  adopt; if Vault is being scoped alongside, reconcile the two before either
  freezes the interface. The one exception is Vault's ORGANIZATION tier, which
  needs a real multi-writer backend (see Vault's prompt) rather than this
  synced-folder model; the personal tiers of both features share this seam.

  WHERE THIS LIVES
  A new, native "Repositories" section of OS Code (native, not a wrapped web
  view). Confirm the exact surface with the founder before scoping downstream.
  Note Vault proposes living in this same file-browsing surface, so scope the
  navigation with both in mind.

  RESOLVE WITH THE FOUNDER BEFORE BUILDING (do not guess silently)
  1. Which surface in OS Code does the "Repositories" section live in?
  2. Implementation approach, the pivotal call. Strong default: shell out to
     real `git` against a working copy that sits inside the user-chosen storage
     location. This gets true Git semantics (branches, merges, history, diffs)
     for free and makes every cloud drive "just a folder." The alternative,
     reimplementing Git operations against each provider's raw API, is far more
     work and more failure modes. Recommend the real-`git` default explicitly
     unless the founder has a reason to want otherwise.
  3. Secrets on untrusted storage. When a repo lives on a consumer cloud drive
     the founder does not control, how are its secrets (CI tokens, deploy
     hooks, API keys) stored and encrypted so the drive provider never sees
     plaintext? This needs a real answer (for example client-side encryption
     with a key the provider never holds), not "we'll store them in a file."
     OS Code already has an at-rest sealing format (`enc:v1`) and a credential
     store; reuse them rather than inventing a second mechanism.
  4. Multi-device conflict handling. Dropbox, Google Drive, iCloud, and Proton
     Drive do NOT provide Git-aware locking or merge semantics; they are naive
     folder syncs. Is a lock file or lease enough for v1, or is real 3-way
     merge on top of the synced folder required? Decide before committing to a
     backend model; do not assume "it's just a folder, it'll be fine."
  5. Per-provider auth. What OAuth scopes do Dropbox, Google Drive, and Proton
     Drive each need, and what is the simplest on-device iCloud path (native
     Files picker vs. CloudKit)?

  CORE REQUIREMENTS
  1. Storage-location picker on repo creation. Backends for v1:
       - Local device storage, including any path reachable from the device (a
         Tailscale-mounted share or NAS is just a filesystem path, no bespoke
         network protocol). OS Code already pairs desktop and phone over
         Tailscale, so this backend runs with the existing grain.
       - iCloud Drive (via the OS's own Files/iCloud connection, not a bespoke
         API).
       - Dropbox.
       - Google Drive.
       - Proton Drive.
     Build these behind the pluggable storage-provider interface so new
     backends land without touching Git logic.
  2. GitHub stays available, additively. The section also offers "Connect to
     GitHub" (note GitLab and Bitbucket as later additions). gitOS is a new
     option ALONGSIDE GitHub, never a removal of it.
  3. Full functional parity, not just file sync: branches, commits, merges,
     diffs, history, AND the secrets/integration layer so a repo's wiring (CI,
     deploy hooks, keys) clones and reconnects exactly like today, regardless
     of which backend holds the bytes. The bar is "clone this and everything
     just works," not "clone this and get plain files."
  4. Coding-agent workflow parity. Selecting a repo to work in feels identical
     to selecting a repo in a modern coding agent today: pick the repo (any
     backend), an agent or the user makes changes, changes commit; the backend
     is invisible. OS Code's own agent loop is the consumer to satisfy here.
  5. Backups as a first-class feature, near-zero effort. Because the repo
     already lives on storage the user owns, add a Settings toggle plus an
     interval picker (daily, weekly, custom) that snapshots the repo to a
     second user-chosen location. This is gitOS's headline differentiator
     versus GitHub, not a bolt-on: the wiring already exists, so backup is
     gold-standard by construction. Design it as such.

  NON-GOALS FOR V1 (flag, do not build)
  - Do not try to match GitHub's collaboration surface (PRs, issues,
    Actions-equivalent CI runners) in v1. Scope v1 to solo or small-team repo
    storage plus core Git operations plus backups.
  - Do not assume the cloud-drive providers solve real-time multi-device
    conflict resolution. They do not.

  DELIVERABLE FOR THIS PASS (plan, not code)
  1. The storage-provider interface: its surface, and how local, iCloud,
     Dropbox, Drive, and Proton each satisfy it.
  2. The repo-creation flow end to end.
  3. The secrets/integration-wiring design, including the untrusted-storage
     encryption model.
  4. The backup feature design.
  5. A clear v1 vs. later-phase cut line.
  Present the five "resolve first" questions as explicit decision points at the
  top. Do not write feature code until the plan is approved.

  DEFINITION OF DONE (v1)
  A user can create a repo on any of the five backends, do real Git work in it
  (including via a coding agent), have its integrations reconnect on clone, and
  turn on scheduled backups to a second location, with secrets never landing in
  plaintext on a provider the user does not control.
  ```

- [x] **Scope and build Bring Your Own Model (BYOM): BUILT (2026-08-24).**
      Shipped in `243e43e` ("connect a model you control, from the Stack"). Code
      in `app/src/lib/byom.ts`, tests in `app/test/byom.test.ts`. The original
      build prompt is kept below for history.
      (a first-class "connect
      any model you control" capability). NOTE: this overlaps heavily with what
      OS Code already does, so the prompt is framed as an EXTENSION of the
      existing model/router layer, not a new build. Below is the optimized Opus
      4.8 build prompt.

      **Partial (2026-08-24): the individual in-stack connector shipped.** The
      founder's concrete ask (a "+" button top-right of the Stack, point at a
      model you control, it lands on the Bench and places into the stack) is
      built: `app/src/lib/byom.ts`, a `byom` `StackModelRef` kind, `connectByom`
      / `disconnectByom` in the store (key in the device secret store, never in
      settings), and the StackManager connect/disconnect UI. It reuses the
      existing OpenAI-compatible adapter (now endpoint-driven, with an optional
      key so keyless local servers work). STILL OPEN from the prompt below:
      org-level configuration (set once for a whole team), a pre-flight
      capability check, and graceful degradation when a connected model lacks a
      needed capability. Keep this item open until those land.

  ```
  ROLE
  You are the lead engineer extending OS Code with an explicit "Bring Your Own
  Model" (BYOM) capability. IMPORTANT FIRST STEP: OS Code is already a
  bring-your-own-stack product (local models as the default, a
  router/quarterback, Ollama-native and OpenAI-compatible adapters, a manual
  cloud flip for the user's own Claude or ChatGPT account, a marketplace
  catalog). So this is very likely an EXTENSION of the existing model/router
  layer, not a new subsystem. Before proposing anything, audit what already
  exists (the router, the provider adapters, the cloud-connect flow, the config
  schema) and design the DELTA that turns today's capability into a first-class,
  user-facing "connect any model you control" feature. Do not duplicate what is
  built. Work in phases: plan first, get it approved, then build. Where a
  decision below is unresolved, ASK.

  MISSION (one sentence)
  A clear, first-class setting that lets a user or an organization point OS Code
  at a model THEY control (their own fine-tuned or local model, a self-hosted
  endpoint, or another provider's API) with as little friction as selecting a
  built-in model, framed as an explicit "Bring your own model" entry point
  rather than something only power users discover.

  THE GAP TO CLOSE (audit first, then build)
  OS Code can already talk to local and OpenAI-compatible backends. BYOM is
  about making "add a model I control" an obvious, safe, org-aware first-class
  action, plus honest capability handling when a connected model cannot do what
  the agent loop needs. Identify and close the gap between what the
  router/adapters do today and:
    - a discoverable "Bring your own model" action in the app (not just a config
      file edit),
    - organization-level configuration (a company sets it once for the team),
    - a pre-flight compatibility check and graceful degradation.

  TWO AUDIENCES, DESIGN FOR BOTH
  1. Super users: individuals swapping in a specific model for preference, cost,
     or performance.
  2. Companies (the primary long-term case): organizations running a local or
     fine-tuned model tailored to their own codebase and conventions, with the
     CTO's time going into shaping that model rather than rebuilding the generic
     agent tooling every company now has. Treat the org case as first-class.

  THE HARD PART, THINK HERE
  The agent loop, tool-calling, and context management must work against a BYO
  model exactly as against a built-in one. Endpoints disagree on tool-call
  format, streaming, context window, and system-prompt handling. The crux is a
  clean model-adapter contract plus honest capability detection: when a
  connected model cannot do something the stack needs, detect it and tell the
  user precisely what is missing, rather than failing mid-agent-loop. Spend your
  reasoning budget on the adapter contract and the degradation path. Reuse OS
  Code's existing "specialist tools register only when the stack can serve them"
  pattern rather than inventing a parallel one.

  RESOLVE WITH THE FOUNDER BEFORE BUILDING (do not guess silently)
  1. How much of BYOM does OS Code's current router/adapter layer already
     cover, and what is the exact remaining delta? (Answer from the code first,
     then confirm scope with the founder.)
  2. How are credentials for a self-hosted or local endpoint stored and
     secured? (OS Code already has a credential store; extend it, do not add a
     second.)
  3. Does connecting a model require a pre-flight compatibility check (tool-use
     format, context window, streaming) before it can go live?
  4. How does a BYOM connection interact with the existing spend-confirm and
     billing model that governs cloud escalation?

  CORE REQUIREMENTS
  1. A discoverable "Bring your own model" entry point that connects a model
     endpoint (self-hosted, local-network, or third-party API) with its own
     credentials, clearly distinct from the built-in local stack and the cloud
     flip.
  2. Fully first-class, not a stub: the agent loop, tool-calling, and context
     management all function against the connected model as they do against
     built-ins.
  3. Build on the existing OpenAI-compatible adapter as the baseline (it already
     covers most self-hosted and local servers such as vLLM, Ollama, and LM
     Studio), and keep the adapter layer open so named providers can be added
     later.
  4. Org-level configuration: a company sets this once for its whole team or
     workspace, not only per individual user, wired through the existing org
     write-through where possible.
  5. Graceful degradation: when the connected model lacks a needed capability,
     detect it and explain what is missing rather than failing silently or
     breaking the loop.

  NON-GOALS FOR V1 (flag, do not build)
  - Not a marketplace or discovery surface for models (OS Code already has a
    marketplace catalog; BYOM is the "I already have my own model" path, not a
    new catalog).
  - Not model fine-tuning tooling. Assume the org already has, or is training,
    its own model elsewhere; BYOM only connects to it.

  DELIVERABLE FOR THIS PASS (plan, not code)
  1. An audit of what OS Code's model/router layer already provides and the
     exact remaining delta.
  2. The connection UX (individual and org).
  3. The model-adapter contract and the capability-detection and degradation
     model, expressed as an extension of the existing adapters.
  4. Individual-vs-org scoping and credential storage.
  5. A clear v1 vs. later-phase cut line.
  Present the "resolve first" questions as explicit decision points at the top.
  Do not write feature code until the plan is approved.

  DEFINITION OF DONE (v1)
  An individual or an org can connect a model they control through a
  discoverable setting, run the full OS Code agent workflow against it exactly
  as against a built-in model, and get a clear, specific message (never a silent
  break) when the connected model lacks a capability the stack needs.
  ```

- [x] **Scope and build Vault: BUILT (2026-08-25).** Shipped on the gitOS seam
      in `b8e1658` ("Frame gitOS and ship Vault on it"). Code in
      `app/src/lib/vault.ts`, `app/src/lib/vaultExport.ts`,
      `app/src/screens/VaultScreen.tsx`, `app/src/components/VaultMarkdown.tsx`;
      tests in `app/test/vault.test.ts`. The organization tier (multi-writer
      backend) remains the open follow-up. The original build prompt is kept
      below for history.
      (a native, Obsidian-style markdown knowledge base built into OS Code,
      personal by default with an organization tier). Working name only, the
      founder is not settled on it.

      **Partial (2026-08-25): the personal Vault shipped, on the gitOS seam,
      after the full advisory org answered the decision points.** Name: Vault
      ships (CMO: generic term, safe, and earned because compat is TRUE).
      Compat ruling: true Obsidian compatibility. Plain .md paths, Obsidian's
      own [[wikilink]] grammar including alias and heading-ref tolerance,
      bare-name resolution with shortest-path tiebreak, and export as real
      files (Documents/Vault via the new @capacitor/filesystem plugin plus
      UIFileSharingEnabled, so the Files app shows the folder and Obsidian
      mobile opens it as a vault). Shipped surface (`VaultScreen`, in the
      sidebar nav): folder tree with breadcrumbs, edit/read toggle, autosave
      as you type (debounced), clickable wikilinks that create missing notes,
      Linked mentions backlinks card, the storage-location sheet with Local
      live and the other providers honestly Arriving, and the export action.
      Free tier (CFO: the daily-habit hook; the agent side is what Personal
      gates).

      **Org tier BUILT (2026-08-25).** The shared, multi-writer team vault
      shipped: a Supabase-backed gitOS provider ('org', Team vault) behind the
      same seam, so the Vault UI never learns the bytes live in Postgres.
      Migration `supabase/migrations/0010_org_vault.sql` adds `org_vault_notes`
      (keyed org_id + path), RLS so only active members read (is_org_member),
      table writes revoked so the two SECURITY DEFINER RPCs are the ONLY write
      path, `org_vault_put` doing last-write-wins with a conflict copy (the
      overwritten body is preserved as a "(conflict ...)" note, never lost),
      and `org_vault_delete` as a tombstone. The Vault screen gains a
      Personal | Team switcher (Team shown only to signed-in org members), and
      `[[` autocompletion landed for both vaults (pure `wikilinkContext` in
      vault.ts, a mobile-first chip row in the editor). iCloud sync for the
      PERSONAL vault is already covered by the landed iCloud gitOS provider.
      The founder must apply the migration (supabase db push) for the live team
      vault to work. (Applied 2026-08-25.)

      **Agent vault writes BUILT (2026-08-25), daemon side.** The founder chose
      a PRIVATE ON-DEVICE vault (local-first, no token crossing to the daemon)
      over the team vault as the agent's write target. New daemon tools in
      `os-code/src/core/tools/vault.ts`: `vaultRead` and `vaultList` (read risk,
      flow) and `vaultWrite` (write risk, alwaysAsk). Notes are plain markdown
      under `~/OSCode/Vault` (config `vault.dir`), path-jailed to that root, so
      Obsidian or any editor opens the folder. "Never silent" is enforced hard:
      a new `ToolDef.alwaysAsk` flag, honored by the permission engine BEFORE
      any auto-allow path (session grant, rule, trusted repo), so no setting can
      make an agent vault write skip its approval diff. The approval reuses the
      existing app ApprovalSheet + CLI/TUI prompt (a unified diff). 236 os-code
      tests green (adds vaultTools.test), lint, em-dash.

      **App folder view BUILT (2026-08-25), desktop.** The paired follow-up
      shipped: a file-backed gitOS provider ('files', "This folder") that the app
      points the personal vault at, reading and writing the SAME `~/OSCode/Vault`
      folder the agent writes, so agent notes show in the app's Vault and vice
      versa, and Obsidian opens the folder. New Electron IPC (osc:vaultList /
      Read / Write / Remove in electron/main.ts, path-jailed with os-code's Jail),
      exposed on the bridge + preload; the provider (app/src/lib/gitos/
      deviceFolder.ts) is a thin client over it, in PROVIDER_ROSTER and offered
      in the "Where it lives" sheet on desktop only (probeReady gates it off the
      phone). Move the personal vault to it from that sheet. Green: app typecheck
      (incl. electron), lint, 176 tests (adds deviceFolder.test), vite build,
      em-dash. Not device-verified (no Electron in the web session); founder
      confirms on Pop!_OS. Minor known gap: no live fs-watch, so an agent write
      appears in the app on the next Vault refresh (navigate away and back), not
      instantly.

  ```
  ROLE
  You are the lead engineer scoping and building Vault, a native markdown
  knowledge base inside OS Code. Work in phases: deliver a plan and get it
  approved BEFORE writing feature code. Where a decision below is unresolved,
  ASK the founder rather than assume, especially anything touching where org
  data physically lives or how it syncs across members.

  MISSION (one sentence)
  A folder of markdown files the user (or, on the organization tier, the whole
  team) reads and writes by hand and the agent reads and writes as part of its
  own work, rendered with a consistent, native visualization inside OS Code
  instead of a separate app, so the record of what the agent has done and what
  the user knows lives in one place.

  WHY THIS FITS HERE
  OS Code already runs the agent loop locally and already owns the file
  browsing surface (Repositories). Vault is the natural extension: the same
  agentic work already happening in the app gets a durable, readable home
  instead of living only in chat transcripts, and the user gets a real
  organizing layer for notes, decisions, and reference material the agent can
  actually use as context.

  THE ARCHITECTURE QUESTION THIS SHARES WITH GITOS, RESOLVE TOGETHER
  gitOS (see the prompt above, if built or being scoped in the same cycle)
  already needs a storage-provider abstraction: local device, iCloud, Dropbox,
  Google Drive, Proton Drive, chosen per resource instead of centrally hosted.
  A personal Vault is the same problem at smaller scale (a folder of files,
  chosen storage location, needs to sync across the user's own devices). Do
  not build a second, parallel storage abstraction. If gitOS's
  storage-provider interface exists or is being scoped concurrently, Vault's
  personal tier should sit on top of it. If gitOS is not yet built, design
  Vault's storage layer so gitOS can adopt it later instead of the reverse.

  THE HARD PART, THINK HERE
  The organization tier is a different problem than the personal tier, not a
  bigger version of it. A personal vault is one folder on storage the one user
  already controls, so it can be local-first. An organization vault is shared,
  read-and-written-to by multiple members across their own devices, which
  means it needs real multi-user sync and a permission model, the same
  multi-device conflict problem gitOS's prompt flags for cloud-drive backends,
  now with concurrent writers instead of one. Consumer cloud drives (Dropbox,
  Drive, iCloud) do not provide this out of the box. Spend your reasoning
  budget on whether the org tier needs its own real backend (for example
  Supabase, mirroring how org accounts and entitlements already work
  elsewhere in this codebase) rather than trying to force a synced-folder
  model to do multi-writer duty.

  RESOLVE WITH THE FOUNDER BEFORE BUILDING (do not guess silently)
  1. True Obsidian compatibility (plain `.md` files plus an `.obsidian/`
     config folder, so the same folder also opens correctly in the real
     Obsidian app) versus an Obsidian-INSPIRED native experience that is not
     actually interoperable. This changes the file format contract
     completely; get it settled first.
  2. Where does a personal vault live when the user has only ever used the
     phone (no desktop paired over Tailscale)? Device-local storage, iCloud,
     or does it require pairing a desktop first?
  3. Organization vault backend: real multi-user store (see THE HARD PART
     above) versus a synced folder with a lock/lease model. Pick one
     deliberately, do not default into the weaker option.
  4. Permission model for the organization vault: can every member write
     everywhere, or is it scoped (a member's own subfolder plus a shared
     shared/ area, admin-only areas, etc.)?
  5. How does the agent decide what to write into Vault versus keep in a
     session's own journal? Automatic (the agent files things itself) versus
     user-directed (the user tells it to save something) versus both; get this
     wrong and Vault either fills with noise or stays empty.
  6. Final product name. "Vault" is a working name only.

  CORE REQUIREMENTS
  1. Personal tier, on by default for every signed-in account: one vault, one
     folder of markdown notes, the agent's own read/write target alongside the
     user's own notes.
  2. Organization tier: one shared org vault per organization, alongside each
     member's own personal vault, mirroring how OneDrive separates a personal
     drive from an org's SharePoint-backed one. The org decides internally
     what belongs there; OS Code does not police content, only access.
  3. A native, consistent visualization inside OS Code: browse the folder
     structure, open and edit a note, see backlinks/references if the
     Obsidian-compatibility decision above calls for them, all rendered in the
     app's own design language rather than an embedded web view.
  4. Agent integration: the agent can read Vault content as context and write
     new notes or update existing ones as part of its own work, gated by
     whatever the resolve-first decision on automatic-vs-directed lands on.
  5. Reuse OS Code's existing at-rest sealing (`enc:v1`) and credential store
     for anything sensitive that ends up in a note, rather than inventing a
     second encryption path.

  NON-GOALS FOR V1 (flag, do not build)
  - Not a real-time collaborative editor (two people typing in the same note
    simultaneously). Start with save-and-sync, not live co-editing.
  - Not a plugin ecosystem or Obsidian plugin compatibility, even if the file
    format is made Obsidian-compatible per the resolve-first decision above.
  - Not a replacement for the session journal or chat history; Vault is a
    curated knowledge layer, not a raw transcript store.

  DELIVERABLE FOR THIS PASS (plan, not code)
  1. The file-format decision (true Obsidian compatibility or not) and why.
  2. The personal-tier storage design, and its relationship to gitOS's
     storage-provider interface.
  3. The organization-tier backend design and its permission model.
  4. The agent read/write integration design (automatic vs. directed).
  5. The native browsing/editing UI's shape inside OS Code.
  6. A clear v1 vs. later-phase cut line.
  Present the six "resolve first" questions as explicit decision points at the
  top. Do not write feature code until the plan is approved.

  DEFINITION OF DONE (v1)
  A signed-in user has a personal vault the agent reads from and writes to
  alongside their own notes, rendered natively in OS Code. An organization has
  one shared org vault alongside each member's personal one, with a real
  permission model and a genuine multi-writer sync story, not a
  best-effort synced folder.
  ```

## Log

- **2026-08-26: Desktop (Electron) interactive PTY terminal wired (the one
  documented Phase 2 follow-up).** The interactive terminal already ran
  phone-to-desktop over the daemon; this wires the same TerminalManager into
  the Electron desktop app, so a desktop-backed chat opens a real local PTY
  over IPC (not only remotely). EngineHost holds a TerminalManager and forwards
  output on a new channel; six osc:terminal* IPC handlers + preload/bridge
  methods + onTerminalData; ElectronDriver implements the ChatDriver terminal
  methods (the output listener registers before subscribing so ring replay is
  never missed, and tears down on abort). A terminalReader is also passed into
  both bootstrapSession calls so read_terminal sees PTY scrollback on desktop.
  Owner is the local user on desktop, so no cross-user gate is needed here; PTY
  output rides its own forwarder and is never journaled; stdin is never logged.
  3 new ElectronDriver tests. Gates green (os-code 36 files, app 41 files,
  typecheck incl. electron tsconfig, lint --max-warnings 0, vite build).
  Still needs the machine: electron-rebuild of node-pty for the Electron ABI to
  run a real PTY (absent, openTerminal reports unavailable and chat is unaffected).

- **2026-08-26: Second round, founder-approved builds + all scoped follow-ups.**
  The founder approved both team recommendations and asked for every "left for
  their own scoping" item. All built, test-backed, merged to main. Gates green
  (os-code 302 tests, app 239, typecheck, lint, vite build).
  - **Free desktop chat (paywall change, C-suite approved, CTO-designed).** Chat
    with a paired desktop's own local models is now FREE; the coding agent,
    Marketplace, and repo writes stay Personal. The CTO rejected a
    "zero-tools session" (the command lane would have bypassed the tool registry
    and let a free session run shell) and specced a stateless daemon route POST
    /chat that builds only a provider and streams one completion: no
    AgentSession, no LocalDriver, no ToolRegistry, no command lane, no journal,
    pinned to the local orchestrator (no cloud spend). It cannot act by
    construction. A distinct source.kind 'desktop-chat' (not a flag on
    'desktop') keeps the free path off the session-creating branch; the gate is
    unchanged. New DesktopChatDriver; a free-chat picker row beside the merged
    "My computer" agent entry. Honest limit (CTO): the $20 wall is not
    server-enforceable against a user's own daemon; this confines the free
    surface, it does not police entitlement. Logged in DECISIONS.md.
  - **Terminal bridge Phase 2: a full interactive PTY.** xterm.js on the phone
    driving a live PTY on the desktop over new daemon term routes; agent reads it
    with a new readTerminal tool (no writeTerminal). node-pty is an OPTIONAL dep,
    lazy-imported: absent, the create route returns 503 and the daemon keeps
    serving (the whole tree stays green with no native module). Security
    reviewed: the terminal surface is ADMIN-only and owner-only; PTY output
    rides its own SSE endpoint, never the journal (only content-free
    opened/closed markers); stdin is never journaled or logged. Ring buffer with
    absolute byte offsets for lossless reattach. Electron terminal wiring was
    the one documented follow-up; it is now DONE (see the 2026-08-26 desktop
    PTY entry at the top of the Log).
  - **MP-F2:** a paired phone installs a desktop model over the tailnet (daemon
    /models/install + progress polling).
  - **MP-F4:** pocket models that finished downloading while the app was closed
    are adopted instead of re-downloaded (app adoption + a native guard).
  - **TS-P2-4:** per-device, revocable pairing credentials; the QR no longer
    hands out the shared admin token (mint-once, cached, revoke rotates the QR).
  - **TS-P1-5:** the home-repo path writer, so "Sync now" stops being
    enabled-but-doomed (pick an on-desktop cloned workspace).
  - **Still needs founder / device:** confirm the free-chat and P0 streaming on a
    real iPhone; node-pty built for the machine's ABI to run the real PTY (and
    electron-rebuild for the Electron terminal follow-up); the Swift changes
    compile on TestFlight.

- **2026-08-26: Review remediation, full pass, merged to main.** Acted on the
  2026-08-25 review (`CODE-REVIEW-FINDINGS-2026-08-25.md`) across the three
  focus areas, closing out the substantive findings and a full premium-polish
  pass, each fix test-backed; gates green (os-code 275 tests, app 192,
  typecheck, lint, vite build). Founder directed the push to main.
  Additions beyond the first pass below: the chat-to-terminal bridge now works
  on the DESKTOP app too (Electron command lane over IPC) and gains a composer
  Terminal mode ($) for typing your own command; the Marketplace got a premium
  pass (a real single-model product page replacing the fuzzy-search stand-in, a
  browsable Starter-stacks preset shelf, a shimmer skeleton loader, an installed
  state for desktop models, a quantization gloss, brand-safe hero variety, a
  button-in-button a11y fix, a filter-clear empty state); macOS Tailscale
  detection and CGNAT alignment; honest loopback pairing state (no unreachable
  QR); SSE write backpressure; a cached Tailscale probe so the Pair poll never
  freezes the desktop; and polish haptics on the terminal commits. Still a
  founder decision, deliberately NOT built: the desktop-chat paywall change
  (C-suite recommended opening free desktop chat, a monetization-foundation
  change needing explicit approval) and terminal-bridge Phase 2 (full PTY tab).
  Still needs founder/device verification: the P0 streaming fix on a real
  iPhone, and the native Swift changes compile on TestFlight. Larger follow-ups
  left for their own scoping: the daemon model-install endpoint (MP-F2),
  background-download adoption (MP-F4), per-device pairing credentials (TS-P2-4),
  and the home-repo path writer (TS-P1-5).
  - **Tailscale / phone (P0 + P1s).** Fixed the flagship phone bug: the daemon
    SSE stream and Anthropic SDK were routed through Capacitor's native-HTTP
    fetch (buffers, cannot stream), so a paired phone rendered nothing during a
    run. New `streamingFetch` reaches the unpatched WebView fetch
    (`window.CapacitorWebFetch`); the global patch stays on so web search / Drive
    / Supabase are untouched (safe failure mode). Also: `/outbox/apply|verify`
    now admin/workspace-gated (a member token could push to any repo, security
    must-fix); the tailscale-bound daemon also listens on loopback so `osc
    attach` reaches it; a daemon restart seeds the agent's history from the
    journal (no more amnesia) and clears zombie approvals; the reconnect loop
    stops on 401/persistent-404 with actionable copy instead of retrying forever;
    phone POSTs get a 10s timeout.
  - **Chat-to-terminal bridge, Phase 1 (the founder's game-changer).** A
    first-class command lane: run a command on the paired desktop from chat,
    watch output stream live, answer prompts, kill it, and the model reads the
    result on its next turn (no screenshot loop). New
    `core/exec/commandRunner.ts` (shared with runShell), three `command-*`
    driver events, `LocalDriver.runCommand/writeCommandStdin/killCommand`, daemon
    routes under the owned-session block (owner's tap is the approval, audited in
    the journal), a `contextPreamble` seam into `AgentSession.run`, and the app
    side (command ThreadItem + reducer, `CommandCard`, RemoteDriver methods,
    store actions, a Run/Copy button on shell code blocks). Also fixed the tiny
    high-leverage bug: the app discarded all shell output past its first line.
    Follow-ups: desktop (Electron) command lane, a composer terminal-mode
    toggle, and Phase 2 (full PTY tab) which is a founder decision.
  - **Marketplace (premium + functional + HF automation).** A standalone iPhone
    now fetches the published catalog directly (Preferences-cached, graceful
    fallback) so ratings/popularity/staff-picks appear without a paired desktop;
    the Staff axis hides when empty; copy fixed (popularity is HF-only; the "over
    Tailscale" note is phone-only). Builder: an HF outage no longer strips
    popularity (carry-forward + coverage gate); HF_TOKEN + bounded concurrency +
    retry; a license-drift warning; a published commercial-posture flag; a gate
    that rejects any non-huggingface.co `onDevice.url` (plus the native client
    check), closing a redirect-to-anywhere download vector.
  - **Advisor ruling captured (founder decision needed).** The C-suite (CFO lead,
    CMO weighed) recommends opening FREE desktop CHAT (route it like `stack`,
    read-only) while keeping the $20 Personal gate on the coding agent,
    Marketplace, and repo writes. This is a monetization-FOUNDATION change, so it
    was deliberately NOT built; it needs the founder's explicit yes. Gate lives at
    `app/src/state/store.ts` around the desktop-conversation check.
  - **Needs founder / device (cannot verify in a web session):** confirm the P0
    fix on a real iPhone (streaming); the Swift `downloadModel` host check and
    any native change compile on TestFlight; wire an optional `HF_TOKEN` repo
    secret if you want the authenticated popularity fetch.
- **2026-08-26: Chat-surface refinements + polish (bigger menu, anchored
  greeting, guide-as-reasoning, a Chats room).** Founder asks over four
  screenshots. (1) Menu button: a drawn SVG glyph (`components/MenuIcon.tsx`),
  fuller weight in the primary ink on a 40px target, in the chat top bar and the
  room BackBar. (2) Empty-state greeting: `.greeting` switched to
  `justify-content: flex-end` so the mark + line sit just above the composer and
  ride up with it under the keyboard, instead of centering and colliding with
  the status bar. (3) Downloaded guide becomes the Reasoning anchor:
  `reasoningPromotion` in `state/store.ts` promotes a just-downloaded Harbor /
  Harbor Mini when there is no anchor or the anchor is a guide not on the device
  (Harbor also upgrades a ready Mini); a matching init reconcile heals the seeded
  Mini anchor a Harbor-only user hit ("download it first"). Cloud/BYOM/user
  device anchors untouched. (4) Chats room: new `chats` view +
  `screens/ChatsScreen.tsx` lists the active project's chats with an easy new
  chat; the recent-chats list left the drawer, New chat + Quick chat stayed.
  Polish: capped row stagger, opacity room cross-fade (keyed on view),
  menu-glyph press spring, grouped flat rows that swipe to delete behind a
  confirm (SwipeRow gained an optional label + danger variant + style, pin
  behavior unchanged). Dead `.conv-list`/`.conv-empty` pruned. Animations use
  `backwards` per the polish-standards rule. Green: 209 app tests, typecheck,
  lint, build, em-dash. Not iOS-verified here.

- **2026-08-25: App Vault opens the on-disk folder (file-backed provider).** The
  paired follow-up to agent vault writes: the app's Vault can now live in the
  same `~/OSCode/Vault` folder the agent writes, so notes flow both ways and
  Obsidian opens the folder. A new gitOS provider 'files' ("This folder") is a
  thin client over new Electron IPC (osc:vaultList/Read/Write/Remove in
  electron/main.ts), each path jailed to the vault dir with os-code's own Jail
  (symlink-safe). Exposed on the bridge interface + preload; registered in the
  seam and PROVIDER_ROSTER; probeReady('files') gates it to the desktop app
  (the phone shows it as "Open OpenShore on your computer"). The user moves the
  personal vault onto it from the existing "Where it lives" sheet, which needed
  no change (it renders the roster generically). Green: app typecheck (app +
  electron tsconfig), lint --max-warnings 0, 176 tests (adds deviceFolder.test
  with a no-bridge-throws case), vite build, em-dash. Not runnable in the web
  session (no Electron), so founder verifies on Pop!_OS. Known gap: no fs-watch,
  so an external write (the agent's) shows on the next Vault refresh, not live.

- **2026-08-25: Agent vault writes, with an always-ask approval (daemon side).**
  The last Vault follow-up. The agent can now read, list, and WRITE the user's
  knowledge vault as part of its work, but never silently. Founder chose a
  private on-device vault (plain markdown under `~/OSCode/Vault`, config
  `vault.dir`) over the team vault, so nothing crosses to the daemon and Obsidian
  opens the folder. New tools in `os-code/src/core/tools/vault.ts`: `vaultRead` /
  `vaultList` (read, flow) and `vaultWrite` (write, always-ask, append or
  replace, unified-diff preview), path-jailed to the vault root so a note can
  never escape it. The "never silent" guarantee is structural, not a convention:
  a new `ToolDef.alwaysAsk` flag that the permission engine honors before every
  auto-allow path (`decide()` returns 'ask' ahead of session grants, rules, and
  trusted repos), and the loop refuses to grant "allow for this session" on such
  a tool. Reuses the existing approval surface (app ApprovalSheet + CLI/TUI diff)
  for free. Green: os-code build, lint --max-warnings 0, 236 tests (adds
  vaultTools.test with an escape-rejection and an always-ask-beats-trusted-repo
  case), em-dash policy. FOLLOW-UP (paired, not blocking): the app's Vault screen
  does not yet show this on-disk folder; wiring it needs a file-backed gitOS
  provider over new Electron IPC (the bridge exposes no generic fs today),
  desktop-only and not testable from the web session.

- **2026-08-25: Vault organization tier (shared multi-writer team vault).** The
  last open Vault follow-up. A Supabase-backed gitOS provider ('org', "Team
  vault") slots behind the existing storage seam, so the Vault UI is unchanged
  above it. Migration `supabase/migrations/0010_org_vault.sql`: `org_vault_notes`
  keyed (org_id, path); RLS so only active members read (reuses is_org_member);
  table INSERT/UPDATE/DELETE revoked from clients so the two SECURITY DEFINER
  RPCs are the sole write path (same lockdown shape as 0005); `org_vault_put`
  does last-write-wins with a CONFLICT COPY (the body that would be overwritten
  by a concurrent write is first preserved as a "(conflict ...)" note, so no
  member's work is ever silently lost); `org_vault_delete` is a tombstone so
  peers converge on removals. Client: the provider tracks the rev it last read
  and hands it to the RPC as the base for conflict detection; a Personal | Team
  switcher on the Vault screen (Team shown only to signed-in org members); the
  personal vault's storage-location sheet stays personal-only. Also shipped `[[`
  autocompletion for both vaults: a pure `wikilinkContext(text, caret)` helper in
  vault.ts (tested) drives a mobile-first suggestion chip row in the editor, one
  tap to link an existing note or create a new one. The store's vault actions are
  now scope-aware (personal path behavior unchanged); the org provider
  authenticates via a token getter the store registers, never importing the
  store. FOUNDER ACTION: apply the migration (supabase db push) to enable the
  live team vault. Green: typecheck, lint --max-warnings 0, 168 app tests, em-dash
  policy, vite build. STILL OPEN as its own subsystem: agent-proposed vault
  writes with approval (spans the desktop daemon's tool/approval protocol; the
  app is chat-only). CTO reviewed the migration/RLS: SAFE with one P1 fixed in a
  follow-up commit before the migration is applied. The P1 was an
  account-separation leak (team-vault state and the provider base-rev cache
  survived sign-out, so a handed-off device could show the previous org's note
  titles / open note); fixed by clearing vaultScope/vaultFiles/vaultNote and
  calling resetOrgVault() on sign-out, and resetting to the personal scope on
  sign-in. Also took the CTO's anon-select revoke (defense in depth). Left as
  noted, non-regression: repo-wide search_path hardening (pg_catalog, public).

- **2026-08-25: connection status sheet fix + a full sheet-dismiss polish.**
  Tapping the connectivity pill (Docked/Offshore/Offline) opened its Connection
  sheet clipped at the top of the screen, behind the status bar, unreadable. Root
  cause: `ProfileStatus` rendered the sheet from inside `.topbar`, which sets
  `backdrop-filter`; a non-none backdrop-filter makes the element the containing
  block for its position:fixed descendants, so the full-screen `.sheet-scrim` was
  trapped in the thin bar instead of the viewport. Fix: portal the scrim to
  `document.body`, so its fixed positioning resolves against the viewport. Keeps
  the top bar's backdrop blur intact and fixes both places the pill appears
  (ChatScreen, BackBar). Then the polish the fix invited: the sheet slid in but
  snapped out, so it now drags to dismiss (grab handle, 1:1 finger tracking,
  velocity-free threshold with spring-back) and always animates out (scrim fade +
  slide-down, unmount held for the full exit so the tail is never clipped, a fixed
  timer so it also lands under reduced motion). Haptics on the lift and the drop
  via `lib/haptics`. `prefers-reduced-motion` now suppresses the sheet rise,
  slide, and scrim fade (was previously unhandled for sheets, an app-wide win).
  Green: typecheck, lint, 147 app tests, em-dash policy. Follow-up (not done):
  bring the same real exit to InfoSheet, ModelSheet, and the mode sheet, which
  still snap-unmount.

- **2026-08-25: polish pass, swipe physics + a tappable out-of-usage fallback.**
  Both polish bundles surfaced this session, built. Swipe-to-pin now reads as
  native: (1) axis lock, the gesture decides horizontal vs vertical in the first
  ~8px and only captures the pointer once horizontal, so a vertical list scroll
  is never stolen; (2) velocity commit, a quick leftward flick fires Pin/Unpin
  even short of the distance threshold; (3) a reveal-edge haptic tick the instant
  the action is fully revealed (armed), on top of the success haptic at commit.
  Out-of-usage is now actionable: the stopped message carries a "Switch to a
  local model" button that opens the Local LLMs sheet directly. The exact
  fallback phrase moved to `lib/usageFallback.ts` (a leaf module the cloud driver
  emits and the transcript matches, so they cannot drift), and `ModelSheet` takes
  an `initialStage` so the tap lands straight on the Local LLMs sub-sheet. Green:
  typecheck, lint, 153 tests, vite build, cap sync ios.

- **2026-08-25: OpenShore stops pricing usage; at account limits it points to
  local.** Founder call: OpenShore is a connection to the user's own Anthropic
  account (subscription or pay-as-you-go), so their account owns all billing.
  The app no longer fabricates or shows a per-turn dollar estimate. Removed the
  `inPerM`/`outPerM` rates from `lib/claudeModels.ts` (catalog now keeps only the
  real context window, the honest non-pricing signal the meter reads) and the
  token-times-rate cost math from the cloud driver. The shared `usage` protocol
  event still carries a `dollars` field for the CLI, so the driver sends 0 rather
  than invent a number (the shared protocol/CLI cost path was left intact, not
  renovated). Out-of-usage handling: a depleted balance (400 naming the credit
  balance) or a usage cap (429) now reads "No more Claude usage on your account
  right now. Switch to a local model to keep going," instead of the old
  rate-limit hedge, so the local fallback is always offered. The chat status line
  drops the `$X.XX` segment; model, kind, and context percent remain. Green:
  typecheck, lint, 151 tests, vite build. Follow-up (not done): make the
  out-of-usage message tappable to jump straight to the Local LLMs sheet.

- **2026-08-25: swipe-to-pin for models in the model sheet.** Founder wanted a
  swipe-left-to-pin on selectable models, pinned ones surfacing under My Stack
  on the root sheet where they can be unpinned by swipe. New pure helpers in
  `lib/pins.ts` (`pinKey`/`isPinnable`/`isPinned`/`togglePin`, tested) key each
  concrete source (`cloud:anthropic:<model>`, `device:<id>`); the stack and mock
  never pin. New `SwipeRow.tsx` is a pointer-driven row: a tap picks the model,
  a swipe past a short commit distance fires Pin/Unpin with a success haptic, and
  the foreground tracks the finger 1:1 then springs back on release (reduced
  motion honored). `AppSettings.pinnedModels` persists the list. The model sheet
  renders pins under My Stack (swipe to unpin) and wraps the Cloud Providers /
  Local LLMs model rows in SwipeRow (swipe to pin). Green: typecheck, lint, 151
  tests, vite build, cap sync ios.

- **2026-08-25: complete Claude model lineup, and a corrected model catalog.**
  Founder wants OpenShore to be a full Claude client: every model the user's key
  can reach, listed and usable, no need for the Claude app. Added Fable 5
  (`claude-fable-5`) so the Cloud Providers sheet now lists Fable 5, Opus 5,
  Sonnet 5, Haiku 4.5 with blurbs. Centralized the catalog into one leaf module
  `lib/claudeModels.ts` (single source of truth for id, label, blurb, pricing,
  context) that the cloud driver, the model sheet, and `sourceLabel` all read.
  Fixed stale data against the first-party API rates: Sonnet 5 was listed at
  3/15 per MTok, it is 2/10; and the context windows were all a flat 200k when
  Fable 5 / Opus 5 / Sonnet 5 are 1M (Haiku 4.5 is 200k), which had been reading
  the context meter about 5x too high. The composer pill now shows a clean name
  ("Claude · Opus 5") instead of the raw model id. The cloud-driver context-meter
  test was asserting the old wrong 200k window; updated to the real 1M with the
  200k fallback for unknown models. Follow-up (not done): wire the real
  `output_config.effort` API param for the cloud path instead of the current
  system-prompt effort directive; the request shape already works with Fable 5
  (no thinking/budget_tokens/prefill sent). Green: typecheck, lint, 147 tests,
  vite build.

- **2026-08-25: model sheet restructured to the Claude "Select model" shape.**
  Root is now a header (X + "Select model"), My Stack as the default, an Effort
  row (opens a High/Medium/Low sub-sheet), and two category buttons that open
  dedicated sheets the way Claude's "more models" does: Cloud Providers and
  Local LLMs. Each has an honest empty state that routes to setup: Cloud with no
  connected providers shows "No connected providers, add your API to get
  started" to Connections; Local with no downloads shows "No connected local
  LLMs, download a model from the Marketplace to get started" to the
  Marketplace. When no stack exists yet (`settings.stack` undefined), My Stack is
  greyed and carries a "Create your stack to get started" link to the Stack
  screen. Rows are now grouped into rounded cards with dividers, matching the
  Claude grouping. Effort no longer lives in the composer; it is a selection in
  this sheet. Green: typecheck, lint, 143 tests, vite build.

- **2026-08-25: composer refinements (founder pass on the live app).** Boot
  splash hold cut to 1.5s (`SPLASH_MIN_MS`). Greeting is now the tile mark plus
  the line only, the OpenShore wordmark removed. Composer mic swapped from the
  emoji to the iOS keyboard dictation microphone (an inline outline SVG, matching
  Claude). The effort pill is replaced by a Claude Code style permission-mode
  pill: `</> Accept edits` by default, opening a Select-mode sheet with the three
  modes (Auto, Accept edits, Plan) and their descriptions. Effort stays a
  selection pinned at the top of the model sheet, as before. New
  `permissionMode` in settings (default acceptEdits) and `lib/permissionMode.ts`;
  it functions on the coding-agent surface, the driver event handler
  auto-answers tool approvals per mode (Accept edits approves file edits, Auto
  approves all tools, Plan approves nothing, cloud spend always asks), and is
  inert for plain chat, exactly as the mode picker is in Claude Code. Tests
  added for the mode logic; app suite 143. Green: typecheck, lint, 143 tests,
  vite build.

- **2026-08-25: native iOS voice dictation, on-device only (founder call).**
  Founder chose on-device-only recognition (mic audio never leaves the phone,
  matching the "your machine, your keys" posture) and to build now rather than
  wait for a clean TestFlight. New `oscode-speech` Capacitor plugin, third local
  SPM plugin, mirroring oscode-iap: `SFSpeechRecognizer` +
  `SFSpeechAudioBufferRecognitionRequest` with `requiresOnDeviceRecognition =
  true`, driven by an `AVAudioEngine` input tap. Crucially it is JS-registered
  (`registerPlugin('OscodeSpeech')`), NOT imported in AppDelegate, so it needs
  no manual `project.pbxproj` linking, the exact trap that cost four fixes on
  oscode-llama; `cap sync` lists it in `CapApp-SPM/Package.swift` (verified: both
  the package ref and the product link landed) and Capacitor discovers it at
  runtime. CTO must-fixes all in: both `NSMicrophoneUsageDescription` and
  `NSSpeechRecognitionUsageDescription` (real sentences, no em dash); separate
  `SFSpeechRecognizer.requestAuthorization` and `AVAudioSession` record grants
  with every denial branch reported; audio session `.record`/`.duckOthers`,
  deactivated with `.notifyOthersOnDeactivation` on stop; interruption observer
  (call/Siri) stops cleanly; `available` reports false where on-device is absent
  so the mic hides instead of falling back to a server. `useDictation` now picks
  the backend: native on iOS, Web Speech on desktop/web, mic hidden where
  neither exists. Green: app typecheck, lint, 140 tests, vite build, and `cap
  sync ios` clean. NOT device-verified (no macOS/Xcode here); the native side
  compiles for the first time on the next Codemagic archive, so expect a
  possible round of fixes like the earlier iOS work, and the on-device
  transcription itself is only provable on a real TestFlight install.

- **2026-08-25: mid-chat model switching, Claude-style (founder overrode the
  CTO's fresh-chat default).** The founder wanted Claude's actual behavior:
  keep the conversation, change the model, the next turn runs on the new brain
  with the full transcript as context. This is NOT the live hot-swap the CTO
  NO-GO'd (aborting a stream mid-token, re-homing in-flight approvals). The
  insight that made it safe: `attachDriver` already disposes the old driver and
  swaps in a new one while keeping the thread (it is the production reattach
  path), so the only new work is seeding the new driver with the transcript and
  gating the swap. New `switchModel(source)` store action: refuses to swap while
  a turn is streaming or an approval is pending (CTO guardrails), falls back to a
  fresh chat when there is nothing to carry or the target is a repo agent/demo
  (a different mode), otherwise reseeds and reattaches in place and drops a "Now
  using X." note in the transcript. `seedFromTranscript` carries only the spoken
  user/assistant turns (tool/status artifacts stay behind). The three chat-brain
  drivers (cloud Claude, stack, on-device) gained an optional `seed` constructor
  arg that pre-fills their history. The top-bar model badge clears on switch so
  it reflects the new brain immediately. Tests added (seed extraction); app
  suite 140. Green: typecheck, lint, 140 tests, vite build. Not device-verified
  (no iOS here). Edge left as-is (low risk): switching right after an errored
  turn that ended on a user message could seed two consecutive user turns; the
  Anthropic API merges those, and the idle+approval gates make it rare.

- **2026-08-25: vision routing (CTO-ruled), plus the two composer forks the CTO
  parked.** Built on the composer rework above after a CTO review of the three
  deferred forks. **Fork 2 (GO, shipped):** images now route only to a brain
  that can see them. New `sourceSupportsVision(source)` in `state/types.ts`
  (default false everywhere, true only for a direct Claude chat today; the one
  place to extend for BYOM/Gemini vision or the desktop daemon later). The
  composer + button is gated: on a text-only model it shows "This model reads
  text only. Switch to Claude to send images." instead of stranding the file,
  and a send-time guard strips images if the model changed. No more silent drop
  (the trust hole the CTO flagged). Tests: effort, attachments, and vision
  resolvers added (app suite now 138). **Fork 3 (CTO NO-GO on hot-swap):** kept
  fresh-chat-on-switch (each conversation is bound to one driver; real
  mid-thread driver hot-swap is large blast radius, low value: streaming
  aborts, approval/tool state re-homing, N-by-N history reshaping). NEEDS
  FOUNDER RATIFY that fresh-chat is the intended behavior to keep. A bounded
  later enhancement is captured in the action list: "continue this thread with
  [new model]" = fork a new chat seeded with the transcript, no live handoff.
  **Fork 1 (native iOS voice) BLOCKED, by CTO recommendation + a founder
  decision:** the mic works via Web Speech on desktop/web but the iOS WKWebView
  needs a native SFSpeechRecognizer Capacitor plugin. The CTO says sequence it
  AFTER a confirmed clean TestFlight build (so any red is unambiguously the new
  plugin, not a latent archive issue we just spent four fixes on), and it needs
  the founder's call on the on-device-vs-server speech data-egress posture
  (on-device preferred for an on-device-first tool; server recognition is
  allowed but must be disclosed). Must-fixes captured for when it proceeds:
  both `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription`
  (real sentences, no em dash); request both SFSpeech and AVAudioSession
  permissions with every denial branch handled; `requiresOnDeviceRecognition`
  where supported; deactivate the audio session with
  `notifyOthersOnDeactivation` on stop; verify `cap sync` lands the plugin in
  CapApp-SPM and the App target links the product with the correct
  product-vs-module import name (the exact trap from last time). Green through
  Fork 2: app typecheck, lint, 138 tests, vite build.

- **2026-08-25: opening chat reworked to the Claude shape, and a five-control
  composer.** Empty state now mirrors the Claude app: just the wave-mark and a
  time-of-day greeting, no header title, no "chat and build" subtitle, no
  suggestion pills. Top bar keeps only the hamburger (phone) and the OpenShore
  ProfileStatus indicator. The composer gained the five Claude-Code controls:
  add (+), a model pill (default "My Stack"), an effort pill (default High), a
  mic, and send/stop. New model+effort sheet (`ModelSheet.tsx`): effort pinned
  at the very top (High/Medium/Low segmented), then My Stack, then connected
  cloud providers (Claude opens a sub-sheet of Claude models; other providers
  point to the stack, which is where they actually run), then on-device models.
  New state: `effort` in AppSettings (default High), mirrored to a live value
  (`lib/effort.ts`) that the cloud-Claude and stack drivers fold into their
  system prompt, so the choice actually shapes answers. Attachments
  (`lib/attachments.ts`): + captures photos/files via the WebView picker (works
  in the iOS WKWebView, no native plugin), shown as chips, and image blocks are
  forwarded to the cloud-Claude vision path (`ChatDriver.send` gained an
  optional `attachments` arg; non-vision drivers ignore it). Voice
  (`useDictation.ts`): Web Speech dictation where the platform provides it
  (desktop, web); the iOS WKWebView does not expose SpeechRecognition, so the
  mic is honest there (a toast) rather than fake. Green: app typecheck, lint,
  128 tests, vite build. **Known scope / follow-ups:** (1) native iOS voice
  needs a Capacitor speech plugin, deliberately deferred so it cannot
  destabilize the just-fixed iOS archive; (2) vision is wired for the
  cloud-Claude path only, other drivers ignore attachments; (3) switching the
  model while a chat is open starts a fresh chat with the new brain (each
  conversation is bound to one driver), rather than swapping mid-thread. Not
  build-run-verified on device (no macOS/iOS here); validated by the gate.

- **2026-08-25: fixed the real cause of the "Unable to resolve module
  dependency: 'OscodeLlama'" archive failure, a wrong import name.** The
  oscode-llama Package.swift names the library PRODUCT `OscodeLlama` but its
  TARGET (and therefore its Swift MODULE) `OscodeLlamaPlugin`. Swift `import`
  takes a module name, so `import OscodeLlama` in AppDelegate.swift could never
  resolve. The error was byte-identical across builds because the import line
  never changed and no module named `OscodeLlama` exists. Fixed to `import
  OscodeLlamaPlugin`. The earlier package-link commit (6fc341d) was still
  necessary and correct: it links the `OscodeLlama` product to the App target,
  which is what makes the `OscodeLlamaPlugin` module available to import; the
  wrong import name was masking whether that link worked. Both classes
  AppDelegate calls (`OscodeLlamaPlugin.deliverPushToken`,
  `ModelStore.handleBackgroundSessionEvents`) live in that module. Still not
  locally build-verifiable (no macOS/Xcode); reasoned from the Package.swift
  product-vs-target naming and Swift's module-import rule.

- **2026-08-25: fixed the first two Codemagic archive failures (fresh iOS
  Swift compile, expected per the earlier note above).** (1)
  `ModelStore.swift`'s four `URLSessionDownloadDelegate`/`URLSessionDelegate`
  methods were missing `public`, required because the class and the protocol
  are both public. (2) `AppDelegate.swift` does `import OscodeLlama` directly
  (to call `OscodeLlamaPlugin.deliverPushToken` for the completion-push
  feature), but the App target only linked the `CapApp-SPM` umbrella package,
  never `OscodeLlama` itself, so the module could not resolve. Added a second
  `XCLocalSwiftPackageReference` + `XCSwiftPackageProductDependency` to
  `App.xcodeproj/project.pbxproj`, pointed at the exact same pnpm virtual-store
  path `CapApp-SPM/Package.swift` already resolves
  (`node_modules/.pnpm/oscode-llama@file+app+plugins+oscode-llama_@capacitor+core@8.5.0/node_modules/oscode-llama`)
  rather than the `app/plugins/oscode-llama` source directly, since pnpm
  copies (not symlinks) into that store, so the two paths are different
  package identities to SwiftPM and pointing at both would risk a duplicate
  package/duplicate symbol conflict. **Known fragility:** unlike
  `CapApp-SPM/Package.swift` (regenerated by `cap sync`), this hand-added
  pbxproj reference does NOT auto-update if that pnpm store hash ever changes
  (e.g. a future `@capacitor/core` version bump). If a build ever fails again
  with "Unable to resolve module dependency: 'OscodeLlama'", recompute the
  path from the current `CapApp-SPM/Package.swift` dependency string. Neither
  fix could be locally build-verified (no macOS/Xcode available in this
  session); both were reasoned from the Codemagic error text and Xcode project
  file conventions. Landed on branch
  claude/splash-screen-openshare-rename-sd0580 for merge to main; next
  Codemagic run will show whether more first-compile issues remain.

- **2026-08-25: boot splash on open, and the app is now named OpenShore.**
  Two founder asks. (1) Opening OpenShore no longer shows a blank window before
  the UI paints: a branded boot splash (the wave-mark plus the OpenShore
  wordmark on the app background) is painted the instant index.html parses, so
  it covers the desktop Electron blank-window gap and the iOS launch-image to
  React-mount gap alike; main.tsx cross-fades and removes it once the first
  frame renders, honoring prefers-reduced-motion. The in-app opening greeting
  (brand lockup plus time-of-day greeting in the empty chat) is unchanged and
  still shows on a cold open. (2) The product display name changed from "OS
  Code" to "OpenShore" everywhere a person reads it: the app/window/bundle
  display names (capacitor appName, electron title, package productName,
  index.html title, iOS CFBundleDisplayName), the topbar and greeting wordmark,
  the guide system prompts ("You are OpenShore..."), and all in-app copy.
  Technical identifiers are deliberately left as-is (appId ai.openshore.oscode,
  the oscode-* packages, the os-code workspace package, the osc CLI) so bundle
  IDs, IAP, and builds do not break. Green: app typecheck, lint, 116 tests, and
  vite build all pass. Landed on branch
  claude/splash-screen-openshare-rename-sd0580 for merge to main. Follow-up:
  the public product page (Open-Shore-LLC-Homepage, openshore.ai/os-code) still
  says "OS Code"; mirror the rename there when the founder is ready.

- **2026-08-25: completion push, so you can code with the app closed.** Parity
  with Claude Code's "write a prompt, close the app, get told when it is done."
  The desktop path already runs the agent loop on the user's own daemon and
  journals every step for replay, so the run continues while the phone is closed;
  the missing piece was telling the user when it finishes or blocks on an
  approval. Built content-free push across three layers. Supabase: migration 0009
  (push_devices, push_grants, push_sends), a new _shared/apns.ts ES256 provider
  signer with token caching, and push-register / push-grant / push-send. The
  daemon (src/daemon/push.ts) watches each session's live events and fires a
  push on approval-request (always) or an idle task-done (queue empty), unless a
  fresh phone beat says the user is watching; the grant is sealed at rest, keyed
  per owning user. The app registers for APNs (AppDelegate + the llama plugin,
  aps-environment read from the provisioning profile), hands the daemon a grant,
  and beats while foreground. Auth model per the CTO review (GO with must-fixes,
  all folded in): the daemon is already fully trusted, so the credential is an
  opaque revocable grant, not a signed short-lived JWT; push-send derives the
  target user and devices solely from the grant, with a per-session cooldown, a
  daily ceiling, and (session, kind, seq) de-dupe. On-device (Harbor) and
  phone-orchestrated cloud/stack turns cannot run closed (iOS limit) and are out
  of scope; the standing off-device principle is in DECISIONS.md. Gates green
  (os-code 29 files / 227 tests incl. a new push.test.ts, app 20 / 116, vite
  build, both em-dash guards).
  **Server side is now LIVE (2026-08-25):** the founder set the APNS_* secrets,
  ran `supabase db push` (0009 applied), and deployed push-register /
  push-grant / push-send. Still needed before the phone can register: confirm
  Push Notifications is enabled on the ai.openshore.oscode App ID (Apple
  Developer, Identifiers), and merge this branch to `main` so Codemagic cuts a
  TestFlight build carrying the entitlement and the new native code (the
  simulator cannot receive a push token; needs a real device).
  Swift builds on Codemagic, not verifiable in this sandbox.
- **2026-08-24: model downloads (and inference) survive backgrounding.** Root
  cause of "the download failed because I closed the app": `ModelStore` ran the
  GGUF download on a foreground `URLSession`, which iOS suspends on background
  and kills on close, and the whole completion contract was a live
  `CAPPluginCall` that evaporated with the app. Rebuilt it on a background
  `URLSession` (`URLSessionConfiguration.background`, fixed identifier, a
  process-wide `ModelStore.shared` singleton): the system daemon keeps
  transferring while the app is suspended or terminated and relaunches the app
  to finish. Each task carries its model id in `taskDescription` so it is
  recovered across a relaunch (`getAllTasks`), with a recovery gate that holds a
  fresh start until recovery reports what is already in flight, so no duplicate
  download. AppDelegate now implements
  `handleEventsForBackgroundURLSession` -> `ModelStore.handleBackgroundSessionEvents`.
  On launch the JS init calls a new `activeDownloads()` and re-drives
  `ensureHarbor` / `ensureHarborMini` for anything still transferring, so the
  progress bar reappears instead of a dead one; a download that finished while
  away was already caught by the `listModels` reconciliation. Also wrapped
  on-device `load` and `generate` in finite-length `beginBackgroundTask`
  assertions so a model load or a mid-stream reply is not cut off the instant
  the app leaves the foreground. No `UIBackgroundModes` entry needed;
  `docs/app-review-notes.md` documents the justification. Gates green (app: 20
  files / 116 tests, typecheck, lint, em-dash guard incl. `.swift`). Swift is
  built on Codemagic, not verifiable in this sandbox.
- **2026-08-21: individual Personal + free/paid gating + iOS IAP (4 phases).**
  Free is now chat only; the coding agent and Marketplace need Personal ($20/yr),
  bought via Apple IAP on iOS and Stripe on web/desktop, both writing one
  account entitlement. Phase 0: `user_entitlements` + `apple_links` (0006/0007),
  the `personalUnlocked` resolver, individual read path. Phase 1: Stripe
  individual checkout/webhook/portal (CTO-reviewed; a HIGH in-place-migration bug
  found and fixed via 0007, plus a cross-rail clobber pre-empted). Phase 2:
  native StoreKit 2 Capacitor plugin `oscode-iap` + the Apple server rail
  (`_shared/apple.ts` via Apple's official verifier, `link-apple-purchase`,
  `apple-notifications` with idempotency 0008; CTO found and fixed F1 cross-rail
  false-revoke, F2 sandbox-in-prod, F3 restore revenue-leak). Phase 3: the gate
  flip -- `newConversation({kind:'desktop'})` and `setView('marketplace')`
  intercept to a Personal paywall (CMO copy), a lock pill, buyPersonal/restore
  actions. All gates green (222 engine, 93 app, vite build); commits across
  e9170a4..f1a70dd. NOT yet deployed: needs the founder config in the action item
  above (Stripe Personal price, migrations + function deploys, Apple product +
  secrets + root CA, sandbox validation). Reversible: the gate only bites once
  the entitlement rails are live, and there are no public users yet.
- **2026-08-20: CI goes green on main.** The new CI workflow (added in the
  review remediation) was red on its first three runs: `pnpm -r typecheck`
  ran before the engine was built, so the app package could not resolve
  `os-code/protocol` (which points at os-code's built dist). Added a "Build the
  engine" step (`pnpm --filter os-code build`) before lint/typecheck/test,
  matching catalog.yml. Run #4 on `73244eb` is fully green: install, build,
  lint, typecheck, and all 312 tests (222 engine + 90 app) pass in CI. Commit
  `73244eb`.
- **2026-08-20: full-platform code review + remediation.** A five-pass senior
  review (engine core/security, engine breadth/builder, money/backend,
  app+electron, infra) produced `CODE-REVIEW-FINDINGS.md` (6 P0, ~28 P1, plus
  P2s). All of it was then fixed in two gated waves, test-backed. Wave 1
  (engine/security/infra): journal-redaction JSON corruption, outbox reverting
  desktop commits, keychain-unreadable key-loss, daemon member-as-admin, egress
  redirect + httpFetch DNS-rebind SSRF, abort/guardrail session-bricking, atomic
  config/usage writes, Stack Health day/DST bucketing, iGPU budget, plus a real
  CI workflow (lint/typecheck/test on every push, which nothing ran before) and
  catalog-pipeline hardening. Wave 2 (billing/app): the live money path per the
  CTO ruling. The billing endpoints authorized the SERVICE-ROLE identity so the
  admin check saw NULL (the purchase path may have been 403ing every real
  admin); now a caller-scoped client makes `auth.uid()` the caller. Entitlement
  is revoked on cancel/past-due/payment-failure (was never revoked), `orgs` is
  RLS-locked against client tier/customer writes (UPDATE and INSERT), the webhook
  500s on a failed write so Stripe retries, idempotency/ordering guard, real
  seats, double-checkout routing. `org_entitlements.status` is the single
  authoritative source; the dead entitlement-claim function was deleted. App
  side: blank-transcript-on-resume, listener leaks, persistence, brand-commit
  a11y. Commits `9c60273`/`d3926fa` here, `53e9c12` marketing.
  **Founder actions before this is live:** apply migrations 0004 then 0005 and
  redeploy the edge functions (with/before the app); enable Supabase
  refresh-token rotation; run one real test-mode purchase to confirm P0-1; add
  the `docs/app-review-notes.md` ATS justification to App Store Connect.
- **2026-08-20: at-rest encryption for the engine.** Session journals and
  titles now seal with AES-256-GCM in the exact app-side `enc:v1` format
  (bidirectional WebCrypto cross-test pins the compatibility). The data key
  rides the existing credential store: OS keychain preferred, machine-keyed
  encrypted file at 600 as fallback, with the backend reported honestly and the
  key self-upgrading into a keychain when one appears. Lines are redacted then
  sealed; readers everywhere tolerate legacy plaintext; a one-shot atomic
  idempotent boot migration (Electron host + daemon) reseals pre-encryption
  sessions. The Stack Health privacy seal is now measured, not asserted: a
  full-disk prefix scan plus the real key backend decide its color, and green
  requires keychain + zero plaintext lines. Settings' "Encrypted on this
  device" card shows the live measured facts. 12 new tests; suites now
  os-code 162 / app 76, all gates green.
- **2026-08-20: Marketplace + Stack Health + Nightshore site.** Three builds,
  branch `claude/os-code-openshore-styling-4bk7mp`, all gates green (os-code
  150 tests, app 76, vite build).
  - **Marketplace** upgraded to a real model store: a CI-only catalog builder
    (`os-code/scripts/build-catalog/`, own `tsconfig.scripts.json`, run via
    `tsx`, isolation-guarded) that reads HF + Ollama METADATA ONLY and computes
    provenance-backed 5-star capability ratings from a data table, with license
    fail-closed (SPDX allow-list), a bad-build regression gate, and an editorial
    overlay. Client storefront: search, filter rail, three sorts (Recommended
    default, popularity labelled honestly, newest, best-fit), osCodeFit set
    apart above true half-star capability lanes with provenance tap-through,
    fit/pick badges, shore-edge accents, and 2-3 model compare. Schema extended
    with optional ratings/popularity/recency/recommended (back-compat). Docs in
    `os-code/docs/MARKETPLACE.md`.
  - **Stack Health** (Phase 1): a fully local dashboard, computed by a new
    engine aggregator (`os-code/src/insights/stackHealth.ts`) folding the
    session journals + `usage.json` into three rings (Local/Private, Flow,
    Saved), a dollars-saved count-up (local tokens repriced at a named Claude
    Sonnet basis, presented as an estimate), cloud flips, tools/approvals,
    outcomes, a session-grained timeline, and a crew view over the configured
    stack. Read-only bridge (`osc:stackHealth`), pure payload types through
    `os-code/protocol`, honest privacy seal (telemetry off true, data-left-
    device reflects real cloud calls, encrypted-at-rest a candid amber until the
    separate sealing task ships). Screen at `app/src/screens/StackHealthScreen`.
    Docs in `os-code/docs/STACK-HEALTH.md`.
  - **Nightshore site**: `openshore.ai/os-code` given a Creative Studio delight
    pass (coda teal accent, hero sub-CTAs, pillar ghost-wave glyph, offer
    hover-spine bloom, contrast + FAB restraint) in the marketing repo.
  - Advisor passes: CTO (go with must-fixes, all applied) and Creative Studio
    (delight/brand pass across all three surfaces, folded in).
- **2026-08-18: native app pivot.** Founder direction: OS Code is a native
  app for iOS and the Linux desktop, cloning the Claude app experience on a
  local stack; the CLI is parked. The repo became a pnpm workspace: this
  package is now the shared ENGINE (browser-safe `os-code/protocol`
  subpath, daemon CORS + phone endpoints, quarterback taxonomy with
  writing/analysis slots, pocket-class on-device models in the catalog).
  `app/` holds the React app, the Electron shell with the engine embedded,
  the Capacitor iOS project, and the `oscode-llama` Swift plugin (llama.cpp
  via LLM.swift v3.0.3). CI to TestFlight via `codemagic.yaml`; founder
  walkthrough in `docs/TESTFLIGHT.md`. Workspace gate green: 97 engine
  tests + 10 app tests. Root README is the product front door now.
- **2026-08-18: delight polish pass.** Streaming smoother, model-load ticker,
  syntax-tinted diffs, cursor blink, approval pressed-state, real download
  progress bar (Ollama `/api/pull`), low-color terminal fallback, and `/find`
  transcript search. New pure modules (`tui/smoothing.ts`, `tui/syntax.ts`,
  `tui/transcriptSearch.ts`) and 16 new tests. Suite: 97 passing.
- **2026-08-18: initial complete build.** Repo scaffolded from empty to a
  working product in three commits (core foundation; breadth layer; TUI,
  commands, tests, docs). Toolchain: Node 20+, TypeScript 5.9 strict ESM,
  Ink 5 + React 18, zod 4, vitest 4, eslint 8 + prettier. See DECISIONS.md
  for every judgment call.
