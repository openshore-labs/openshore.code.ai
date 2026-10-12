# The Stack page, reviewed and rebuilt (2026-09-15)

Founder brief: "Have this same team now audit the stack page in the same
fashion." Same three seats (CTO, Creative Studio, CX), same shape: the read, the
direction they agreed on, and what shipped. Advisory as always; the founder
decides, and it is on a branch, not `main`.

First, a scoping note the CTO raised: the screenshot is the **phone** view. On a
phone the Stack page renders `StackManager` (the app-native stack the person
carries everywhere); the desktop path renders a different, older `StackScreen`.
So the audit target is `StackManager`, and the desktop screen surfaces its own
finding below.

## The diagnosis

The page is the control room for the whole plan-first workflow (one Reasoning
LLM plans and routes to specialists), and 75% of the work runs on the stack it
describes. But it was drawn as a flat settings list: a status card, then a
Reasoning LLM card, then a bare "Image reading" heading and card, then "Active
stack", then "Bench", every one the same `.card` with the same weight.

### CX (the evidence read)

- **The premise is invisible.** The whole idea is a system, one model that plans
  and routes to specialists. The page never showed that relationship; it listed
  parts. A person could not see their stack as a pipeline (anchor, then the
  specialists it routes to, then the reserves on the bench).
- **The anchor did not read as the anchor.** The Reasoning LLM "runs the show,"
  yet its card looked identical to a benched 1.5B waiting to be placed. The one
  required, load-bearing choice had no more weight than an optional one.
- **You could not read your stack's posture at a glance.** Which models are
  local and private, which are cloud and spend? The app has a precise color
  language for exactly this (teal local, amber cloud), and the page barely used
  it. "kind" showed up as a small text pill in one place and not at all in
  others.
- **"Image reading" floated between headings** with no relationship to the
  specialists it belongs with, so the two-slot vision control read as a separate
  feature rather than one of the specialists the router calls.

### Creative Studio (the perceptual and identity read)

- Flat monotony, no focal point, same as the project room before its pass. The
  anchor deserves a cover: it is the brain.
- Off-brand seams: a raw native `<select>` styled with inline CSS for the cloud
  picker, `⋯` and `i` as literal text glyphs, section headers as bare
  `<h3 style={{margin}}>`. Small things, but they read as unfinished.
- Direction, the most premium of the three we weighed: a calm paper cover with
  the same water wash as the project room (so the room family reads as one),
  carrying the reach the stack runs under and the Reasoning LLM as the hero;
  then the specialists as one tagged group; then the bench as reserves. Teal and
  amber chips on every model so the whole stack's privacy and spend posture is
  legible in one glance.

### CTO (safe to ship)

- **Blast radius contained.** This is a far larger, more central component than
  the project room (BYOM, vision slots, Currents contributions, per-status
  stacks, placement, admin gating). The rebuild is presentational: every store
  action, sheet, and the `admin` gating are preserved verbatim; the non-admin
  locked view still shows the lock on every control; the Currents bench pill and
  the vision two-slot semantics are untouched.
- **The guards hold.** New motion is on the tokens (the cover rides `room-in`,
  no layout transitions); no test pinned the Stack UI strings, so nothing was
  loosened. Gates green: app typecheck, lint, 887 tests, Vite build; motion,
  polish, and em-dash guards.
- **One finding is cross-surface and the CTO flags it as the top item:** the
  vocabulary split. The phone says **Reasoning LLM**; the desktop `StackScreen`
  and `StackHealthScreen` still say **Quarterback** (and "orchestrator",
  "specialists", fixed role names). The plan-first workflow settled on "Reasoning
  LLM" as the canonical user-facing term, so the desktop copy is stale. It is a
  copy sweep with its own small blast radius, left for the founder to green-light
  rather than folded into this phone change.

## What shipped (phone `StackManager`)

1. **An anchor cover.** A paper-raised cover with the water wash carries a
   compact **reach** pill (the status, "now", tap to switch which status's stack
   you are editing), then "Runs the show", the Reasoning LLM's name in the
   display face, a teal/amber location chip, the reach blurb, and Change (or the
   admin lock). The one required model finally reads as the anchor.
2. **Specialists as one system.** A single "Specialists" section with a one-line
   explainer of how routing works. Image reading sits inside it as a tagged
   specialist (its two local/cloud slots intact); the placed specialists follow,
   each with its **category as a tag** over the model name, its trigger and
   effort beneath, and a location chip.
3. **Bench as reserves.** A "Bench" section that states the teal/amber rule and
   keeps it: every bench model wears its location chip (on device, your server,
   or cloud). The cloud picker is now a house-styled control, not a raw inline
   select.
4. **One posture language.** Teal for local and private (on device, your own
   server), amber for cloud and spend, on the anchor, every specialist, and
   every bench model.

Rendered in headless Chromium at phone width in both themes; the hierarchy
reads, the teal/amber posture is legible at a glance, and the dark ground lifts
the teal correctly.

## Open, for the founder

- **The vocabulary unification (CTO's top item). DONE 2026-09-15.** The founder
  rejected "Quarterback" ("either just reasoning or something like Anchor"), so
  the user-facing term is now "Reasoning LLM" everywhere: the desktop
  `StackScreen` heading and lead, `StackHealthScreen`, the Library intro, and the
  Harbor and guide copy.
- **Desktop `StackScreen` structure.** The desktop page is still the older flat
  list (fixed roles). If the founder wants, the same work-first cover and system
  framing can be brought to it.
- **Taste on a device.** The cover wash and the chip density are a first pass;
  TestFlight is the judge.
