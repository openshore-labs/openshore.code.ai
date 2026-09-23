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

### Harness Currents, the first: Jev (BETA, founder 2026-09-23)

A second, independent currents group above Agentic Currents, chosen PER PROJECT
(both groups moved out of app Settings the same day, below). A Harness Current
layers a cheap decision method INTO the harness rather than being an agent you
hand work to, so you use any of your seats with it applied; the two groups are
independent (one of each may be on), one at a time within the harness group,
same animation and two-part gate. The first is Jev, TypeSafe AI's System One
decision model (`api.typesafe.ai`), scoped to a paid/cloud seat: an escalation
gate and a task classifier run as one `JevAdvisor.steer` call in the app stack
driver, and a verify judge runs in the engine loop, each shown as an amber
(cloud spend) card with a pill beside the reach pill. Copy claims no dollar
saving until `osc eval` measures it (tenet 2); the harness "no room, no name"
tenet is a deliberate founder supersede for this one named group (Keel stays
barred). Pure core `app/src/lib/harnessCurrents.ts`, client
`os-code/src/harness/jev.ts` (via `os-code/protocol`), doc
`docs/agentic-currents.md`, rulings in `DECISIONS.md`. Gates green both packages.

### Scope simplified to three curated models (founder, 2026-09-21)

Three curated, harness-trained models, and the Marketplace grayed to "Coming
soon" (Sidebar, desktop and phone). The lineup: Harbor Lite (built-in phone
guide), Harbor (recast from the Qwen3-1.7B guide to a Qwen2.5-Coder-3B mobile
coder, web search kept, Harbor Lite now the sole guide), and DeepBlue (the
desktop coder, the rename of the Harbor Master slot with Qwen 2.5 Coder 32B as
the flagship over 14B/7B/3B). Stock Qwen today, each a harness training target.
DeepBlue on the desktop: `app/src/lib/harborMaster.ts` (id
`harbor-master`, a stable slot over the catalog's own Qwen 2.5 Coder sizes,
the display name in one constant for the CMO); `ensureHarborMaster` in the
store (pull the size that fits by catalog id through the engine, seat its
Ollama ref, refresh the gate); the First Seat card named DeepBlue and
installing in place; the Stack starter on the same action; a desktop Settings

> Harbor row (Install, percent, Retry, Installed; no cancel or uninstall, since
> Ollama owns the weights) plus the attribution. `starterModel.ts` and the
> Starter bundle derive from the one list, which gained the 32B flagship (the
> 7B before the machine is read, never the biggest on a guess). Internal slot
> identifiers stay (`harborMaster`, `harbor-master`); only the display name and
> copy carry DeepBlue. `test/harborMaster.test.ts` and `test/harborGuides.test.ts`
> pin the ids, the fit table, the honesty bar, the rows, and the docs. Gates
> green across all three passes; the plan for the tuned weights behind the slots
> is `docs/house-model-proposal.md`.

### The premium front door, integrated (founder "build" go, 2026-09-16)

The founder's build order: make the framework a premium human experience for
vibe coding, so a person can connect a GitHub repo, download OpenShore on a
normal computer and a normal iPhone, reach the hub over Tailscale, and code on
the phone against free local models, keeping the look and the personality. Built
across four streams and integrated here. Every gate is green: app 1025 tests,
engine 819 tests, both typechecks, lint, Prettier, the em-dash guard and this
PROGRESS shape guard, the app Vite build.

- **Per-device pairing.** The desktop QR carries `{u, claim}`, a one-time short-
  lived code; the phone redeems it at `POST /pair/claim` for its own labeled
  credential, so revoke cuts one device and the old shared token is gone.
  `os-code/src/daemon/pairClaims.ts`, `app/src/lib/qrDecode.ts`,
  `app/src/screens/PairScreen.tsx`, `remoteDriver.redeemPairClaim`.
- **The appliance.** The daemon starts on app-ready, binds the tailnet (else
  loopback, and re-binds when Tailscale comes up), survives window close via a
  tray, offers a login item, and holds a power-save blocker while a session runs
  (`app/electron/lifecycle.ts`, the `engineHost` rebind fix). An in-app Ollama
  bridge reports install/running/version and can start or install it on Linux
  behind a one-tap card, never a toast (`app/electron/ollama.ts`).
- **The First Seat.** When nothing on this device can answer, the empty chat is
  one hardware-fit local pick with one tap to set it up and the Marketplace one
  tap behind it; the greeting is its fallback the instant a brain is ready. It
  is presence-aware, arrives on the "Seat Fills" tokens, and ticks once as the
  card seats. `app/src/components/FirstSeat.tsx`, `app/src/lib/firstSeat.ts`,
  the fit-aware starter in `starterModel.ts`, theme.css `.first-seat`.
- **Honest guarded stream.** The app guard now preserves the inner driver's seq
  instead of renumbering, so a reopened desktop chat keeps its journal snapshot
  until the replay lands; a disposed driver is treated as absent so a fresh send
  never reuses one (`app/src/drivers/guardedDriver.ts`, `state/store.ts`).
- **Graduated ethics ladder.** The always-on layer (now archived) gained staged
  enforcement with a next-action block, migration `0018_graduated_enforcement.sql`,
  pinned by `test/graduatedEnforcement.test.ts`.
- **Linux and Windows: SHIPPED, sign-in everywhere, real auto-update.**
  `release.yml` builds both, smoke-tests each engine headless, and publishes
  atomically to one GitHub Release on a `v*` tag; `v0.1.1` is live. Every
  desktop workflow now stamps `app/package.json`'s version from the tag first
  (v0.1.0/v0.1.1 had shipped identically-versioned, which made
  `apt install ./file.deb` see "already newest" and skip). All three carry
  the Vite-build-time Supabase keys now, so sign-in works everywhere, not
  just iOS; the app's `fetch`-based client takes a newer `sb_publishable_...`
  key exactly like the legacy anon key. Windows/Linux get `electron-updater`
  against that Release feed (background download, restart-to-install banner).
- **macOS: unsigned, matching Uki Music (founder call). SHIPPED 2026-09-17.**
  No certificate, no notarization; cost is one Gatekeeper right-click Open on
  first launch (`docs/MAC-DESKTOP.md`). Can't self-update in place unsigned,
  so it gets a version check that opens the latest Release instead;
  `mac-desktop` (Codemagic) publishes into that same Release given
  `GH_RELEASE_TOKEN`, confirmed live on `v0.1.2` against the release assets
  themselves, not just a green build (see Log).
- **Pairing names a real cause instead of a red herring.** A phone on a
  pre-claim-rework build sent its old code straight to the bearer header, so
  the daemon's wrong-credential 401 read like a Tailscale problem; it now
  names "an out-of-date app," surfaced by `daemonHealth`.

### The premium harness (founder + advisor org, 2026-09-14)

Latest (2026-09-15): the floor was measured for real, over ten rounds on the
founder's CPU-only box with qwen2.5-coder:3b, each round fixing one harness
gap the previous run exposed (stream windows, tool-call-as-text, edit shapes
and a six-strategy matcher, ground-truth echoes, stale-repeat handling, an
answer-only turn, the lean core prompt, verify in the loop, self-naming
traces). The round-by-round record is in `docs/progress-archive.md` under
"the 3B deep-eval rounds one to nine"; the result is below.

Round ten, the number: **qwen2.5-coder:3b scores 25% on the deep benchmark
on the reference box** (create 100%, edit 0%, refactor 0%, answer 0%), the
first non-zero result after nine rounds of 0%, and the recorded floor for
the small class on CPU-only hardware. `add-function` passed clean (the
flattened matcher and the concrete blank-SEARCH redirect did their work).
`rename-across-files` came within one line: the definition and the call site
were both renamed, only the import line still said `oldName`, and the seat's
last SEARCH was `oldName(` (a fragment from the call site, no longer in the
file) rather than the import line shown to it; it also still reached for
`gitDiff` twice despite the new instruction, harmlessly. `answer-from-code`
is the arithmetic limit (82). The cycle is closed at this number: every
harness gap the traces ever showed is fixed and pinned by a test, and what
remains is the model copying lines faithfully and holding a two-file change
together, which is a stronger seat's job, not the harness's. Next lever is
that seat: the 7B once the Ollama stall on the box is sorted (a separate
check, not harness work), or a Qwen3-4B-class model, each measured with the
same one command.

Round eleven (founder: "let's push this thing", aiming at 75%), built from
the round-ten traces rather than a belief. The fix-bug miss turned out to be
a bug in the new flattened matcher, caught by the structural check: the
model's SEARCH matched starting after `export function ` on the line, and
the whole-line swap dropped that prefix, producing `subtract(a, b) { return
a - b; }`, which the syntax check rightly refused; text outside a flattened
match on its first and last lines now rides around the replace, and that
exact edit applies (`test/editMatchRelaxed.test.ts`). Three levers on top:
(1) the answer task is now run, not reasoned: the deep eval's approver lets
a plain `node ...` command run in the workspace (no chaining, redirection,
substitution, or `..`; the same trust verify already extends), and the lean
core says to run code it is asked about (`test/evalApprover.test.ts`); (2)
an ambiguous SEARCH comes back with each candidate and the line above it,
ready to copy, since the blank-SEARCH redirect proved a small model follows
text it can paste; (3) a lean seat gets at least four verify retries
(`verifyRetries` per class in `profile.ts`, a project's own setting can only
raise it), since the rename came within one line after three checks. A
rolled-back edit also says plainly the file is unchanged and the replace
must be complete code for the whole region. os-code 753 green (9 new).

Round twelve ran that: 25% again, but a different 25%. `fix-bug` passed
(edit 100%, the flattened boundary fix did its work), `add-function` fell
back to 0 (run-to-run variance; `--attempts 3` is the tool for that), the
answer task ignored the "run it" line (still `readFile` only, answered 24:
the 3B does not take that instruction, a stronger seat should), and the
rename trace showed something worse than a miss: `greeter.mjs` left as
`(name) {`, a corrupted file. That exposed a pre-existing bug in the edit
engine with real teeth: `structuralCheck` ran `node --check` on the PATH,
which is the file before the edit, so a corrupting edit passed (the old
file parses), was written, and only the next edit tripped the check; the
"a write landed; verify failed" shape in the last two runs was this. The
check now writes the proposed content to a probe file beside the real one
(same extension, so module type resolves the same) and checks that, and
`writeFile` gained the same gate, which it never had
(`test/structuralCheckContent.test.ts`).

Round thirteen, `--attempts 2`, the numbers that decide the next build:
**qwen2.5-coder:3b, one try 38%, best of 2 50%** (edit 100%, create 50%,
refactor 0%, answer 0%), and the report's own line: "a best-of-2 picker
judged by tests would add about 13 points on this model." That is the gate
the roadmap set for the picker (build it only if the attempts gap says it
pays), and it pays. What still misses: the rename, where the seat renamed
the function but dropped its parameter (`greet()` with `${name}` still in
the body, valid syntax, wrong program), then searched for the line it had
itself changed and could not recover; and the answer task, where the seat
reads and guesses (24) and will not take the "run it" instruction. Both are
the model at this size; the harness surfaces each exactly. Next build, in
order: the best-of-N picker in the loop, the minimal checkpoint form
(record each touched file's original content on first write, restore on a
fresh attempt when verify retries are spent, take the first attempt that
verifies, N from the class profile, still under the step rails); then the
same one command on the 7B and a Qwen3-4B for the seat comparison.

Round fourteen: the picker is BUILT, in exactly that minimal form. In
`loop.ts`, every workspace file a write tool touches is recorded with its
content before the first touch (null when it did not exist); when the verify
retries are spent and the check still fails, and the class allows another
attempt (`bestOfAttempts` in `profile.ts`: two for small and tiny, one for
mid and large, a per-class override), every touched file is put back, the
history is wiped to the original ask, and the task goes again as an
independent try, the way the eval measured it; the first attempt that
verifies wins, the step and wall-clock rails keep counting across attempts,
a full seat and plan mode never start over. An `attempt` event (additive)
says when it happens, the transcript gets a status line naming how many
files were restored, and the eval's trace line reports "2 attempts"
(`test/bestOfPicker.test.ts`). Not built: a general checkpoint or rewind
system, or restoring what a shell command changed; this is the touched-file
form the number justified and no more. os-code 762 green (5 new), app
typecheck green. Next: the same one command on the 3B to measure the picker
in the loop against 38%, then the 7B.

Round fifteen, the headline: **qwen2.5-coder:3b scores 75% on the deep
benchmark on the reference box** (edit 100%, create 100%, refactor 100%,
answer 0%), up from 38% one-try the round before, with the best-of-N picker
carrying refactor and create over the line. This is the founder's north
star hit in miniature: a free 3B anyone can download, on a CPU-only
five-year-old-class box, went from 0% (2026-09-14) to 75% (2026-09-15)
through the harness alone, no model change. The only remaining zero is the
arithmetic answer task (the seat reads the code and guesses rather than run
it, and cannot do 20 \* 2 + 2 in its head), which is the model's ceiling at
this size, not a harness gap; a stronger seat that takes the "run it"
instruction closes it. The 7B run in the same pass stalled ("No bytes for
300s" on every task): Ollama or RAM contention on the box after the 3B, not
the harness, and left for a box-side check (`ollama ps`, `free -h`, a cold
`ollama run` of the 7B alone), never harness work. This is the measured
milestone for the small class; the harness cycle that chased it, rounds one
to fifteen, is done. The convergence memo for the out-of-the-box path is
`docs/premium-harness-first-seat-convergence.md`.

The 7B, measured 2026-09-16: it does NOT run usefully on this box, and that
is the answer, not a bug to fix. Run cold with the 3B stopped, `free -h`
showing 7.6 GB total and 4.8 GB free, the 7B stalled "No bytes for 300s" on
all four tasks, 0%. A 7B at Q4 is about 4.7 GB of weights plus context and
server overhead, so it does not fit in real memory on a 7.6 GB machine; it
spills into swap and inference crawls past the prefill window. Raising
`resourceBudget.streamFirstByteSeconds` could force a number eventually, but
a model swapping on every token is not a usable seat, and the reference box
exists to measure what a real person feels. So the honest tiering, which is
the founder's own north star proving out: a 7.6 GB five-year-old-class box
tops out around a great 3B (75%), a 4B fits with headroom as the realistic
bigger local seat (`qwen3:4b`, ~2.5 to 3 GB, the next thing to measure), and
a 7B and up belong to the docked/hub tier (a machine with more RAM, or a
GPU). "Way more power" comes from docking, exactly as framed, not from
forcing a 7B onto the floor machine.

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

The plan-first workflow (My Stack as the anchor, the reasoning LLM draws a play)
moved to `docs/progress-archive.md` on 2026-09-23; it still ships, and its
live-quality, engine hand-off, and routine Plan-note checks stay open.

Video attachments (frame-by-frame vision, never the raw video) shipped and
moved to `docs/progress-archive.md` on 2026-09-17; device and desktop-FFmpeg
verification are still open in What remains below.

Crew routines (the botOS brief: a crew member, a task, a workspace, a clock,
shipped inside My Crew) moved to `docs/progress-archive.md` on 2026-09-17;
on-device verification (a real scheduled fire, the approval push with the app
closed, suspend/wake, TestFlight) is still open in What remains below.

The always-on ethical guardrail layer (2026-09-05, reviewed by the CTO and CMO)
moved to `docs/progress-archive.md` on 2026-09-16; it still ships and was
extended that day by the graduated enforcement ladder (migration
`0018_graduated_enforcement.sql`), summarized in the front-door build above.

## What remains (known follow-ups, none blocking)

- [ ] **Harness Currents (Jev): the eval number and a device pass (built
      2026-09-23).** The seam ships, but tenet 2 means no copy claims a dollar
      saving until `osc eval --deep` measures the gate/classifier/judge with and
      without Jev on the reference box (does a cheap decision net out against the
      retry a wrong route costs). Also verify the TypeSafe API base, model id
      (`jev-latest`), and key page against the live API before a distribution
      build (from web docs; egress-blocked here), and on a device confirm the
      arrival, the amber pill, the steer/judge cards on a paid-seat turn, and
      that off leaves no trace. Currents are now per project
      (`ProjectDetailScreen`): confirm two projects run different currents at
      once and a shared project carries the selection. Follow-up: a dedicated
      card, not a note.
- [ ] **The terminal without the back-and-forth, on real devices (built
      2026-09-23, unverified off the sandbox).** On the founder's box and
      iPhone over Tailscale: pair, tap "Open a terminal on your computer" on
      the Paired card, land in the Terminal room with no first-run intro; with
      no repo open, "Open a shell" starts a shell in the home folder; leave the
      room and come back to the same shell. Turn Tailscale off on the phone and
      read "Can't reach your computer"; revoke the phone on the desktop and read
      "no longer accepts this device". A member phone must not see Open a shell.
- [ ] **DeepBlue on a real desktop (built 2026-09-21, unverified off the
      sandbox).** On the founder's box with Ollama up: the First Seat card reads
      "DeepBlue", "On Qwen 2.5 Coder 3B. 1.9 GB download. Fits this
      computer (8 GB, no GPU)."; Set up pulls it with a percent on the button,
      the card leaves, a chat opens; Settings > Harbor reads Installed. A 16 GB
      or GPU machine gets the 7B, a hub with room the 14B. Then pair the phone
      and confirm My computer. Follow-ups: a phone-side row reading "On your
      computer" when docked; an engine-side uninstall if `ollama rm` is too
      much to ask; the 14B's loop score on a hub-class box (only the 3B has a
      measured deep number).
- [ ] **OpenShore's own weights, and the Air program (founder go, 2026-09-21).**
      Both in `docs/house-model-proposal.md`. Not a compact Opus (closed
      weights; distilling from Claude is barred by the terms): the harness's
      discipline baked into an open base, gated by `osc eval --deep` on a
      hub-class box. The Air program: Bonsai 2 27B (ternary, 5.95 GB) plus a
      recovery adapter distilled from the open Qwen3.8-27B, Harbor as the
      speculative draft, a prefix KV cache, CoreML palettization or the fork
      as the runtime, gated to 12 GB phones. Gate 0 is the founder's: serve
      Bonsai from PrismML's fork on the Mac mini and run the deep eval against
      the 14B and 32B (the config and command are in the memo).

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
      Harbor Lite still loads and streams, and the memory-warning observer
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

### 2026-09-23, notices on the phone: downloads, replies, approvals

The founder asked for a notice when a model finishes downloading, with the
Claude app's notification pattern as the baseline for the rest: only when you
are away, permission asked in context (first download or first message, never
at launch), a tap opens the thing, no reply text on the lock screen, per-kind
toggles (Settings > Notifications: Downloads, Replies; both on). Download
notices post natively (`Notices.swift`, called by `ModelStore`) so one still
fires when iOS relaunches the app in the background to finish the transfer;
reply and approval notices post from the store, and stand down for a desktop
session the daemon already pushes for. Taps (local and the desktop push) route
through one `noticeTap` event. Core `app/src/lib/notices.ts`, guards
`app/test/notices.test.ts`. Open: verify on a real iPhone (Swift not compiled
in CI here).

### 2026-09-23, Harness Currents: Jev, a cost-saving decision layer

"add Jev availability" resolved through a design pass: Jev is TypeSafe AI's
System One decision model, not a chat seat, so it became a new, independent
currents group (Harness Currents) rather than a Bench model. It layers a cheap
decision method into the harness: scoped to a paid/cloud seat, it does the
escalation gate and the task classifier in one `JevAdvisor.steer` call in the
app stack driver and the verify judge in the engine loop, each an amber card
with a pill. Copy claims no saving until `osc eval` measures it (tenet 2); tenet
1's "no name" is a deliberate founder supersede for this one group. Then, same
day, BOTH current groups moved from app Settings to a per-project choice
(`Project.agenticCurrent`/`harnessCurrent`, UI `components/ProjectCurrents.tsx`),
so different projects run different currents at once; connecting one stays
device-local, and the rooms and each session read the active project via
`agenticView`/`harnessView`. Detail in Current state above; DECISIONS x2. Gates
green both packages (838 + 1071 tests).

### 2026-09-23, the terminal without Termius: fixed on the device, no relay

The founder asked for OpenShore's own terminal, reached through the account
instead of Termius plus Tailscale. The native Terminal room already existed, so
the question was the transport. An account relay went to the eight advisors
(seven: build with conditions; the Chief of Staff: not now), and the founder
declined it on principle: no OpenShore server in the path of a person's work
(DECISIONS). CX's finding was that most of the pain was reaching the room, not
Tailscale, so that is what shipped. The Paired card now offers "Open a terminal
on your computer"; a device that already reaches a computer skips the Terminal
room's first-run intro; with no session open the room offers a plain shell in
the home folder (`HOME_SHELL_ID`, admin-only on the daemon, reopens the running
shell, never read by the agent; `os-code/src/daemon/serve.ts`
`handleTerminalRoute`, `app/src/lib/homeShell.ts`); and a failed `/health`
now tells "can't reach your computer" from "it no longer accepts this device"
with a credential-free empty-claim probe. The phone's main menu already listed
Terminal. Gates green: app 1056 tests, engine 824, both typechecks, lint, the
Vite build.
