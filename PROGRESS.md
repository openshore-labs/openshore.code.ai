# PROGRESS: OS Code build and handoff log

This file is the **dedicated source of truth for OS Code**. It records "what
happened most recently" for this repo (`openshore.code.ai`), and nothing else.
It is a sibling to, and deliberately **separate from**, the Uki app's
`PROGRESS.md` (in `uki-audio`). The two products keep their own logs so neither
session gets overloaded with the other's context. OS Code work is recorded
here; Uki work stays in the Uki repo.

Read this at the **start of every OS Code session**, before other work, so a
fresh session picks up where the last one left off.

Three sections:

- **Action items.** A prioritized, living to-do list. Reconcile it on every
  build or deploy: check off what got done, add any follow-up surfaced.
- **Current State.** A _living_ snapshot, kept current (overwrite it, do not
  append): what is built now, the current focus, and open threads.
- **Build Log.** Append-only history, **newest entry on top**. Every material
  push gets one entry using the template at the bottom. Concise but complete:
  decisions and rationale, not a raw diff.

> **Scope note.** This root file is canonical for the OS Code **product** as a
> whole (engine, app, iOS, desktop). The engine-scoped `os-code/PROGRESS.md`
> now points here so the two never drift.

---

## Action items: prioritized running list

> **Priority.** P0 blocks launch or revenue · P1 quick win, do next · P2
> important but larger · P3 parked on a dependency.
> **Effort.** S ≈ a short pass · M ≈ one full flow · L ≈ multi-path or
> live-fire.

### Product / build

- [ ] **P0 · L · First Codemagic build to TestFlight.** The Swift side
      (`app/ios`, `oscode-llama` plugin, Harbor ODR delivery) compiles for the
      first time on Codemagic; expect one round of fixes. Walkthrough in
      `docs/TESTFLIGHT.md`.
- [ ] **P0 · M · First desktop run on the founder's machine** (`pnpm install`
      then `pnpm desktop`) against real Ollama models. First live-fire on real
      weights, to confirm streaming feel and the capability probe across
      backends (Ollama, LM Studio, llama.cpp, vLLM).
- [ ] **P1 · M · Live-fire pass on a machine with Ollama plus a GPU.**
      Everything is wired and covered against mocks and mocked HTTP; the first
      real-weights session confirms streaming and the four-backend probe.
- [ ] **P2 · M · App polish, Tier 2** (proposed, not picked): drag-to-dismiss
      with rubber-banding on sheets, a "new tokens" scroll pill, dark and
      tinted iOS 18 icon variants, model-chip shared-element morph.
- [ ] **P3 · M · ComfyUI image path** needs a bundled txt2img workflow graph
      (A1111 and OpenAI-images endpoints work today).
- [ ] **P3 · L · Tree-sitter code map** behind the existing `extractSymbols`
      seam, when install-weight is worth it.
- [ ] **P3 · S · Real openshore.ai brand palette:** swap at the `OPENSHORE:`
      markers in `app/src/theme.css` and `app/scripts/gen-icon.py` when the real
      hexes land.

### Business / pricing (open thread, 2026-08-19)

- [x] **P1 · Price DECIDED (founder, 2026-08-19): free download, $25/year,
      conduit-only, purchased on web/desktop via Stripe (no App Store IAP).**
      Start simple with a single flat annual price while OS Code stays a pure
      conduit (no hosted models, ~$0 marginal cost, CTO-confirmed). Tiers and
      the future "OpenShore models" recurring add-on are deferred, not adopted.
      Prior CFO/CTO/CMO analysis (2026-08-19) is captured for the record: the
      category is mostly free/OSS; paid local comps are Private LLM ($9.99
      one-time) and Msty ($149/yr or $349 lifetime); Cursor (~$240/yr) is the
      anchor, not a direct comp. CFO flagged, and founder accepted, that $25/yr
      is a deliberate low-friction entry price, not a revenue-maximizing one.
- [ ] **P1 · Reconcile the revenue goal with the $25 price.** Founder's target
      is $100k in year one. At $25/yr that implies **~4,000 paying users**
      (not the ~1,000 discussed at higher prices). The binding constraint is
      top-of-funnel/distribution, not price. Open: confirm the year-one number
      the founder wants to run at, then size the download/conversion funnel to
      match (at ~3% conversion, 4,000 payers needs ~130k qualified downloads).
- [ ] **P1 · Validate positioning / market need (CMO straight-answer pass, in
      progress).** Is OS Code genuinely differentiated, or does an existing
      tool already fill this need? Fold the CMO's blunt read here, then seed the
      OS Code business doc in `openshore-hq/finance`.
- [ ] **P2 · The license-verify endpoint becomes production infra the moment
      activation is paywalled.** Today it is a documented stub (client is real;
      server contract in `os-code/src/license/verify.ts`). Any paid tier needs
      that endpoint stood up with an uptime obligation and an offline-grace
      window. Scope and host before charging.

---

## Current State (2026-08-19)

**OS Code is a native app for iOS and the Linux desktop.** It gives a familiar
modern-coding-agent experience running on the user's OWN local LLMs (downloaded
from Hugging Face or Ollama) and their OWN cloud keys (opt-in). OpenShore hosts
no weights, proxies no inference, and collects no telemetry: the app is
deliberately a **serverless conduit**. The only server-side pieces are a
still-stubbed hosted **license-verify** endpoint and a **subscription OAuth**
exchange.

**Engine and app are built, tested, and green.** The repo is a pnpm workspace:
`os-code/` is the shared ENGINE (agent loop, tools, edit engine, router,
daemon, security, plus a parked terminal UI), and `app/` is the one React
codebase both shells ship. `app/electron/` is the Linux desktop (engine
in-process) and `app/ios/` is the Capacitor project (iOS 16+), with the
`oscode-llama` Swift plugin for on-device GGUF inference (llama.cpp on Metal).
Workspace gate green: `pnpm -r build && typecheck && lint && test` all pass.

Layer status:

- **Core (agent loop, tools, web, edit engine, local provider, TUI):** built
  and tested. Streaming TUI with static-scrollback transcript, status line,
  approval prompts with syntax-tinted diffs, citations, slash commands, and a
  `--plain` fallback.
- **Security:** enforced, not deferred. Jail, redaction, egress policy, daemon
  bearer auth with a hard no-`0.0.0.0` bind rule, default-deny shell, stricter
  phone and headless profiles, Keychain-backed secret storage on iOS.
- **Breadth:** router/stack with graceful degradation, cloud escalation with
  confirm-before-spend, RAG plus code map, marketplace catalog with
  hardware-fit ratings and preset stacks, daemon plus reattach plus Tailscale
  pairing, vision ingest.
- **Harbor (built-in guide model):** a small on-device concierge
  (Qwen2.5-0.5B-Instruct, Apache-2.0) a new user downloads on first launch
  (~380 MB, from Hugging Face, not bundled) to walk through setup before
  connecting anything. Native delivery via iOS On-Demand Resources, Keychain, a
  RAM floor, license plus disclaimer. See `docs/HARBOR.md`.
- **Phone-side stack manager (Stack / Bench / placements), stage 1:** the
  on-phone UI for assembling and managing a local model stack. In progress.
- **Polish:** streaming smoother, model-load ticker, syntax-tinted diffs,
  cursor blink, approval pressed-state, real byte-level download progress
  (Ollama `/api/pull` plus marketplace verify/retry), low-color terminal
  fallback, `/find` transcript search. App Tier-1 polish (navy launch
  continuity, sheet spring physics, haptics, token-stream smoothing) done.

**Not yet real-world proven:** the first TestFlight build and the first run
against real local weights are the two big open items (see Action items).

**Open business thread:** pricing is being worked (free download, $20/yr
proposed). See the pricing action item above. No pricing is implemented in the
app yet; the entitlement gates and activation client exist, the hosted verify
server does not.

---

## Build Log

### [2026-08-19] Dedicated OS Code PROGRESS.md plus pricing analysis kicked off

**What shipped:** This root `PROGRESS.md`, the dedicated product-wide source of
truth for OS Code, split out so it never shares context with Uki's log.
Elevated the current-state and follow-ups from the engine-scoped
`os-code/PROGRESS.md` (which now points here) to cover the whole workspace
(engine, app, iOS, desktop), and brought current state up to 2026-08-19 to
include the work landed since the 08-18 snapshot: Harbor (the built-in
on-device guide model) with native ODR/Keychain delivery, marketplace honest
download progress plus verify/retry, iOS signing-cert persistence across
Codemagic builds, and stage 1 of the phone-side Stack/Bench stack manager.
Also opened the **pricing** thread as an action item, pending the CFO plus CTO
analysis and the founder's sign-off.
**Why / decisions made:** Founder asked OS Code to have its own dedicated
progress doc so the Uki one stays dedicated and neither gets overloaded. Root
is the right home now that the repo is a workspace (engine plus app), rather
than the engine subpackage. Consolidated to ONE canonical file (root) with the
sub-package file reduced to a pointer, to avoid two docs drifting, which is the
overlap the founder wanted gone. Doc-only change; nothing in the build touched.
**Migrations / config / env changes:** None.
**Known issues / deferred:** Pricing is undecided (see Action items). The two
big product unknowns remain the first TestFlight build and the first
real-weights run.
**Rollback notes:** Doc-only; `git revert` this commit to restore the prior
state (the engine `os-code/PROGRESS.md` pointer reverts with it).
**Next session should:** Fold the CFO plus CTO pricing recommendation and the
founder's decision into the pricing action item or a `finance` doc; then keep
driving toward the first TestFlight build.

### [2026-08-19] Harbor native delivery plus marketplace plus phone stack manager

**What shipped:** (pre-existing work, recorded here for continuity) Harbor, the
built-in on-device guide model, with native iOS delivery (On-Demand Resources,
Keychain, RAM floor, license plus disclaimer) and first-launch download instead
of bundling; marketplace honest download progress with a verify phase, retry,
and a "Start here" preset; an opt-in on-device activity log for the test run;
iOS distribution signing cert persisted across Codemagic builds; and stage 1 of
the phone-side Stack/Bench/placements stack manager.
**Why / decisions made:** Keeps "weights come straight from the source, never
from OpenShore" true even for the guide model. CTO fixes landed alongside
(Keychain-backed secrets, real key delete, model reconcile).
**Migrations / config / env changes:** `CERTIFICATE_PRIVATE_KEY` group wired in
Codemagic (see `docs/TESTFLIGHT.md`).
**Known issues / deferred:** Swift side still compiles for the first time on
Codemagic (TestFlight follow-up).
**Rollback notes:** Per-feature commits on this branch; revert individually.
**Next session should:** First Codemagic build to TestFlight.

### [2026-08-18] Native app pivot plus delight polish plus initial complete build

**What shipped:** OS Code became a native app for iOS and the Linux desktop
cloning the modern-coding-agent experience on a local stack (the CLI is
parked). Repo became a pnpm workspace: `os-code/` is the shared ENGINE
(browser-safe protocol subpath, daemon CORS plus phone endpoints, quarterback
taxonomy, pocket-class on-device models), `app/` holds the React app, Electron
shell (engine embedded), Capacitor iOS project, and the `oscode-llama` Swift
plugin (llama.cpp via LLM.swift). CI to TestFlight via `codemagic.yaml`. A
delight polish pass (streaming smoother, model-load ticker, syntax-tinted
diffs, cursor blink, approval pressed-state, real download progress bar,
low-color terminal fallback, `/find` search). The repo was scaffolded from
empty to a working product; git history slimmed (node_modules stripped from
every commit via `git filter-repo`, founder-approved).
**Why / decisions made:** See `os-code/DECISIONS.md` for every judgment call.
**Migrations / config / env changes:** None (workspace restructure).
**Known issues / deferred:** First TestFlight build and first real-weights run.
**Rollback notes:** History was rewritten on this branch; existing clones must
re-clone or hard-reset.
**Next session should:** First desktop run against real Ollama models.

---

## [EXAMPLE, copy this template for each material push; do not delete] Short title (commit: abc1234)

**What shipped:** Concrete, bullet-level features / fixes / changes.
**Why / decisions made:** The reasoning behind anything non-obvious, and
alternatives ruled out.
**Migrations / config / env changes:** New env vars, CI groups, signing, infra,
license-server changes, anything a new session must know. Write **None.** when
there are none.
**Known issues / deferred:** What is intentionally incomplete or flagged.
**Rollback notes:** How to revert if needed.
**Next session should:** The handoff, the next concrete action.
