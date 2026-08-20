# PROGRESS

The recent-state source of truth for OS Code, kept in the same spirit as the
Uki app repo: current state first, then what remains, then the log.

## Current state (2026-08-20)

**All planned layers are built, tested, polished, and green.** `pnpm install
&& pnpm build` compiles clean; `pnpm typecheck`, `pnpm lint --max-warnings 0`,
and the test suites (os-code 19 files / 150 tests, app 13 files / 76 tests,
plus a passing `vite build`) all pass. Live commercial platform is wired:
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
      `.github/workflows/catalog.yml` (weekly + on curation/builder/schema change
      + manual) builds, gates, and publishes `catalog.json` by committing it to
      the marketing repo at `src/static/os-code/catalog.json`, which Cloudflare
      Pages serves at `openshore.ai/os-code/catalog.json` (the default
      `config.catalog.url`). Verified end to end: run #3 published commit
      `aca6186` to the marketing `main`. Auth is a classic PAT in the
      `MARKETING_DEPLOY_TOKEN` repo secret (an earlier fine-grained token 403'd
      on a wrong-repo selection; fixed).
      Follow-ups, both minor: (1) source-metadata enrichment (HF/Ollama
      downloads/likes) came back EMPTY on the first live run, so the popularity
      sort has no numbers yet; investigate whether the sample catalog's
      `source.ref`s resolve against the real HF/Ollama APIs. (2) the builder
      stamps a fresh `updated` timestamp each run, so every scheduled run commits
      even when models are unchanged; consider diffing on content only.
      Seed `os-code/curation/*.json` as the roster grows.
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
- [ ] **Real openshore.ai brand palette**: swap at the `OPENSHORE:` markers
      in `app/src/theme.css` and `app/scripts/gen-icon.py` when the real
      hexes land.
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
