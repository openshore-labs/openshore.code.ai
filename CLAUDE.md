# Working notes for Claude, OS Code (openshore.code.ai)

## Read PROGRESS at session start (standing rule)

`os-code/PROGRESS.md` is the recent-state source of truth for OS Code: current
state first, then "What remains," then the log. Read it at the start of every
session before other work, so a fresh session picks up where the last one left
off. `os-code/DECISIONS.md` records one line per ambiguous call; skim it when a
design choice looks already settled. PROGRESS keeps one Current state, one What
remains, and the last five log entries (`os-code/test/progressShape.test.ts`
enforces it); older sections live in `os-code/docs/progress-archive.md` and are
not session-start reading.

## gitOS, BYOM, and Vault are BUILT (reminder retired 2026-08-25)

All three founder-requested features shipped and are on `main`. The old
"surface them until built" standing reminder is retired, since its own
condition (each checkbox checked off in `os-code/PROGRESS.md`) is now met.

- **BYOM** (connect a model you control, from the Stack): BUILT 2026-08-24,
  commit `243e43e`. Code in `app/src/lib/byom.ts`.
- **gitOS** (the per-repo storage seam, ships as "Repositories"): BUILT
  2026-08-25, commits `b8e1658` (framing/seam), `ac74f77` (iCloud Drive),
  `3b28146` (Google Drive, OAuth PKCE). Code in `app/src/lib/gitos/`.
- **Vault** (native Obsidian-style markdown knowledge base, on the gitOS seam):
  BUILT 2026-08-25, commit `b8e1658`. Code in `app/src/lib/vault.ts` and
  `app/src/screens/VaultScreen.tsx`.

Do NOT re-surface these as unbuilt or re-scope them from scratch. Vault's
ORGANIZATION tier (the real multi-writer backend) also shipped: code in
`app/src/lib/gitos/orgVault.ts`, migration `supabase/migrations/0010_org_vault.sql`.
The original build prompts are kept in `os-code/docs/parked-ideas.md` as
historical reference only.

## Crew routines (the botOS brief) are BUILT (2026-09-05)

The founder's "clone grokbot, call it botOS, local-first" shipped as
**routines inside My Crew** (botOS is the codename only, like gitOS): a crew
member, a task, a workspace, and a clock; the scheduler opens a headless
journaled session on the person's own computer and leaves a dated note in the
vault. Engine in `os-code/src/routines/`, daemon routes in `serve.ts`, the app
in `app/src/lib/routines.ts` and `app/src/screens/CrewCommandScreen.tsx`. Do
NOT re-scope it as a chatbot: the reference is Grok Bot (always-on agents with
their own computer), and an earlier persona-chatbot stab was dropped on
purpose (see `os-code/DECISIONS.md`). Copy stays honest: "while your computer
is on", never "always on". Open follow-ups are in `os-code/PROGRESS.md`.

## Premium UX out of the box (standing rule, founder 2026-09-02)

OpenShore is a machine that builds usable software, so everything a coding
model builds through it is premium by default: the twenty laws of UX plus the
house motion and honesty bar, written as build instructions in
`os-code/src/core/agent/uxStandard.ts` and injected into the coding agent's
system prompt. It is ON unless rerouted: a project sets `ux.standard: "off"`
(or adds its own rules in `ux.notes`) in `os-code.config.json`, or the person
says "skip the UX standard" in the chat. The same standard is the bar for this
repo's own screens (see `docs/interaction-model.md`). `test/uxStandard.test.ts`
proves it reaches the model and that the off switch works.

## Humanizer: written output avoids AI writing patterns (standing rule, founder 2026-09-04)

OpenShore harnesses the active models, and one way it does that is by making
any written output read like a careful human wrote it, not a chatbot. The tells
are distilled from Wikipedia's "Signs of AI writing" (ingested as a dated
snapshot, treated as data, not a live fetch) and written as avoid-this build
instructions in `os-code/src/core/agent/humanizerStandard.ts`, injected into
the writing agent's system prompt. It is ON unless rerouted: a project sets
`humanizer.standard: "off"` (or adds its own voice rules in `humanizer.notes`)
in `os-code.config.json`, or the person says "skip the humanizer" in the chat.
`test/humanizer.test.ts` proves it reaches the model and that the off switch
works. In the app it is a user setting, "Humanize Writing" (Settings, default
on), threaded through `StackDriver` for app-side chats and, as a per-session
override, into the desktop engine through the daemon and the electron bridge
(`BootstrapOptions.humanize`). Precedence is one helper, `humanizerEnabled`: the
override only ever turns it OFF, so a project's config `off` always wins while
the app toggle's OFF reaches a paired desktop. Refresh the snapshot deliberately
by reading the live page again; never wire it to a live fetch, since the page is
world-editable. Scope is this repo for now, as the single source of truth.

## Motion and interaction polish is a standard, not a nice-to-have (standing rule, founder 2026-09-02)

The bar is the same as the Uki app's: peaceful, tranquil, premium. "Smooth and
slow feels premium and lux." Calm breaks at the seams (a screen that hard-cuts,
a sheet that snaps shut, a button that does not answer the finger), so the
rules live in tests, not memory. `app/test/motion-tokens.test.ts` pins the
vocabulary; `app/test/polish-standards.test.ts` fails CI on drift.

1. **One motion vocabulary.** Curves and durations are tokens in
   `app/src/theme.css :root` (`--ease-standard/arrive/spring/accel/loop`,
   `--dur-1..6`, `--press-*`). New motion references the tokens, never a raw
   `cubic-bezier()`, an `ease` keyword, or an ad-hoc millisecond value. The
   guard allows raw values only on `infinite` loops and on delays of a second
   or more. A surface that crosses the screen (the drawer, a sheet) travels
   on `--ease-glide` over `--dur-7`, the door clock: the standard curve
   front-loads two thirds of its travel into the first fifth of the clock,
   which on a 310px door reads as a pop, not a slide. Rows that arrive one
   after another step by `--stagger`.
2. **Every tappable acknowledges the touch, instantly.** `press-fb` (or the
   base button group). Press physics are asymmetric: curt accelerate-in
   (`--press-in`), slow spring-out (`--press-out`).
3. **Everything that animates in animates out.** No surface snap-unmounts.
   Sheets use `components/Sheet.tsx` (presence-aware) or `useSheetExit`; the
   drawer and the toast ride `useExitPresence`. The guard fails any JSX scrim
   without a `closing` binding. `animation-fill-mode: both` is banned (it kills
   the press state); use `backwards`.
4. **Animate transform, opacity, scale. Never layout.** The guard bans
   transitions on width, height, inset, margin, padding, max-height, with one
   documented exemption (the composer's keyboard inset).
5. **Haptics go through `app/src/lib/haptics.ts`** (`@capacitor/haptics`).
   Never `navigator.vibrate`. Mark the lift and the drop of a drag, the arm of
   a swipe, a decisive commit, and opening the main navigation.
6. **Reduced motion is honored, always.** The global `*` reset zeroes
   durations, delays, and iteration counts; per-animation kills stay too.
7. **Gestures track the finger 1:1 and settle with physics.** Drag follows the
   touch exactly, releases on distance or velocity, never a fixed snap.

Emergency door is a targeted `.skip` with a reason, never a loosened guard.
The coding agent's UX standard (`os-code/src/core/agent/uxStandard.ts`)
carries the same bar for everything built through OpenShore.

## Em dash policy is TOTAL here (standing rule)

No em dash anywhere in tracked source, comments included, encoded spellings
too. Use a period, a comma, or a rewrite. `test/em-dash-policy.test.ts` in both
`os-code` and `app` enforces it and fails the build on any violation. This is
stricter than the Uki repos by design, because OS Code started under the rule.

## Agentic Currents and Wayfinding are BUILT (BETA, 2026-09-09)

The founder's frame: OpenShore takes on new agent tech by connecting to it and
layering it in, never by reshaping the familiar rooms. Two Settings groups hold
that promise, doc in `docs/agentic-currents.md`. **Wayfinding** (memory,
skills, browser) is how the agent finds its way, default on. **Agentic
Currents** (Hermes Agent, CLI Pairing, Vellum, OpenAGI, A2A) are opt-in
modalities for agent work, default off, a BETA, ONE on at a time everywhere:
flip one on and the same rooms gain rows for it; flip it off and every trace
is gone. The rules are code, not memory: the pure core is
`app/src/lib/currents.ts`, the engine side is `os-code/src/currents/` plus the
`askHermes`, `askAgent`, and `cliAgent` tools, and `app/test/currents.test.ts`
holds the guards (one at a time, the two-part gate, every current fills every
contribution slot, and no room names a current itself). Do NOT add a room for
a current, do NOT hardcode a current's name in a room (render through
`activeContribution`), and do NOT call a current "always on". "Currents" is
the CMO and Creative Studio's name; "Layers" was retired; "frontier" stays
reserved for cloud models. Open follow-ups are in `os-code/PROGRESS.md`.

## Harness Currents are BUILT (BETA, founder 2026-09-23)

A second, independent Settings group ABOVE Agentic Currents. Where an Agentic
Current is a modality for agent work (an external agent you hand a task to), a
**Harness Current** layers a cheap decision method INTO the harness: it does
not answer for a seat, it steers which seat answers and whether a step is
needed, so you use any of your models with the method applied. The two groups
are independent, so one of each can be on at once; WITHIN the harness group it
is one at a time, the same rule the agentic group holds, with the same arrival
animation, water-line, and two-part gate.

The first (and only, today) Harness Current is **Jev**, TypeSafe AI's System
One decision model (`api.typesafe.ai`, `POST /v1/systemone`, model `jev-latest`;
it returns typed decisions, never chat). It is scoped to a paid/cloud seat
(there is nothing to save against a free local seat and a cloud call would only
add latency and break the offline floor), and it does three jobs: an escalation
gate (can a cheaper local seat carry this turn), a task classifier (route to the
seat placed for this kind of work, replacing the regex `classifyTask`), and a
verify judge (does the result satisfy the task when there is no check to run).
The classifier and gate run in the app stack driver as ONE Jev call
(`JevAdvisor.steer`); the judge runs in the engine loop. Each decision shows as
an amber (cloud spend) card in the transcript, and a pill sits beside the reach
pill.

The rules are code: the pure core is `app/src/lib/harnessCurrents.ts` (its own
`settings.harnessCurrent` scalar, roster, gate, contribution, handle); the wire
shapes and the reusable client are `os-code/src/currents/model.ts` and
`os-code/src/harness/jev.ts` (exported through `os-code/protocol`);
`app/test/harnessCurrents.test.ts` and `os-code/test/jev.test.ts` hold the
guards (one-at-a-time within the group, coexists with an agentic current, the
two-part gate, no room names a harness current, and the client's job readers).
Do NOT re-scope Jev as a chat model on the Bench (it cannot chat); do NOT make
Harness Currents mutually exclusive with Agentic Currents; do NOT claim a dollar
saving in copy until `osc eval` shows the number on the reference box (tenet 2).
**Naming supersede (founder 2026-09-23):** the harness's tenet 1 ("no room and
no name") is deliberately overridden for this ONE visible group named "Harness
Currents"; the internal codename Keel is still barred from copy, and Jev is a
real connected product name, named like Hermes in the agentic group. Open
follow-ups are in `os-code/PROGRESS.md`.

## The premium harness: five tenets (standing rule, founder + advisor org 2026-09-14)

The plan for making OpenShore's coding agent premium on any model, dev, creative,
and agentic work alike, is `docs/premium-harness-proposal.md`; the full advisory
review that shaped it is `docs/premium-harness-advisory-memos.md`. The harness
is codenamed Keel internally and ships with no room and no name, the way gitOS
ships as Repositories. Build it to these five tenets so no session drifts:

1. **The harness has no room and no name.** It ships as how OpenShore works:
   cards in the transcript, rows in Wayfinding, pills on the Bench. Never a new
   room, never a codename in copy. Grep the codename like the Currents nouns.
2. **Nothing is claimed without eval.** Every feature ships behind config with a
   with-and-without number per model class on the reference machine (the
   founder's own box). That box is deliberately the lowest common denominator
   (founder, 2026-09-15): older, slower, CPU-only, no usable GPU, so a 7B runs
   at 3 to 7 tokens per second. A number that holds there holds for almost
   anyone, so measure the floor there first and build for it; a fat GPU only
   makes it better. Copy says "remembers what worked", never "trains itself",
   until an adapter actually ships. `osc eval` is the spine.
3. **The harness raises the floor, never the ceiling, and says so.** A tiny seat
   runs single steps and its pill says it; the harness does the mechanical work
   (retrieval first, structural checks, running the project's own tests) so a
   small model does not have to remember to.
4. **The person places the seat; the harness may only fill a gap.** Auto-place
   places an installed or benched LOCAL model with a note and one-tap revert, and
   never the anchor, never under a secrets lockdown. Every download and every
   cloud call is a card the person taps. Teal is local, amber is cloud and spend.
5. **One loop; hosts differ only by tool slice.** The pure core in
   `os-code/src/harness/` stays free of Node built-ins by test so the phone can
   run it; events are additive; the working path (`core/agent/loop.ts`) stays
   until a host passes on the core. Long and unattended work runs on the engine.

Order is fixed and each step unlocks on a number, not a belief: measure, then
the discipline seam (model-class profiles, the tool-or-answer decoding schema,
context budgets, retrieval-first), then the Claude Code moment on the engine
(verify, checkpoints and rewind, hooks), then Ask for a hand with Auto-place,
then the pure-core extraction with subagents, then the phone host, then Lessons
(local-only learning, per owner and workspace, cleared with the chats). A
subagent always draws down its parent's step and dollar rails; lessons are never
mined machine-wide on a shared hub. Pricing (Personal $50, Micro $100, Small
$250, Growth $500, Scale $1000) is a Board gate, not harness work.
