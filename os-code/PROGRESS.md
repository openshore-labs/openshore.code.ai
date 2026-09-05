# PROGRESS

The recent-state source of truth for OS Code, kept in the same spirit as the
Uki app repo: current state first, then what remains, then the log.

Older Current state sections and log entries are in `docs/progress-archive.md`
(newest first); the parked build prompts are in `docs/parked-ideas.md`. Keep
this file to one Current state, one What remains, and the last five log
entries (`test/progressShape.test.ts` enforces the shape).

## Current state (2026-09-05, full-codebase review remediation)

The review in `CODE-REVIEW-FINDINGS-2026-09-05.md` (root; six parallel senior
passes over HEAD `e14b0a7`, 82 commits and about 90k changed lines since the
2026-08-25 reviews) was worked as one wave, batched by subsystem so each file
was edited once, with the `Verify` test written first. Rulings during the wave
are one line each in `DECISIONS.md`.

- **The four P0s.** P0-1: the daemon's user command lane is no longer an
  unjailed shell for a member token (admin-gated, and both path predicates
  resolve real paths on both sides). P0-2: the guardrail token and dollar
  counters reset per task, so a long session can start its next task. P0-3: the
  sealed-store key is never minted over existing sealed data; an unreadable key
  surfaces a "could not unlock your data on this machine" state instead of
  orphaning every sealed byte. P0-4: email confirmation is on in
  `supabase/config.toml`, and the email-keyed grants require a confirmed
  address in SQL as well (migration `0015`).
- **P1 and P2, by batch.** Trust boundaries (owner-filtered session listings,
  profile-aware permission overrides, normalized permission globs). Session
  lifecycle (idle work no longer inherits the task's abort signal, compaction
  never cuts between a tool call and its result, steps rail off-by-one, native
  batch problems reported, approvals settled on abort). Streams and timeouts
  (Anthropic in-stream errors surface, an idle deadline on every provider
  stream, Stop reaches a delegated specialist, a terminal exit frame). App auth
  and the sealed store (one refreshed token helper for every Supabase call, a
  typed sign-out on a dead refresh token, persisted pending email for the
  magic-link binding, sign-out clears the roster, per-key write chain). On-device
  model ownership (one `loadedModelId` owner; a load during generation ends the
  old chat honestly). Backend (`members_write` WITH CHECK, seat ceilings by
  trigger, the Stripe cross-rail guard, Apple link state, review column grants,
  vault path guard, checkout filter on live statuses, entitlement decisions in
  `_shared/entitlement.ts` with Deno tests).
- **Guards and CI (INF).** CI now builds every package, checks formatting,
  and runs the Deno tests; both workflows are least-privilege (`contents:
read`), SHA-pinned, and read Node from `.nvmrc` (22.22.2; root `engines`
  `>=22.12`); the catalog workflow scopes each secret to its one step and takes
  an `allow_large_drop` input. The em-dash guard is repo-wide (git toplevel,
  every text extension, test files included, one reasoned exemption for the
  archived 2026-08-20 review). The desktop preflight refuses to launch with a
  node-pty that is missing or built for the wrong ABI; the app postinstall
  honors `SKIP_NATIVE_REBUILD=1` and CI and Codemagic skip the Electron binary.
  Codemagic pins Xcode and builds the engine once. `.cjs` and `.mjs` are linted.
  The nested `os-code/pnpm-lock.yaml` is gone. The addressed review docs live in
  `docs/archive/` with status banners.
- **Docs and license.** This file is lean again (one Current state, one What
  remains, the last five log entries); the history is in
  `docs/progress-archive.md` and the parked build prompts in
  `docs/parked-ideas.md`, both guarded by `test/progressShape.test.ts`. The
  license is a "no license granted" placeholder at the root and in
  `os-code/LICENSE` (CFO ruling; the plugins are `UNLICENSED`, `private`).
  ESLint 9 is deferred to its own commit.
- Gates at close: os-code typecheck, lint, 493 tests (54 files), tsc build,
  Prettier check; app typecheck (src and electron), lint (now covering .cjs and
  .mjs), 692 tests (92 files), vite build, Prettier check; the repo-wide
  em-dash guard and the PROGRESS shape guard. Deno and pgTAP suites are
  written but not executed here (no Deno or Postgres in the session); CI now
  runs the Deno suite.

## What remains (known follow-ups, none blocking)

- [ ] **ESLint 9 + typescript-eslint 8 upgrade (INF-9).** Deferred by the
      CTO to its own commit after the 2026-09-05 wave: flat config in both
      packages, the unsupported-TypeScript warning gone. DECISIONS.md records it.
- [ ] **Apple link status from the App Store Server API (BE-4, long term).**
      The 2026-09-05 fix keeps subscription state on `apple_links` and refuses a
      stale JWS; the durable answer is a live status call with the `.p8` the
      README reserves, so a refunded purchase can never be replayed.
- [ ] **Per-seat billing (BE-2, deferred).** Seat ceilings are enforced by
      trigger since 0015; billing `quantity = seats` on Stripe is the follow-up
      so a team above its band pays for it rather than being refused.
- [ ] **P0-3 on Linux, repro still UNCONFIRMED.** How often Electron's
      `safeStorage.decryptString` throws on the founder's Pop!\_OS desktop:
      launch the desktop app with `--password-store=basic` after a run that used
      the default backend and check whether `oscode-secrets.json`'s key entry is
      rewritten. The code now refuses to mint a new key over sealed data either
      way.
- [ ] **On-device verification of the Swift changes (needs a phone).** The
      2026-09-05 wave touched `LlamaRunner.swift` (a load during generation now
      ends the old chat in a stopped state), the iCloud plugin (evicted notes
      are reported, not hidden), and the download bookkeeping. TestFlight is the
      proof: start a Harbor reply, open another pocket model chat and send; on
      two devices Remove Download a note and create the same name.
- [ ] **Codemagic-drives-builds gate, UNCONFIRMED edge (INF-16).** A desktop
      session bootstrapped while the switch is On keeps its token after the
      switch flips Off. Verify: On, start a session, Off, ask the model to
      trigger a build; expect the deny. Close by re-reading the switch per call.
- [ ] **Founder ops from the 2026-09-05 review** (`CODE-REVIEW-FINDINGS-2026-09-05.md`,
      "Still needs the founder"): keep Supabase "Confirm email" ON in the hosted
      project and never `supabase config push` while `config.toml` says
      otherwise; confirm "Secure email change" is on; refresh-token rotation and
      reuse detection is a dashboard toggle; set `CORS_ALLOWED_ORIGINS`; choose
      the license (a "no license granted" placeholder stands at the root and in
      `os-code/LICENSE` since 2026-09-05, the plugins are `UNLICENSED`); decide
      the member command lane (the code now admin-gates it).
- [x] **Terminal Control: the approval-handler assembly is pinned by tests.**
      Extracted to the pure `decideDesktopShellApproval` in
      `app/src/lib/terminalControl.ts` with tests for approve / deny / passthrough
      and the member case (2026-09-04).
- [x] **Terminal Control OFF semantics, founder call: stricter OFF shipped.** Off
      keeps the model out of the terminal entirely and sends the person to the
      switch; it no longer asks per command (2026-09-04).
- [x] **Terminal: a desktop drives a remote hub, and multi-hub.** Both built
      (2026-09-04): `preferRemoteHub` in `buildDriver`, `settings.daemons` with
      the active one mirrored into `settings.daemon`, and PairScreen management.
- [x] **Project memory: read-only view in the app (DONE, cross-platform).** The
      founder chose full cross-platform. Built: a desktop read-only repo bridge
      (`repoReadDir`/`repoReadFile`, jailed to the repo root), a read-only GitHub
      contents client (`app/src/lib/github.ts`) for iOS and clone-less devices,
      the source chooser (`app/src/lib/projectMemoryRead.ts`), and the
      `ProjectMemoryScreen` reached from a "Coding projects" list in the Vault.
- [ ] **Project memory: a "note updated" nudge (P3, optional).** The
      `projectMemoryWrite` tool lands silently by design, and `mode: 'replace'`
      can overwrite a note the person hand-edited. The full diff is emitted on
      tool-end (visible in the transcript), so it is not truly silent, but a
      lightweight "memory note updated" toast would let a person notice when the
      agent rewrote something they touched. CTO-suggested, accepted as a
      non-blocking nicety (2026-09-04).

- [x] **Community reviews: LIVE.** The backend was validated against a real
      Postgres (0011 + 0012 + 0013 apply clean; anon reads visible rows,
      per-reader block, single/batched/snapshot aggregate RPCs, one-per-user
      upsert, the report auto-hide trigger at 3, and the moderator guard all
      exercised), which caught and fixed two bugs that would have 403'd in
      production: missing table grants, and the block subquery in the read policy
      locking anon out of every review (now a SECURITY DEFINER `author_blocked`
      helper). All founder steps are done: `supabase db push` applied 0011/0012/
      0013; a build shipped with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY set,
      installed and signed in; the founder is seeded into `review_moderators`
      (`founder@openshore.ai`), so the Admin queue is reachable. The scale-path
      snapshot is turned on and verified (see the 2026-09-04 entry).
      `first_successful_run` (per model, via logOnce) fires so the activation
      funnel can be measured later. Still deferred, non-blocking: sybil hardening
      (account-age weighting or an installed-signal gate) if astroturfing
      appears, since "any signed-in user may review" leans on one-per-user +
      report/block + auto-hide + the count-gated average.
- [ ] **Large-model iCloud home, TestFlight validation + the CTO caveat.** The
      "download to iCloud" path (ModelStore places the GGUF in the app's iCloud
      Drive container, ensureLocal materializes it before a load) is unverifiable
      in a web session, so first TestFlight download-to-iCloud, evict, and
      draw-back-when-online is the proof. The CTO's HIGH caveat, held for the
      native pass and the founder's "iCloud, made honest" call: multi-GB
      re-downloadable GGUFs in an iCloud container brush against Apple's data
      storage guidelines (regenerable content), and the free 5 GB iCloud tier
      means most single models push the user toward paid iCloud. Mitigations in
      place: the device home stays backup-excluded, and the UI states plainly the
      iCloud copy uses the user's iCloud storage. Revisit whether the concrete
      backend should stay iCloud Drive vs. an on-device eviction cache if Review
      pushes back; the JS seam (`target: 'device'|'icloud'`) survives either way.
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
      2026-09-02 parity build (modes, plan mode, todos, instructions, slash
      and @ and #, queue, approvals stack, repo chip, chats grouping all
      DONE): MCP-stdio on the engine; checkpoints/rewind;
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
- [x] **Individual Personal tier + free/paid gating + iOS IAP: BUILT (2026-08-21),
      re-scoped 2026-08-31 (DECISIONS.md).** Personal ($20/yr) is an Apple
      auto-renewable subscription bought only in-app on iPhone/iPad; there is NO
      Stripe purchase for Personal, and web/desktop point to "buy on iPhone" then
      refresh the shared entitlement row. Stripe stays only for the commercial
      team plans. For the beta every Personal pay gate is OFF behind one
      reversible switch (`PAY_GATES_ENABLED=false` in `store.ts`); the Apple
      purchase and entitlement plumbing stays built underneath. Migrations
      0006-0008 and the five functions are deployed.
- [ ] **Personal on Apple, founder config still open (one at a time):** 1. Apple secrets: the Apple Root CA DER base64 (`APPLE_ROOT_CA_G3_DER_BASE64`
      or the constant in `_shared/apple.ts`, still the `PASTE_` sentinels as of
      2026-09-05), `APPLE_BUNDLE_ID`, `APPLE_APP_APPLE_ID`; every Apple
      verification throws until they are set. 2. Confirm the auto-renewable sub
      `ai.openshore.oscode.personal.yearly` and the In-App Purchase capability in
      App Store Connect, and that `cap sync ios` links `oscode-iap`. 3. Register
      the `apple-notifications` URL as the App Store Server Notifications V2
      endpoint. 4. `APPLE_ALLOW_SANDBOX=1` ONLY during Apple review, cleared
      after. 5. Sandbox-validate purchase, restore, and the notification loop on
      a device before the gates are flipped back on.
- [ ] **Public pricing page vs the Apple-only call.** The page on the
      marketing site (2026-08-21) was written when Personal had a Stripe buy
      button. Confirm its Personal call to action now points at the App Store,
      not Stripe checkout, and purge the Cloudflare cache after the change.
- [ ] **Live billing config was blank (fixed 2026-08-21).** On project
      lzlrlfdffwiypzreoldb, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` were
      set to EMPTY strings (digest = SHA256 of ""), so checkout 401'd from
      Stripe. Founder pasted real live values; a live $20 Micro purchase then
      succeeded end to end (checkout + webhook + entitlement write), confirming
      P0-1. Migrations 0004/0005 applied and stripe-checkout/-webhook/-portal
      redeployed on that project; refresh-token rotation already on. Refund the
      $20 test charge + cancel that sub.
- [x] **First desktop run on the founder's machine:** done 2026-09-02, the
      desktop coding path works against real Ollama models (see the archive).
      `scripts/desktop-preflight.mjs` now refuses to launch with a node-pty that
      is missing or built for the wrong ABI (2026-09-05).
- [x] **First Codemagic build to TestFlight:** done. The `ios-testflight`
      workflow ships every push to `main`; about 62 builds had reached
      TestFlight by 2026-09-03 (walkthrough in `docs/TESTFLIGHT.md`). Xcode is
      pinned in `codemagic.yaml` since 2026-09-05; bump it deliberately.
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
      `.github/workflows/catalog.yml` (daily + on curation/builder/schema change +
      manual, with an `allow_large_drop` input) builds, gates, and publishes
      `catalog.json` by committing it to
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

## Log

- **2026-09-05: full-codebase review remediation, one wave.** Every finding
  in `CODE-REVIEW-FINDINGS-2026-09-05.md` worked by subsystem (four P0s, the
  P1 and P2 batches, the INF guards and CI hardening), rulings recorded in
  `DECISIONS.md`, this file restructured to its own contract. Gates: see the
  Current state above.

- **2026-08-26: Desktop (Electron) interactive PTY terminal wired (the one
  documented Phase 2 follow-up).** The interactive terminal already ran
  phone-to-desktop over the daemon; this wires the same TerminalManager into
  the Electron desktop app, so a desktop-backed chat opens a real local PTY
  over IPC (not only remotely). EngineHost holds a TerminalManager and forwards
  output on a new channel; six osc:terminal\* IPC handlers + preload/bridge
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
