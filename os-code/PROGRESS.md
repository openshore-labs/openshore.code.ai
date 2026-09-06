# PROGRESS

The recent-state source of truth for OS Code, kept in the same spirit as the
Uki app repo: current state first, then what remains, then the log.

Older Current state sections and log entries are in `docs/progress-archive.md`
(newest first); the parked build prompts are in `docs/parked-ideas.md`. Keep
this file to one Current state, one What remains, and the last five log
entries (`test/progressShape.test.ts` enforces the shape).

## Current state (2026-09-06 the plan-first workflow and video attachments; 2026-09-05 phone storefront, Crew routines, ethics layer, review remediation)

Newest first: the plan-first workflow and video attachments (2026-09-06,
below), then four pieces from 2026-09-05 built in parallel sessions and merged
here: the phone storefront, Crew routines, the always-on ethical guardrail
layer, and the full-codebase review remediation (its state section moved to
`docs/progress-archive.md`; its open items stay in What remains).

### The plan-first workflow (My Stack as the anchor, the reasoning LLM draws a play)

The founder's explicit workflow: a prompt flows through the harness (always-on
ethics plus curatable filters), starts in My Stack, and the reasoning LLM frames
it (asking clarifying questions only when genuinely ambiguous), composes a play
(an ordered set of handoffs to specialist models with dependencies), briefs the
user (a short checklist of steps and their owner models, live), runs it in
dependency order handing each step to its owner, re-plans at bounded
checkpoints, and streams a final synthesis. Any category with no placed
specialist is run by the reasoning LLM; a step can also target a specific model
by id for a particular subject or decision (the level-deeper routing). The flow
degrades to a single routed turn when the anchor is a weak or unreachable model,
the plan will not parse, or the play is one step, so a modest stack still just
answers. It is app-native (works on the phone alone); a repo/tool step is marked
to run on the paired computer's engine when docked (engine execution from this
flow is a seam, a follow-up). Pure core in `app/src/lib/play.ts` (scheduling,
re-plan merge, owner resolution, the brief, planner/re-plan prompts and robust
JSON parse), fully tested in `app/test/play.test.ts` (30 cases); the runner is
`app/src/drivers/stackDriver.ts`; the brief renders as todos-with-owners
(`TodoItem`/`TodoRow` gained `owner`, shown in `TodoCard`). Doc and a diagram in
`docs/workflow.md`. The three follow-ups then landed (CTO-guided, 2026-09-06):
the clarifying questions are a tappable picker (`ClarifyCard`, a `clarify`
driver event); a repo/tool step runs on the paired computer's engine when docked
over one shared `RemoteDriver` session with real approvals surfaced (describe
only when not docked or no local workspace is bound); and crew routines, which
keep the engine's own ReAct loop, now write a Plan section into their vault note
from the agent's `todoWrite`. Live plan quality, the engine hand-off, and the
routine Plan note need a real reasoning model, a paired computer, and a device
(unverifiable in a web session).

### Video attachments (reviewed frame by frame, never the video)

### Video attachments (reviewed frame by frame, never the video)

A model never receives a video. On attach, a clip is compressed toward the 25
to 29MB band when it is over 30MB, then sampled into up to 12 downscaled JPEG
frames tagged with order and timestamp; the frames ride to a vision model as
image blocks and the composer shows one chip per video. Native work runs on
AVFoundation on the phone (new `oscode-media` plugin) and FFmpeg on the desktop
(`osc:mediaProcess`), with a canvas fallback so a clip always yields frames.
Screenshots and screen recordings flow through with no approval. The cloud
Claude driver leads the frames with a context header, labels each with its
timestamp, and adds a system note so the model reads them as one clip and may
say plainly it reviewed the video frame by frame. Vision is a placeable Stack
category ("Image reading") with two slots: a local model (on-device or your own
server) and a cloud model, each with its own effort, the cloud slot defaulting
to the most capable cloud model until assigned (`visionSlots`,
`defaultVisionCloudRef`, edited in `StackManager`). An image turn routes to the
local slot when it can actually read images, else the cloud slot, else a
connected cloud provider (`pickVisionRef`/`stackVisionReady`, wired in
`StackDriver`); an on-device model is text-only on this build, so a device model
placed for vision falls back to the cloud. My Stack is the source: a workflow
run through the stack inherits the Vision position. The composer chip shows a
determinate progress ring keyed to frames extracted. Code in
`app/src/lib/{attachments,videoAttach,videoBackends,
mediaPlugin,stack}.ts`, `Composer.tsx`, `cloudClaudeDriver.ts`,
`drivers/stackDriver.ts`, `app/electron/media.ts`, and `app/plugins/oscode-media`;
doc `docs/video-attachments.md`. Device and desktop-FFmpeg verification are in
What remains.

### The phone storefront (Marketplace, on iPhone)

On an iPhone the Marketplace now leads with three one-tap packs keyed to the
connection status (Offline, Offshore, Docked), a browse-by-family rail with a
family page split by where each size installs, the pocket shelf retitled "Runs
on this iPhone" with the line that a new 4B beats the old 7B class at half the
memory, and a "Desktop and home servers" divider below which no control ever
says "Get" on a phone. The seed carries the phone-class pick `qwen3-4b-phone`;
it reaches the live feed only once `osc eval` scores it (see What remains).
Code: `app/src/lib/packs.ts`, `app/src/components/modelFamilies.ts`, `runsOn`
and `installLabel` in `app/src/components/marketplace.ts`; the doc is
`docs/MARKETPLACE.md`, "The phone storefront".

### Crew routines (the botOS brief, shipped inside My Crew)

**Crew routines are BUILT.** The founder's brief was "clone grokbot, call it
botOS, local-first." Research corrected the premise: Grok Bot (xAI, beta
2026-08-11) is always-on agent teammates with their own cloud computers, a bot
roster with presence, routines that start without a prompt, results waiting
when you return. The local-first version ships as **routines inside My Crew**
(CMO ruling, founder agreed: botOS stays the codename, the way gitOS ships as
Repositories): a crew member, a task, a workspace, and a clock; the daemon
opens a normal journaled session on the headless profile when the clock
strikes and the computer is on; the result lands as a dated markdown note in
the vault with the transcript one tap away. The copy says "while your computer
is on", never "always on", and "works, then asks", never "unsupervised".

- **Engine.** `src/routines/model.ts` (pure model, schedule math, validation,
  the preset; exported through `os-code/protocol`), `src/routines/store.ts`
  (sealed `~/.os-code/routines.json`, atomic writes), `src/routines/scheduler.ts`
  (a process singleton the daemon and the desktop shell share, so a routine
  fires exactly once whichever surface is up). Contract as the CTO ruled it:
  one run on the box at a time and one per routine; a slot the machine slept
  through is recorded as skipped once and never replayed; an approval nobody
  answers pauses the run (the existing approval push fires) and times out to a
  denial with a reason after 15 minutes, never to an approval; a wall-clock cap
  per routine (5 to 60 min) on top of the guardrails; read-only routines run in
  plan mode, edit routines in acceptEdits; a routine runs only in an
  admin-provisioned workspace or an outbox root (`core/security/workspaces.ts`,
  shared with the daemon's own gates). New read-risk `gitLog` tool so a
  read-only routine can review history without a shell.
- **Headless hardening (CTO must-fix).** A configured permissions DEFAULT of
  allow (not just a rule) can no longer make shell, push, or cloud spend silent
  on the remote or headless profile; headless also blocks push auto-allow
  (`allowPushAutoApprove` on the profile). Pinned by
  `test/headlessPermissions.test.ts`.
- **Daemon and desktop.** `/routines` routes (GET open to members scoped to
  what they own, every change admin-only, workspace-gated for all); the same
  surface over Electron IPC (`engineHost.routines*`, seven guarded handlers,
  preload and bridge types). A run's live driver is adopted by whichever
  surface attaches, never rehydrated twice.
- **App.** `app/src/lib/routines.ts` (one client over the bridge or the paired
  daemon, presence and copy helpers, the preset builder), a `routines` store
  slice with the actions, and the **Crew command** room (`CrewCommandScreen`,
  view `crewcommand`, a sub-page of My Crew): the live headline and four
  counts, a Waiting-for-you list, the roster with each member's presence dot
  (teal pulse working, amber waiting, green done), the routines with Run now,
  Stop, Edit, and a pause switch, and the results inbox opening a result sheet
  (the vault note rendered, Open transcript). The one preset, Morning review
  (weekdays 06:00, read-only, so its first unattended run can never need an
  approval), adds a Reviewer to the crew on setup; custom routines unlock after
  the first run finishes (CX). Each Crew card shows its busiest routine's
  presence line, and the room opens through a door card at the top of My Crew.
  Copy for a phone with no paired desktop says so and offers pairing.
- Gates at close: os-code typecheck, lint, 518 tests (57 files), tsc build,
  Prettier; app typecheck (src and electron), lint, 699 tests (93 files), vite
  build, Prettier; the repo-wide em-dash guard and the PROGRESS shape guard.
  Pushed to `main` per the founder.
- **Cross-device control model (founder, 2026-09-05: "it should all operate
  seamlessly cross-device").** One clear distinction, on the same "docked"
  reach the big models use: you SET UP and CONTROL routines only while
  harnessed to the machine (docked over Tailscale, or on the machine itself);
  you can always VIEW. Away from home the command center shows the last-known
  dashboards from a cached snapshot (persisted at `oscode.routines.v1`), the
  roster and dormant capabilities, and a Reconnect prompt; every control button
  is hidden and the store refuses a mutation with "Reconnect to your main
  machine over Tailscale to control your crew." Three header states, In control
  / View only / Not set up, named by a badge. A `set-up-crew` guide walks the
  mobile setup. Pure `crewControl()` in `app/src/lib/routines.ts` decides, and
  both the screen (live, off connectivity) and the store guards call it. App
  only: the daemon is already unreachable when not docked, so no server change.
- **Polish pass (founder: "do all the polish").** A waiting-for-you row
  breathes a soft amber halo on the working dot's clock; the results inbox
  arrives row by row on `--stagger`; a sheet's heading rises in, keyed to the
  routine it came from; routine cards swipe to delete through `SwipeRow` (the
  Delete button is gone, the card's own buttons stay); the Next run tile is
  tabular. Every animation dies under reduced motion. The pause switch keeps
  the app-wide button tick (a component-level haptic is banned by the polish
  guard, per the 2026-09-05 ruling).
- **Not verifiable here:** a real scheduled fire under Ollama on the founder's
  box, the approval push arriving with the app closed, suspend and wake, and
  the room on an iPhone (TestFlight). See What remains.

### The always-on ethical guardrail layer

Founder brief: a safety-critical filter that wraps every model interaction,
always on, not disableable in the app, blocking a narrow set of serious harms
while staying out of the way of legitimate edgy work.

- **One chokepoint, two install points.** `os-code/src/core/ethics/` holds the
  layer (read `index.ts` first, it names the reading order). It is installed by
  construction: `ProviderRegistry` wraps every provider in `GuardedProvider`
  before anything can hold one, so the agent loop, `Router.delegate`,
  `summarize`, the daemon `/chat`, and the eval harness are all covered; in the
  app, `buildDriver` wraps every `ChatDriver` in `guardDriver`, covering cloud
  Claude, every OpenAI-compatible provider, BYOM, the on-device models, the
  paired desktop, and the demo. `register()` wraps too.
- **Both sides.** Input screened before a model sees it, output before a person
  does. `StreamScreener` releases text only after a screen that covered it came
  back clean, so a blocked answer is never partially shown.
- **Fail closed.** Any throw or timeout blocks. A check failure is recorded as
  `check-failed` and never counts toward enforcement.
- **The tiers.** Tier 1 (CSAM, non-consensual intimate imagery, concrete CBRN
  and high-yield explosive uplift) is a hard block with no consent override.
  Tier 2 (synthesizing a real person's face or voice) is gated behind an
  authorization assertion, recorded, with provenance on the output. Tier 3 is
  protected: legal adult content, dark fiction, horror, satire, security
  research, dissenting opinion.
- **No toggle exists.** The layer reads no configuration at all, and
  `test/ethicsNoBypass.test.ts` greps the tracked source to keep it that way.
- **Provenance.** Generated images carry a C2PA-vocabulary record as a PNG
  `iTXt` chunk. It is unsigned and says so in its own text; a signer seam exists
  for the day there is a certificate.
- **Enforcement.** Migration `0016_guardrail_enforcement.sql` adds
  `guardrail_events`, `likeness_consents`, `enforcement_actions`,
  `abuse_reports`, and an `abuse_reviewers` allowlist. There is no IP address
  anywhere in the product: no column, no header-reading function, and no
  address-ban queue, because banning a network location is not a capability
  this product has (founder call, 2026-09-05, superseding the earlier
  block-only compromise). Enforcement is account termination plus a lawful
  report, full stop.
- Gates green: os-code and app typecheck, lint, test, build.

**Reviewed by the CTO and CMO on 2026-09-05, then their findings worked to
close.** Both ruled the layer safe to land and flagged the same top item first:
the Terms asserted a data practice the product does not have (corrected before
publish). The founder then asked to finish the thread per both advisors. Done in
this pass: Tier 2 likeness precision (coding vocabulary no longer reads as a
person, generation verbs and photoreal deepfake shapes now caught) and the gate
made non-countable so a false gate never penalizes; the enforcement ladder
moved server-side so it survives a reinstall and cannot be talked down by the
client; provenance no longer dropped silently (keyword match, not a substring
grep; a non-PNG Tier 2 output is refused rather than shipped unlabeled); and the
honesty copy pass across Settings, README, and the ToU, plus the media-vs-text
satire seam stated publicly. The founder then took the CMO's original
recommendation on the IP question rather than the block-only compromise: IP
capture is now removed from the product entirely (see the 2026-09-05 IP-removal
log entry). Migration is now `0016`.

## What remains (known follow-ups, none blocking)

- [ ] **GitHub repo connect: align the GitHub App's Callback URL (founder,
      TestFlight "redirect_uri is not associated with this application").**
      One-tap Connect GitHub reached the consent page and GitHub refused the
      redirect address. GitHub found the App (the client id is valid) but the
      `redirect_uri` the app sends,
      `https://lzlrlfdffwiypzreoldb.supabase.co/functions/v1/repo-oauth/callback`,
      did not match a registered Callback URL. This is config, not app logic
      (the code paths are hardened and tested). Fix on GitHub, in order: (1) the
      GitHub App named by `VITE_GITHUB_CLIENT_ID` has that exact Callback URL
      (a GitHub App created without one rejects every redirect); (2) that build
      var is the OpenShore Code App's client id, not a stray personal OAuth app;
      (3) `VITE_SUPABASE_URL` names that same project over https with no trailing
      slash. Full checklist in `supabase/README.md` (Phase 4). The Repositories
      screen now shows the exact Callback URL to register when a connect fails.
      Verify on TestFlight once the App's Callback URL is set.
- [ ] **Video attachments on device and desktop (built 2026-09-06, unverified
      off the sandbox).** TestFlight: attach a screen recording over 30MB,
      confirm one chip with a frame count appears, send to Claude, and confirm
      the reply reasons across the frames in order and can say it reviewed the
      clip frame by frame. Desktop with FFmpeg installed: the same with a picked
      video file (confirm compression lands under 29MB and frames extract);
      without FFmpeg, confirm the canvas fallback still produces frames. Also
      confirm `cap sync ios` picks up the new `oscode-media` plugin and the
      photo-library permission prompt reads correctly. Follow-ups noted in
      `docs/video-attachments.md`: a native PHPicker to skip staging the video
      bytes through the WebView, and vision beyond cloud Claude.
- [ ] **Run `osc eval` on `qwen3-4b-phone` and commit its average to
      `curation/eval.json` (founder, needs a machine with the model).** Until
      then the curated gate drops the 4B from the live feed (an orchestrator
      needs a real eval, and no star is invented), so the packs and the Pocket
      bundle fall back to `qwen2.5-1.5b-phone` on a live catalog. The bundled
      seed and the family page show the 4B either way. Same step for
      `qwen2.5-coder-1.5b-phone` is NOT needed: it is a specialist and clears
      on its published benchmarks.
- [ ] **On-device verification of the phone storefront (needs a phone).**
      TestFlight: tap Set up Offline on the Marketplace (both downloads land,
      the Offline stack's Reasoning is the 4B, the coder sits under Coding),
      flip the header pill to Offline and chat; then Set up Offshore, connect
      a key, confirm the card reads Ready; open Qwen from the family rail,
      open a size, confirm the back chevron says Qwen.
- [ ] **Enable the iOS memory entitlements on the App ID (founder, before the
      next distribution build).** `App.entitlements` now declares Increased
      Memory Limit and Extended Virtual Addressing; the `ai.openshore.oscode`
      App ID must carry both capabilities (developer.apple.com, Identifiers)
      and Xcode must regenerate the provisioning profile, or signing fails,
      exactly like Push and iCloud. Self-served, no Apple review.
- [x] **Smooth a larger model on the iPhone (CTO + CMO consensus, built
      2026-09-05).** The direction: a great 4B is the phone ceiling, bigger
      runs on your computer, and the store is honest about the memory limit
      (not storage). Shipped: `runsWellOnDevice` in `modelStorage.ts` and the
      product page "Where it runs" phone verdict (amber "better on your
      computer" when a model is larger than this phone's memory keeps free,
      guidance not a gate); the Increased Memory Limit + Extended Virtual
      Addressing entitlements; a memory-warning unload in `OscodeLlamaPlugin`
      that emits `deviceModelUnloaded` so `deviceModel.ts` forgets the slot and
      the next send reloads. NOT built on purpose: a force-run toggle, a 7B
      beta pack, and llama.cpp memory tuning (the pinned LLM.swift 3.0.3 exposes
      no such knobs). Device verification below.
- [ ] **On-device verification of the iPhone memory path (needs a phone).**
      TestFlight on a high-memory iPhone: a 4B loads and sustains a full reply
      without a jetsam kill; the memory-warning unload recovers (reply ends,
      next send reloads cleanly); the control group is unregressed (bundled
      Harbor Light still loads and streams, and the memory-warning observer
      does not fire spuriously on memory-tight phones).
- [ ] **Crew routines on the founder's machine and TestFlight (built
      2026-09-05, unverified off the sandbox).** Set up Morning review on the
      Pop!_OS desktop against a cloned repo, let it fire at 06:00 (or Run now),
      confirm the note lands in `~/OSCode/Vault/Crew/Morning review/`, open the
      transcript from the command center, and on the phone confirm the
      approval push arrives with the app closed for an edit routine. Also
      confirm a slot slept through shows as Missed, not as a late run.
- [ ] **A push for a missed slot.** The push-send function takes the approval
      and done kinds only; a missed slot shows in the results inbox today and
      does not push. Adding a stale kind is the follow-up.
- [ ] **Personal at $50/yr with the gates reinstated (founder, 2026-09-05).**
      Routines sit inside Personal (CFO); gating is off while the founder
      builds. When it returns, the command center and Run now go behind
      `personalUnlockedNow()` like the coding agent.
- [ ] **Measure the preset (CFO and CX conditions).** Free-to-Personal
      conversion within 60 days with routines credited; share of payers with a
      routine that ran unattended three times in month one; tap-through on the
      preset card. Insights events exist (`routine_created`, `routine_run_now`,
      `crew_command_open`, `routine_transcript_open`).
- [x] **Ethics layer, Tier 2 likeness precision (CTO M1/M2).** Fixed: coding
      vocabulary in `NON_PERSON_NAME_WORDS`, generation verbs and photoreal
      deepfake shapes caught, likeness made non-countable. Known residual limit:
      a lowercase name with no photoreal cue and no other signal is not caught
      (a public-figure gazetteer is out of scope; the intent path and the
      person's own consent flow are the backstop).
- [x] **Ethics layer, IP capture removed from the product entirely (founder
      call, 2026-09-05, supersedes the earlier block-only compromise).** No
      address column, no header-reading function, no ban queue, anywhere.
- [x] **`0017_reconcile_stale_0016.sql` applied to production (2026-09-05).**
      Verified live: all four stale IP objects gone (schema query returned
      false/false/false/false), `record_enforcement()` is the only signature
      left, founder seeded into `abuse_reviewers`. Founder's own smoke test
      of a live guardrail block (confirming `enforcement_actions` actually
      gets a row) is still pending, deferred to when they get to it.
- [x] **Ethics layer, provenance drop paths (CTO M5).** Keyword match not
      substring grep; bounded reader; a non-PNG Tier 2 output is refused.
- [x] **Ethics layer, the ladder is server-side now.** `record_enforcement()`
      computes from `guardrail_events`, so a reinstall does not reset it and the
      client cannot under-report. The device cache is a local view only.
- [x] **Ethics layer, privacy label (CTO M6).** Moot: IP capture is removed
      entirely (2026-09-05), so there is no address to disclose. Still open,
      process not code: `PrivacyInfo.xcprivacy` does not exist yet and the App
      Store Connect privacy answers should be reviewed before the next
      submission for accuracy generally.
- [ ] **Ethics layer, one positioning call the founder deferred.** Whether the
      C2PA name leaves the trust statement's top line (the CMO recommends it;
      the CTO is neutral). A taste call, not correctness.
- [ ] **Ethics layer, re-enable "repeated Tier 2 -> warning" once precision is
      field-proven.** Suspended while likeness is non-countable.
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

- **2026-09-06: GitHub repo connect, the redirect address GitHub could not match
  (founder report from TestFlight).** Connecting a repo, one-tap Connect GitHub
  reached the GitHub consent page and stopped on "The redirect_uri is not
  associated with this application." Traced it: the app's OAuth connect
  (`app/src/lib/gitos/repoOAuth.ts`) sends
  `redirect_uri = <VITE_SUPABASE_URL>/functions/v1/repo-oauth/callback`, and a
  GitHub App requires that to match one of its registered Callback URLs exactly.
  GitHub found the App (the client id resolved), so the mismatch is the address,
  which makes this a configuration gap (the App's Callback URL, the client id
  the build carries, or the Supabase project the build names), not app logic.
  The CLI device flow (`os-code/src/auth/github.ts`) uses no redirect and is not
  involved. Hardened and made it self-diagnosable rather than guessing at values
  only the founder can see: the app and the `repo-oauth` function now trim a
  trailing slash off the Supabase base, so it can never compose a doubled-slash
  address that fails the exact match; `repoOAuth` exports the exact Callback URL
  and the Repositories screen shows it, copyable, when a one-tap connect fails,
  so the exact string to register is in hand. Documented the GitHub App setup and
  a three-step troubleshooting checklist in `supabase/README.md` (Phase 4), and
  left the config verification in What remains. Gates: app typecheck (src and
  electron), lint, `repoOAuth.test.ts` (17, up from 14), the em-dash and
  polish-standards guards.

- **2026-09-06: the plan-first workflow, My Stack draws a play (founder, pushed
  to main).** The founder specified the workflow explicitly: prompt through the
  harness, framing by the reasoning LLM (clarify only when ambiguous), a play of
  dependency-ordered handoffs to specialist models, a brief of steps and owners
  shown live, hybrid execution that can re-plan mid-run, then a streamed
  synthesis. Decisions (via a picker): app-native with engine handoff for
  repo/tool steps when docked; hybrid re-plan; ask only when ambiguous then
  auto-run; build the whole flow now; My Stack is the single source workflows
  inherit. Built additively over the existing backends so the single-turn path
  is preserved as the degenerate case. New pure core `app/src/lib/play.ts`
  (framing/play shapes, dependency scheduling, re-plan merge, owner resolution,
  the brief, planner and re-plan prompts with robust JSON parse), 30 unit tests;
  the runner is `stackDriver.ts` (frames, briefs as todos-with-owners, runs
  steps by dependency, re-plans at bounded checkpoints, synthesizes, degrades to
  single-turn); `TodoItem`/`TodoRow` gained `owner`, rendered in `TodoCard`;
  a step can target a specific model by id (level-deeper routing), and the
  planner is shown the targetable models. Doc and diagram in `docs/workflow.md`.
  The three follow-ups then landed the same day (CTO-ruled, founder delegated
  the forks): a tappable clarify picker (`ClarifyCard` off a new `clarify`
  driver event; the reply folds back into the framing); a repo/tool step runs on
  the paired computer's engine when docked, over one shared `RemoteDriver`
  session bound to the chat's local workspace, with real tool approvals surfaced
  in the chat and never auto-answered, `StackDriver.answerApproval` now a real
  pass-through, abort wired, degrading to describe-only when not docked or no
  workspace is bound; and crew routines keep the engine's ReAct loop (no planner
  port, so a headless run never blocks on a question) and write a Plan section
  into their vault note from the agent's `todoWrite`. Gates: app typecheck, lint,
  810 tests, Vite build, Prettier; os-code 604 tests, em-dash and PROGRESS shape
  guards. The engine hand-off and the routine Plan note need a paired computer
  and a real routine fire to verify.

- **2026-09-06: vision as a Stack category with two slots and effort, plus the
  video framing progress ring (founder, pushed to main).** Follow-ups to video
  attachments, landed across two pushes the same day. (1) Vision is a placeable
  Stack category you can put a local LLM in. It has two slots in My Stack, a
  local model (on-device or your own server) and a cloud model, each with its
  own effort; the cloud slot defaults to the most capable cloud model
  (`defaultVisionCloudRef`, Claude Opus) until assigned, so images are always
  understood out of the box (founder: "default that position to most capable
  cloud model until manually adjusted"). An image turn routes to the local slot
  when it can actually read images, else the cloud slot, else a connected cloud
  provider (`visionSlots`/`pickVisionRef`/`stackVisionReady`, wired in
  `StackDriver`). On-device models are text-only on this build, so a device
  model placed for vision falls back to the cloud (`visionCapable` false for a
  device ref, one line to flip when a multimodal runtime lands); a BYOM vision
  model does read images and is preferred over the cloud slot. `StackDriver` now
  accepts attachments (it dropped them before) and folds frames into the
  Anthropic and OpenAI-compatible backends; the device backend never gets
  images. Per-placement `effort` is honored in `systemFor` over the global
  composer effort, and is settable on any specialist, not just Vision. My Stack
  is the source (founder call): a workflow run through the stack inherits the
  Vision position, so there is one place to set it. (2) The video chip's pulse
  became a determinate ring keyed to frames extracted (`onProgress` threaded
  through the backends). Code: `stack.ts`, `stackDriver.ts`, `StackManager.tsx`,
  `store.ts` (`stackVisionReady`), `ChatScreen.tsx`, `Composer.tsx`, `theme.css`,
  `videoAttach.ts`/`videoBackends.ts`. Gates: app typecheck (src and electron),
  lint, 780 tests, Vite build, Prettier; os-code em-dash and PROGRESS shape
  guards. Rulings in `DECISIONS.md`.

- **2026-09-06: video attachments, reviewed frame by frame, never the video
  (founder, pushed to main).** The founder wanted Claude Code's attachment flow
  (Camera, Photos, Files) with video added, on two rules: a model never reviews
  a video directly, and a large clip is compressed before it is broken into
  stills. Built: a video is detected on attach (`isVideoFile`), compressed
  toward the 25 to 29MB band when it is over 30MB, and sampled into up to 12
  downscaled JPEG frames, each tagged with its order and timestamp; the frames
  ride to a vision model as ordinary image blocks and the composer shows one
  chip per video. Native compression and framing run on AVFoundation on the
  phone (new `oscode-media` Capacitor plugin: `AVAssetExportSession`
  fileLengthLimit for the band, `AVAssetImageGenerator` for the frames) and on
  FFmpeg on the desktop (`osc:mediaProcess` over the Electron bridge, invoked
  with an argument array, never a shell string, with a friendly "install
  ffmpeg" message when it is absent); the browser and any native gap fall back
  to a canvas over a hidden `<video>`, so a clip always yields frames.
  Screenshots and screen recordings flow through with no approval, since
  attaching is not a tool call. The cloud Claude driver (`buildVisionContent`)
  leads the frames with a one-line context header, labels each with its
  timestamp, and adds a system note so the model reads them as one clip in
  order and may say plainly it reviewed the video frame by frame. Only stills
  ever leave the device; the video is read locally. Vision stays cloud Claude
  only (`sourceSupportsVision`), so frames route there. New Info.plist photo
  permission string. Code: `app/src/lib/{attachments,videoAttach,videoBackends,
mediaPlugin}.ts`, `app/src/components/Composer.tsx`,
  `app/src/drivers/cloudClaudeDriver.ts`, `app/electron/media.ts` +
  `main.ts`/`preload.cjs`, `app/plugins/oscode-media`. Doc:
  `docs/video-attachments.md`. Gates: app typecheck (src and electron), lint,
  tests (29 in the touched suites), Vite build, Prettier; os-code em-dash guard
  and the PROGRESS shape guard. Native device and desktop-FFmpeg verification
  are in What remains (not runnable in a web session).

- **2026-09-05: `0016` had already been applied to production, from its
  stale first draft, before every edit made to it since.** Discovered by
  querying the live schema directly (prompted by the founder asking what to
  check before running `db push`), rather than trusting the file's edit
  history: production had unconditional IP capture on every row of
  `guardrail_events` and `likeness_consents`, the full `ip_ban_proposals`
  queue, `request_ip()`, and a three-argument `record_enforcement` the app
  no longer calls (the app calls the zero-argument version, so enforcement
  recording has been silently broken in production). Confirmed empty first
  (0 rows in all three tables), so nothing real was at stake. Fixed with a
  new migration rather than more edits to `0016`:
  `0017_reconcile_stale_0016.sql` drops every stale IP object and the
  stale `record_enforcement` signature, then recreates the zero-argument
  version the app expects. 3 new tests in `ethicsEnforcement.test.ts`
  (86 total, up from 83). Full write-up in `DECISIONS.md`. Applied to
  production the same day and verified live (all four stale objects gone,
  `record_enforcement()` the only signature, founder seeded into
  `abuse_reviewers`). The founder's own smoke test of a live guardrail
  block is the one thing still pending.
