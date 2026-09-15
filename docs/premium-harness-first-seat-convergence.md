# The First Seat: how Creative, CX, and the CTO converge on the out-of-the-box path

Status: CONVERGENCE MEMO, 2026-09-15. Founder brief: "We need the full
marketplace but we need a curated out-of-the-box option for users new to local
models. I want to sign up, click install on a predetermined model for my
phone's capability, and get Sonnet results. Docked, I have way more power.
Code for free: docked, online, and offline." This memo is the three voices the
founder asked for, grounded in what is actually in the code today, and the six
rulings they converge on. It extends `premium-harness-proposal.md` (the plan)
and `premium-harness-advisory-memos.md` (the eight-advisor review); it does
not replace either. The north star it serves: a five-year-old MacBook should
feel as powerful as running Claude-grade models on a local stack, and the
reference machine is deliberately the lowest common denominator (CLAUDE.md,
tenet 2).

## The brief in one line

One hardware-fit seat, one tap, an honest pill, a real first answer in two
taps, on any of the three reach states, with the whole Marketplace one tap
behind it. We call it the First Seat. It ships with no room and no name, like
the rest of the harness; "First Seat" is this memo's handle, not copy.

## What already exists (this is the 75%, and it is real)

| Piece                     | State today                                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The three reach states    | BUILT. `app/src/lib/profiles.ts`: Docked (home reachable: home models, cloud, on-device), Offshore (online, home unreachable: cloud and on-device), Offline (on-device only). Auto-detected; a person may step down, never up. |
| One-tap bundles           | BUILT. Marketplace bundles fill the whole stack in one tap: Pocket and Offline (phone), Starter and Qwen 2.5 Coder 7B (desktop). Weights download from their source, never through OpenShore.                                  |
| Curated picks             | BUILT, machine-blind. `os-code/curation/recommended.json` ranks picks with notes: 7B (rank 1, "your starting orchestrator"), 14B ("grow into on 16 GB"), qwen3-4b-phone ("The iPhone pick"), qwen2.5-1.5b-phone (lightest).    |
| Blessing                  | BUILT for the one-shot probe. Catalog `blessed` plus `curation/eval.json` (7B 0.86, 14B 0.88). These are quick-probe numbers, NOT agent-loop numbers; see the CTO section.                                                     |
| Phone on-device inference | BUILT. llama.cpp on the iPhone's Metal GPU via a native plugin; a capacity monitor that reads real RAM; iCloud parking for a model too big for the phone; `recommendMachine` that names the machine a model wants.             |
| The Harbor guides         | BUILT. Harbor Light (135M, bundled, the concierge) and Harbor (1.7B, a 1.1 GB download, "a reasonably capable first coding agent and the app's own expert"). `docs/HARBOR.md`.                                                 |
| Docked                    | BUILT. Pair your computer over Tailscale by QR; "My computer" appears in the model menu for chat and for coding on your repos.                                                                                                 |
| Setup guides              | BUILT. Get Harbor, Connect your own key, Connect your computer, Install Ollama, Pick a model, Open a repository, and more. `app/src/lib/setupGuides.ts`.                                                                       |
| The harness under it      | BUILT this week. Lean seat (fewer tools, compact standards), verify and verify-in-the-loop, eval v2 with attempts, the frontier reference run, self-diagnosing traces, the two-window stream guard.                            |
| One-card onboarding       | ALREADY CALLED FOR. `AUDIT-P0-BETA-ROADMAP.md` 1.2: one recommended card per platform, the rest behind "More ways to start", a real first answer in at most two taps plus one download, no paywall before the first answer.    |

## The one word to settle first: Harbor is taken

The founder floated "docked can have Harbor be a premium local LLM." Harbor
already means something shipped: the phone's built-in on-device family, Harbor
Light and Harbor, with a Settings section, a setup guide, tests, and a Codemagic
workflow named for it. Reusing it for the docked machine would make one word
mean two places. The vocabulary the code already speaks is cleaner than a new
coinage:

- **Harbor** is what you carry: the on-device family on the phone (Harbor Light,
  Harbor, and the Pocket and Offline picks above them).
- **Home** is where your power lives: your own computer, docked. It is already
  `ModelLocation 'home'`, "your home system", the Docked profile, "My computer".
- **A key you connect** is the frontier: Claude, OpenAI, Gemini on your own key,
  amber, deliberate.

Recommendation: keep Harbor for the phone family, call the docked machine Home
(it already is), and let the premium docked bundle be the Home bundle. The CMO
and Creative Studio bless or rename; this memo only insists the word is not
overloaded.

## CTO

The CTO's view is that the founder's instinct is correct and the last gap is
specific: **the curation is machine-blind, and the reference box just proved
it.** `recommended.json` ranks the 7B first for every desktop. On the founder's
CPU-only box (no NVIDIA driver, `ollama ps` reads 100% CPU, a 7B prefills at
about 6.7 tokens per second and generates at about 3.4) the 7B scores 0.75 on
the one-shot probe and 0% on the agent loop, because it times out before its
first token. The pick that is right for a 16 GB MacBook Air is wrong for a
CPU box, and the catalog cannot tell them apart.

So the CTO's build is a pure function and a table:

1. `deriveDeviceTier()`: read what the device is (RAM, CPU-only or Metal/GPU,
   free storage; the phone already exposes `ramBytes`) and return a tier. Pure,
   synchronous, testable, phone-safe, in `os-code/src/harness/` next to
   `profile.ts`.
2. `recommended.json` gains `fits`: which tiers a pick is the First Seat for.
   Ranks become per-tier, not global.
3. The First Seat card reads the tier and offers exactly one pick, with the
   class pill from `classBlurb` (tiny: "Runs single steps"; small: "Runs short
   plans. The harness carries the checklist.").
4. Blessing moves to the deep eval. A pick is blessed for a tier only when
   `osc eval --deep` (the real loop, behavioral scoring, on the reference class
   of machine for that tier) says so. Today's `eval.json` numbers stay as the
   probe score; a second column, the loop score, is what the card may quote.

The CTO's second point is the honesty gate on "Sonnet results." The scoreboard
publishes three numbers per tier against the Sonnet 5 reference line: local
only, local plus judge, local plus hand. Copy climbs the claim ladder below
only as those numbers land. Nothing about Sonnet reaches a screen before the
reference run is drawn.

The CTO's third point is that everything under the card is the harness already
built or designed: the lean seat, verify in the loop, best-of-N judged by tests
(measured first by `--attempts`), retrieval first, constrained decoding (built
in `decoding.ts`, to be wired), Auto-place for the gap, the docked engine as
the power path, and the phone operating model (right-size per step, read big
and write small, MoE-first, phone quants). The First Seat is the front door to
all of it.

## CX

CX's view: **a person new to local models should never see a marketplace
before they see an answer.** The first run is one decision, and the decision is
already made for them, with a way to change it.

- **One card, one tap.** The card names the seat, says what it can do in one
  plain sentence (the class blurb), shows the download size in GB and the
  memory it wants, and has one control: Install. The tap is the ask; downloads
  always ask, and this is the asking. No wizard.
- **A real answer in two taps.** The P0 acceptance stands: at most two taps
  plus one download or connect, a real first answer, no paywall before it.
- **Reach is always visible.** The Docked / Offshore / Offline pill is the
  reason power changes, so nobody wonders why the phone felt stronger at the
  desk. Docked reads "connected to your home system"; Offshore reads "online,
  home out of reach"; Offline reads "your on-device models only". These
  strings exist.
- **Progressive disclosure.** Under the card: "More ways to start" (Connect
  your computer, Connect your own key, the Marketplace). After the first
  successful answer, the next step appears in context ("Ready to build on your
  repos? Connect your computer."), never as a wall.
- **The hand is a card, never a surprise.** When the seat is out of its depth,
  the hand to a frontier model is an amber card with the spend estimate, and
  "No" is a full answer. A person can also step down (force Offline) and the
  app honors it.
- **One-tap revert.** Whatever Auto-place or the First Seat chose, the person
  sees a note and can put it back.
- **The metric CX will hold the room to** is time to first merged fix on the
  person's own repo, by tier. "Feels like coding with Claude" is that number
  falling.

## Creative Studio

Creative's view: **the arrival should feel like coming ashore, not filling out
a form.** The app already has an arrival moment (the Currents glow); the First
Seat gets one calm arrival of its own and no more.

- **The story is the vocabulary.** Harbor is what you carry. Home is where your
  power lives. The open sea is the frontier, sailed on purpose. Three reach
  states are three weathers: Docked, Offshore, Offline. None of this is copy on
  the card; it is the frame every screen agrees on.
- **Teal is local, amber is cloud.** The existing tokens carry the honesty. A
  local seat wears teal; the one thing that costs money wears amber; the pill
  never lies about which is which.
- **The pill is honesty made beautiful.** "Small model seat. Runs short plans.
  The harness carries the checklist." is a promise a person can hold, and it
  is the same sentence in the transcript, on the Bench, and on the card.
- **Voice.** Plain, specific, humanized. No "AI magic", no "supercharged",
  no "trains itself". "Fixes bugs and ships small changes on its own, checked
  against your own tests" is the register.
- **One family of names for the bundles**, blessed by the CMO: Pocket and
  Offline on the phone, Starter and Home on the desktop. The First Seat is
  whichever of those fits the device; the person never has to know the word
  "tier".
- **The one aesthetic risk**, spent in one place: the reach pill as weather.
  Everything else stays quiet.

## Where they converge: six rulings

1. **The First Seat is the front door on every platform.** One hardware-fit
   card, one tap, a real answer in two taps. The Marketplace is one tap behind
   it, never in front of it.
2. **Curation becomes hardware-aware.** `deriveDeviceTier()` plus `fits` tiers
   in `recommended.json`, blessed per tier by the deep eval on the reference
   class of machine. The machine-blind global rank retires.
3. **One vocabulary, already in the code.** Harbor (phone), Home (your
   computer), a key you connect (frontier); reach is Docked, Offshore, Offline.
   The CMO blesses the words; nobody overloads Harbor.
4. **Free means a real seat, not a demo.** One starter local model is free on
   every platform (the P0 recommendation); Personal unlocks the full
   Marketplace. Coding for free, docked, online, and offline, is literally true
   on day one.
5. **The claim ladder is the copy law.** Each rung unlocks on a number from the
   deep eval against the Sonnet 5 reference line, per tier.
6. **The phone reaches Sonnet outcomes through the phone operating model, and
   through Home.** Alone, a small seat plus the oracle and best-of-N, with a
   bigger streamed judge for the steps that deserve it. Docked, Home does the
   heavy lifting and the phone is the window. The hand covers the hardest step.

## The hardware-fit table (a proposal the deep eval blesses)

Tiers name the reference class of machine; the pick is what the First Seat
offers there. Every row is a hypothesis until `osc eval --deep` on that class
says otherwise, and the founder's box is the row that already spoke.

| Tier                                                | First Seat                  | Class | What it is honestly for                                         | Status                                                      |
| --------------------------------------------------- | --------------------------- | ----- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| Phone, up to 6 GB RAM                               | qwen2.5-1.5b-phone (Pocket) | tiny  | Quick edits, answers, drafts; heavy work Docked or by the hand  | Probe 0.62; loop not yet measured                           |
| Phone, 8 GB RAM and up (iPhone Air, 17 Pro)         | qwen3-4b-phone (Offline)    | small | Bounded coding on the phone; the phone operating model above it | "The iPhone pick"; loop not yet measured                    |
| Desktop, CPU-only (the founder's box, the floor)    | qwen2.5-coder:3b            | small | Bounded coding; the 7B is proven too slow for the loop here     | 3B deep run in flight; 7B loop 0% (timeout at 3 to 7 tok/s) |
| Desktop, 16 GB unified (M1 MacBook Air) or 8 GB GPU | qwen2.5-coder-7b (Starter)  | small | Everyday coding; today's rank 1 is right HERE                   | Probe 0.86 (curated); loop to be measured on this class     |
| Desktop, 32 GB or a 12 GB+ GPU                      | qwen2.5-coder-14b (Home)    | mid   | Multi-file work with headroom; "the one to grow into"           | Probe 0.88; loop to be measured                             |
| Desktop, 64 GB or a 24 GB GPU                       | qwen2.5-coder-32b           | mid   | The strongest local seat; plans and delegates                   | Probe 0.94; loop to be measured                             |

Units are the person's units: GB of download, GB of memory wanted, and, on the
pill, what the seat does. Tokens per second stay in the eval report, not on the
card.

## The claim ladder (what copy may say, and when)

This is a sequence because each rung is unlocked by a number, in order.

1. **Now, true today:** "A real coding partner that runs on your own machine.
   Free, private, yours." No frontier comparison anywhere.
2. **When a tier's local-only deep-eval score clears 0.8 on the bounded
   tasks:** "Fixes bugs and ships small changes on its own, checked against
   your own tests."
3. **When local plus judge, or local plus hand, lands within about ten points
   of the Sonnet 5 reference line on that tier:** "Sonnet-grade results for
   everyday coding. Your own key, only when it truly needs it."
4. **Never, at any rung:** "as smart as Claude", "trains itself" (until an
   adapter ships), "always on".

## What is missing (the 25%) and the order

Each step unlocks on a number, per the tenets. The First Seat is pulled forward
because it is the humane face of Auto-place and the front door of the whole
product, and because the founder's box just showed what machine-blind curation
costs.

1. **The desktop floor goes green.** The 3B deep run on the founder's CPU box,
   in flight. First real loop number at the floor.
2. **Hardware-aware curation and the First Seat card.** `deriveDeviceTier()`,
   `fits` in `recommended.json`, one card per platform (P0 1.2), the free
   one-starter path, the class pill, one-tap revert. Deep-eval blessing per
   tier begins with the tiers the founder can run (CPU desktop, iPhone Air).
3. **Finish the discipline seam.** Wire constrained decoding and retrieval
   first; re-measure the small class with and without.
4. **The phone, measured.** Deep eval on the iPhone Air; then the phone
   operating model (right-size per step, read big and write small, MoE-first
   curation, phone quants), each behind a number.
5. **Best-of-N in the loop** only if the `--attempts` gap says it pays; needs
   checkpoints.
6. **Lessons, then adapters.** Local only, per owner and workspace, cleared
   with the chats; adapters on accepted diffs are the long game and stay out of
   the copy until they ship.

## The immediate step

Paste the 3B scorecard from the founder's box. It is the first loop number at
the floor, it decides the CPU-desktop row of the table, and it is the gate for
everything above.
