# The advisor team on the premium harness: the eight memos (2026-09-14)

The founder asked the entire advisory org to weigh in on
`premium-harness-proposal.md` and reach a consensus. Each advisor read the
proposal, the standing docs, the public promises on the site, and the code it
cites, then wrote independently. The memos are recorded here, condensed but
faithful, so no finding evaporates. The consensus they produced is in the
proposal itself under "The advisor team's consensus."

Every memo returned the same verdict: go with conditions.

## CTO

**Verdict.** Safe to build with six must-fixes; do not start subagents or
Lessons until findings 1 and 2 are designed in.

**Must-fix findings.**

1. **Subagents on shared deps defeat the rails and Stop.** `loop.ts:131`
   rewrites `deps.toolContext.noteUsage` in the constructor; `run()` at
   `loop.ts:304` rewrites the shared signal; `Guardrails.startTask()` zeroes
   steps, tokens, and dollars. A child sharing the parent's `ToolContext` and
   `Guardrails` resets the parent's counters, credits later spend to a dead
   child, and detaches the parent's abort from its tools. Fix: a child rail
   that draws down the parent's budget with no reset, a cloned `ToolContext`
   per child with a signal chained to the parent's, usage credited to the
   root session, the same approver so approvals bubble, and the spend
   estimate on the seat, not on `router.escalationTarget()`.
2. **Lessons mined machine-wide leak one member's code into another's
   prompt.** Journals are per session with `ownerUserId` in `info.json`;
   `tool-end` carries up to 24k chars of file content and diffs. Stack Health
   already had to stamp `scope: 'machine'` for this reason. Fix: exemplars
   keyed by owner and workspace, never machine-wide; per-owner or off on a
   hub with member tokens.
3. **The union schema as written cannot stream prose, does not guarantee
   valid args, and a rejected schema kills the task.** `toolCallJsonSchema`
   constrains args to a bare object; `openaiCompatible.ts:287` sends
   `strict: true`; `handleProviderFailure` treats a 400 that is not
   `TOOLS_UNSUPPORTED` as a hard fail; the loop emits raw deltas, so a person
   would watch `{"kind":"say","text":"I found\n`. Fix: per-tool `oneOf` arg
   schemas checked by a schema-accepted probe per backend in eval v2; retry
   the turn unconstrained on a 4xx; an incremental JSON-string decoder that
   reveals `text` as it arrives; never send a schema and native tools
   together.
4. **The phone tool slice's repo writes rest on an outbox producer that does
   not exist.** `REPO_OUTBOX_ENABLED = false`; the daemon drain exists and is
   root-gated. Fix: the producer is a prerequisite of the phone host, or phone
   repo writes ship describe-only with honest copy. The phone host runs at
   `remote-attached` or stricter, enforced in the core.
5. **Auto-Source has no runtime seam and the app shows the shape to avoid.**
   The tool registry is built once at bootstrap from `stack.specialists`, so
   placing a vision model mid-session cannot register `analyzeImage`.
   `stackDriver.ts:531 cloudVisionFallback` picks Claude on a stored key with
   no card; Auto-Source must not inherit it. Fix: a runtime registry add and
   remove behind the same egress rules plus a `stack-changed` event; resolves
   only `kind: 'local'` refs, pinned by a grep test in the style of
   `ethicsNoBypass.test.ts`; downloads always ask.
6. **The pure core is realistic; the order is wrong.** Direct Node in
   `loop.ts` is only `randomUUID` and `relative`; the rest arrives through
   `Guardrails`, `Jail`, `UsageTracker`, the logger, `instructions.ts`, the
   permission engine, and egress, all replaceable behind `HarnessHost`.
   Compaction, the parser, modes, seed, and the adapters are already pure.
   Estimate: two to three focused sessions for a behavior-preserving move,
   proven by byte-identical golden-journal replay. The app has no Node
   built-in guard for `os-code/protocol` today; that guard is new work.
   Landing profiles in `loop.ts` and then moving it rewrites every test twice.

**Nice-to-have.** Eval v2 must run the loop through `bootstrapSession`
against fixture repos with a scripted approver, three-plus trials, not
one-shot `provider.chat` calls.

**Positions.** Phone in V1: agree, conditions 4 and 6; foreground only; a
suspend ends in a journaled `task-done` aborted. Auto-Source: on for an
installed or benched local model on the desktop and docked; off by default on
a shared hub for a member and on the phone alone. Downloads always ask.
Subagents: agree with finding 1. Decoding: agree with finding 3. Name: "Keel"
never reaches copy; grep it like the Currents nouns. TUI: parked; every event
consumer needs a default case so an older client never crashes on `handoff`.

**Elevations.** A Verified badge on the task-done card and the chats list.
Rewind as git checkpoints (a dangling commit per approved write) rather than
file snapshots. The card carries numbers and their basis ("failed this edit
twice; LLaVA 7B, 4.1 GB, fits in 12 GB free"). A bundled sample repo from the
eval fixtures. A "Ran on" fold per turn (seat, class, constrained or native).

**One thing.** Extract the core first as a pure move proven by replay, and
make every subagent draw down its parent's rails.

## CMO

**Verdict.** Go with conditions: the story is right, three promises on the
site break as written, and two names do not belong in this product.

**Must-fix.** Silent downloads break "You decide who sits in each seat" and
"Nothing leaves unless you tap to send it." Lessons contradict Stack Health's
"Nothing about your use is collected" (`stackHealth.ts:416`); ship with a
delete, a count on the row, and reword the four surfaces in the same commit,
never "collected", always "leaves". Two claims the product cannot back yet:
"feels like Claude Code" never appears on the site, and "learns" is shown
("12 lessons on this computer", "Used 2 lessons") not asserted. The handoff
card must recommend local first; cloud is recommended only when nothing local
fits, and the card says why. "LLM Auto-Source" is a mechanism name (the fault
that retired "Layers"); rename to **Auto-place**, badge "auto-placed". "Seat"
means billing in the app and the Stack on the site; the Stack keeps it and
billing says "people" and "team plan". The phone run must say what it did not
do: "Proposed, not applied. Applies when docked." and "Not verified: tests run
on your computer."

**Naming.** Keel: codename, no public name. Lessons: keep. Ask for a hand: a
transcript verb ("Qwen 7B asked for a hand with image reading"), never a
feature name; the card is not a "handoff" (the play owns that word). Verify:
keep. Frontier stays cloud-only.

**The one-liner.** "Real work from a model you already own." Under it: "The
harness carries the discipline. It finds the code first, runs your tests,
checks its own work, and asks for a hand when a step is beyond it. So a small
local model does work you used to rent." **The villain:** the rented brain.

**Copy that changes in the same piece of work.** `tabpages.js:38` gains "or
let Auto-place fill one from your bench when a step needs it. Cloud never
places itself." The privacy page gains "Lessons stay here." The "A real coding
agent" line gains "runs your checks before it says done, and asks for a hand
when a step is beyond it." Settings' privacy sheet names Lessons. Stack
Health's trust row becomes "No telemetry. Nothing about your use leaves this
computer." "Team seats" becomes "Team plans."

**Elevations.** The lift on the model page ("Bare: 2 of 7 tasks. With
OpenShore: 5 of 7", provenance osc eval v2). The hand as the first-run demo
(a guide that attaches a photo to a text-only stack). The verify row as the
signature. Rewind on every tool card. Lessons you can read.

**One thing.** Ship the eval numbers before the adjectives, and let one tap
stay one tap.

## CFO

**Verdict.** Go with conditions: zero infra by construction, so COGS stays
where it is; the conditions are one Personal price on record, an order that
puts a marketable number on screen inside the first two session-days, and V2
adapters held until Tier 1 has a measured lift.

**Must-fix.** Two Personal prices are on record: the site, `plans.ts`, and
`supabase/README.md` say $20 a year; DECISIONS and PROGRESS say $50 when the
gates return. Recommendation: $50 once the harness ships with eval numbers;
everyone on the beta list keeps $20 for a first year, because the site said
so. The ladder is inverted: Micro is $20 for up to five people with admin
and a shared stack; at $50 Personal it is 2.5x worse; Micro to at least 2x
Personal (a Board gate) or an org-domain requirement. The order buries the
marketable result under the biggest step: verify, checkpoints, hooks, and
skills are host-side and do not wait on the core; proposed order 0, 1, 4, 5,
2, 3, 6. Step 0 is founder attention on a GPU box, not code: ship eval v2 as
a Crew routine ("Benchmark", nightly, while the computer is on) plus a
mock-provider regression mode in CI.

**Nice-to-have.** "Local inference is free" undercounts: `maxResidentModels`
defaults to 1, so a cross-model second opinion on a sub-12 GB box is an
unload and reload per candidate; same-model sampling only, off until the
eval shows the win. Hooks from a project file on a shared hub always ask on
headless and remote, never auto-allowed by a config rule (the `daemon` block
ruling). Profiles in the loop miss Free: put the union schema and class
preamble in `providers/adapters/` so the stateless `/chat` funnel gets the
lift too.

**Positions.** Phone in V1: agree on the outcome, disagree on the sequence.
Auto-Source: agree, never a gate; downloads ask on every host. The founder's
box: disagree on spending now; the eval blesses no 1.5B to 4B as an anchor,
so the spike would prove training on models nobody runs as the anchor; defer
until Tier 1 shows a lift, then rent GPU hours (tens of hours at a few
dollars each, estimate) rather than buy a card.

**Tiers.** Free: the fast path, the classifier, profiles and decoding at the
adapter. Personal: the loop with tools, subagents, skills, hooks, verify,
checkpoints, the hand, Auto-place, Lessons. Team: admin-owned profile
defaults and hooks, an admin switch for downloads on the hub, org-scope
Lessons only when the org Vault multi-writer backend exists. Lessons and
Auto-place never gate on their own. A cloud runner is the temptation to
refuse: at $1.67 a month, one nightly GPU-hour burns the year in one to three
months and breaks "nothing leaves the machine".

**Sizing** (basis: 4 to 9 thousand lines per build day in the log). Step 0
medium, step 1 medium, verify and rewind medium-large, the hand medium, the
core large plus TestFlight, subagents medium, Lessons medium; 10 to 18
session-days total. Eval-first delays no revenue: gates are off and the flip
waits on Apple ops, not this plan.

**Elevations.** The number on the Marketplace card. "Personal verifies" as
the wall the paywall names when gates return. The lesson card, ungated.
Benchmark as a routine, with Stack Health gaining "your stack, measured". The
card before the failure ("your anchor has 8k context; this repo's code map is
6k").

**One thing.** Ship the number before the name.

**Second ruling, the same day, on the founder's pricing call ("Go $50 for
personal and micro at $100 if my CFO is good with that. Ditch the $20").**
Good with it, with one change. Personal $50 on Apple nets about $42.50 per
payer under the Small Business Program against $17 at $20, a 2.5x
contribution, so it breaks even at 40% of the conversion $20 would have
brought; the harness is what is priced, so the number lands with the eval
number. Micro $100 for up to five collides with Small at $100 for 6 to 30
(the sixth seat would be free), so every band moves up one rung: Micro $100,
Small $250, Growth $500, Scale $1,000; every team price stays above one
Personal and no band's floor is cheaper per seat than the band below at its
ceiling. Four new Stripe price objects, old ids ignored, the Personal Stripe
price retired (Apple-only), a Board vote in DECISIONS. Ditch the $20: agreed,
since nobody has paid it and every gate is off; change the site this week
with one candid line ("We said $20 earlier; the price moved when the agent
learned to verify its own work") and purge the cache. The mirror rule lists
the site data, `plans.ts`, `Paywall.tsx`, `AccountSetup.tsx`, the Supabase
README, App Store Connect, Stripe, DECISIONS, and PROGRESS as one piece of
work per repo.

## CX

**Verdict.** Go with conditions. The desktop path lowers the barrier on
evidence we can produce; the phone-alone path does not yet, and two defaults
trade trust for convenience at the moment a non-expert can least judge the
trade.

**The first-run walk.** iPhone alone: the hero is Harbor Light (SmolLM2-135M,
a reciting guide), the upgrade is Harbor (Qwen3-1.7B) or the Offline pack
(`qwen2.5-1.5b-phone` until the 4B is scored), all tiny class, so "feels like
Claude Code" on the phone alone is out of reach in V1 by the proposal's own
table; a described change with an outbox proposal reads as failure to a
non-expert unless the copy says "do this on your computer". Desktop with
Ollama: the one-tap starter (Qwen 2.5 Coder 7B) lands in the small class,
exactly where the lift is claimed; retrieval-first and the verify row lower
the barrier most for a novice who does not know to ask for tests; no per-model
VRAM fit check exists for the desktop.

**Must-fix.** The phone-alone anchor is tiny class: score the 4B in step 0,
state the ceiling ("short builds on this iPhone, long work on your computer"),
and lead the first phone hand card with pairing. Downloads always ask.
**Lessons versus Clear:** "Clear conversations" removes every chat, but an
exemplar bank holds trajectories, which hold code, in a second sealed store;
Clear must clear lessons, the privacy sheet must name them, and the Vault
folder reads from `~/.os-code/lessons/`, never a vault that can move to
Drive. Nothing will tell us whether the barrier fell: insights has no hand,
verify, or lesson events.

**Rulings.** Auto-Source: placement on, downloads ask; if overruled, a
cancelable progress row and "put it back" also deletes the bytes. Lessons
default on is defensible; the honest row copy is **"Remembers what worked in
your own builds, sealed on this computer. Nothing leaves it."** ("remembers"
is honest for retrieval; "learns" reads as "trained on my code").

**Metrics.** Pin two numbers now: median time from first `app_open` to
`first_accepted_edit`, and the share of testers reaching it with no
`cloud_key_added`. Add with the build: `hand_raised`, `hand_resolved`,
`auto_source_reverted` (the regret signal), `verify_result`,
`lesson_proposed|accepted|dismissed`, `phone_run_suspended|resumed`. Learning
works if hand cards per finished task fall week over week on the same
machine.

**Elevations.** First build seeded with one chip ("Explain this project and
run its tests"). The phone hand card leads with "Do this on your computer".
Verify in plain words, honest on no tests ("This project has no tests. Want
one?"). Measured fit before any desktop download (a VRAM probe, the desktop
twin of `runsWellOnDevice`). "What it learned" on the task-done card, one
accept, instead of mid-run lesson cards.

**One thing.** Prove the small-model lift on the 7B starter first; the
phone-alone promise waits on the 4B eval and honest copy.

## Creative Studio

**Verdict.** Go with conditions. The proposal names six surfaces by their
content and none by their motion, and the one place the team is visible today
renders in grey.

**Must-fix.** The owner chip is grey today: `.todo-owner` reads
`var(--water, var(--muted))` and `--water` is not defined, so the only place a
person sees who owns a step falls back to muted; use `--local` for a local
owner, `--cloud` for a cloud owner, pinned in `motion-tokens.test.ts`. "Seat"
already means a billing seat in the app (`AdminScreen.tsx`); the Stack room's
nouns are Reasoning LLM, category, place, Bench. No new card has an arrival
or exit yet, and the polish guard catches scrims, not cards; every new card
ships with its arrival and a `reveal` fold or `useExitPresence` exit in the
same commit, and the guard grows a card clause. The handoff card mixes local
teal and cloud amber in one picker; the recommendation is the first tile,
never a default-selected cloud tile. The Auto-Source transcript note as
`msg-note` renders warn amber, which reads as spend; it needs a quiet teal
note class. The lesson card must not narrate ("You run prettier before every
commit. Make it a standing instruction?"). Class and adapter marks are the
existing `pill local` grammar on the Bench row, not a new badge family.

**Three directions for how the harness is felt.** A, the Ledger: every event
is one more row in the tool-card grammar (coherent, lowest effort, every
agent product's transcript). B, the Room: presence dots beside the reach
pill, one per placed model, teal breathing while its owner works, amber
holding when a hand waits, green when done (the vocabulary exists in the Crew
room). C, **the Current in the Thread (recommended):** when the anchor hands a
step to a model, a current leaves the plan row and runs down the transcript's
left rail on the glide curve and the door clock to the arriving subagent
card; the rail stays faintly teal while that model works; when it returns the
current ebbs back and the card folds to one line; a hand stops the current
and the card rises as a picker; verify draws a check; rewind runs the current
backwards and folds the undone cards in reverse stagger; an accepted lesson
folds to a teal wikilink line, "Saved to Lessons". One decisive haptic when a
hand is asked and when verify lands. Transform and opacity only; reduced
motion collapses the rail to a crossfade. Recommend C with B's presence dots
as its header; A is the fallback if the step slips.

**Naming, from the visual side.** "Seat" does not render inside the app; in
the chat, name the owner by category and model, "Coding: Qwen 7B". "Hand"
renders: "Handing to" is the play's own copy and "hand off" is Harbor Light's
microcopy; the card's badge is "Needs a hand", never "escalation".

**Positions.** Downloads under Auto-Source: disagree with silent starts; a
multi-GB download with no card breaks "every change shown before it lands";
one card, size and disk left, Approve starts the existing progress bar.

**Elevations.** The current in the thread. Presence dots by the reach pill.
Rewind as a gesture (drag a tool card through `SwipeRow`, haptic at the arm).
Verify as the last check on the task bar (the bar turns ok only when verify
passed; skipped stays teal with a "not verified" pill). A lesson settles into
the Vault (the folder breathes once on next open).

**One thing.** Ship the harness so a person can watch it work without
reading a word: the rail flows, the dot breathes, the check draws itself, and
nothing ever snaps.

## Chief of Staff

**Verdict.** Go with conditions: eval v2 actually runs on a real machine
before step 1 is claimed, the phone host is scoped to what the founder
already ruled twice, and the hand and Auto-Source can never place a cloud
seat inside a locked-down session.

**Must-fix.** Step 0 rests on an ops step open since 2026-09-05 (the 4B eval
and the live-fire pass); the founder's first act is one `osc eval` run on the
box, and eval v2 ships as a read-only Crew preset ("Measure") so it keeps
running with no founder in the loop. **The phone host reverses a call made
twice** (DECISIONS 2026-08-25 "a remote control and a viewer, not the
compute"; the archive's 2026-08-26 R-16 choice "fights iOS suspension"); a
foreground loop with vault writes and outbox proposals is a runner; scope it
to the Part 5a read-only slice plus vault writes, a step cap and wall clock
the CTO sets, and the engine for every repo edit; copy never says the phone
builds. **The hand and Auto-Source must honor egress lockdown:** a secrets
session never escalates to the cloud (DECISIONS 2026-09-04); the cloud
candidate and Auto-Source are unregistered under lockdown, the rule
`askHermes` follows, and a subagent never holds a tool or seat its parent
could not. **`~/.os-code/USER.md` recurs against a settled ruling** ("the #
shortcut writes to the project's instructions, not a hidden file"); global
standing instructions are a visible surface. **The shared planner re-opens
CTO FORK B** (2026-09-06: do not port `play.ts` to the engine, a headless
routine must never block on a question); it may be right now, but it needs
an explicit re-ruling with the headless constraint kept as a profile flag
(`clarify: never`), not a silent reversal.

**Nice-to-have.** Stack Health Phase 2's `agentId` and the subagent `parent`
field are one thing; fold them. Skills should reuse the Hermes reader's
`SKILL.md` jail and size cap.

**Collides, obsoletes, keeps.** Depends on the play as planner source, the
journals, the catalog's fit and provenance, the Wayfinding rows, the routines
scheduler, the founder's machine. Absorbs Part 5a's classifier, checkpoints,
and phone read-only slice, `Router.delegate`, the dead `onModelRequest` flag,
Stack Health Phase 2. Leaves untouched MCP and the browser, the Currents
rules, the ethics chokepoint, the parked leaderboard, "while your computer is
on", and the device verification backlog, which is separate ops work and
must not queue behind the harness.

**Founder attention, in order.** Run `osc eval` once on the desktop. One word
on downloads (ask). One picker on the phone host scope. Approve the public
copy change. Everything else delegates to the CTO (the host interface and
extraction order, FORK B, the subagent subset and jail, the lockdown rule,
phone caps, the schema, checkpoint storage, the per-family gate) and to the
CMO and Creative Studio (names, card copy, badges, the trust-statement line).

**The first two sessions.** Session 1, measure: eval v2 fixtures and tasks,
deterministic scoring, per-class runs, golden-journal replay, the Measure
preset, the profile derivation as a pure tested module; ends with the founder
running it once. Session 2, discipline: step 1 behind config, the lockdown
rule written as a test now, eval re-run, DECISIONS supersessions recorded.
The core extraction does not start until session 2's numbers say step 1
helped.

**Elevations.** An attention budget for cards (one proposal card per task;
the rest to the Vault folder, surfaced on the third recurrence with history;
one policy table like `voiceBreaks.ts`). The Measure routine. Verified or not
on every task-done card.

**One thing.** Run the eval on your own machine before anyone writes a line
of the harness, or every number in this plan is a guess.

## Board

**Verdict.** Go with conditions. Steps 0 and 1 are a go now; the core, the
Stack inside the loop, the hand, and Lessons unlock only on measured gates,
and the phone host is gated hardest.

**The angel.** The burn is the founder's attention; the log shows 93 commits
by one author since 2026-09-03 while What remains carries eleven
device-unverified builds and the 4B eval that has never run. The product
already builds faster than it verifies. The price is two numbers ($20 on the
site, $50 in PROGRESS). The earliest marketable increment is not "Claude Code
on any model"; it is "your 7B fixed a failing test on its own, and the verify
row says 42 passed", a recording you can post, produced by step 0.

**The operator.** The local-first tools that earned trust (Ollama, LM Studio,
Aider, Continue, Cline) nailed the desktop loop against real weights,
published numbers, and let the community carry the benchmark; none shipped a
phone host in V1; none promised the model learns. This plan deviates twice:
three hosts before one is live-fired, and a learning tier before an eval
exists. The order of steps is right; the scope inside them is not.

**The contrarian.** Claude Code's feel is a frontier model plus a loop; the
loop is here, the model is not, and the proposal's own ceiling section
concedes it. "Models train themselves" is a research program for one person.
The phone in V1 doubles the surface for a beta whose device backlog is eleven
deep, and the phone slice cannot run verify, which is the thing that makes
small models capable. Subagents, hooks, and checkpoints are table stakes; the
real moat is the promise set plus the Stack, and Keel deepens it only where it
makes the promise set measurable.

**Conditions to unlock each phase.** Step 1: eval v2 runs on the founder's
box across three classes with baselines committed with provenance. Step 2,
desktop only: a measured lift on the small class from harness changes alone
(0.1 proposed as the bar, to reset after the baseline), the four-backend
live-fire pass checked off, golden journals green. The phone host: desktop
at parity with today's loop on golden journals, device backlog under five,
one TestFlight run of a phone-sized task end to end. The hand: the three
stubs closed (`onModelRequest`, the regex classifier, tool-less `delegate`),
the card raised pre-emptively in the vision eval task. Lessons: a repeatable
delta on the same machine, two runs a week apart. V2: a GPU, a spike that
beats base, a founder yes.

**Positions.** Phone in V1: disagree and commit, narrowed to the gates above.
Auto-Source: on for installed and benched models; downloads ask; this settles
both open calls at once. Subagents: default on only when the eval shows they
beat a single seat on the mid class. Name: no name until it is measured.

**Elevations.** A recorded, verified win as the marketing unit. The eval
score on the seat ("0.71 on this machine, 3 Sep"). "Runs single steps" as
honest premium. Golden journals as the regression suite. The not-verified
state said plainly on the phone ("not verified, dock to run tests").

**One thing.** Measure the 4B before you promise it; every other line in this
plan is either proven by that number or exposed by it.

## Corporate Strategist

**Verdict.** Go with conditions: eval on real hardware before any code moves,
the phone-alone host demoted to V1.5, downloads always ask, and the tenets
written into CLAUDE.md first.

**Vision against the proposal.** Aligned: the discipline layer is the
mission's "a way in that does not ask you to be an expert" in code form;
Lessons local-only honors "no telemetry, ever"; adapters are "a companion you
own"; eval as spine matches "honest ratings with provenance". Drift: the
phone as a third runner (README: "Desktop is home, the phone rides along";
the self-hosting page: "more remote control than compute"); who places the
seat; and stale surrounding docs, since CLAUDE.md still names the org Vault
tier as the one open follow-up while `app/src/lib/gitos/orgVault.ts` and
migration 0010 are built.

**Must-fix.** Scope versus capacity: the phone-alone host to V1.5; steps 0
and 1 land as their own PROGRESS entries before step 2 starts. The purity
guard does not exist; write it before the first line moves. A ruling is
reversed silently (grammar as a repair tool); one supersession line the day
step 1 starts. Two public lines softened in one change; Auto-Source places
only installed or benched models, every download and every cloud call is a
card, the site edit ships in the same commit. Retire the stale org Vault line
in CLAUDE.md in the commit that adds the harness tenets.

**Nice.** Switches over nothing: Wayfinding's Skills and Browser rows gate
nothing today; the Lessons row appears only when the bank is readable in the
Vault; MCP is cheap and can ride with skills and hooks once the per-profile
tool filter exists. Two eval numbers: the storefront shows the curated
number; the local number lives on the seat badge only.

**The right machine and the shape.** Device verification is step 0's other
half, not a competitor. The org Vault tier is built. The Marketplace's next
work is this proposal's spine. So the harness is the right machine next. The
four layers are a good reading order and the wrong build unit: reshape to
one loop, one seat contract (profile, capability, tool slice, transport), two
feedback loops (verify inside a run, lessons across runs), and eval as the
gate.

**Tenets proposed for CLAUDE.md.** The harness has no room and no name.
Nothing is claimed without eval v2. The harness raises the floor, never the
ceiling, and says so. The person places the seat; the harness may only fill a
gap. One loop; hosts differ only by tool slice.

**What "super unique" honestly means.** Not unique: a Claude Code-shaped loop
on local models. Unique, if measured: heterogeneous local seats distributed
inside one loop with owners, a hand grounded in hardware-rated honest
ratings, lessons that stay on the device and make the same model better next
week under an eval gate, on a phone-and-desktop pair over a tailnet, with no
telemetry and an ethics floor that cannot be turned off. The marketable word
is not "unique"; it is "yours, and provably better next week".

**Elevations.** The reference machine, published (eval numbers from the
founder's under-12 GB box as "what a modest desktop finishes"). "Better next
week" on the seat badge. The handoff card as the Marketplace's front door.
One founder sitting for step 0 (a day of the founder's hands, basis: each
device item is a TestFlight tap-through). Tenets before code.

**One thing.** Build the harness, but measure on your own machine before you
move a line, and let the phone follow the desktop rather than lead it.
