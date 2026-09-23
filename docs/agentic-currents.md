# Agentic Currents and Wayfinding

How OpenShore takes on new agent tech without reshaping the familiar app. The
founder's frame (2026-09-09): the app evolves by connecting to new features and
layering them in. Two groups in Settings hold that promise.

## Wayfinding (default on)

How the agent finds its way. Three switches, on unless turned off:

- **Memory.** The agent keeps project notes in the vault and reads them back
  into every session there.
- **Skills.** Reusable recipes the agent wrote or you gave it, as markdown it
  reads before it builds.
- **Browser.** A driven browser on the paired computer. Every action asks
  first. Docked only.

The name is the Creative Studio's: "Navigation" already means the side panel
in this codebase, and memory, skills, and a browser are how the agent finds
its way.

## Harness Currents (default off, BETA, one at a time, above Agentic Currents)

A second, independent group, sitting above Agentic Currents. Where an Agentic
Current is a modality for agent work (an external agent you hand a task to), a
Harness Current layers a cheap decision method INTO the harness. It does not
answer for a seat; it steers which seat answers and whether a step is needed,
so you use any of your models with the method applied. The two groups are
independent, so one of each can be on at once; within the harness group it is
one at a time, with the same arrival animation, water-line, and two-part gate.

| Current | What it does                                                                                                                                                                                                                                                                                                                   | What lights up when on                                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jev     | TypeSafe AI's System One decision model. Only when a paid/cloud seat would answer, it does three jobs: an escalation gate (can a cheaper local seat carry this turn), a task classifier (route to the seat placed for this kind of work), and a verify judge (does the result satisfy the task when there is no check to run). | A pill beside the reach pill, and each decision as an amber (cloud spend) card in the transcript. No Bench, Crew, or Vault row: it is not a model or an agent. |

Jev is a cloud call that costs a little per turn, so it is scoped to a paid seat
on purpose: there is nothing to save against a free local model, and a cloud
call would only add latency and break the offline floor. The copy never claims a
dollar saving until `osc eval` shows the number on the reference box (harness
tenet 2). Naming: the harness ordinarily ships with no room and no name (tenet
1); this one visible group is a deliberate, founder-approved supersede
(2026-09-23). The internal codename Keel stays out of copy; Jev is a real
connected product name, the way Hermes is named in the agentic group.

### The rules the code holds (harness group)

1. **Its own scalar.** `settings.harnessCurrent` is a single id or none,
   independent of `settings.agenticCurrent`, so a harness current and an agentic
   current can be on together while each group stays one-at-a-time.
2. **The two-part gate.** Same as the agentic group: On only when the toggle is
   on AND a live probe answered (Jev answers `GET /v1/models` under its base).
3. **No room names a harness current.** Rooms render it only through
   `activeHarnessContribution`; `app/test/harnessCurrents.test.ts` greps the
   source and the stack driver names Jev through the roster, never as a literal.
4. **Off leaves no trace.** With none on, `activeHarnessContribution` is
   undefined and nothing (pill, water-line, routing, card) is added.

### The code (harness group)

- Pure core: `app/src/lib/harnessCurrents.ts` (roster, the gate, the
  contribution, the handle, `activeHarnessId`). Probe reuses
  `probeOpenAiCompatible` in `currentsProbe.ts`.
- Wire shapes and the reusable client: `os-code/src/currents/model.ts`
  (`HARNESS_CURRENT_IDS`, `JevHandle`, `parseHarnessCurrentsHandle`) and
  `os-code/src/harness/jev.ts` (`JevAdvisor` with `steer`/`judge`, the System
  One client), both exported through `os-code/protocol`.
- App: the group and `HarnessCurrentRow` in `SettingsScreen.tsx`,
  `HarnessCurrentConnectSheet.tsx`, the amber pill in `ProfileStatus.tsx`, the
  water-line OR-in in `CurrentArrival.tsx`, the `harness-current` card in
  `transcript.ts`, the store state/actions (`harnessCurrent`,
  `harnessCurrentConnections`, `harnessCurrentProbes`,
  `setHarnessCurrent`/`connectHarnessCurrent`/`disconnectHarnessCurrent`/
  `refreshHarnessCurrents`), and the steer in `stackDriver.ts`. The handle rides
  a session through the daemon and the electron bridge like the agentic one.
- Engine: the verify judge in `core/agent/loop.ts` (`maybeJevJudge`, cloud seat
  only, dropped under egress lockdown), threaded through `bootstrap.ts` and the
  daemon `POST /sessions`.
- Guide: `connect-jev` in `setupGuides.ts`.

## Agentic Currents (default off, BETA, one at a time)

Opt-in modalities for agent work. Flip one on and the same rooms gain rows for
it; flip it off and every trace is gone. The five in the first beta:

| Current      | What has to exist                                        | What lights up when on                                                       |
| ------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Hermes Agent | A Hermes box on your tailnet with its API server on      | Bench model, Crew member with its jobs, a Vault folder, the `askHermes` tool |
| CLI Pairing  | Claude Code or Codex on the paired computer              | Crew member, the `cliAgent` tool (a shell run you approve)                   |
| Vellum       | No documented API yet; an A2A card or `/v1` if yours has | Arriving row; connects through whichever door answers                        |
| OpenAGI      | No network API yet; an A2A card or `/v1` if yours has    | Arriving row; connects through whichever door answers                        |
| A2A          | Any agent that publishes an agent card                   | Crew member named from the card, the `askAgent` tool                         |

"Currents" is the CMO and Creative Studio's name (water in motion through the
familiar app); "Layers" was retired as a mechanism word. "Frontier" stays
reserved for cloud models on a paid key.

### The rules the code holds

1. **One at a time, everywhere.** `settings.agenticCurrent` is a single id or
   none, so exclusivity is structural. Turning one on turns the other off.
2. **The two-part gate.** A current is On only when its toggle is on AND a
   live probe answered (`currentState`): on, arriving, ready, or off. Nothing
   is a hardcoded flag; iCloud's runtime probe is the precedent.
3. **The mirrored pattern.** Every current fills the same contribution slots
   (bench, crew, vault, tools, guide, header) or names the reason it cannot
   (`contributionFor`). A test refuses a current that leaves a slot silent, so
   the modality reads the same whichever is on.
4. **Off leaves no trace.** Rooms render a current only through
   `activeContribution`, never by naming one. `app/test/currents.test.ts`
   greps the source: the proper nouns may appear only in the core, the probe,
   the guides, the Settings screen, and the connect sheet. Turning a current
   off also purges its bench model from every status's stack.
5. **Honest copy.** A current that has not answered reads Arriving with what
   it needs. The arrival animation is a gesture, not a progress bar. Hermes and
   any A2A agent run on their own computer under their own rules; the tools say
   so to the model, and the rows say so to the person.

### How it is felt (Creative Studio; the Siri replica, founder 2026-09-14)

A replica of the iOS Siri glow in the brand's own water, read frame by frame
from the founder's screen recording. Flip a current on and a soft bloom rises
from where the switch sits, then a thick multi-hue ring lights the whole
border with a glow bleeding inward, and settles into a thin ring whose hues
keep drifting around the perimeter for as long as the current is on. Flip it
off and the ring brightens once, drains, and the bloom sinks back into the
switch. The palette is OpenShore's, never Siri's pink and purple: deep water,
water, shore teal, a light aqua for the highlight, and the amber counterpoint
(`--current-1` to `--current-5`, deeper on paper, brighter in the dark).
The ring is a masked frame whose conic gradient rides an oversized rotating
square, so the drift is transform only; the bloom is a gradient with a long
falloff, no filter; the glow is the one blurred layer and it is short-lived.
The flourish lasts about three door clocks, then the persistent ring carries
on alone, thin, faint, breathing on a five-second loop. The global
reduced-motion reset stops the drift and collapses the rest to a crossfade.
One decisive haptic when the ring is lit, never a run of ticks. A pill beside
the reach pill names the current on every screen. The BETA badge is a neutral
pill after the group head, with one line under it: "An imperfect addition we
are exploring. One on at a time. Off leaves no trace."

## The code

- Pure core: `app/src/lib/currents.ts` (rosters, the gate, the contribution
  contract, the handles). Probes and read clients: `app/src/lib/currentsProbe.ts`.
- Settings: `SettingsScreen.tsx` (the Wayfinding group and the Agentic
  Currents group with `CurrentRow`), `components/CurrentConnectSheet.tsx`.
- The arrival and the water-line: `components/CurrentArrival.tsx`, mounted in
  `App.tsx`; the header pill in `components/ProfileStatus.tsx`; CSS at the end
  of `theme.css`.
- Rooms: the bench in `StackManager.tsx` (a BYOM-shaped ref keyed
  `current-<id>`, with the Hermes session header added in `stackDriver.ts`),
  the roster and the jobs section in `CrewCommandScreen.tsx`, the folder and
  the read-only note sheet in `VaultScreen.tsx`.
- Store: `wayfinding`, `agenticCurrent`, `currentConnections` (device local),
  `currentProbes`, `currentsHost`, `currentArrival`; actions `setWayfinding`,
  `setAgenticCurrent`, `connectCurrent`, `disconnectCurrent`, `refreshCurrents`.
  The active current's handle rides into every session (desktop bridge and
  daemon alike) as `currents`.
- Engine: `os-code/src/currents/model.ts` (shapes, exported through
  `os-code/protocol`), `os-code/src/currents/host.ts` (the host probe and the
  jailed, markdown-only Hermes home reader), tools `askHermes`, `askAgent`
  (A2A `message/send`), `cliAgent` (a shell run, always asks on the headless
  and remote profiles), registered only when a handle was delivered and never
  under egress lockdown. Daemon routes `GET /currents` (any member) and
  `GET /currents/hermes/notes[/<path>]` (admin only). Electron IPC parity:
  `currentsProbe`, `hermesNotes`, `hermesNote`.
- Guides: `connect-hermes`, `cli-pairing`, `connect-a2a` in `setupGuides.ts`.

## Verification

Unit tested end to end on the pure core, the tools, the daemon routes, and the
guards (`app/test/currents.test.ts`, `os-code/test/currents.test.ts`,
`os-code/test/daemonCurrents.test.ts`). Not runnable in a web session and in
What remains: the arrival on a phone, a real Hermes box answering over
Tailscale (the `/v1/models` probe, the `/api/jobs` list, the home folder read
through the daemon), a paired CLI running headless, and an A2A agent card.
