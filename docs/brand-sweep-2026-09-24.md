# Brand sweep, 2026-09-24 (Creative Studio)

The founder asked the Creative Studio to sweep the whole app after the first
open's Tide Letter and Swell Line, to keep the brand consistent everywhere.
Four Studio passes read the code (chat surfaces; setup and settings; the stack
and the rooms; the design system) and reported ranked findings with file
references. This is the merged plan. Nothing here is built yet: the Studio
shapes, the founder chooses.

**The read.** Motion is the healthiest part of the app, and the guards hold it.
The damage is in facts and words: copy never caught up with Harbor's recast, the
Marketplace going Coming soon, or the pay gates switching off, so screens
disagree with each other and with Harbor Lite's fact cards. Color meaning has
drifted: teal is used as the generic accent (a destructive delete is teal; a
BYOM pointed at someone's cloud wears the teal "private" chip) and amber has
leaked into "waiting" and "plan mode". One machine has six names. And the first
frame in dark mode is a cream bouncing splash, in the motion language the Swell
Line replaced.

## Decisions for the founder

1. **The stack's name. Decided (founder, 2026-09-24): "Stack".** No "Your" or
   "My": the room is Stack, the model sheet row is Stack, and copy says "your
   stack" only as plain English mid-sentence where a possessive reads naturally
   ("add it to your stack"), never as a name.
2. **The machine's name.** Retire hub, desktop, machine, the box, home system in
   anything a person reads. Recommendation: **your computer** (and "My computer"
   only as the model-sheet row that means "answer on my computer").
3. **Room-name casing.** Recommendation: Title Case only for proper nouns (My
   Crew, Cloud Connections, Stack Health, Harbor Lite, DeepBlue, Vault,
   Wayfinding); Sentence case for everything else (Stack, Desktop + phone,
   Crew command, Launch with Codemagic).
4. **Prices on screen.** Tiers in `plans.ts` ($20/$100/$250) disagree with
   CLAUDE.md ($50/$100/$250/$500/$1000), and pricing is a Board gate.
   Recommendation: show headcount bands with no prices until the Board rules.
5. **Harbor's license line.** The Studio believes Qwen2.5-Coder-3B ships under
   the Qwen Research license, not Apache 2.0 as the code comments and the
   DeepBlue attribution say. Verify on the model card before any copy changes.

## Wave 1: trust (P1, mostly small)

| #   | Where                                                             | What                                                                | Fix                                                                                               |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | SettingsScreen.tsx:445                                            | Privacy sheet: Harbor is "Qwen3-1.7B", "neither guide is a coder"   | Current facts (Qwen 2.5 Coder 3B, a coder that does not edit files; Harbor Lite is SmolLM2-135M)  |
| 2   | harbor.ts:37                                                      | Byline calls Harbor "a coding agent" (the agent is DeepBlue)        | "A coding model that runs fully on your phone. It writes and explains code and searches the web." |
| 3   | setupGuides.ts:95,104; StackScreen.tsx:295; StartingPaths.tsx:287 | Four doors into the closed Marketplace                              | Point at Your stack and Settings, Harbor; rewrite pick-a-model                                    |
| 4   | AccountSetup.tsx:48; Paywall.tsx                                  | "$20 a year", "the Marketplace", "OS Code" while gates are off      | Price behind `PAY_GATES_ENABLED`; drop Marketplace; "OpenShore"                                   |
| 5   | Composer.tsx:144                                                  | The model pill says "Claude" for every cloud model, OpenAI included | Label from `sourceLabel`                                                                          |
| 6   | theme.css:2257                                                    | Plan mode wears amber (spend) though it costs nothing               | Ink for Plan; amber only for spend                                                                |
| 7   | ChatScreen.tsx:779 + Composer.tsx:489                             | Dismissing the model chooser drops a held first message             | Restore it to the field, toast "Kept your message"                                                |
| 8   | ApprovalSheet.tsx:93                                              | "Approve runShell": a raw tool name at a trust moment               | "Run a command", "Edit a file"                                                                    |
| 9   | theme.css:1372                                                    | White on teal fails contrast in dark ("Switch to a local model")    | `color: var(--bg)`                                                                                |
| 10  | CrewScreen.tsx:341; CrewCommandScreen.tsx:1051                    | Remove and Delete are teal primary buttons                          | One confirm grammar: Keep, then `btn danger`                                                      |
| 11  | StackManager.tsx:70                                               | Every BYOM gets the teal "your server" chip, even a hosted API      | Teal only for localhost, private IPs, `.ts.net`; else amber "cloud"                               |
| 12  | CurrentConnectSheet.tsx:175; HarnessCurrentConnectSheet.tsx:132   | "Forget" in one tap removes a current from every project            | Confirm first                                                                                     |
| 13  | index.html:9; capacitor.config.ts:9; electron/main.ts:598         | Dark mode opens on a 2.7 s cream splash, then cuts to dark          | Dark splash, `color-scheme: light dark`, dark shell backgrounds, sync `theme-color`               |

## Wave 2: one voice (P2)

- **Glossary** (below) applied everywhere: Desktop + phone (not "Desktop and
  phone", "Desktop connection"), Set up (verb, never "Setup"), API key,
  repository in copy, Address for any endpoint field, "What it has learned" for
  project memory (four names today).
- **Color meaning split.** Add `--accent` for UI chrome (primary buttons, focus,
  selection) and `--attention` for "needs you"; keep `--local` teal for local
  only and `--cloud` amber for spend only. Selected chips and "Active" pills go
  ink. The Harness Current connect uses `btn cloud`. Tokenize the 66 raw
  rgba/hex literals and the hero gradients so dark mode follows.
- **Undesigned states.** Desktop stack loading (reads "Not set up yet" before
  status lands); Stack Health error and unreachable with no way forward; merged
  "no jobs, or the box did not answer" states; the empty Chats list with no
  "Start a chat"; raw `err.message` toasts mapped to plain lines.
- **"Arriving"** only for not built yet; "Not set up" and "Not answering" for the
  rest.
- **Sheets.** Close button on "Which status?", "Who runs the show?", and both
  current sheets; `role="dialog"` and `aria-modal` on `Sheet`.
- **Copy.** "Default" mode renamed "Ask first" (it is not the default); Clarify
  "One thing first." / "A few things first."; "Stop" not "Kill"; "Cloud models" /
  "Local models" in the model sheet; retire "Always on" (Harbor Lite's byline:
  "Built in. Works offline. Here from first launch."); greeting lines that lean
  hustle ("Fueled up and ready?") swapped for calm ones; the "Uki Audio"
  placeholder and the "ones we host" line removed.
- **Motion strays.** Spring on the Stack Health rings and the confirm card; raw
  per-item delay in Stack Health; the thinking body snapping; the tool-card
  flash snapping off; the greeting swap on the spring.

## Wave 3: the system (P2/P3, larger)

- A type scale (`--text-1..8`, three weights) replacing 33 sizes (8 half-pixel)
  and 8 weights.
- Radius tokens (`--radius-sm`, `--radius-md`) replacing 17 pixel values.
- One `<Icon>` with a stroke token (1.8, and 1.4 hairline) replacing 11 stroke
  widths across 46 inline SVGs.
- One dark theme block instead of two copies kept in sync by hand.
- Preload Fraunces so the splash never swaps fonts mid-rise.
- `hapticApproval` split from "setting turned on" (`hapticCommit`).
- **Guards**, so it stays true: `color-tokens.test.ts` (no raw color outside the
  token blocks; fallbacks equal their tokens; the dark blocks identical),
  `type-radius-scale.test.ts` (sizes, radii, weights, and inline TSX values on
  the scale), `copy-glossary.test.ts` (retired strings banned in UI text; room
  names match one list; `--cloud` only on spend selectors). Pin `--ease-ink`
  and `--dur-swell` in `motion-tokens.test.ts`.

## Moments (pick two or three; restraint is the brand)

1. **The splash, as a swell** (recommended). Replace the squash-and-stretch
   bounce with the mark rising 0.14em, cresting, and settling on `--ease-ink`,
   in both themes. It is the first frame everyone sees, and today it speaks the
   rejected language.
2. **The everyday greeting on a swell** (recommended). The empty chat's landing
   line rolls in on the Swell Line once per session; a tap skips. The most-seen
   screen then sounds like the first-open letter.
3. **Docked.** When a phone pairs, "Docked." rolls in once on the swell with one
   success haptic, in place of a toast: the one time the product says "you are
   home".
4. **Slack water.** When an agent turn ends with changes, the changed-files card
   settles as one low swell and its rows step in, with one tick.
5. **The anchor takes the helm.** When the Reasoning LLM changes, its name rolls
   in on the swell and the location chip cross-fades teal or amber.
6. **The morning note lands.** A finished routine's "Done today" count rises and
   a thin teal line draws under it: a note reached your vault, kept local.

## Glossary

| Right                                              | Retire                                              |
| -------------------------------------------------- | --------------------------------------------------- |
| OpenShore                                          | Open Shore, OS Code (in UI)                         |
| Harbor Lite, Harbor, DeepBlue                      | harbor lite, Deep Blue                              |
| Your stack (room), your stack (in a sentence)      | Your Stack, My Stack (pending decision 1)           |
| your computer                                      | hub, desktop, machine, the box, home system (in UI) |
| Desktop + phone                                    | Desktop and phone, Desktop connection               |
| My Crew, Crew command                              | my crew                                             |
| Cloud Connections, Stack Health, Vault, Wayfinding | Cloud connections                                   |
| Set up (verb)                                      | Setup                                               |
| API key                                            | key, token (except Pairing token)                   |
| repository (copy), Repositories (room)             | repo (in copy)                                      |
| Address (an endpoint field)                        | Endpoint URL, Hub address, Desktop address          |
| What it has learned                                | Historical knowledge, Project notes (as a name)     |
