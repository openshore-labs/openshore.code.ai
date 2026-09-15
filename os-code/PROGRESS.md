# PROGRESS

The recent-state source of truth for OS Code, kept in the same spirit as the
Uki app repo: current state first, then what remains, then the log.

Older Current state sections and log entries are in `docs/progress-archive.md`
(newest first); the parked build prompts are in `docs/parked-ideas.md`. Keep
this file to one Current state, one What remains, and the last five log
entries (`test/progressShape.test.ts` enforces the shape).

## Current state (2026-09-14 the premium harness begun; 2026-09-09 Agentic Currents and Wayfinding; 2026-09-06 voice mode, the plan-first workflow, and video attachments; 2026-09-05 phone storefront, Crew routines, ethics layer, review remediation)

Newest first: the premium harness (2026-09-14, below), then Agentic Currents
and Wayfinding (2026-09-09, below), then voice
mode (2026-09-06), then the plan-first workflow and video attachments
(2026-09-06), then four pieces from 2026-09-05 built in
parallel sessions and merged here: the phone storefront, Crew routines, the
always-on ethical guardrail layer, and the full-codebase review remediation (its
state section moved to `docs/progress-archive.md`; its open items stay in What
remains).

### The premium harness (founder + advisor org, 2026-09-14)

Latest (2026-09-15): the floor produced its first real numbers, in two
rounds. Round one: qwen2.5-coder:3b ran all four deep-eval tasks on the
founder's CPU-only box with no timeout ("1 turn; done: complete"), proving the
lean prompt plus a seat that fits the hardware solves the prefill wall. It
still scored 0%, because the model wrote its tool call as JSON text (ollama
hands calls back as content, not `tool_calls`, on this box) and native mode
read that as a final answer, completing with nothing run. Fixed in `loop.ts`:
native mode falls back to text extraction when no native call arrives, and
records that turn the text way, never a fabricated tool_use
(`test/textCallFallback.test.ts`). Round two, after that fix: every task now
calls real tools (readFile, editFile, writeFile, todoWrite), no more timeouts,
no more "no tools called". Still 0%, but for two distinct, honest reasons: (1)
a second harness gap, now also fixed, where editFile's failure on a
non-matching SEARCH block only offered a hint, so a 3B that mis-transcribed a
line resent the IDENTICAL block four times and tripped the loop guardrail;
`editFile.ts` now echoes the file's own current content (bounded to 4000
chars) into the failure so the next turn has ground truth to copy from
(tenet 3; `test/editFileToolTrace.test.ts`); (2) genuine 3B capability limits
on the remaining two tasks (a wrong implementation, a wrong answer), which the
harness does not paper over, and which best-of-N and verify-in-the-loop exist
to buy back next. os-code 693 green. Re-running the 3B deep eval again is the
immediate step; the convergence memo for the out-of-the-box path is
`docs/premium-harness-first-seat-convergence.md`.

The plan is `docs/premium-harness-proposal.md`, reviewed by all eight advisors
(`docs/premium-harness-advisory-memos.md`), and its five tenets are in
`CLAUDE.md`. It ships with no room and no name (codename Keel, internal only),
the way gitOS ships as Repositories. Step 0 (measure) ran on the founder's box:
the existing three-probe `osc eval` scored deepseek-coder:latest 33% and
qwen2.5-coder:7b 75%, the first real baseline. Step 1 (the discipline seam that
makes small models capable) has landed behind config: `os-code/src/harness/`
holds `profile.ts` (derives a model class tiny/small/mid/large and its per-class
policy: tools shown, calls per turn, constrained decoding, subagents, plans,
context budget) and `decoding.ts` (the tool-or-answer union schema so a
constrained small model can always answer in prose or call a tool with its own
argument schema). Config `harness.profiles` and `harness.decoding`, on by
default, tunable or off, an empty config still valid; the derived class rides
`osc eval` and prints on the report. Exported from the engine surface for the
app. 27 new tests. Step 2 (eval v2, the real spine) also landed:
`src/eval/tasks.ts` (four hermetic fixture tasks scored by behavior),
`src/eval/v2.ts` (the runner, loop injected), `osc eval --deep` (wires the
real engine loop), and a CI regression test that drives the loop with a mock
provider and no weights (`test/evalV2.test.ts`), so the harness itself is
guarded. Verify also landed (`src/harness/verify.ts`, config
`harness.verify.command`): after a task that changed files, the loop runs the
project's check command and emits a `verify` event (verified / not verified),
gated to the local-interactive profile so a project-config command never fires
unprompted on a remote or headless session; the app shows it as a note for
now. Verify then went IN the loop (the founder's north star is frontier-level
coding from a decent local model, and coding has an oracle): a failing check
is handed back to the model as an observation (the exact output tail plus one
plain ask) and it gets another go, bounded by `harness.verify.maxRetries`
(default 2, 0 means report only), still under the step rails; the `verify`
event carries `round` and `willRetry` so the last one is the verdict. Eval v2
gained `--attempts <n>` (independent tries per task in fresh workspaces,
reporting one try next to best of n, so a best-of-N picker is measured before
it is built) and the frontier reference run: `--provider anthropic --model
<model>` puts the named model in the orchestrator seat for the run, asks once
up front on the terminal (default No, `--yes` for a scripted run), and draws
the ceiling line the local numbers are measured against. The eval also became
self-diagnosing: each drive can return a trace (turns, tools reached for,
whether a write landed, how it ended) and the scorecard prints a one-line why
under any task short of a clean pass. That trace paid off immediately: the
first deep run of qwen2.5-coder:7b on the box scored 0% on all four tasks, and
the why-lines showed why, "1 turn; no tools called; done: error (No bytes for
120s from ollama)". Not model incapacity: the stream idle guard was killing the
request during prefill, because a cold 7B reading the full agent-loop prompt on
a modest box (small GPU or CPU) takes longer than 120s to emit its first token.
Fixed by splitting the guard into two windows (`src/providers/streamIdle.ts`):
a generous first-byte window (prefill, default 300s) and the tight inter-token
window (default 120s), both configurable via `resourceBudget.streamIdleSeconds`
and `streamFirstByteSeconds`, applied at bootstrap and in the deep eval. The
three-probe eval had hidden this because its prompts are tiny and prefill is
quick. But raising the window to 300s was not enough: the second deep run still
timed out with "No bytes for 300s" on every task, because the full agent-loop
prompt (about 17KB of UX and humanizer standards plus 25 tool schemas) is
simply too heavy for a 7B to prefill on this box inside five minutes. That is
the real reason small local models look useless in a naive harness, and it is
exactly what step 3 (the discipline seam) is for, so it was built next and the
measurement justified it. The seam is now wired into `loop.ts`, gated by
`harness.profiles.enabled` (default on): each turn derives the active model's
class (`deriveProfile`), and for a lean seat (tiny or small) the loop shows
only the profile's tool allowance (core-first, so read/edit/search survive the
cut: `maxToolsShown`, 6 tiny / 10 small) and swaps the full standards for a
compact one-line digest, with a one-time note saying the seat is small and the
harness is carrying the checklist (tenet 3). mid and large seats, and the
profiles-off path, keep every tool and the full standards, unchanged. The test
helper defaults the seam off so the rest of the suite is the full-prompt
baseline; dedicated tests (`test/harnessLoopProfile.test.ts`) prove the lean
path and that the engine default is on. What is NOT done:
re-running the deep eval on the box to confirm the small class now completes the
loop and to record the with-and-without number (the immediate next step),
wiring the union decoding (constrained tool-or-answer) into `loop.ts`,
per-class context budgets and retrieval-first,
a best-of-N picker in the loop (needs checkpoints, and
only if the attempts gap says it pays), a pass/fail verify pill on the
task-done card, checkpoints/rewind, hooks, Ask for a hand with Auto-place, the
pure-core extraction and the phone host, and Lessons. Those are the next
steps, each gated on a number, in What remains and the proposal.

### Agentic Currents and Wayfinding (BETA, founder 2026-09-09)

The founder's frame: the app evolves by connecting to new tech and layering it
in, never by reshaping the familiar rooms. Two Settings groups after Voice hold
it. **Wayfinding** (memory, skills, browser; default on) is how the agent finds
its way. **Agentic Currents** (BETA; Hermes Agent, CLI Pairing, Vellum,
OpenAGI, A2A; default off; ONE on at a time everywhere) are opt-in modalities
for agent work: flip one on and the same rooms gain rows for it (a Bench
model, a Crew member with its jobs, a Vault folder, a tool for the coding
agent, a pill beside the reach pill); flip it off and every trace is gone. The
name is the CMO and Creative Studio's ("Layers" retired); "frontier" stays
reserved for cloud models. Doc: `docs/agentic-currents.md`; rulings in
`DECISIONS.md`.

- **The rules are code.** One id, not a map, so exclusivity is structural. A
  two-part gate (toggle AND a live probe) yields off, arriving, ready, or on.
  Every current fills the same contribution slots or names why not (the
  mirrored pattern), pinned by a test. Rooms render a current only through
  `activeContribution`; a source grep refuses a proper noun anywhere else, and
  turning a current off purges its bench model from every stack.
- **How it is felt (the Siri replica, 2026-09-14).** A bloom rises from the switch, a
  multi-hue ring blazes around the border and settles into a thin drifting ring in the
  brand's water (`--current-1..5`); before that, a current flowed from the switch to the edges on the door
  clock and the glide curve (transform and opacity only, flow tokens, no third
  blue), settles as a faint persistent water-line on every screen, ebbs back on
  off, one decisive haptic at the border, reduced motion honored. The BETA
  badge is a neutral pill after the group head with one honest line under it.
- **Engine.** `src/currents/model.ts` (shapes, through `os-code/protocol`) and
  `src/currents/host.ts` (host probe; a jailed, markdown-only Hermes home
  reader). Tools `askHermes` (OpenAI-compatible, one Hermes session per
  OpenShore session via `X-Hermes-Session-Id`), `askAgent` (A2A `message/send`),
  `cliAgent` (a shell run of Claude Code or Codex headless, always asks on the
  headless and remote profiles). Registered only when a handle was delivered,
  never under egress lockdown; a CLI handle only when the CLI is on PATH. Daemon
  `GET /currents` (any member) and `GET /currents/hermes/notes[/<path>]` (admin);
  `POST /sessions` accepts `currents`. Electron IPC parity.
- **App.** `app/src/lib/currents.ts` (pure core), `currentsProbe.ts` (probes,
  Hermes jobs, Hermes notes), `CurrentConnectSheet`, `CurrentArrival` and
  `CurrentWaterline` (mounted in `App.tsx`), the header pill in
  `ProfileStatus`, the bench in `StackManager` (a `current-<id>` BYOM ref, the
  session header in `stackDriver.ts`), the roster and a "Runs on" jobs section
  in `CrewCommandScreen`, the folder and a read-only note sheet in
  `VaultScreen`. Three written guides. Vellum and OpenAGI are Arriving rows
  that accept an address and probe an A2A card then an OpenAI-compatible `/v1`.
- Gates at close: os-code typecheck, lint, 628 tests (62 files), build,
  Prettier; app typecheck (src and electron), lint, 872 tests (101 files),
  Vite build, Prettier; the motion and polish guards, the trace guard, the
  em-dash guard, the PROGRESS shape guard.
- **Not verifiable here** (What remains): the arrival on a phone, a real
  Hermes box answering over Tailscale, a paired CLI running headless, an A2A
  agent card, and the App Review read of the BETA label.

### Voice mode (a spoken conversation over the chat, native and offline)

The founder's ask: a Claude-style voice mode usable while coding, native so it
works offline, with a voice you pick, and with the natural breaks the work needs.
Built on top of the existing on-device dictation. Listening reuses the
`oscode-speech` plugin (on-device SFSpeechRecognizer, mic audio stays on the
phone) with a silence-based finalize so it is hands-free; speaking is a new
`oscode-tts` plugin (AVSpeechSynthesizer, synthesized on the phone, offline), Web
Speech on desktop and web. The picker lists the device's installed system voices
(Apple's downloadable premium neural voices included), so it is real and offline,
and it steers clear of the ethics layer's Tier 2 voice-likeness gate (generic
system voices, no cloud voice service like Claude's own). Access inherits the
chat, no separate preset (founder: "if access is on for the chat, voice gets the
same access"): a voice-triggered action rides the same `send` and approval path.
The natural breaks are one policy table (`voiceBreaks.ts`): clarifying questions
and plan approval are read out and answered by voice; a tool or cloud-spend
approval, and a stopped-turn recovery, close voice and hand back to the chat
screen, then voice reopens once an approval is answered. Everything spoken lands
in the transcript as text, so the chat is the history. Pure, tested core in
`app/src/lib/voice/` (`spoken.ts` speech shaping, `voiceBreaks.ts` the policy,
`tts.ts`/`stt.ts` the backends), the loop in `app/src/hooks/useVoiceMode.ts`, the
overlay in `VoiceMode.tsx` and the picker in `VoicePicker.tsx`, a voice button in
`Composer.tsx`, the break/reopen wiring in `ChatScreen.tsx`, and settings
(`voiceReplies`, `voiceId`, `voiceRate`) in `SettingsScreen.tsx`. Doc in
`docs/voice-mode.md`, rulings in `DECISIONS.md`. Like dictation, the native speech
path is only provable on a device (What remains).

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

- [ ] **Bring the work-first cover to the desktop `StackScreen` (optional).** The
      Quarterback rename to Reasoning LLM is done (2026-09-15); the older desktop
      stack screen is still the flat list and could get the same cover if wanted.

- [ ] **Project room redesign, device taste (built 2026-09-15).** The
      work-first rebuild is verified in headless Chromium in both themes; the
      cover wash and the resume card's teal are a first pass. TestFlight is the
      judge: the shared-element title flying cleanly into the cover, and whether
      the room feels premium on a phone. Review and set-aside directions in
      `docs/project-room-redesign.md`.

- [ ] **The premium harness, the rest of the plan (begun 2026-09-14).** Step 1
      (the discipline seam: `os-code/src/harness/profile.ts` and `decoding.ts`)
      landed behind config but is not wired into `loop.ts` yet. Next, in order,
      each gated on a number per the tenets: (1) commit the founder's real eval
      baselines to `curation/eval.json` (deepseek-coder:latest 33%,
      qwen2.5-coder:7b 75%, run on the founder's box), and run the deeper
      `osc eval --deep` there too for a real-loop baseline; (2) DONE, eval v2
      landed (`src/eval/tasks.ts`, `src/eval/v2.ts`, `osc eval --deep`, the
      mock-provider CI regression `test/evalV2.test.ts`); the remaining eval-v2
      follow-ups are a "Measure" Crew routine that runs it nightly on the box
      and more fixture tasks (a vision-need-recognized task once the hand
      exists); (3) wire profiles and the union decoding into `loop.ts` (tools shown, calls
      per turn, retrieval before the first turn, per-class context budget), then
      re-run eval to prove the small class climbs; (3b) the frontier-level
      coding path, measured: run `osc eval --deep --attempts 3` on the founder's
      box for qwen2.5-coder:7b and the largest local coder that fits, and a
      reference run on a frontier model on the founder's key; the one-try vs
      best-of-3 gap decides whether a best-of-N picker judged by tests (needs
      checkpoints) is built into the loop; (4) the rest of the Claude
      Code moment on the engine (verify LANDED as a `verify` event, and verify
      IN the loop landed: a failing check goes back to the model for up to
      `harness.verify.maxRetries` more goes; still to do:
      a pass/fail verify pill on the task-done card, checkpoints and rewind,
      hooks); (5) Ask for a hand with
      Auto-place (needs a runtime tool-registry seam, local-only, never under
      lockdown, downloads always ask); (6) the pure-core extraction with a
      Node-free guard and subagents drawing down the parent's rails; (7) the
      phone host; (8) Lessons, local only, per owner and workspace, cleared with
      the chats. Plan and rulings: `docs/premium-harness-proposal.md`,
      `docs/premium-harness-advisory-memos.md`, `CLAUDE.md`. Pricing (Personal
      $50, Micro $100, Small $250, Growth $500, Scale $1000) is a Board gate and
      the site copy change, not harness work.

- [x] **Perplexity Sonar citations through the driver (built 2026-09-14).**
      `CloudOpenAiDriver` now parses Sonar's top-level `search_results`/
      `citations` (both the streaming and native-shim paths) and emits a
      `citations` event, so a placed Sonar model shows its sources like the
      on-device search path does. It is a no-op for every other provider.
      Tested in `app/test/cloudOpenAiDriver.test.ts`.
- [ ] **Verify Perplexity Sonar model ids and the API-key URL against the live
      API before a distribution build.** They were taken from web search (the
      docs host is egress-blocked in the sandbox), and carry the house
      verify-before-release caveat in `providers.ts`. A retired id is a dead
      button in the stack.
- [x] **Research (Perplexity) engine parity (built 2026-09-14).** The engine
      now has a `perplexity` search backend
      (`os-code/src/core/tools/search/perplexity.ts`, registered in
      `searchProviderFor`, `search.backend: 'perplexity'` +
      `perplexityKeyEnv`), so a paired-desktop or headless session can ground
      its own web search in Sonar. By design the key is read from the env on
      that machine like Brave and Tavily and never rides a session to a remote
      hub (the CTO provider-key ruling), so the engine is configured on the box
      via `os-code.config.json` rather than by pushing the app toggle and key
      over the wire. Auto-selecting the engine backend from the app's Research
      toggle is deliberately NOT done for that reason; a docked user sets
      `search.backend` on the desktop, the same as the other keyed backends.

- [ ] **Agentic Currents on a device and a real box (built 2026-09-09, unverified
      off the sandbox).** TestFlight: flip Hermes Agent on in Settings and
      confirm the current flows from the switch to the edges, the water-line
      stays faint on every screen, the pill sits beside the reach pill, and
      turning it off ebbs and leaves no row anywhere. With a Hermes box on the
      tailnet (`hermes api-server`): confirm the `/v1/models` probe turns the
      row On, Hermes appears on the bench and places, a chat turn reaches it
      with `X-Hermes-Session-Id`, the Crew room lists its `/api/jobs`, and the
      Vault reads its home through the paired computer. With Claude Code or
      Codex on the paired computer: CLI Pairing finds it and a coding chat can
      hand it a task as an approved command. With any A2A agent: the card names
      it and `askAgent` gets an answer. Open follow-ups: Wayfinding's three
      switches are honest labels over what exists today (project memory, the
      Skills.md recipes note, and no browser driver yet), so the Browser
      switch gates nothing until a Playwright-driven browser lands on the
      engine; the BETA pill's per-row exit is a founder call.
- [ ] **Voice mode on a device (built 2026-09-06, unverified off the sandbox).**
      The decision logic is unit tested (`app/test/voice.test.ts`), but the native
      speech path is device-only, like dictation. TestFlight: open voice mode in a
      chat, speak a request, confirm the reply is spoken in the chosen voice and
      lands in the transcript as text; ask something that draws a clarifying
      question and answer it by voice; trigger a tool or cloud-spend approval and
      confirm voice closes, the sheet shows, and voice reopens after the tap;
      change the voice in the picker and hear the sample; confirm it all works with
      the network off for an on-device model. Also confirm `cap sync ios` links the
      new `oscode-tts` plugin (registered in `app/package.json`, not yet in the
      CLI-managed `CapApp-SPM/Package.swift`, same as `oscode-media`). Follow-ups
      in `docs/voice-mode.md`: true always-open barge-in (needs echo handling), and
      a bundled cross-platform neural TTS engine behind the existing seam.
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
      Pop!\_OS desktop against a cloned repo, let it fire at 06:00 (or Run now),
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

- **2026-09-15: My Crew reframed to project-agnostic advisors, and a command-door
  overlap bug fixed (founder, CTO + Creative Studio + CX).** The founder asked to
  make the crew less business-oriented, project-agnostic with the business
  abilities kept ("CTO should be called Technical Advisor or something like
  that"), and to audit the page. Fixed a real bug first: the "Crew command" door
  rendered its kicker, title, and subtitle as inline spans, so on a phone they
  ran together and the subtitle overflowed; `.crew-command-door-body` is now a
  flex column. Reframed the eight-member advisor preset in `crewPresets.ts`: CTO
  to Technical Advisor, CMO to Marketing Advisor, CFO to Finance Advisor, CX to
  Research Advisor, Chief of Staff to Coordinator, Board to Sounding Board,
  Corporate Strategist to Strategy Advisor, Creative Studio kept; personas
  rewritten to advise on whatever a person is building rather than a company,
  abilities and the activity shape (one reviewer, an auto trio, four by request)
  unchanged, each still advisory. Activity labels lost their dev framing
  ("Reviews builds" to "Reviews the work", etc.). The invite became an "Advisors"
  card and the roster sits under a "Your crew" label. Copy updated to match in
  the Crew screen, the guide knowledge string, and `docs/interaction-model.md`.
  `crewPresets.test.ts` updated to the new names with a guard that the old
  C-suite titles are gone. Rendered in headless Chromium in both themes. Gates:
  app typecheck, lint, 888 tests, Vite build; the motion, polish, and em-dash
  guards. Review in `docs/crew-page-redesign.md`; ruling in `DECISIONS.md`.

- **2026-09-15: the Vault page, a new-user onboarding ramp, and an empty-state
  overlap bug fixed (founder, CTO + Creative Studio + CX).** The founder asked
  how a new user would know what the Vault is or how to use it, and to take
  Obsidian's new-user ramp as the guide. The read found a real bug first: the
  empty Vault reused the chat screen's `.greeting`, which on a touch device is
  `position: fixed` and `pointer-events: none`, so on a phone the empty state
  floated over the Coding projects card and its "New note" button could not even
  be tapped. Rebuilt the empty personal vault as an in-flow onboarding ramp (no
  `.greeting`): a welcome cover in the room family's water wash, a plain-language
  "what it is", two ways in (Write your first note, or Add a welcome note that
  seeds a real readable starter note the way a fresh Obsidian vault opens on
  one), and three "how it works" cards teaching that notes are yours in plain
  markdown, that the agent both writes and reads here, and how `[[wikilinks]]`
  connect them. The offline and empty-team states became in-flow notice cards
  too. `vaultCreate` gained an optional `content` arg (backward compatible) so a
  seeded note opens in read mode; all existing callers and tests unchanged.
  Presentational plus that one seam; no other store or gate change. Rendered in
  headless Chromium at phone width in both themes (the overlap is gone, the
  button is in flow). Gates: app typecheck, lint, 887 tests, Vite build; the
  motion, polish, and em-dash guards. Review in `docs/vault-page-redesign.md`;
  ruling in `DECISIONS.md`. Follow-up the same day: the `.greeting` sweep moved
  the project memory view's empty, error, and not-set-up states onto the shared
  in-flow `.empty-notice` card, so only the chat keeps the fixed `.greeting`.

- **2026-09-15: the Stack page, reviewed and rebuilt as a legible system
  (founder, CTO + Creative Studio + CX).** Same team, same treatment as the
  project room. The screenshot was the phone view (`StackManager`), so that was
  the target. The read: the control room for the plan-first workflow was drawn
  as a flat settings list, the premise (one Reasoning LLM plans and routes to
  specialists) invisible, the anchor looking like any benched model, and the
  teal/amber posture language barely used. Rebuilt: an anchor cover (the same
  water wash as the project room) carrying a compact reach pill (the status,
  now, tap to switch which status's stack you edit) and the Reasoning LLM as the
  hero with a location chip and Change; a single Specialists section with a
  routing explainer, image reading as a tagged specialist keeping its two
  local/cloud slots, and the placed specialists each with a category tag and a
  location chip; a Bench of reserves with the teal/amber rule kept on every
  model and a house-styled cloud picker (was a raw inline `<select>`).
  Presentational only: every store action, sheet, the Currents bench pill, the
  vision two-slot semantics, and the admin gating (the non-admin lock on every
  control) preserved. No test pinned the Stack UI strings; none loosened.
  Rendered in headless Chromium at phone width in both themes. Gates: app
  typecheck, lint, 887 tests, Vite build; the motion, polish, and em-dash
  guards. Review in `docs/stack-page-redesign.md`; ruling in `DECISIONS.md`. The
  CTO's top cross-surface finding, the desktop Quarterback vs Reasoning LLM
  vocabulary split, was then closed the same day at the founder's call: Quarterback
  is renamed to Reasoning LLM across the desktop stack screens and the guides.

- **2026-09-14: the arrival is now a replica of the iOS Siri glow, in the
  brand's water (founder, from a screen recording).** The founder attached a
  recording of Siri activating and asked for a replica with the OpenShore
  palette in place of the purple. Read frame by frame (twenty stills): a soft
  bloom from the pressed edge, then a thick multi-hue ring lighting the whole
  border with a blurred glow bleeding inward, settling into a thinner ring
  whose hues keep drifting. Rebuilt `CurrentArrival` and the persistent
  water-line on that shape: a bloom (a plain gradient, no filter) centered on
  the switch; a masked ring whose conic gradient rides an oversized rotating
  square (transform only, `linear` infinite, the guard's allowed loop); one
  blurred glow layer that lives only through the 1.6s flourish; and the
  persistent ring as the same thing thin and faint, breathing, so the hand-off
  is seamless. Palette tokens `--current-1..5` (deep water, water, shore teal,
  a light aqua highlight, the amber counterpoint) in all three theme blocks,
  deeper on paper. Verified in headless Chromium with animations frozen at
  250, 500, 800, 1100, and 1600 ms in both themes (the bloom, the blaze, the
  settle, and the persistent ring all render as designed). Gates: app
  typecheck, lint, tests, Vite build, Prettier, and every guard.
  `docs/agentic-currents.md` and `DECISIONS.md` updated.
- **2026-09-15: the Project room, reviewed and rebuilt as a workspace (founder,
  CTO + Creative Studio + CX).** The founder flagged the project room (the room
  behind a tapped project, where they expect 75% of the work) as scattered and
  subpar and asked the three seats to look. The read: the room opened on config
  (standing instructions, then repos) with the actual work (chats) third, under
  a wall of lead copy, four identical cards with no hierarchy and no identity.
  Rebuilt work-first: a calm paper-raised cover with a soft water wash (not a
  dark band, so the shared-element title still lands), the hero title, a live
  stat strip (chats, repos, team), and the primary action (New chat beside
  Resume last chat); then the chats lead, with a resume card in the brand's
  water for the returning person; then the context that rides into every chat
  (instructions preview, repo chips with GitHub/local glyphs, a link into the
  agent's project memory) under a teal eyebrow; then the roster and delete last.
  The Projects list cards were aligned to read as workspaces (live chats and
  repos count). Presentational plus one existing outbound link
  (`openProjectMemory`); no store, permission-gate, team-access server path, or
  migration touched, so `mayWrite`/`mayEdit`/`canManageAccess`/`canShare` gating
  is preserved. Rendered in headless Chromium at phone width in both themes.
  Gates: app typecheck, lint, 887 tests (extended `projectPolish.test.ts`, none
  loosened), Vite build; the motion, polish, and em-dash guards green. Review
  and directions in `docs/project-room-redesign.md`; ruling in `DECISIONS.md`.
  Device taste is the founder call (What remains).
