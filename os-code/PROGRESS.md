# PROGRESS

> The maintainers' running build log. New here? Start with the top-level `README.md` and `ARCHITECTURE.md`; this file is not required reading.

The recent-state source of truth for OS Code, kept to one rule: current state first, then what remains, then the log.

Older Current state sections and log entries are in `docs/progress-archive.md`
(newest first), and the parked build prompts in `docs/parked-ideas.md`, both
in the private `openshore-hq` repository under `openshore-code/internal-docs/os-code/`
since this one went open source (2026-10-11). Keep this file to one Current
state, one What remains, and the last five log entries
(`test/progressShape.test.ts` enforces the shape); an entry that rotates out
is appended to the archive there.

## Current state (2026-10-21 the security review: explicit grants, least privilege, and the small fixes; 2026-10-19 the Vault made plain and one tidy OpenShore folder; 2026-10-14 the security follow-ups; 2026-10-12 the model library, one pick per size for each job; 2026-10-12 sign-in without passwords, passkeys and App Lock, built behind their gates; 2026-10-12 many machines and Runs on, a project chooses the machine it runs on; 2026-10-09 bring your own keys, any provider, and keys on your server; 2026-10-11 open source under Apache 2.0, the pay gate removed; 2026-10-08 connect anywhere merged after the CTO review, docking to a computer or a server; 2026-10-08 v0.1.65 released with the CX and CMO rulings; 2026-10-08 CX and the CMO rule the open calls, built; 2026-10-08 v0.1.64 released for Linux and Windows; 2026-10-08 the release privacy review, fixed; 2026-10-08 the open follow-ups, built, and CI green again; 2026-10-07 image reading and desktop Offline; 2026-10-07 the review's directions, built; 2026-10-07 the UI/UX review; 2026-10-02 app actions only when asked; 2026-10-01 your writing voice and app actions; 2026-09-30 the Personal paid gate; 2026-09-30 the curated models on Apache weights; 2026-09-29 packages B and C, reviews from production's view and account deletion as one design; 2026-09-29 CTO 11, main matches production's migration history; 2026-09-29 the premium build; 2026-09-27 accounts and the privacy calls; 2026-09-27 release tiers, this build is Personal; 2026-09-27 v1 for the first-time person, built; 2026-09-27 Vault M8, the ship gate opened; 2026-09-27 Vault M7, the customization surface; 2026-09-27 Vault M6, Obsidian day one; 2026-09-27 Vault M5, context layer II; 2026-09-27 Vault M4, context layer I; 2026-09-14 the premium harness begun; 2026-09-09 Agentic Currents and Wayfinding; 2026-09-06 voice mode, the plan-first workflow, and video attachments; 2026-09-05 phone storefront, Crew routines, ethics layer, review remediation)

Newest first: the security review (2026-10-21; see the Log, What remains and DECISIONS: `0032_explicit_grants.sql` applied and push-send and repo-oauth deployed 2026-10-21); the model library (2026-10-12; see the Log, What remains, DECISIONS and `docs/design/model-library-plan.md`: the Local Library is a library by Stack category, each job a shelf with at most one pick per size of machine, every license commercial; photo editing, video, transcription, voices, music and sound are new Stack slots run by ComfyUI, a speech server, audio-separator and DeepFilterNet; sources beyond Hugging Face; a "Don't see your preferred model?" door to bring your own or ask support; on branch `claude/marketplace-library`, not yet on `main`), then Runs on made simple (2026-10-13; see the Log: the default machine replaces Active and the desktop's switch, Computer folds once docked, a chat names its machine), then many machines and Runs on (2026-10-12; see the Log, What remains and DECISIONS: a device docks to any number of computers and servers, at home or rented; each project chooses the one its coding chats run on in the project room's Runs on, and each chat goes back to the machine its session opened on; Computer offers your computer, a server at home and a rented server, lists every machine with its kind and size, and says what each server size can do; the server package and installer take arm64, and a cloud-init sets up several servers the same way; pushed to `main`), then open source (2026-10-11; see the Log, What remains and DECISIONS: Apache 2.0 with a CLA, a trademark policy and contributor rules that keep what ships and the names with Open Shore LLC; the OpenShore Plus gate deleted, so every room meets only the free sign-in; the Local Library back as a v1 room with reviews off; OS Code, the terminal CLI, supported again and packaged for npm as `os-code`; internal docs moved to openshore-hq; on branch `claude/open-source-apache`, not yet on `main`), then image reading and desktop Offline (2026-10-07; see the Log and What remains: a plan's image step with nothing set for Image reading says which model reads it, a picture nothing can read gets two doors to set a reader up, and the desktop and every session it hosts work on this computer's own models when there is no internet or Offline is chosen; pushed to `main` at d8fd423), then the review's directions, built (2026-10-07; see the Log, What remains and `docs/ux-review-2026-10-07.md`, Round two: the founder took all 23 recommendations, built in five packages, signed off by the Creative Studio and the CMO, and pushed to `main` at 8bcfaf5), then the UI/UX review with the Creative Studio and the CMO (2026-10-07; see the Log, What remains and `docs/ux-review-2026-10-07.md`: 125 polish items across every v1 room, eight UI guards, and 23 directions for the founder, since built), then the Personal paid gate (2026-09-30; see the Log and What remains: every room but Chats, Projects, the Stack, Cloud Connections and Settings is paid, with the free sidebar's gold Upgrade banner, behind the `VITE_PAY_GATES` build flag, off by default; Stripe on the desktop and the web, the App Store on iOS, $49.99 on both), then the curated models on Apache weights (2026-09-30; see the Log and What remains: Harbor and DeepBlue's floor move to Qwen3-4B-Instruct-2507, so all three curated models are Apache 2.0; the evals come later), then packages B and C of the closure memo (2026-09-29; see the Log and What remains: every review list reads production's `model_reviews_public` and Block names the review; `delete-account` is one design, main's planner and answer plus the legal-hold copy, with 0022's service-role functions for the all-or-none team delete, the operator-only tombstone and the email cleanup; the app reads either function's answers; one published address, support@openshore.ai since the founder's F1 of 2026-09-30, held by a test; the deploy is the runbook's 7.4, after the push), then CTO 11, main matches production's migration history (2026-09-29; see the Log and What remains: production holds 0001 to 0020, whose 0019 and 0020 are the privacy branch's files, now on main byte for byte and pinned in `supabase/production-history.tsv`; main's Org Vault v1 file is 0021, 0026 is new, CI replays production before pgTAP, and the next push is 0021 to 0026 from main), then the premium build (2026-09-29; see the Log and What remains: seventeen packages from a whole-codebase review, `docs/next-build-2026-09-29.md` and `docs/design/build-2026-09-29/`: every seat streams and stops, the engine budgets against the window a local model is really served, routines run offline, desktop updates are signed, secrets stay out of child processes, the account is complete with deletion, a free local chat on the desktop, and three premium features, long-running processes, rewind, and your Claude Code commands), then accounts and the privacy calls (2026-09-27; see the Log and What remains: chatting needs no account and everything else is a free sign-in, nothing resets signed out, eight preferences follow a signed-in person, web search asks once, desktop updates ask first, the guardrail record keeps a named person on the device, and the repository sign-in keeps nothing), then release tiers and v1 for the first-time person (2026-09-27; see the Log), then Vault M8, the ship gate (2026-09-27; see the Log and the ship gate in What remains: the device checklist is one list in `docs/vault-v1-device-checklist.md`, every must-fix finding maps to a named test in `docs/design/vault-v1-test-map.md`, and the docs and claims are swept), then Vault M7, the customization surface (2026-09-27; see the Log and the M7 follow-ups in What remains: a vault now carries its own conventions in `.oscode/vault.json`, a model's note says who wrote it and where, the person approves the exact bytes, and an empty vault can start from a simple layout), then Vault M6, Obsidian day one (2026-09-27; see the Log and the M6 founder gate in What remains: an existing Obsidian vault can now be searched, renamed and moved with its links following, trashed and restored, and read with Obsidian's markdown, images and PDFs), then Vault M5, context layer II (2026-09-27; see the Log and the M5 founder gate in What remains: every app seat now gets the pack sized to its window, a model switch hands over what it drops, the phone reaches the one vault on the paired computer, and each member of a shared hub works on their own root), then Vault M4, context layer I (2026-09-27; see the Log and the M4 founder gate in What remains: each engine task now starts with this project's Current State, sized to the served window, with private notes judged by address), then the premium harness (2026-09-14, below), then Agentic Currents and Wayfinding (2026-09-09, below), then voice mode (2026-09-06), then the plan-first workflow and video attachments (2026-09-06), then four pieces from 2026-09-05 built in parallel sessions and merged here: the phone storefront, Crew routines, the always-on ethical guardrail layer, and the full-codebase review remediation (its state section moved to `docs/progress-archive.md`; its open items stay in What remains).

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

Three curated, harness-trained models, and the Local Library grayed to "Coming
soon" (Sidebar, desktop and phone). The lineup: Harbor Lite (built-in phone
guide), Harbor (recast from the Qwen3-1.7B guide to a Qwen2.5-Coder-3B mobile
coder, web search kept, Harbor Lite now the sole guide; on Qwen3-4B-Instruct-2507
since 2026-09-30), and DeepBlue (the desktop coder, the rename of the Harbor
Master slot with Qwen 2.5 Coder 32B as the flagship over 14B/7B and, since
2026-09-30, Qwen3 4B as the floor). Stock Qwen today, each a harness training
target, all Apache 2.0.
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
  one hardware-fit local pick with one tap to set it up and the Local Library one
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
- **macOS: unsigned, outside the App Store (founder call). SHIPPED 2026-09-17.**
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

- [ ] **The security review of 2026-10-21: the founder's steps.** DECISIONS 2026-10-21. Migration `0032_explicit_grants.sql` was applied by the founder in the SQL editor on 2026-10-21 (from main at e602256, one transaction with its history row; both cron jobs checked as postgres first) and is pinned in `supabase/production-history.tsv`. `push-send` and `repo-oauth` were deployed by the founder on 2026-10-21 from main at 1c72e44 (CLI 2.118.0 through npx, `--use-api`); repo-oauth behaves as before until the secret is set. Once the build that sends the token is what people run, set `REPO_OAUTH_REQUIRE_SIGN_IN=true` on repo-oauth and, if wanted, `CORS_ALLOWED_ORIGINS` (it must list the app's own origins first). Later: drop `user_entitlements` and `apple_links` after delete-account, the export and stripe-portal stop reading them; delete-account's recent sign-in (F2) needs an email-code step in the deletion sheet; a repo-oauth rate limit needs a stored counter. Check CI's new `sql-strict` job on its first run (it installs pgTAP from apt on the runner).
- [ ] **The Vault made plain, and the folder by room: device checks (2026-10-19).** `docs/design/vault-room-clarity-2026-10-19.md`; DECISIONS 2026-10-19. Founder, device: on the desktop, How you keep notes marks Here now on OpenShore's own folder, then on an Obsidian vault picked through Choose folder, and Use this goes back (the sheet offers Bring); a desktop with `~/OpenShore/Projects` and `Models` from the 10-16 build starts with `Repositories` (a link left at `Projects`, every project's repository still opening) and `Local Library`; on an iPhone, docked and not, the three ways and their Here now, Only on this phone stopping the note sync while chats still sync, and a model downloaded before the update found in `Local Library` without a download (no Swift build runs in CI); Settings, Vault folder: choose an Obsidian vault, see it read Obsidian vault, then Use OpenShore's folder. Open call: a read-only copy of the agent's repository notes in `Vault/Projects/<project>` for Obsidian (the doc's last section).
- [ ] **The model library: licenses, device checks and follow-ups (2026-10-12).** `docs/design/model-library-plan.md`; DECISIONS 2026-10-12 (the library). Founder, licenses (the plan's list): Gemma 4's license page is read and it is Apache 2.0 (cleared 2026-10-13); the Health shelf stays (founder, 2026-10-13) with counsel to answer MedGemma's indemnity and distribution questions; accept the SAM License and approve its shipped text (in NOTICE); register Open Shore LLC under Stability's Community License (under $1M) for Stable Audio 3; add the CC BY 4.0 attributions (Parakeet, WeSpeaker), the OpenMDW-1.1 notice and the Apache and MIT notices to `NOTICE` or the acknowledgements; ask Lightricks for a written OK on LTX-2.5, send the Qwen3.8-Flash-Next license to be read, and put the one distribution question (with HAI-DEF's indemnity) to counsel (VibeVoice-ASR is excluded; Get now asks the person to accept a gated license, 2026-10-13); confirm the license of each file a pick pulls from another repository (FLUX.2 klein's VAE from the FLUX.2 dev repack, the lightx2v Lightning LoRA, shared text encoders). Publish: the first `catalog.yml` run that writes `catalog.v2.json` beside the narrowed `catalog.json`, with every media file pinned (until then the app shows the bundled library, whose media Get refuses unpinned files); GitHub published no digest for LaMa's 2022 asset, so its SHA-256 is pinned by hand in the seed (344c77bb...9ea9, hashed from the release file on 2026-10-13; check it against the md5 e3aa4aaa... the LaMa publisher lists). Device: each ComfyUI graph on a real ComfyUI 0.39 (node names come from the official templates), the LaMa node pack, SAM 3.1's text prompt; LocalAI's gallery ids and its diarization answer; DeepFilterNet's 2023 package on a current Python; the phone picks' GGUFs (Qwen3.5, MiniCPM5) in the iOS llama.cpp build; BFL's fp8 file for FLUX.2 klein 4B without a gate; every Ollama tag, Qwen3.8's 8-bit tag above all; the store front, a category page and the request sheet on an iPhone and in Electron, and Get for a media pick on a desktop with ComfyUI. Follow-ups: a paired phone's Stack showing the computer's media placements; transcript cards for a media job's output; whether to name LocalAI's gallery hosts on the egress list; a per-pick eval on the reference box before any copy calls a pick better (tenet 2). Founder, the review's follow-ups (built 2026-10-13): run `node app/scripts/release-keygen.mjs catalog`, save the private half as the `CATALOG_SIGNING_KEY` repository secret and paste the public half into `CATALOG_PUBLIC_KEY` (`os-code/src/market/catalogSignature.ts`), in that order, so the next catalog run signs and every app checks; confirm the FLUX.2 VAE's Apache 2.0 on its card (the lightx2v Lightning LoRA's card says Apache 2.0, named in the seed 2026-10-13, so Qwen-Image-Edit 2511 publishes at the next catalog run). Device: the labels in a real ComfyUI MP4 and FLAC, a LocalAI MP3 and WAV, and a deepFilter WAV (each read by a common player and still playing); Remove with Take out and delete on a desktop with two models sharing an encoder; Made here and Clear.
- [ ] **Sign-in without passwords: the founder's steps (2026-10-12).** `docs/passwordless-runbook.md`, DECISIONS 2026-10-12. Migration `0031_passwordless.sql` (written as 0028, renumbered 2026-10-14 when 0029 and 0030 went in first) is APPLIED (2026-10-14, the founder's call with no users yet, ahead of the SMTP sender), so until that sender is set up, sign-in codes go through Supabase's built-in email and its low hourly limit. In order: an SMTP sender with click tracking off (and its line in the privacy policy); deploy openshore.ai so `/sign-in/continue/` is live; the codes and the two email templates in the dashboard (not `config push`: config.toml's `site_url` is local); set up the App Review mailbox and the notes; when wanted, passkeys (Associated Domains on the App ID, the Team ID to Claude for the entitlement and the association file, `[auth.passkey] enabled = true`, `VITE_PASSKEYS=1`); App Lock on a device. Follow-ups: passkeys and App Lock on the desktop.
- [ ] **Many machines and Runs on: device checks and follow-ups (2026-10-12).** DECISIONS 2026-10-12. Founder, device: dock a phone to the computer at home and to two servers (one rented, one at home), give a project Runs on a server, start a chat there and see the session, its terminal, its repositories and its model menu on that server while the Vault and Crew stay on the active machine; switch the active machine and reopen the chat (it goes back to its server); forget the server (the project follows the device again, the chat says where it ran). On the desktop: dock a server from Computer's "Run projects on a server" (nothing moves until a project chooses it), keep one project on This computer, and with no local model see no First Seat in a project on the server. Release: the first `release.yml` run with `package-server-arm64` (an arm64 asset beside the x64 one, both signed), then the installer on an arm64 shared-vCPU server, and the cloud-init pasted at a provider's create page with a one-off Tailscale key (the installer prints the pairing command, then `osc pair --server` over SSH). Follow-ups: a chat bar line that names the machine a chat runs on; Crew routines and the Vault per machine (today they follow the active one); the Chats list reads only the active machine's sessions; an app-side Ollama offer on a server (the proposal's fit-aware pick); and a GPU line in the machine facts once a server's engine can see one.
- [ ] **Bring your own keys: device checks and follow-ups (2026-10-09).** `docs/design/byok-any-provider-plan.md`, `docs/security-privacy-review-2026-10-09-byok.md`. Founder, device: connect each named provider with a real key and read its model list (the list shapes of Groq, Together, xAI, Nebius and NVIDIA are modeled on community code, not pinned from a real answer); the key-page links (Hugging Face's fine-grained token page, the console roots); Connect a model against a real Anthropic-format address and a LiteLLM gateway (the guide's commands came from LiteLLM's source, its docs site was unreachable here); on a rented server, `osc key add openrouter`, place the model, start a coding session and read its card; the server keys sheet from a phone, and forgetting a server. Follow-ups: wrap the file key on a server (systemd-creds or a passphrase; the credentials file there is locked with a key derived from the machine), the engine's own forwards-to-a-cloud mark, a per-provider key check where a provider documents one (Hugging Face whoami, OpenRouter's key route), dollar prices for non-Claude models, kind-based judges for the image-ask card and the per-turn reach dot, and a pending-leave retry if the app is killed while forgetting a server.
- [ ] **The 2026-10-08 privacy review and the CX and CMO rulings: device checks.** `docs/security-privacy-review-2026-10-08.md`; DECISIONS 2026-10-08 (privacy review) and (CX and CMO, for the founder). The open calls are ruled (CX and the CMO, A to K) and built. Founder: align the marketing site, the privacy policy and App Store Connect with the new strings (the promise's two sentences word for word, the camera, microphone and speech wording, no "home network" Ollama line, no "asks before it spends" or "a cloud model runs only when you choose it", and no image-step exception). Rulings, device: a placed cloud specialist's amber card once per task per model on the desktop, and its Cloud chip and amber reach; a project-memory write asking after a private read even in Accept edits; a search or page fetch after a private read asking every time with the exact words; the placeholder line once per cloud model; a private pin's lock, the line under the list and the refusal naming the pin; Runs the show and Specialists chips (Cloud, On this computer, On your network) at 720px; Install by name a cloud tag; a Local image reader failing on a picture and the Cloud card; a private plan's edit step on a computer running 0.1.65 or later. Device: on the desktop, pull `kimi-k3:cloud`, place it and read its card (ollama.com, never localhost), choose Offline with it placed, check the secrets gate and a Private/ read on it, and `osc doctor`; Windows and Linux, Offline chosen and Start with your computer on, restart: the phone reads offline by your choice before the window opens, and the `offline-chosen` marker comes and goes; iPhone and iPad, the new camera, microphone, speech and local network prompts; a vault picked inside a project on a Claude seat (readFile, grep, glob, Trash, a runShell card in Bypass), and on a local seat then back online; a plan with a private pin and a cloud specialist, and with a cloud image step; the image-reader guide's way back on each OS; the Stack's Image reading rows with a LAN reader in Local. Follow-ups: `tailscale serve` for Ollama; search on result-only backends and page fetch after a private read; the person's own command output on a seat that stays; vault dot folders (plugin caches); a workspace that links to the vault; excluded names in gitStatus and the code map; spend for cloud tags and plan steps; the v2 currents' handoff refusal; old handoff files; `node --check` on ESM; align the site, the policy and App Store Connect with the new strings.

- [ ] **Image reading and desktop Offline: device checks and follow-ups (2026-10-07).** DECISIONS 2026-10-07 (founder), (image reading) and (desktop offline). Device, image reading: on an iPhone, a LLaVA connection on Ollama's `/v1` over the tailnet reads a picture through the native-shim fallback (Ollama refuses the `capacitor://` origin at the preflight), and Moondream's 2048-token window holds a picture plus the Stack system prompt; the offer card, its two guide chats and the play's note on a phone. Device, desktop Offline (Electron on Linux, Mac and Windows): Wi-Fi off flips the lone Offline pill within about 3 s, and again on wake; Wi-Fi off mid-stream on a cloud orchestrator shows "Could not reach Claude. Trying again in 2s." or the offline note, then a local answer, and Wi-Fi back brings "Back online." and the cloud seat; an all-local stack says nothing and offers no web search; an idle `/compact` on a cloud seat runs local; the modem's WAN unplugged ends cloud turns on the plain "Could not reach Claude from your computer" line, and Choose Offline then moves work local; the window closed to the tray with a paired phone; Offline chosen while online (an engine chat goes local, the banner and Follow the connection, Automatic undoes it); Install DeepBlue with its progress, leaving Claude seated; pulls and Cloud Connections' Save with Wi-Fi off; rooms switching offline in a packaged build. Built 2026-10-08 (the follow-ups log entry): the daemon tells a paired phone the computer is offline, the rooms read every local provider by address and name the offline seat, a pull failing with the network up has a plain line, the ask-first card names a set model, a play's task list names the model that runs each step, an offer-only turn has no success haptic, and the working row's long note reads whole. Device, those: a paired phone on a LAN or tailnet path to an offline computer (Docked, the offline lines within one 20 s poll, Chat with your computer hidden under a cloud orchestrator); Offline chosen on the desktop read on the phone; a hosted OpenAI-compatible provider listed before Ollama; real failed pulls on each OS (a misspelled name, an old Ollama, a full disk, a LAN with no internet, Wi-Fi cut mid-download); the three-line image note and its exit on an iPhone. Still open: a LAN with no internet beyond it reads as online (cloud turns end on the plain line and the person chooses Offline; a per-task local fallback is a decision); text a failed cloud stream already showed stays above the local answer; a phone has no read of the paired computer's memory, so the image card passes no fit and Moondream never leads alone; no thumbnail in a sent picture's bubble (a sent message keeps only its text, so it needs a stored preview, a decision under the Proton standard); the desktop chat banner says models here still answer when none can (the store reads the engine's status only at launch and after installs); the phone's model sheet reads `/stack` once per open, and its offline lines trail the computer by up to the 20 s poll; the phone's Stack note says the computer's cloud models wait even when it has none (`/stack` carries no specialist kinds); other daemon routes still read the config from bind time; for the CTO, a play's image step takes a phone Local slot before a usable Cloud slot (`ownerFor`), and the planner's roster still counts a phone model as a specialist.

- [ ] **UI/UX review: a device pass and the open follow-ups (2026-10-07).** `docs/ux-review-2026-10-07.md`. The 23 directions are ruled (founder, 2026-10-07: "Do the remaining recommendations") and built as recommended, on `main` at 8bcfaf5, one DECISIONS line each; D12 and D15 are ruled as no change. Device: the press dip and keyboard rings at normal motion on the desktop; the iPhone's keyboard and touch (hover gating, the field ring, the First Seat offering Harbor, the composer row at 360 to 430 points, the 44pt drawer rows, Get Tailscale without Android, Pairing's tuck, a swipe row at rest); the desktop Stack, DesktopPair and the other Electron-only surfaces; the terminal's ready state and the live terminal's doors on a paired phone (asleep, revoked); D5's glide and group in the Electron build; D6's round button and D18's crew swipe on an iPhone; D1 on a paired phone and on the Electron desktop (and pointed at a remote hub); the desktop bar buttons (D11) and the named image reader (D13) in Electron; an iPad in landscape at 900pt and wider, and "this iPad" on a real iPad; D21's switch at normal motion; the Vault wash in light, and D8's next step (teal for private only) once the founder has seen the pass. Open, in the doc's last section (the rest built 2026-10-08): the composer pill names the provider while the reply names the model; the phone Stack's Offshore and Offline switch beside Choose Offline; the Stack's engine step ignores the permission mode; the Local image reading sheet lists a model at a public address; "your iPhone or iPad" in Apple's own steps.

- [ ] **Vault v1 ship gate (M8, 2026-09-27).** Device checklist (plan 8.1, ship gate 4): `docs/vault-v1-device-checklist.md`, the one list, merging the plan's 8.1 lines with the device checks M1, M4, M5 and M6 left here (the folder and Obsidian on the desktop, iCloud on two devices and from a Mac, the iPhone opening an Obsidian vault in place, a two-member team vault, iOS export, a paired phone on "Your computer", a cloud to Harbor to desktop-agent switch with a handoff, a real Obsidian fixture vault, the M6 touch checks); tick every line on a device before v1 ships. Must-fix map (plan 8.3): `docs/design/vault-v1-test-map.md`, all 101 v1-must findings: 97 covered on `main`, 2 on the held team branch (orgvault-4, orgvault-7), 2 device-only (truth-22, truth-23), none missing (orgvault-19 is held by `os-code/test/vaultClaims.test.ts`; 0010's stale header stays, an applied migration is never edited). Until 0021 (Org Vault v1, main's old 0019) is in production, three team writers on one note in one minute can still fold two conflict copies (orgvault-3), so no copy says the team vault never loses work.
- [ ] **Founder gate, Vault evals on the reference box (M4, M5, M6; tenet 2).** Per class (tiny and small local, large by an approved reference run): `osc eval --deep --vault-pack on|off` and `--num-ctx auto|off` (score, turns, input tokens, wall time, prefill cost); `vault-continue-handoff` with `--handoff on|off` (D12, before any copy says "picks up where you left off"); `--prompt-cache on|off` on a large run (input tokens, cache reads and writes, dollars per completed task; the dollar rail does not yet price cache reads and writes, so price them first); and the K16 numbers at 5,000 notes (title and switcher hits under 16 ms a keystroke, filtered body search under 50 ms warm, the bare two-letter prefix search against 50 ms, about 22 ms on the build machine, a 50-source rename plan under 300 ms on the folder, the outline under 5 ms, a 100 KB note's render under 50 ms). Record them in DECISIONS and here before `PACK_BY_CLASS` (each class in its own commit citing its DECISIONS line), `numCtx`, the handoff layer, or `promptCache` flips. Until then every class gets Current State only and no `num_ctx` is sent unless set. Pack budgets stay the placeholders DECISIONS records (M8 entry) until these land.
- [ ] **Team vault: before the teams switch ships (2026-10-01).** The team client is on main behind `featureOn('teams')` (tier 4). Nine low findings from its edge-case review stay open and must be fixed first (DECISIONS, 2026-10-01): E47 (an OV402 before the plan is read makes an admin read as a member), E48 (the fake server's overwrite snapshots, `org_vault_path_ok` and non-member RLS), E49 (Trash row after a renewal), E50 (a passed deadline in a never-paid team's notice), E52 (the expired sign-in's kept note is never on screen), E53 (personal-provider tests pinning the personal vaults' new refusal and gone lines), E54 (each room on its own vault's settings after a scope switch), E56 (DECISIONS reasons for changed main lines). Then one re-review of the whole client (the review's lenses: durability, privacy, concurrency, refusals, plan and role states, integration), and the device checklist's team lines on a tier-4 build.
- [ ] **Founder gate, the held Vault branches and the team migrations (M2, M6, M7; CTO 4 and CTO 11).** **0021 to 0026 APPLIED 2026-09-30:** the founder ran each file in the SQL editor from main at 4ffe370, one per run, bytes unchanged, with a guard above it and its history row in the same transaction; the check that followed matched all 31 function bodies by md5 and found the three cron jobs, and `production-history.tsv` has the six rows (DECISIONS, 2026-09-30). `delete-account` DEPLOYED 2026-09-30 from main at 81253d0 (runbook 7.4; the no-sign-in check answered `{"error":"unauthorized"}`, main's function). PR #1 (the team client) merged 2026-10-01 after the edge-case review, dark behind `featureOn('teams')`; `vault-m2-icloud` and `vault-m2-native` have main merged in and stay held for their `xcodebuild test` runs. The plan as it stood before the push: Follow `docs/vault-gate1-runbook.md`, the one verified sequence. Production holds 0001 to 0020 (the founder's `schema_migrations` query, 2026-09-29), and its 0019 and 0020 are the privacy branch's files, pinned with main's copies in `supabase/production-history.tsv`. Migrations go to production from `main` only: one push applies exactly 0021 to 0026 (`0021_org_vault_v1.sql`, main's old 0019 with its bytes unchanged; `0022_account_deletion.sql`; `0023_org_free_caps.sql`; `0024_org_vault_move.sql`; `0025_org_vault_settings.sql`; `0026_export_and_retention.sql`), with `--skip-vault`, after every preflight in the runbook (the history equal to `production-history.tsv` through `supabase/scripts/push-preflight.mjs`; the Vault secret present; 0021's case duplicates; teams 0025 makes read-only; the two `abuse_reports` queries for 0022; the guardrail retention job, which 0026 schedules if pg_cron was off), then `supabase functions deploy delete-account --use-api` (runbook 7.4, main's merged function, only after all six applied; the runbook first checks that the live function is the 2026-09-24 one), then the checks and the rolled-back smoke test (25 checks). The interaction review's (a) 0023's refusal copy is fixed in 0023 itself, and (b) the deletion race and (c) a deleted person's email in `org_project_members` and pending invites are fixed in 0022's section 6 (package C). Then Claude appends the six rows to `production-history.tsv`, merges main into `vault-m2-team`, `vault-m2-icloud` and `vault-m2-native` (the rename flows through), retitles draft PR #1, and merges it once its `check`, `sql`, `sql-replay` and `migrations` jobs are green on current `main`. The founder sets the date in `no_entitlement_vault_until()` when pay gates return (null in the beta, at least 30 days out). Merge `vault-m2-icloud` and `vault-m2-native` after one recorded `xcodebuild test` run of their Swift tests (each branch's DECISIONS entry lists the Swift work still to do). Still the founder's call beside it: the CFO's seat-ceiling dissent (DECISIONS 2026-09-05).
- [ ] **Vault known limits and follow-ups (M1, M7; 2026-09-27).** A note save through `writeNote` carries no Finder tags or other xattrs; a write landing between its guard check and its rename is overwritten (no lock is shared with Obsidian); on Linux the created date resets on each save. Routines follow config `memory.enabled`, not the app's Memory switch; a daemon session revived after a restart does not keep the app's `memory: false` (nor `humanize` or Chain of Thought). Not built: CX's fork card (the move-mode sheet opens instead), and caching Linked mentions across opens above 1,000 notes. The app cannot show "This project's settings turn this off." on Notes in chats and Handoff (the engine still enforces the project's off): an honest line needs the app to read the active project's config on demand (a main-side read on the desktop, a daemon route on the phone), since a session's report goes stale and a project can span several repos. (M8 closed the rest: play-step sessions carry `vaultOverrides`, the sheet names the computer's own Room for notes, the Trash page crossfades both ways.)
- [ ] **v1 is Personal; built, waiting on the box, the device and the founder (2026-09-27).** `docs/release-tiers.md` (v1 Personal, v2 Currents/Stack Health/Launch, v3 Local Library, v4 Enterprise); `docs/v1-direction-review.md`. Box: `osc eval --floor`, then record the table before `numCtx: 'auto'`, `harness.verify.pageCheck` or `detect`, or the floor model changes. Founder or Board: the $50 vote (ruled 2026-09-30: $49.99 on both rails) and the `VITE_PAY_GATES=1` review build (the paid gate item below); Apple setup (the root certificates in `supabase/functions/_shared/apple.ts`, `APPLE_BUNDLE_ID`, `APPLE_APP_APPLE_ID`, `APPLE_PRODUCT_IDS`, the product, the notifications URL, a sandbox purchase and restore); the signing secrets. (The account rule and the four egress calls are made: see the accounts item.) Device: undo from the desktop and the phone; the owner granting a check from the phone; the First Seat on a Mac and on Windows with no Ollama; the sample page; the terminal over Tailscale with the new failure lines; a Crew routine's push with the app closed.
- [ ] **Going public (2026-10-11).** DECISIONS 2026-10-11. The runbook is `openshore-code/GO-LIVE.md` in the private `openshore-hq` repository. Done: the code is published as a fresh repository (the old one is renamed `openshore.code.ai-old` and stays private), holding only `main`, the tags and the CLA branch, cleaned of internal docs and the founder's personal email and checked with a history scan; Apache 2.0, the CLA and trademark files, fork-safe CI, the Local Library as a v1 room, OS Code the CLI packaged for npm, the site and README copy (live). Founder, in order: turn on secret scanning and push protection and make the repository public; add the `NPM_TOKEN` secret and tag `cli-v0.2.0`; add the release and catalog secrets when the next release needs them; delete the old repository once every secret value is safe elsewhere. After launch, not blocking: a lawyer reads `CLA.md` (name the governing state) and `TRADEMARKS.md` and the trademark is filed; the security items kept privately in hq (`openshore-code/security-open-items.md`): 1, 2, 3, 4, 6 and 7 are built (2026-10-14); the function secret is set, `push-send`, `push-grant` and `push-unregister` are deployed, and 0029 and 0030 are applied (all 2026-10-14). Superseded: the Personal paid gate founder steps (2026-09-30), whose code is gone.
- [ ] **The premium build: founder gates and device checks (2026-09-29).** Built and on `main`; `docs/design/build-2026-09-29/` holds each package's notes (What remains with file:line) and the advisor rulings. Founder, once: release signing DONE 2026-09-30 (`docs/release-signing.md`: the keygen run, `OPENSHORE_DESKTOP_SIGNING_KEY` in GitHub's `release` environment limited to `main` and `v*`, `OPENSHORE_MAC_SIGNING_KEY` in Codemagic's `openshore-mac-signing` group, both public keys pinned in `app/electron/releaseKeys.ts`; seen 2026-10-08: v0.1.64's sign step says `Signed` per file with the pinned desktop key; still to see: the first Mac build, started by hand in Codemagic, signing its zip and dmg); 0021 to 0026 are applied and `delete-account` deployed (2026-09-30); paste the AppleRootCA-G3 root into `supabase/functions/_shared/apple.ts` before a build sets `VITE_PAY_GATES=1` (`app/scripts/check-apple-roots.mjs` stops a selling iOS build without it); the Windows code-signing certificate stays optional (every build after the first signed one must be signed); triage the first `windows-latest` CI run by `skipIf(win32)` with a reason, never a looser assertion. Box (tenet 2): `osc eval --deep --floor` with `--retrieval on|off` and `--union-decoding on|off` on the reference box before either default changes; the lean small-seat prompt's with-and-without number. Device: streaming and Stop on a BYOM Ollama seat on the desktop and over the tailnet on the iPhone (a cold 7B past 60 s on WKWebView), a direct Perplexity and Moonshot chat, a signed Mac update end to end and a rollback after two minutes, the three native confirm dialogs on each OS, a routine that wanted the web and its offline note, the commit card under Tokens and Secrets with a `.env`, the window card's Give it more room, the First Seat on the reference box with Ollama absent and signed out, rewind with files and chat only, a dev server started by the agent with its Open link, a repository's `.claude/commands` in the menu, account deletion on TestFlight, sign out on one device leaving the other, two devices changing two preferences. Known limits: preferences have no server compare-and-swap; DNS rebinding is judged, not pinned; simple-git calls inherit the environment; MCP servers, hooks, subagents and vision on desktop sessions wait for a design pass; the store split's pilot (Launch and Repositories) opens the next build.
- [ ] **Privacy branch harvest (CTO 11, 2026-09-29).** `claude/openshore-privacy-mobile-1ij12h` is never merged whole (it rewrites PROGRESS and DECISIONS from a September 21 base and conflicts with main on the 3B). Its migrations arrived as package A, and packages B (reviews) and C (deletion) are built on `prod-reconcile` with it (closure memo, 2026-09-29; DECISIONS). Left for the branch's own PR after C: Download my data in the app (the server's `export_my_data` already covers `org_vault_revisions`, `org_vault_settings`, `enforcement_tombstones`, `push_sends` and `likeness_consents` in 0026), the owner flow (F2), refunds (F3), the ten-minute re-sign-in with its sheet, and that branch's app moving to main's `delete-account` contract; after B: the raw-average display (the 2026-09-24 ratings ruling's app half beyond the view). The rest, in order, each ported onto current `main` by the session that owns the area, merging main before touching `supabase/` (any new migration takes 0027 through the guards): D, app compliance (compliance session; re-check each against main: `PrivacyInfo.xcprivacy`, 18+ and terms consent, paywall disclosures and WCAG fixes, voice consent, `keySeal.ts` wording, `ethics.ts` no longer sending allowed-with-assertion rows); E, legal drafts for counsel (legal-docs session; `docs/legal/` and the terms edits, docs only; they must say what a deletion keeps: the legal-hold copy in `deletion_holds` until its hold ends, and for an operator's confirmed termination a tombstone under a hash of the email for two years, which main's Terms do not mention yet); F, the Qwen 3B pull (waits on F5); G, DeepBlue and eval docs (eval session, low priority, port what is still true). When B to E are on main, record in DECISIONS that the branch is superseded, keep it, and tag `d3d4bb7` as `prod-source-0019-0020` (a push; the founder's go-ahead).
- [ ] **Founder decisions from CTO 11 (2026-09-29).** F1, the published appeal and contact address: DECIDED 2026-09-30, support@openshore.ai (its round-trip test passed); 0022, the app's `SUPPORT_EMAIL` (block card and Delete account sheet) and `docs/terms-of-use.md` all say it, held together by `app/test/contactAddress.test.ts`; switching again after the push takes a new migration plus the constant and the Terms. F2, the owner flow at deletion: the 2026-09-24 flow (transfer or delete inside it, "Cancel renewal instead" first) or the 2026-09-29 `owns_org` refusal; the CTO recommends the 2026-09-24 flow, built in package C; not blocking gate 1. F3, refunds at deletion, with the CFO and counsel: a team's latest invoice refunded within 14 days; a personal plan cancelled now or at the period's end. F4, counsel: whether Download my data includes a report prepared for 2258A; default no, and copy never says "everything". Also F4: a report still queued when its subject deletes the account keeps no underlying rows, since the hold starts when the report is submitted (the live function does the same); preserving earlier is the privacy branch's PR if counsel wants it. F5, the Qwen 2.5 Coder 3B license (the 2026-09-24 ruling pulled it; main keeps it open); package F waits on it. F6, three facts: the founder ran the 2026-09-24 push, and the live `delete-account` is the privacy version (deployed that day); still open, whether anything else went from that branch and whether a privacy-branch app build reached testers. Done 2026-09-30: the go-ahead for packages A, B and C to land on main, and the runbook's section 0 (history, Vault key, leftovers, pg_cron and both jobs, 4.2 to 4.5 all clean); the push itself (0021 to 0026 in the SQL editor, 2026-09-30; DECISIONS), and the `delete-account` deploy (2026-09-30, main's function answering).
- [ ] **Accounts: before the App Store build carries the gate (2026-09-27).** `docs/accounts-cx-memo.md`; DECISIONS 2026-09-27. In-app account deletion is BUILT (2026-09-29: `delete-account`, `0022`, the Settings row per CX 3; one design since package C) and is live: 0021 to 0026 applied and main's function deployed, both 2026-09-30 (production runs the privacy branch's 2026-09-24 function until then, and a build from main reads either one). Its known gaps: when either function answers `unauthorized` or `not_signed_in` and the auth server cannot say either (offline, a 5xx, `bad_jwt`, a 401 or 403 with no code), the account may be gone or not, so the double failure reads unconfirmed, not failed: the sheet says "We could not confirm whether your account was deleted. Check your connection and try again." and leaves the device as it was (second review, 2026-09-30); a retry settles it; and a team that turns active between the plan and the team delete gets `owns_org` after its Stripe subscription was already cancelled, with copy that does not say so (DECISIONS, known limit): before a `VITE_PAY_GATES=1` build, answer a distinct code with a line that the team's billing was stopped, or have support restore it; the free desktop chat is BUILT (CTO 8). Not built: "Also erase this device" (CX 3 puts it beside Clear conversations, not in deletion). The signed-out reset is not built on CX's advice; the founder can overrule (reset only the `follows` keys in `app/src/lib/settingsReach.ts`). Device: sign in on two devices and watch a theme change arrive; the gate sheet from each locked room, signing in carrying on to it; a first message typed on a signed-out desktop coming back to the composer; web search's ask sheet once, then never; a Windows update waiting for the click. Know without telemetry: accounts per install weekly, support mail tagged "lost settings", "why sign in", "where did my projects go".
- [ ] **Repositories: reconnect GitHub, then a device pass (2026-09-25).** iPhone, Repositories: tap Reconnect GitHub on the GitHub card; the picker then lists private repositories (openshore-hq). Clone it from the picker and confirm a new chat works in it. Before others connect: make the GitHub App public; add `VITE_GITHUB_CLIENT_ID` as a repository variable.
- [ ] **The curated models on Apache weights: evals and checks (2026-09-30).**
      Box: `osc eval --floor`, then record the 4B in `curation/eval.json`,
      flip the seed's `qwen3-4b` to `orchestratorCapable: true`, and re-run
      the guide eval (`fit-8` now expects "4b"). The Hugging Face URL and the
      Ollama tag were confirmed by the founder. Device: a 6 GB iPhone gets
      Harbor; a phone with the 3B drops it at launch. Known cost: a 4 GB CPU
      computer reads too big for DeepBlue.
- [ ] **Harbor Lite's guide harness: a phone pass (built 2026-09-24; box
      number in, `docs/guide-eval-2026-09-24.md`).** On a phone: a web
      question shows "Searching the web" and cites; an app question stays
      offline; "I have 16 GB" gets the 7B line. Rerun `eval:guide` on the box
      after card changes (about 100 minutes per model there). Stale copy found
      alongside: the Settings privacy sheet still calls Harbor Qwen3-1.7B and
      "not a coder"; AccountSetup and Paywall still advertise the $20 unlock.
- [ ] **Mac desktop updates: prove on a real Mac (built 2026-09-23, founder has
      no Mac yet).** Windows and Linux update from any push to main with no
      Mac involved; until this is done, Macs simply see no update. Needs a Mac
      to: run `pnpm --filter oscode-app release:mac` once (builds, stamps the
      version, uploads the dmg and zip), install that dmg into /Applications,
      then publish a newer release with a Mac build and confirm the top bar's
      one click downloads, swaps, and relaunches (`electron/macUpdate.ts`, both
      the zip and the dmg path). Optional after that: set CODEMAGIC_API_TOKEN
      and CODEMAGIC_APP_ID so every release gets a Mac build without a Mac on
      hand (`docs/MAC-DESKTOP.md`).
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
      `docs/design/project-room-redesign.md`.

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
      TestFlight: tap Set up Offline on the Local Library (both downloads land,
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
- [x] **Personal at $50/yr with the gates reinstated (founder, 2026-09-05).**
      Done 2026-09-30 as OpenShore Plus; see the paid gate item above.
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
- [ ] **Apple link status from the App Store Server API (BE-4, long term).** The 2026-09-05 fix keeps subscription state on `apple_links` and refuses a stale JWS; the durable answer is a live status call with the `.p8` the README reserves, so a refunded purchase can never be replayed.
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
      workflow shipped every push to `main` until 2026-10-01 (by hand since); 62 had reached
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
- [x] **Local Library popularity axes + landscape breadth.** Two honest axes plus
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
  product (a second webhook belongs to it); each webhook
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
- [ ] **Your writing voice and app actions: the engine and a device pass (2026-10-01).** The voice rides every app-side seat but not a desktop engine session: thread it as a session switch (`BootstrapOptions`, the daemon's create route, `osc:` bridge, `electron/main.ts` and `engineHost.ts`) the way `humanize` rides, into the loop's prompt beside the humanizer's notes. New app actions join `APP_ACTIONS` in `app/src/lib/appActions.ts` (one entry each, with its own value check; never a key, an address, a consent or anything that loosens a gate). Device: Shape it in a chat on Harbor Lite and Harbor, the card's Add to Settings, a reply in the new voice, and a cloud seat's reply carrying no card.
- [ ] **Cross-device vault (CTO, 2026-10-02).** iCloud Drive after `vault-m2-icloud` gets compare-and-swap and its recorded `xcodebuild test` run, then `ICLOUD_HELD` flips; end-to-end encrypted account sync is a later-tier design, a design note and the full security and privacy review before any table exists.
- [ ] **Connect anywhere: a real server, the live lists, a device look (built 2026-10-07).** `docs/design/connect-anywhere-proposal.md`. Release: the first run of `release.yml` with the server package (pack, smoke, sign, publish beside `install-server.sh` on `openshore-releases`); an arm64 package. Server: on a fresh Ubuntu VPS with Tailscale, run the one command, check the signature line, dock an iPhone from Computer and from Cloud Connections, type y at the terminal, see "Your server" in the model menu and Stack, open its terminal, reboot the box and see it come back; dock the desktop to it under More options. Providers: connect Venice and OpenRouter on real keys, check the live lists, the first picks, Choose models, a streamed chat and Stop on each, and that the Venice taglines match what its `/models` says (`privacy`); OpenRouter's optional `HTTP-Referer`/`X-Title` headers are not sent (the Electron stream guard drops them). Device: the four path tiles, the server steps and Copy, the new names. Later, on its own go (proposal part C): "Rent one for me" through a provider's API; a GPU server's spend line and "Stop the model"; `osc eval --deep` on a reference VPS before any server copy names a model or a speed (tenet 2). The account gate still asks a signed-out person to sign in at the Computer room's door (`ROOM_ACCOUNT.pair`), which "free" did not change. CTO review follow-ups (2026-10-08): a server's loopback could still be squatted in the moment before the daemon starts (a Unix socket inside the 700 home would close it); the unsigned `install-server.sh` is the real trust root, so copy never claims the whole install is signed; cap live claims an admin mints (about 20); OpenRouter's Choose models shows `:free` routes with no note on their terms; Vault's other lines about the computer being off (`HUB_AWAY_*`, the agent and routine places), `PAIRING_REJECTED` and "Pair" as a verb in body copy still say computer or pair; the site's privacy page and App Store Connect should name Venice and OpenRouter as recipients the person chooses on their own key.

## Log

### 2026-10-21, the security review: explicit grants, least privilege, and the small fixes

Founder approved all of the CTO review's fixes, with "do not break functionality". Supabase stops granting the Data API roles anything on a new table on 2026-10-30, so a rebuilt database would have refused the app on every table that leaned on the defaults (a strict local rebuild of main failed 11 pgTAP checks). `0032_explicit_grants.sql` (applied 2026-10-21) grants the service role every table, anon none (the review view and aggregates stay public), and authenticated only what a traced caller uses; strips TRUNCATE, TRIGGER and REFERENCES from both client roles; takes the signed-in RPCs from anon and the trigger functions from every client; stops a push grant being un-revoked; writes a ladder row only when the outcome moves; adds `push_send_claim` (ceiling, cooldown and dedupe under one lock); drops `apple_notifications_seen` after re-scheduling the weekly job without it; and clears unclaimed invites after 90 days. push-send uses the claim (falling back without it), touches a phone's `updated_at` on delivery and groups banners by the keyed hash; repo-oauth can require a signed-in caller behind `REPO_OAUTH_REQUIRE_SIGN_IN`, and the app now sends the token. Kept, with reasons in DECISIONS: `user_entitlements`, `apple_links`, the raw id in the push data, F2. CI: `sql-strict` builds with no default grants and runs pgTAP; `sql-replay` describes the push of 0032; a static check holds every later file to naming its grants. Tests: `supabase/tests/grants.test.sql` (26), Deno `_shared` (32), and the app and engine suites.

### 2026-10-19, the Vault made plain, and one folder per room

Founder, from a screenshot of the desktop Vault: the project notes (Progress, Decisions) were not to be seen, the Obsidian line read like a connection, the page did not say what to do, the phone should mirror the desktop with three ways (dock, Obsidian, this phone), and the OpenShore folder should match the app's rooms. The Creative Studio led (`docs/design/vault-room-clarity-2026-10-19.md`). The room opens on How you keep notes (`lib/vaultWays.ts`, `components/vault/VaultWaysCard.tsx`): on a computer, In your OpenShore folder (recommended) or Your Obsidian vault (choose its folder: no key, the folder is the connection; main's new `{ to: 'default' }` goes back); on a phone, With your computer (recommended, Connect your computer when not docked), Your Obsidian vault through the computer, and Only on this phone (not recommended), a third answer to Where your notes live (`vaultSync: 'device'`: notes stop syncing, chats and projects still do). Coding projects is Projects, each row naming Current State, Progress, Decisions, Action Items and Skills; a project's notes view opens its vault folder `Projects/<project>`, which links back. The folder: `Projects` is `Repositories` (a link left at the old name) and `Models` is `Local Library`, moved once on start (`config/openshoreFolder.ts`) and on the phone (`lib/phoneFolder.ts`, `ModelStore.swift`); an earlier generated README is refreshed; the starter layout adds Projects and Agents. Then (founder): Settings gains Vault folder on the desktop, the organized `OpenShore/Vault` by default (Default, Obsidian vault or Your folder, with the path), a tap to choose another inside Obsidian's or another notes app's reach and Use OpenShore's folder to come back, both run in the Vault room's sheet (`vaultSheetRequest`), which shows what the folder holds and offers Bring; a phone's row says the computer chooses it. Verified: both packages' typecheck, lint and tests, with new cases in `openshoreFolder.test.ts`, `phoneFolder.test.ts`, `deviceFolder.test.ts`, `vaultWays.test.ts`, `vaultStore.test.ts` and `vaultRoom.test.tsx`.

### 2026-10-14, the security follow-ups: push turns off, keyed hashes, case-proof deny rules

Founder: "Let's do all of the security fixes" (the post-launch list in hq, `openshore-code/security-open-items.md`; the Local Library catalog token was handled in another session). Sign-in links were already PKCE (2026-10-12). Push now turns off: `push-unregister` (new, verify_jwt) deletes this device's APNs token row and the grants it minted at sign-out, every one of the account's at Sign out everywhere, and the one grant a forgotten computer holds; `push-grant` returns the grant's id, which the phone keeps per computer (`pushGrantIds`, device-local), and `state/pushOps.ts` bounds every call so a sign-out never waits on it. `push-send` keeps only HMAC-SHA256 of the session id under the function secret `PUSH_SESSION_HASH_KEY` and refuses to send without it; `0029_push_session_hash.sql` clears the old rows and fits the index. `0030_keyed_enforcement_keys.sql` keys the tombstone and legal-hold hashes with HMAC under the Vault key 0019 already keeps (a domain prefix each), and every reader also checks the old plain hash until those rows age out; a new tombstone write folds an old one in. A deny or ask permission rule now matches case-folded, so `secrets/**` fences `Secrets/k`; an allow keeps its spelling, and the jail is untouched, so the Windows `.oscode` guard that broke the first attempt stands. Both migrations were applied the same day (DECISIONS). Tests: `app/test/pushOps.test.ts`, `os-code/test/permissionCase.test.ts`, `supabase/functions/_shared/push.test.ts`, and the pgTAP account-deletion file; both migrations replayed on a local Postgres with the new functions exercised.

### 2026-10-12, the model library: one pick per size for each job

Founder: the Local Library "needs to feel like the Apple AppStore with different categories that match the required categories for the stack", with a limit per category, sources beyond Hugging Face, "a true library of recommended models" and a "don't see your preferred model?" door; then one pick per device size, every kind of work ("photo editing now along with... video, voice, audio, music... legal, music, math, science, health"), and any source whose license allows commercial use. Plan `docs/design/model-library-plan.md`, calls in DECISIONS (2026-10-12, the library). Engine: `src/market/library.ts` holds four sections, 14 categories named as the Stack names them, 33 shelves and 12 Made for collections; the catalog carries only the picks (68, of 43 distinct models, at most one per size class), and the builder refuses a pick over its class's download cap, off its category's runtime, from an unnamed host, or without a commercial license; `src/market/sources.ts` names every host a download may start at. Media jobs are new Stack slots run by ComfyUI (19 graphs), a speech server in the OpenAI format, audio-separator and deepFilter (`src/media/`), with six agent tools behind `MediaGuard`; Get puts ComfyUI's files in its models folder checked by SHA-256, asks a speech server to fetch from its gallery, and never installs a program. The library publishes as `catalog.v2.json`, the new default; `catalog.json` is narrowed for released apps; discovery writes candidates only. App: the store front is sections of category tiles, Made for collections and search; a category page lists its shelves, each pick with its size class and a Best for this computer (or this phone) badge; a product page says the runtime and any license conditions; the request sheet offers bring your own and a mailto to support@openshore.ai; the desktop Stack gains a Media group and Media servers. The family rail and Compare are gone. Security and privacy checklist run on the diff by an independent reviewer ("ship with these must-fixes"; record in openshore-hq, `docs/security-privacy-review-2026-10-12-model-library.md`), every must-fix fixed: every media file pinned to its source's SHA-256 before publishing and never fetched without one; a media server off this network asks on the amber card, never gets a private vault file, and takes https only; copying a voice is a rule in code (Chatterbox only) and Get replaces a placement whole. Then the review's seven follow-ups (founder, 2026-10-13): the published catalog signed in CI and checked against a pinned key by the engine and the app; every clip and sound labeled AI-made in WAV, FLAC, MP3 and MP4, and edits marked edited; an edit's mask judged by permission rules; a file made from a private one kept private; Made here and Clear in the desktop Stack; Remove able to delete the files Get wrote for a model; and each file from another repository naming its own license. App 4539 tests, engine 2608; typecheck, lint, Prettier and the Personal bundle check green. No migration. On branch `claude/marketplace-library`, not yet on `main`.

### 2026-10-13, Runs on made simple: the CX pass

Founder, after a CX-lens read of many machines and Runs on: "Build it all." Seven changes, each pinned in `app/test/runsOnScreens.test.tsx`. Docked, a phone's Computer folds the ways in behind Dock another machine (a docking link still unfolds them). One idea replaces two: the default machine, where a project runs unless it chooses under Runs on; Active reads Default, a tap makes another the default (`setDefaultMachine`), and the desktop's "Run on another computer" switch is gone, its address form now Dock by address and key, with This computer a row in Your machines. A coding chat names its machine in the bar ("on cax11"), and a chat whose machine was forgotten shows where it ran with Dock again instead of a dead-end toast. The size guide folds behind Which size do I need?, Runs on's first choice is Automatic, and the three ways in share the width and may wrap so they fit a 320px phone. App 4577 tests, typecheck, lint, Prettier and the Personal bundle check green.
