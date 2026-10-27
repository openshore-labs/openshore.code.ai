# Working notes for Claude, OS Code (openshore.code.ai)

> Standing instructions for the AI coding agents that work on this
> repository. People do not need to read it to contribute: start with
> `README.md`, `ARCHITECTURE.md` and `CONTRIBUTING.md`. "Founder", "CTO",
> "CX", "CMO" and "Creative Studio" below name Open Shore LLC's maintainers
> and the reviews they run; a ruling attributed to one is a maintainer
> decision. Codenames (gitOS, botOS, Keel) are internal and never appear in
> the product.

This repository is open source (Apache 2.0, 2026-10-11). The company's own
records it names (advisor and Board memos, the UX and security reviews, the
App Store notes, `os-code/docs/progress-archive.md` and `parked-ideas.md`)
live in the private `openshore-labs/openshore-hq` repository under
`openshore-code/internal-docs/`, at the same path they have below. A doc named
here that is not in this tree is there. Never copy internal material back in.
The maintainer runbooks (TestFlight, push setup, release signing, the Mac
desktop build, the gate 1 runbook and the vault device checklist) live there
too, under `docs/` (2026-10-12). Public docs are indexed in `docs/README.md`;
design history sits in `docs/design/`; `ARCHITECTURE.md` is the one-page map
for contributors. Keep a new doc in one of those three homes.

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
  first BUILT 2026-08-25, commit `b8e1658`; rebuilt as Vault v1 (below).

Do NOT re-surface these as unbuilt or re-scope them from scratch. The original
build prompts are kept in `os-code/docs/parked-ideas.md` as historical
reference only.

## Vault v1: M0 to M7 BUILT, the M8 ship gate open (2026-09-27)

The plan is `docs/design/vault-v1-plan.md` (D1 to D15 ruled by the founder); the
review behind it is `docs/design/vault-v1-review-findings.md`; each milestone's calls
are in `os-code/DECISIONS.md`. Vault is one local-first plain-markdown vault on
the gitOS seam that the person, every model seat, routines in Agents, and Obsidian
share: on the desktop the folder (`~/OpenShore/Vault` or one the person picks,
an Obsidian vault included), on a paired phone "Your computer" while it is on.
Before each turn the harness gives the seat a small cited pack sized to its
served window, and a switch hands over what the next seat cannot fit. Code:
the pure core in `os-code/src/harness/vault/` plus `harness/vaultContext.ts`
and `harness/handoff.ts` (Node-free, through `os-code/protocol`); the engine's
tools in `os-code/src/core/tools/vault.ts` and `vaultFind.ts`, its index in
`core/vault/`, the daemon's routes in `daemon/vaultRoutes.ts`; the app's seam
and providers in `app/src/lib/gitos/` (folder, Local, iCloud, hub, team), the
store's vault work in `app/src/state/store.ts` and `state/vaultOps.ts`, the
room in `app/src/screens/VaultScreen.tsx`, every claim in `lib/vaultCopy.ts`.

Standing rules, each pinned by tests:

- **Nothing is overwritten silently.** The folder, Local, and Your computer
  write by compare-and-swap (`ifMatch`, `ifAbsent`; a conflict is a result,
  never a throw), and each passes `app/test/providerContract.test.ts`; iCloud
  and the team client gain it with their held branches, and until then a
  storage without it keeps the single-writer lease enforced (and the team
  vault its server-side base-rev compare with a conflict copy). The base
  version lives in the open editor and the stash. A conflict opens the
  resolve sheet (Keep both first).
- **Copy says only what is true**, per platform and storage, through
  `vaultCopy.ts` (`app/test/vaultCopy.test.ts`); no "faster", "smarter", or
  "remembers" until the reference box eval says so (tenet 2).
- **Files are the source of truth**; the index is a rebuildable cache outside
  the vault. Agent writes stay always-ask, and the person approves the exact
  bytes (provenance included). `.oscode/vault.json` travels with the vault and
  can only narrow reach; the agent never writes under `.oscode/`.
- **Privacy is judged by address**: notes the privacy rules mark local-only
  (by default `Private/`, `Journal/`, `#private`, and `oscode: local-only`;
  machine config can change the defaults, a vault's own file can only add)
  never reach a seat that leaves this network (D5).
- **Google Drive is held out of v1** (D1), and the team vault stays out of
  model context until v1.1 (D15).

**The room opens on How you keep notes, and the folder is named by room
(founder, 2026-10-19).** A computer offers OpenShore's own folder or an
Obsidian vault; a phone offers its computer (recommended), the Obsidian vault
through it, or only that phone (`vaultSync: 'device'`). Obsidian is a folder,
never an account or a key, and copy says so (`app/src/lib/vaultWays.ts`).
`~/OpenShore` is Chats, Repositories, Vault (with Projects/<project> and
Agents), Local Library and Exports (`os-code/src/config/openshoreFolder.ts`,
`app/src/lib/phoneFolder.ts`); a new part of the app that saves files names
its folder for its room. The agent's project notes stay in each repository
and the Vault's Projects card names them. `docs/design/vault-room-clarity-2026-10-19.md`.

Held branches, not on `main`: `vault-m2-team` (the team client; its
migrations are main's 0024 and 0025), `vault-m2-icloud`, and `vault-m2-native`
(the iPhone opening an Obsidian vault in place). Founder gates (PROGRESS, What
remains): 0021 to 0026 are applied and `delete-account` deployed (2026-09-30);
the entitlement date; the reference box evals for M4 to M6 before any pack
default flips; an `xcodebuild test` run; and the device checklist in
`docs/vault-v1-device-checklist.md`. Every must-fix finding maps to a test in
`docs/design/vault-v1-test-map.md`.

## Routines in Agents (the botOS brief) are BUILT (2026-09-05)

The founder's "clone grokbot, call it botOS, local-first" shipped as
**routines inside My Crew** (botOS is the codename only, like gitOS): an
agent, a task, a workspace, and a clock; the scheduler opens a headless
journaled session on the person's own computer and leaves a dated note in the
vault. Engine in `os-code/src/routines/`, daemon routes in `serve.ts`, the app
in `app/src/lib/routines.ts` and `app/src/screens/CrewCommandScreen.tsx`.
**The room is Agents (founder, 2026-10-19)**, once Crew: copy says Agents,
"an agent", "your agents", and its schedule screen is **Routines** (once Crew
command); `Crew` and "crew member" are retired words in copy
(`app/test/support/uiGuards.ts`). Ids stay (`crew`, `crewcommand`,
`settings.crew`, `CrewAgent`, the run note's `crew` tags and source), so saved
settings and sidebar orders need no migration. New run notes land in
`Vault/Agents/<routine>/`; notes written before stay in `Vault/Crew/`, the
previous-run link names their full path, and the run prompt names both. Do
NOT re-scope it as a chatbot: the reference is Grok Bot (always-on agents with
their own computer), and an earlier persona-chatbot stab was dropped on
purpose (see `os-code/DECISIONS.md`). Copy stays honest: "while your computer
is on", never "always on". Routines run offline (CTO, 2026-09-29) with one
exception (founder, 2026-10-01): a headless run has no page fetch, network,
Codemagic, currents, specialist, vision or image tools, and a network-risk
call is denied rather than asked, and the run note says so; but `webSearch`,
and only it, stays when the person's "Let models search the web" switch is on
(carried to the machine as `routines.webSearch`, machine config), held by the
routine search guard (`os-code/src/core/security/routineSearch.ts`: result-only
backends, short plain queries, no search after a private read). Do NOT add a
per-routine web switch, and do NOT give a routine `webFetch`, without a
domain-allowlist design. Open follow-ups are in `os-code/PROGRESS.md`.

## OS Code, the terminal CLI, is supported again (founder, 2026-10-11)

The `osc` CLI in `os-code/` (parked 2026-08-18) is back as a supported way to
use OpenShore, keeping the name **OS Code** and every command already built
(`osc init`, `osc`, `pair`, `serve`, `attach`, `library` (once `market`, still
an alias), `doctor`, `stack`, `key`). It installs with `npm install -g @openshore/os-code` (`.github/workflows/cli-publish.yml`
publishes on a `cli-v*` tag once the `NPM_TOKEN` secret is set; the package
ships only `dist`, the bundled catalog, the example config and `NOTICE`), or
from source with `pnpm link --global`. The CLI and the apps share one engine,
so a change to the engine is a change to both; do NOT fork the agent loop for
the CLI, and keep `osc --help` working in a clean install
(`npm pack`, then install the tarball, then run it).

## The Local Library, never a market (founder, 2026-10-13)

The room once called the Marketplace is the **Local Library**: free and
communal, never a profit-based store. Copy says Local Library (the room id is
`library`, the screen `LocalLibraryScreen`, the CLI `osc library`); a saved
sidebar order that names `marketplace` maps to it (`lib/sidebarOrder.ts`).
`Marketplace` is a retired word in copy (`app/test/support/uiGuards.ts`).
Founder quotes and applied migrations keep their original words. Every model
in it runs on the person's own machines: cloud models live only in Cloud
Connections, under Frontier models (`lib/hosted.ts`, rendered by
`ConnectionsScreen`), and the library's Install by name turns an Ollama cloud
tag away there (`app/test/hosted.test.ts`).

## Connect anywhere: docking to a computer or a server (founder, 2026-10-07)

The main ways to give OpenShore a brain are a cloud provider on your key, a
model on this device, a model on your computer at home (docked over
Tailscale), and a model on a server you rent (a VPS, docked the same way).
The phone's room for docking is **Computer** (once Pairing); linking a device
to a machine is **docking** in copy. A server runs `osc serve` (installed by
`os-code/scripts/install-server.sh`, the signed package from
`openshore-releases`) and its yes is typed in the SSH terminal by
`osc pair --server`; it docks over the tailnet only, never a public bind.
Cloud Connections sets up a server beside the providers; a docked server
reads "Your server" everywhere (`app/src/lib/docking.ts`). The providers
under More providers list no typed model ids: their models load live
(`liveModels` in `app/src/lib/providers.ts`); Venice and OpenRouter were
removed (founder, 2026-10-15). Docking is free. Copy never says
a server is "always on" or private; renting is said plainly once. Plan and
follow-ups: `docs/design/connect-anywhere-proposal.md`, `os-code/PROGRESS.md`.

**Many machines, and a project chooses where it runs (founder, 2026-10-12).**
A device docks to any number of computers and servers (Computer offers your
computer, a server at home, and a rented server); each project chooses one
under **Runs on** in its room (`Project.runsOn`, or `THIS_COMPUTER` on a
desktop; unset follows the device), and each coding chat records the machine
its session opened on (`source.hub`) and only ever goes back there. The
chat's session, free chat, approvals, push, model menu, plan steps and
repositories follow its machine; the device's default machine (Default in
Your machines; on a desktop This computer or a docked one, `setDefaultMachine`,
which retired the "Run on another computer" switch, 2026-10-13) keeps the
Stack, the Vault on it and Agents, so choosing a project's machine never moves
the Vault. One pure rule, `app/src/lib/runsOn.ts`, read through the store's
`conversationWhere` and `newChatWhere`; never read `settings.daemon` for a
chat's own work. Copy says Runs on and machine, never "hub"; a server's place
(home or rented) is the person's answer, and only a rented one (or one of
unknown place) gets the renting line. `/health` reports memory, cores and
processor family (`daemon/machineFacts.ts`); the server package and installer
take arm64; no copy names a provider, ranks one, or promises Arm or a speed.

**Bring your own keys, any provider (founder, 2026-10-09)** is strictly the
person's keys: OpenShore runs no gateway, resells no model, rents no server
("Rent one for me" stays parked). Cloud Connections names eighteen providers,
the eleven newest behind More providers, every list live from the provider
on the person's key, and a key counts as checked only when a made-up one is
turned down. Any other provider connects in the Stack's Connect a model by
its address, in the OpenAI or the Anthropic format, ticking models from that
address's own list. "Passes requests to a cloud provider" (a gateway such as
LiteLLM) is stricter only: it makes a connection count as leaving, so private
notes never go to it, and never makes one local. A docked server can keep a
provider's key for its coding sessions (Cloud Connections, Keys on your
server; or `osc key add` over SSH), never checks it with the provider, takes
only https addresses off its own network, and copy never calls its store
encrypted (`os-code/src/auth/keyHome.ts`); routines and the free chat run
only on a local model, so they stop while a cloud model is the server's model. Plan: `docs/design/byok-any-provider-plan.md`; review:
`docs/security-privacy-review-2026-10-09-byok.md`.

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

## Search first, the Perplexity standard (gold standard, founder 2026-10-27)

"Open models knowing actual real world facts is not a reasonable
expectation." Outside coding, where a model is strongest in its own context,
a local model never answers from memory alone: the host searches before the
model writes a word, and the model answers from the numbered sources, citing
each claim as [n], trusting the sources over its memory, and saying plainly
where they disagree or do not cover the question. One pure rule,
`searchFirstQuery` in `os-code/src/harness/localSearch.ts` (through
`os-code/protocol`), decides what is left to the model: code, small talk,
arithmetic, an edit of text the person gave, a question about the chat. A
short follow-up searches with the person's previous message. `SearchTurn.first`
(`app/src/drivers/searchTurn.ts`) runs it as the message's one search, under
the same consent, Offline and after-private rules as any search; results are
numbered and kept one per address, so a reply's [1] is the first entry in
Sources. Every driver that speaks the SEARCH: protocol searches first, and the
store turns it on (`app/test/searchFirstStandard.test.ts`); "Let models search
the web" off stops it. Do NOT add a driver that answers a local model without
`search.first`, do NOT loosen the answer note into "cite if you like", and do
NOT claim accuracy numbers in copy until `osc eval` measures them (tenet 2).
Cloud seats are untouched for now.

## Project Wayfinder: every project its own environment (founder, 2026-10-27)

A project is set up the way an environment is in Claude Code. New project asks
for a name and opens the room; Runs on is the pill under the title, a pencil
beside the name renames it, and a red Delete project at the foot asks first;
the doors are Repositories, **Project Wayfinder** and **Agents**. There is no
active project: Chats and Recents list every chat, and a chat belongs to a
project only when started from it (`activeProjectId` is only the one-use
pointer for that).
Project Wayfinder holds Instructions, Network access (Full, Search only, None),
Environment variables and a Setup script, and each is wired, not decoration:
the instructions and a network line ride every chat's brief; network access
shapes the agent's own web tools (`ToolRegistryOptions.network`) and closes
every app-side search for None (`SearchTurn.closedBy`), and a revived session
keeps it; the variables live sealed per project on the device
(`app/src/lib/projectEnv.ts`), never synced or journaled, and ride a session
create only to the machine the project runs on, onto that session's commands,
a secret-looking value redacted from what the model reads
(`os-code/src/harness/projectEnv.ts`, `commandRunner`'s `env`); the setup
script runs once when a fresh session opens, owner only. Agents lists every
agent ticked, untick to leave one out (`Project.excludedAgentIds`,
`app/src/lib/projectAgents.ts`). Pins are retired: every project draws on the
whole Vault through the pack's retrieval, until the founder redesigns that
connection. The chat in a project fills any field through an
`openshore-project:<field>` card the person taps (`lib/projectActions.ts`);
the model never writes a field itself, since a script and variables run on the
person's machine. Copy never claims network access governs a shell command.
Guards: `os-code/test/projectEnv.test.ts`, `app/test/projectWayfinder.test.ts`.

## Chain of Thought is BUILT (off by default, founder 2026-09-25)

A Settings switch (Settings, Reasoning, `settings.chainOfThought`), OFF by
default. On, a model's reasoning streams into the thinking block above its
answer and folds to "Thought for Ns" when the answer starts, the way Claude
shows it. Native reasoners are asked through their own API (Claude's adaptive
thinking with `display: "summarized"`, Ollama's `think`, a server's reasoning
field); every other model is prompted to think in `<think>` tags. Off asks no
model to think and keeps any reasoning out of the chat. One pure core,
`os-code/src/core/agent/chainOfThought.ts` (through `os-code/protocol`), is
shared by the engine loop and every app driver; the app's live value is
`app/src/lib/chainOfThought.ts`; it rides to paired sessions as
`BootstrapOptions.chainOfThought`. Guards: `os-code/test/chainOfThought.test.ts`
and `app/test/chainOfThought.test.ts`. Do NOT turn it on by default (thinking
costs time on the reference box and money on a paid seat), and do NOT copy the
raw thought into history (the answer stays clean either way).

## Motion and interaction polish is a standard, not a nice-to-have (standing rule, founder 2026-09-02)

The bar: peaceful, tranquil, premium. "Smooth and
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

## Premium, simple, sharp: the UI guards (standing rule, 2026-10-07)

The Creative Studio and CMO review of 2026-10-07 (`docs/ux-review-2026-10-07.md`)
turned the seams it found into rules, so they cannot come back. One helper,
`app/test/support/uiGuards.ts`, runs eight rules over every UI source file
(`app/test/uiGuards.test.ts` for shared files, `uiGuards.<room>.test.ts` for
each room's own): a room with a large title tucks its bar title (BackBar
`titleHiddenUntil`); retired words stay out of copy; buttons size through
`.btn.sm` and `.btn.block`, never inline padding or width; carets, chevrons,
checks and emoji are drawn glyphs from `components/SheetGlyphs.tsx`, never
typed characters; `pill local` (teal) only for something local or private,
and state pills such as Active wear `pill ink`; the reach dot draws by class,
never an inline colour; icon sizes sit on one even scale; rows step through
the shared stagger (`.stagger-in` and an inline `--i`), never an inline step,
and an index always wears a class some rule reads it under. Beside them,
`polish-standards` holds every `:hover` inside a `(hover: hover)` or
`(pointer: fine)` block, so nothing stays tinted after a tap, and every press
on the `scale` property with a press token, and `contrast` holds every new
pair at AA. Spacing and depth on the structural selectors (room gutters,
cards, ledger rows, docks, the toast, sheets and their heads) are tokens,
`--gutter`, `--card-pad`, `--row-pad`, `--section-gap` and `--elev-1` to
`--elev-3`, held by `spacing-elevation.test.ts` (D22). Copy names the device
in hand through `thisDeviceNoun` (`lib/deviceNoun.ts`: "this iPad" on an
iPad, "this phone" elsewhere), never a typed "this phone" or "this iPhone"
(`deviceNoun.test.ts`). A new file is covered the day it lands. Every door to
Computer (once Pairing) says "Connect your computer"; a docked device's
Manage row there is not a door. The 23 larger calls the review held for
the founder (D1 to D23 in the review doc) were ruled on 2026-10-07 ("Do the
remaining recommendations"): each is built as its recommendation says.

## Project trust is a rule, not a feature (standing rule, 2026-09-27)

A repository's own `os-code.config.json` is a proposal, never the person's
settings. It can make OpenShore stricter from any folder; anything that
loosens it (its check command, allow rules, model choices) applies only once
the person trusts that folder on this machine; and machine config (model
servers, key variable names, the vault folder, the catalog, trusted repos)
never comes from a project file at all. Every config key is classified in
`os-code/src/config/projectPolicy.ts`, and `os-code/test/projectTrust.test.ts`
fails on an unclassified key and holds one test per attack vector. A new
config key is not done until it is classified there. Trust and "always allow
in this project" grants live on the machine (`~/.os-code/trust.json`), never
in the repo. "Local" is judged by address (`isLocalHost`, `leavesThisNetwork`),
never by a provider's config label, and a seat by `seatLeaves`, which adds the
model's name: an Ollama cloud tag (`:cloud`, `-cloud`) leaves this network
though its server is localhost (privacy review, 2026-10-08).

## This build is Personal: release tiers (standing rule, founder 2026-09-27)

v1 is **Personal**: one person, their desktop and their own phone. Chats,
Projects, Terminal, Repositories, Stack, Vault, Agents (routines), Cloud
Connections, Computer (docking; once Pairing), the Local Library (v1 since
2026-10-11, founder, so the community can help build it; community reviews
stay off, `REVIEWS_OPEN` in `lib/reviews.ts`, until a migration grants review
writes back), and Settings. v2 is Agentic and Harness Currents, Stack Health,
and Launch with Codemagic; v3 is reserved;
v4 Enterprise (Admin, teams, shared projects, the team vault, project
permissions, shared-hub members). "Build personal for now and get that working
fully." One gate, `app/src/lib/focus.ts` (`featureOn`, `roomOpen`,
`RELEASE_TIER`): a build is Personal unless `VITE_RELEASE_TIER` names a later
tier, and nothing shipped sets it. Later tiers' code stays in the tree with
every door shut and no launch-time work. The suite runs at tier 4;
`app/test/tierPersonal.test.ts` reloads the modules as a Personal build. A new
feature names its tier in `FEATURE_TIER` before it has a door; a v1 room never
depends on a later tier; unlocking a tier is a founder call recorded in
`os-code/DECISIONS.md`. The Currents sections below describe built v2 code, not
the shipping build. `docs/release-tiers.md`.

## What leaves this device is a list, not a claim (standing rule, 2026-09-27)

Everything OpenShore sends off a device is written down once, in plain words,
in `app/src/lib/egressManifest.ts`, and shown under Settings, Privacy, "What
leaves this device". `app/test/egressManifest.test.ts` fails on any host in
`app/src`, `app/electron`, or `os-code/src` that is neither on that list nor
marked link-only with a reason. A new call to a new service is not done until
its entry says what it sends and when. Copy never claims more privacy than the
list shows.

## Accounts: chatting is free, the rest is a free sign-in (standing rule, founder + CX 2026-09-27)

No account for chatting (Harbor Lite and Harbor, the Stack, a model you
connect); everything else (the coding agent, Projects, Terminal, Repositories,
Vault, Agents, Cloud Connections, pairing) opens a sign-in sheet instead, and
signing in carries on. A build with no account backend stays open. Nothing
resets for a signed-out person (CX advised against the founder's reset; the
founder deferred to CX): the benefit of signing in is additive, eight plain
preferences that follow the person to every device, riding the account's own
user record, never the settings blob. Two classifications are the rule, each a
type error until complete: every room in `app/src/lib/accountGate.ts`
(`ROOM_ACCOUNT`), every AppSettings key in `app/src/lib/settingsReach.ts`
(`SETTINGS_REACH`). A new room or settings key is not done until it is
classified there; prompts, work, addresses, keys and consents never follow.
`app/test/accounts.test.ts` holds it; `docs/accounts-cx-memo.md` is the why.
In-app account deletion is BUILT as one design (2026-09-29, CTO 11 package C:
main's `delete-account` planner and answer, the privacy function's legal-hold
copy, and 0022's service-role `account_deletion_` functions for the guarded
team delete, the operator-only tombstone and the email cleanup; the Settings
row reads either function's answers). It is live: 0021 to 0026 applied and
main's function deployed, both 2026-09-30 (`docs/vault-gate1-runbook.md` 7.4). The published
address is one constant, `SUPPORT_EMAIL` (support@openshore.ai, founder F1
2026-09-30), and `app/test/contactAddress.test.ts` holds 0022's ladder and
the Terms to it.
Nothing is paid (open source, founder 2026-10-11): the OpenShore Plus gate,
its paywall, the in-app purchase and the `VITE_PAY_GATES` flag are removed,
and every room and action meets only the free sign-in above (`requireAccount`
in the store). Stopping, revoking, forgetting and exporting never need even
that. The only billing code left is a commercial org's team seats, a later
tier with its door shut (`lib/entitlement.ts`, `growthGatedByBilling`).
`app/test/personalReady.test.ts` holds that the paywall stays gone. Do NOT
bring back a paid gate on a person's own rooms without a founder ruling in
`os-code/DECISIONS.md`.

## Open source: Apache 2.0, and the company keeps the ship (founder 2026-10-11)

OpenShore is open source under the Apache License 2.0 (`LICENSE`, `NOTICE`).
The founder's terms: the code is open, but Open Shore LLC keeps sole say over
what ships and owns the repository, the apps, and the names. That is held by
three files, not by the license: `TRADEMARKS.md` (OpenShore, OS Code, Harbor,
Harbor Lite, DeepBlue and the logo stay Open Shore LLC's; a distributed fork
renames), `CLA.md` (contributors keep their copyright and grant a license
that includes relicensing, so the company can change terms later; payment is
never owed), and `CONTRIBUTING.md` (maintainers decide what merges and ships;
rewards are discretionary, never promised). Every `package.json` says
`Apache-2.0`. Keep contributor-facing copy to those terms: never promise
payment, a merge, or a say in the roadmap.

## The premium build's standing rules (2026-09-29)

Built from a whole-codebase review (`docs/next-build-2026-09-29.md`); every
package's notes and the advisor rulings are in `docs/design/build-2026-09-29/`. Each
rule is pinned by tests; keep them:

- **Every model reply streams, and Stop answers at once.** One provider client
  (`app/src/drivers/providerClient.ts`); Electron streams through the guarded
  `osc:chatStream` channel, iOS through the WebView with one fallback. Stop
  closes the turn immediately and the partial answer stays in the chat and its
  history. A new seat or driver is not done until it passes the abort tests.
- **The engine budgets against the window a local model is served**, never its
  native one (`os-code/src/providers/servedWindow.ts`); `numCtx: 'auto'` is
  not a default until the reference box says so (tenet 2).
- **Every desktop update is verified** against pinned Ed25519 keys
  (`app/electron/releaseVerify.ts`, `releaseKeys.ts`); a download that runs code
  without `verifyAsset` fails the guard in `app/test/releaseVerify.test.ts`.
  Founder steps: `docs/release-signing.md`.
- **No secret rides a child process's environment** (`os-code/src/core/exec/childEnv.ts`),
  with one narrow exception: a project's own Project Wayfinder variables, which
  the person typed for it, sit on that session's commands, never journaled and
  redacted from output (below); and **lockdown is enforced at the one execution
  seam** (`executeCall`), never by registry composition alone.
- **The tier-1 bundle carries no later-tier code**: later rooms are gated at
  build time (`SHIPS_*` in `app/src/lib/focus.ts`), and CI runs
  `pnpm --filter oscode-app check:bundle`.
- **Migrations are pushed from `main` only**; a held branch renumbers its
  migrations above main's newest and production's newest when it merges
  (CTO 4, CTO 11; see the migration history rule below).
- **New store logic goes in a sibling module** (`state/gateOps.ts` and its
  kind), with `store.ts` only wiring it in, until the store split (Launch and
  Repositories first) opens the next build.

## Production's migration history is the authority on numbers (standing rule, CTO 11, 2026-09-29)

Production's migration history is the authority on numbers. Migrations go to
production from main only (CTO 4). Every applied file is pinned in
`supabase/production-history.tsv` and never edited or renumbered (CTO 11). A
new file takes the next number above both main's newest and production's
newest, and every push uses `--skip-vault`. Production holds 0001 to 0027 and 0029 to 0032 (0032 on 2026-10-21; 0028 is unused, passwordless moved from it to 0031 before it went in); its
0019 and 0020 are the privacy branch's files (pushed 2026-09-24), held on main
byte for byte, main's Org Vault v1 file is `0021_org_vault_v1.sql`, and 0021 to
0026 went in on 2026-09-30 through the SQL editor, the founder's call, each
file guarded with its history row and checked by md5 afterwards (DECISIONS), and
0027 (privacy minimization) went in the same way on 2026-10-02. Only
`docs/vault-gate1-runbook.md` pushes, after `supabase/scripts/push-preflight.mjs`;
the session that records a push appends its rows to the history file in the
same change; a session branch that adds a migration says in its commit and
PROGRESS that the file is unapplied. A local database gets its throwaway Vault
key from `supabase/scripts/local-vault.sh`, never from a committed
`[db.vault]`. Guards: `app/test/supabaseMigrations.test.ts`, CI's `sql` and
`sql-replay` jobs, and `.github/workflows/migrations.yml`. The privacy branch
(`claude/openshore-privacy-mobile-1ij12h`) is harvested in packages, never
merged whole (DECISIONS, CTO 11).

## Security and privacy: the Proton standard (standing rule, founder 2026-10-01)

"I only want to keep the bare minimum data required to run the application.
Use Proton as a gold standard North Star." Before a release, and before any
change that adds a network call, a stored field, a table, a log line, a
third-party service, or a privacy claim, run the CTO's checklist,
`.claude/skills/security-privacy-review/SKILL.md`. Claims are code: the site,
the app, the privacy policy, `PrivacyInfo.xcprivacy` and App Store Connect say
only what the code does. The first run and its open items are
`docs/security-privacy-review-2026-10-01.md`.

## Em dash policy is TOTAL here (standing rule)

No em dash anywhere in tracked source, comments included, encoded spellings
too. Use a period, a comma, or a rewrite. `test/em-dash-policy.test.ts` in both
`os-code` and `app` enforces it and fails the build on any violation. This is
deliberately strict, because OS Code started under the rule.

## Agentic Currents and Wayfinding are BUILT (BETA, 2026-09-09)

The founder's frame: OpenShore takes on new agent tech by connecting to it and
layering it in, never by reshaping the familiar rooms. **Wayfinding** (memory,
skills, browser) is how the agent finds its way, default on, an app-level
Settings group. **Agentic Currents** (Hermes Agent, CLI Pairing, Vellum,
OpenAGI, A2A) are opt-in modalities for agent work, default off, a BETA, ONE on
at a time WITHIN A PROJECT: flip one on and the same rooms gain rows for it;
flip it off and every trace is gone. The rules are code, not memory: the pure
core is `app/src/lib/currents.ts`, the engine side is `os-code/src/currents/`
plus the `askHermes`, `askAgent`, and `cliAgent` tools, and
`app/test/currents.test.ts` holds the guards (the two-part gate, every current
fills every contribution slot, no room names a current itself, and per-project
selection). Do NOT add a room for a current, do NOT hardcode a current's name
in a room (render through `activeContribution`), and do NOT call a current
"always on". "Currents" is the CMO and Creative Studio's name; "Layers" was
retired; "frontier" stays reserved for cloud models. Open follow-ups are in
`os-code/PROGRESS.md`.

## Currents are chosen PER PROJECT (founder, 2026-09-23)

Both current groups (Agentic and Harness) are a per-project choice, not an app
setting: a current is a workflow requirement, so different projects run
simultaneously with different currents. The SELECTION lives on the project
(`Project.agenticCurrent`, `Project.harnessCurrent`); CONNECTING one (its
endpoint + key) stays device-local and connect-once (`settings.currentConnections`,
`settings.harnessCurrentConnections`, the same secret keys), reached from the
project row's connect sheet. The UI is `app/src/components/ProjectCurrents.tsx`,
rendered in `ProjectDetailScreen` (editors only), and is GONE from
`SettingsScreen`. Every global room (the pill, water-line, Bench, Agents, Vault)
and each session's handle read the ACTIVE project's selection via
`agenticView(settings)` / `harnessView(settings)` (both derive from
`activeProjectOf(settings)`, since `projects` and `activeProjectId` live in
settings). Forgetting a device-local connection sweeps that current off every
project. Do NOT reintroduce an app-level current selection; keep the pure
functions taking a `CurrentsSettings`/`HarnessCurrentsSettings` view built from
the project.

## Harness Currents are BUILT (BETA, founder 2026-09-23)

A second, independent Settings group ABOVE Agentic Currents. Where an Agentic
Current is a modality for agent work (an external agent you hand a task to), a
**Harness Current** layers a cheap decision method INTO the harness: it does
not answer for a seat, it steers which seat answers and whether a step is
needed, so you use any of your models with the method applied. The two groups
are independent, so one of each can be on at once; within the harness group it
is one at a time, the same rule the agentic group holds, with the same arrival
animation, water-line, and two-part gate. Like the agentic group, the SELECTION
is per project (`Project.harnessCurrent`, 2026-09-23); the connection is
device-local and connect-once. See "Currents are chosen PER PROJECT" above.

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

The rules are code: the pure core is `app/src/lib/harnessCurrents.ts` (its
roster, gate, contribution, handle, and `projectHarnessSettings`; the selection
is `Project.harnessCurrent`); the wire shapes and the reusable client are
`os-code/src/currents/model.ts` and
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
   cloud call is a card the person taps, except a model the person placed in
   a Stack chat's slot, which answers there with no card of its own (founder,
   2026-09-25); on the computer, the coding agent asks before a cloud model's
   first step in each task, a placed specialist's included (CX and CMO,
   2026-10-08). Teal is local, amber is cloud and spend.
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
mined machine-wide on a shared hub. Pricing is not harness work.
