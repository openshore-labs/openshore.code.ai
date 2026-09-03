# Working notes for Claude, OS Code (openshore.code.ai)

## Read PROGRESS at session start (standing rule)

`os-code/PROGRESS.md` is the recent-state source of truth for OS Code: current
state first, then "What remains," then the log. Read it at the start of every
session before other work, so a fresh session picks up where the last one left
off. `os-code/DECISIONS.md` records one line per ambiguous call; skim it when a
design choice looks already settled.

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

Do NOT re-surface these as unbuilt or re-scope them from scratch. The one open
follow-up is Vault's ORGANIZATION tier (a real multi-writer backend), tracked
as its own item in `os-code/PROGRESS.md`. The original build prompts are kept
in that file as historical reference only.

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
