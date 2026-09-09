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

### How it is felt (Creative Studio)

Flip a current on and a current leaves the switch, travels to the edges of the
screen, and settles as a faint water-line framing every room while it is on.
Flip it off and the line ebbs back to the switch. No third blue: it rides the
flow tokens (`--wave`, `--local-soft`). It moves on the door clock and the
glide curve like the drawer, animates transform and opacity only, and the
global reduced-motion reset collapses it to a crossfade. One decisive haptic
when the current reaches the border, never a run of ticks. A pill beside the
reach pill names the current on every screen. The BETA badge is a neutral
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
