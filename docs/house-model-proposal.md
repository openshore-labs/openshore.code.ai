# The house model: OpenShore's own weights behind DeepBlue

Status: PROPOSAL, 2026-09-21, revised the same day after the founder set the
shape. Founder brief, first beat: "I love using Opus 4.8. I think it's such a
solid model. I wanted to try to create my own open source version that is more
compact and something that could feasibly be integrated into a home lab set
up. I would want it to be the featured model in OpenShore that you could
download to your hub and get started Docked super quick and basically start
building anything in a real way." Second beat, the correction: "something that
is as capable and acts like Opus 4.8, accessible to download from the start
for users without even having to go to the marketplace. Like Harbor Lite and
Harbor. This would be a third and final more advanced out-of-the-box model."

The second beat is BUILT: **DeepBlue** is the third member of the Harbor
family, on the desktop, out of the box, one tap (`docs/HARBOR.md`, the Desktop
section; `app/src/lib/harborMaster.ts`; DECISIONS 2026-09-21). Today it runs
on stock Qwen 2.5 Coder weights, sized to the computer. This memo is the first
beat: how OpenShore's own tuned weights get made and swapped in behind that
slot, in the order the tenets require (`CLAUDE.md`, the premium harness). It
extends `premium-harness-proposal.md` (Lessons Tier 2, adapters) and
`premium-harness-first-seat-convergence.md` (the hardware-fit table, the claim
ladder). It replaces neither.

## The brief in one line

Behind the DeepBlue slot, replace the stock weights with OpenShore's own
open weights, tuned so the model speaks the harness natively, published as
weights anyone can pull, and swapped in by changing only the refs and the
attribution, once a number on a hub-class box says they are better.

## What it can honestly be, and what it cannot

**It cannot be a compact Opus.** Opus 4.8 is closed weights, so there is nothing
to shrink. Training a frontier-class model from scratch is a lab's budget, not
a founder's. And the shortcut everyone reaches for, distilling from Claude's
outputs, is barred by Anthropic's terms (the commercial terms prohibit using
the services or their outputs to develop or train a competing model; verify the
current wording before any data plan is written, but plan on it being so). This
repo's honesty bar would not let the copy say it anyway: "as smart as Claude"
is a rung the claim ladder marks as never, and `test/harborMaster.test.ts`
fails the build on "Opus" in the slot's copy.

**"Acts like Opus" is mostly the harness, and the harness is built.** What
makes a frontier coding agent feel the way it does in a loop: it plans before
it edits, it runs the tests, it reads the failure and fixes it, it does not
lose a two-file change halfway, it says what it did. The engine already does
the mechanical half of that for any seat (plan mode, verify in the loop,
best-of-N judged by tests, the lean prompt, structural checks), and the eval
record shows how much that is worth: qwen2.5-coder:3b went from 0% to 75% on
the deep benchmark between 2026-09-14 and 2026-09-15 with no change to the
weights. What still misses at the end of that cycle is not intelligence, it is
discipline: the seat copies a line it changed instead of the line it was
shown, drops a parameter in a rename, will not take the "run it" instruction.
Those are exactly the behaviors supervised fine-tuning fixes cheaply and
reliably. Raw reasoning is what it does not fix. So the target for OpenShore's
own weights is a model that speaks the harness as its native tongue: the
SEARCH and REPLACE edit shape, the tool-or-answer schema, the verify
observation and what to do with it, running code it is asked about, the
compact standards digest. A model that never fights the loop is worth more
points on the deep eval than a model that is a little smarter and does.

**"Compact" means the Home class, not the phone.** A home-lab hub is a machine
with more memory than the reference box (16 to 32 GB, or an 8 to 24 GB GPU).
That is the docked tier the progress notes already describe: "a 7B and up
belong to the docked/hub tier". DeepBlue already sizes itself to the
machine (the 32B, the 14B, the 7B, the 3B); the tuned weights ship per size, and a
size only switches when its own number clears.

## The slot is built; the weights are the work

| Piece                   | State                                                                                                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DeepBlue                | BUILT 2026-09-21. `app/src/lib/harborMaster.ts`: id `harbor-master`, four sizes over the catalog's own Qwen 2.5 Coder entries, `resolveHarborMaster(hw)` picks the largest that fits by the engine's own budget. |
| One tap, out of the box | BUILT. The First Seat card installs it in place; the Stack screen's starter and the desktop Settings > Harbor row ride the same store action (`ensureHarborMaster`: pull by catalog id, seat by Ollama ref).     |
| Docked                  | BUILT. Pair the phone under Desktop + phone; DeepBlue is "My computer" in the model menu, for chat and for coding on repositories.                                                                               |
| Weights delivery        | BUILT. The engine pulls Ollama refs straight from the Ollama library, never through OpenShore. An OpenShore-published Ollama model is a ref like any.                                                            |
| The measuring stick     | BUILT. `osc eval --deep --attempts <n>`, per-task traces, the frontier reference run, the with-and-without discipline (tenet 2), `curation/eval.json` with `measured` provenance.                                |
| The trainer             | DESIGNED, not built. Lessons Tier 2 in the harness proposal: a PEFT-style LoRA sidecar, promotion only when eval v2 scores the adapted model at or above the base, an Ollama Modelfile as a new tag.             |

So the swap, when it comes, is one commit: the three `ollamaRef`s in
`HARBOR_MASTER_SIZES` point at `openshore/harbor-master:<size>` (or the
Hugging Face GGUF the Modelfile wraps), the size labels and
`HARBOR_MASTER_ATTRIBUTION` name the new weights and their license,
`MODEL-LICENSES.md` and `docs/HARBOR.md` follow, and the word "tuned" is
allowed into the copy for the first time. The id, the rows, the card, and the
action do not change. That is the whole point of the slot.

## What the code says back: three things to change when the weights ship

The repo holds a promise, "a catalog, not a weight host", in code, docs, the
guide facts, and on the site. OpenShore's own weights keep that promise as
long as they are published to a public source and the engine pulls them from
that source like any other model: OpenShore never proxies inference and never
rehosts another maker's weights. Three places assume no model is OpenShore's
own, and each is a small, deliberate change in the swap commit:

1. **The install notice.** `os-code/src/market/install.ts` prints "Weights
   come straight from the Ollama library, never from OpenShore." For the house
   weights that line reads wrong. It becomes "Weights come straight from the
   Ollama library. This one is published by OpenShore." The promise (straight
   from the source, never proxied) is unchanged.
2. **The engine installs Ollama refs only.** A `huggingface` source is printed
   as a command for the person to run, not pulled. So the house weights ship
   as an Ollama model first; the Hugging Face repo is the canonical home for
   the weights, the model card, and other runtimes.
3. **The catalog builder's trust list.** Live discovery admits only the lab
   families in `TRUSTED_PUBLISHERS` and rejects unknown uploads by name, so an
   OpenShore organization is either added to that list or the sizes stay
   hand-written seed entries in `catalog.sample.json` (they are today). The
   builder never invents a star; the deep score is entered by hand as
   `measured`.

Nothing is ever bundled: `app/MODEL-LICENSES.md`'s "with one exception" stays
true, the iOS bundle has about 65 MB of headroom under the 170 MB cap, and a
7B does not fit in any case.

## The base: chosen by a number, not a belief

DeepBlue's three sizes are the candidates, plus one worth measuring. All
on the license allow-list (Apache-2.0) or to be checked against it first:

| Candidate                            | Why it is on the list                                                                                                                                                                                                                                                   | Check first                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| qwen2.5-coder:7b                     | Rank 1 today, probe 0.86, "follows tools well", 4.7 GB at Q4. DeepBlue's 16 GB laptop and 8 GB GPU size.                                                                                                                                                                | Its loop score on a hub-class box (never measured; the reference box swaps it).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| qwen2.5-coder:14b                    | "The one to grow into", probe 0.88, 9 GB at Q4. DeepBlue's size for a hub with room.                                                                                                                                                                                    | Same. Fits a 24 GB GPU; tight on 32 GB of CPU memory by the engine's rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| qwen2.5-coder:3b                     | The floor seat, measured 75% (best of 2) on the CPU-only reference box.                                                                                                                                                                                                 | Its license (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Qwen3 coder family, small-active MoE | A 30B-total, about 3B-active mixture runs at small-model speed on CPU RAM while carrying big-model knowledge; the phone memo's "MoE-first" idea, on the hub.                                                                                                            | It exists and is Apache-2.0 to the best of this memo's knowledge; confirm the exact card, size at Q4 (about 18 GB), and that Ollama serves it, before it enters the eval.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Bonsai 2 27B (PrismML, ternary)      | A 27B on a Qwen3.8 base compressed to ternary weights (about 1.76 bits each), roughly 6 GB total, Apache-2.0, long context. If the quality holds it collapses the fit table: a 27B-class seat that fits from 8 GB up, not only on a hub. Founder flagged it 2026-09-21. | EVAL FIRST, and be skeptical. The 83.9 aggregate and "98.2% retention" are the vendor's and blog numbers, not an agentic-coding run; ternary compression is exactly where precise multi-line edits, two-file refactors, and exact SEARCH/REPLACE slip. An independent tester already questioned whether v1's lead held at suite level and whether v2's agentic-coding claim holds. RUNTIME BLOCKER, found 2026-09-21: the ternary kernels are NOT in mainline llama.cpp; PrismML ships its own llama.cpp fork and an MLX fork for Apple Silicon. So our Ollama desktop path (mainline llama.cpp) likely cannot serve it as is, and the on-device iOS path (pinned mainline LLM.swift) cannot load it at all, so on-device on a phone, iPhone Air included, is a native project (bring the kernels into the plugin or move that path to MLX), not a config entry. The realistic way to try it today is PrismML's own fork or MLX on the Mac mini, reached from the phone by Docking. Measure it there on the deep eval against the 14B and 32B, weighting the edit and refactor tasks, before it is offered as a size. Packings: PTQ1_0 about 5.95 GB, PQ2_0 about 7.21 GB. |

The choice per size is the candidate with the best `osc eval --deep --attempts
3` score per GB of memory on the hub reference machine, run cold, stock
weights. That run is also the baseline the tuned weights must beat. A base is
disqualified if its license is not on the allow-list, whatever its score.

One license check falls out of this for free and should be done regardless:
the 3B seed entry reads Apache-2.0, but Qwen published the 3B sizes of the
Qwen2.5 family under a separate research license. If that is so, the floor
size's attribution is wrong today and the catalog gate should drop it. Verify
on the model card (egress to Hugging Face is blocked from the sandbox, so
this is a founder or desktop check).

## The data: what goes in, and what never does

The harness is already a data pipeline that does not know it is one. Every
deep-eval drive returns a trace (turns, tools reached for, whether a write
landed, how it ended) and the fixture tasks are scored by behavior, so a
trajectory that verifies is ground truth. Turn that into training data:

1. **Widen the task set first.** Four fixture tasks are a benchmark, not a
   corpus. Mine tasks with an oracle from open-source repositories on the
   allow-list licenses: a commit that touches a test is a task (the parent
   commit is the workspace, the test is the check, the diff is one accepted
   answer). A few hundred is enough for a first adapter. Split them on day
   one: training tasks and held-out tasks never meet, or the number is fake.
2. **Rejection sampling with the project's own tests as the judge.** Put a
   larger open model in the seat (the 32B, or the MoE) and drive each training
   task with `--attempts`, keeping only trajectories that verify. This is the
   best-of-N picker already built, run as a generator. Failed attempts are
   kept too, as the negative half of a preference pair.
3. **Record the harness's exact shapes.** The recorded trajectory is the
   prompt the loop actually sent (lean profile, compact digest, the tool
   allowance) and the model's actual turns, so the tuned model learns the
   real interface, including the verify observation and the blank-SEARCH
   redirect, not an idealized one.
4. **Permissive open coding data** for general coverage, license-checked the
   same way the catalog is.

What never enters the corpus: Claude or any other closed model's outputs
(terms, and the honesty bar); anything from a person's machine (no telemetry,
ever; nothing leaves the machine; the PARKED cross-user ruling stands);
machine-wide lessons on a shared hub (the CTO must-fix on owner and workspace
keying). The house weights are trained on open tasks and open models' verified
work, and say so in their model card.

## Training and publishing

- **Method.** LoRA or QLoRA supervised fine-tuning on the chosen base over the
  verified trajectories, then a preference step (DPO on verified-versus-failed
  pairs, which step 2 yields for free). Merge the adapter, quantize to GGUF
  (Q4_K_M as the default, Q8_0 for GPU hubs), publish to a Hugging Face repo
  under an OpenShore organization and as an Ollama model with a Modelfile
  carrying the chat template the loop expects. `HARBOR_MASTER_SIZES` then
  points at those refs.
- **Compute.** Not the reference box. One rented GPU with 24 to 80 GB for a
  few hours per iteration, or an Apple Silicon machine with 32 GB and up
  through MLX for the 7B. The home lab itself can be the hub reference box
  for measuring and, with a 24 GB GPU, the trainer.
- **The trainer is Lessons Tier 2, built once.** The proposal's "Practice"
  sidecar (PEFT-style LoRA, promotion on eval, an Ollama tag, one-tap revert)
  is the same tooling. Build it once to make the house weights centrally, and
  the person's own nightly adapter later is the same code pointed at their
  own accepted diffs. One trainer, two uses, in that order.
- **Contamination guard.** The held-out tasks and the four fixture tasks in
  `src/eval/tasks.ts` are never trained on. A CI test pins that the training
  manifest and the eval manifest share no task id.

## The gate (tenet 2, nothing claimed without eval)

A size's stock weights are replaced by the house weights only when all of
these hold, on the hub reference machine, cold, `--attempts 3`:

- They beat the stock base they were tuned from, with-and-without, by more
  than the run-to-run variance the eval already reports (best of n versus one
  try).
- They clear the held-out tasks they never saw, not only the training set.
- They do not regress the small-class floor: the 3B's 75% stays the CPU
  floor's number, and a size is never swapped on a size it was not measured
  on.
- The numbers land in `curation/eval.json` as `measured`, with `box` and
  `date`, the way the 3B's did.

Losing to the stock base is a real outcome and a useful one: it means the
harness already extracts what tuning would, and the effort goes to a bigger
base or to the harness instead. The slot keeps its stock weights until the
number says otherwise, and nobody using DeepBlue has to know.

## The claim ladder for this slot

The convergence memo's ladder applies unchanged; the first rung is what the
copy says today, the word "tuned" arrives with the swap.

1. **Now, stock weights:** "The most capable Harbor. A real coding agent that
   plans and edits your repositories, running on your computer through
   Ollama." The attribution names Qwen 2.5 Coder.
2. **At the swap:** "Tuned for OpenShore" joins the attribution, and only
   there, because the weights really are.
3. **When a size's hub-tier deep score clears 0.8 on the bounded tasks:**
   "Fixes bugs and ships small changes on its own, checked against your own
   tests."
4. **When local plus judge, or local plus hand, lands within about ten points
   of the Sonnet 5 reference line on the hub tier:** "Sonnet-grade results for
   everyday coding. Your own key, only when it truly needs it."
5. **Never:** "a compact Opus", "as smart as Claude", "trained on Claude",
   "always on". "Trains itself" stays out until the person's own nightly
   adapter (Lessons Tier 2 on their box) actually ships, which this work makes
   possible but is not.

## The one gap left in the front door

DeepBlue already picks a size by memory. What it cannot do yet is bless
a size per machine class with a loop number: only the 3B has a measured deep
score, the 7B and the 14B ride their published probe. That is ruling 2 of the
convergence memo (hardware-aware curation blessed by the deep eval per tier),
and it needs one thing the sandbox cannot supply: **a hub reference machine.**
The reference box is deliberately the floor, and the floor cannot run the
Home class. The founder's home lab is that machine: record its RAM, GPU, and
free storage as the hub tier's reference row, the way `cpu-7.6gb` names the
floor, and every hub-tier number is measured there.

## The order, each step unlocked by a number

0. **Name the hub reference box and draw the baseline.** Run DeepBlue's
   stock sizes on it with `osc eval --deep --attempts 3`; commit the scores to
   `eval.json`. Do the 3B license check in the same sitting.
1. **Widen the task set, with the split.** Training and held-out manifests, a
   CI guard that they never overlap.
2. **Trace recording and the verify-filtered generator.** A `--record` on the
   deep eval that writes the loop's real prompts and the model's real turns;
   rejection sampling with a larger open model in the seat.
3. **The trainer, built once** (Lessons Tier 2's sidecar). Train v0 per size,
   merge, quantize, publish, Modelfile.
4. **Measure with-and-without.** Swap a size's refs only if the gate holds;
   the card, the row, and the action do not change.
5. **Copy and record.** "Tuned for OpenShore" in the attribution, a model card
   that names its data, the install-notice line, a DECISIONS line, and the
   mirror rule for any new on-device record.
6. **Later, the same pipeline pointed at one person's box** is Lessons Tier 2
   proper: nightly Practice on their own accepted diffs, local only, cleared
   with the chats.

Rough cost of the first iteration, so the Board gate has a number to weigh:

| Item                                   | Estimate                                   |
| -------------------------------------- | ------------------------------------------ |
| Engineering to the first tuned weights | About one engineer-month                   |
| GPU rental per training iteration      | Tens of dollars to low hundreds            |
| Hub reference box                      | The home lab; a 24 GB GPU also trains      |
| Publishing                             | A Hugging Face org and an Ollama namespace |

## What this is not

Not a new room, not a new name (DeepBlue is already the name, and the
CMO can change the display constant without touching the slot), not a
chatbot, not a phone model (the 7B class is hub-only; the phone keeps Harbor
Light, Harbor, Pocket, and Offline), not a way to learn from users (nothing
leaves a person's machine, ever), and not a compact Opus. It is the harness's
discipline baked into open weights, measured before it is claimed, and slid
in behind a door that is already open.

## Think big: Opus 4.8 at home, as close as it honestly gets (founder, 2026-09-21)

Founder: "Can we take an existing model and iterate it to mirror Opus 4.8 as
closely as possible. I just want Opus 4.8 locally however we can make that
happen." Four rungs, cheapest to biggest, each measured on the deep eval
against an Opus 4.8 reference run on the founder's own task set. Opus is the
yardstick, never the teacher: its outputs never enter training data (terms).

1. **DeepBlue, one size up.** The catalog's Qwen 2.5 Coder 32B (probe
   0.94, about 20 GB at Q4, a 24 GB GPU or a 48 GB Mac) becomes a fourth size.
   An edit; the card picks it when it fits.
2. **The open frontier on a real hub.** Open-weights mixture-of-experts models
   on the allow-list licenses (the Qwen3 coder family at 480B total and 35B
   active, Qwen3 235B, GLM 4.5 and later, DeepSeek V3.x, Kimi K2 and later,
   gpt-oss-120b; verify the exact cards and sizes at build time, the top moves
   monthly). Hardware money, not engineering: 96 GB to 512 GB of memory (a
   Mac Studio with 512 GB unified memory, a multi-GPU rig, or a RAM-heavy
   server running experts on CPU at a few tokens per second). A fifth DeepBlue size, offered only when the machine reports the memory, blessed
   only when measured on the hub reference box. Honest phrase: "a generation
   behind the frontier, on your own machine."
3. **Opus itself, for the hardest step only.** The hand, as planned: local by
   default, an amber card with the spend estimate when the seat is out of its
   depth, on the person's own key, "No" a full answer. The closest true
   sentence to "Opus locally": Opus for one step in twenty, the hub for the
   other nineteen.
4. **The flywheel.** Run Opus 4.8 once on the founder's task set with the
   existing frontier reference run to draw the ceiling line; print the gap in
   points on every scorecard. Each turn: record traces, generate verified
   trajectories from open teachers (the biggest open model in the seat,
   rejection-sampled by the project's tests), tune the smaller sizes, measure
   again. The gap is the product metric.

Order: the 32B size now; name the hub reference box and measure every size
there; the memory-gated fifth size once one big open model is measured on that
box; the printed gap; then the tuning loop where the gap is largest.

## The Air program: Bonsai 2 un-docked on an iPhone Air (founder go, 2026-09-21)

Founder: "Yes let's do that." The frame: the capability Bonsai lost is a small,
systematic error between the ternary weights and the original Qwen, so it is
recovered by adding a correction on top of the compressed base, never by
decompressing (a 27B at Q4 is 16 GB, dead on a phone). Apple's own on-device
foundation model is the precedent: 2-bit palettized weights plus accuracy
recovery adapters. Same design at 27B, with PrismML having done the expensive
half.

The five moves:

1. **Base: Bonsai as-is.** The 5.95 GB PTQ1_0 file. Never redo their work.
2. **Recovery adapter, distilled from the open Qwen itself.** The original
   Qwen3.8-27B in FP16 on the Mac mini is the teacher; a low-rank FP16
   residual on every linear layer is trained so Bonsai plus adapter matches
   the teacher's outputs on our distribution (harness trajectories, the edit
   format, tool calls, repository code). Legal because Qwen is Apache-2.0 and
   Bonsai is itself a Qwen derivative; Claude outputs never enter it. Target
   the residual where it matters (agentic coding), 300 to 600 MB by rank,
   shipped as a separate swappable file.
3. **Speed: speculative decoding with Harbor as the draft.** The phone's cost
   is bandwidth (6 GB read per token); a small draft proposes, the 27B
   verifies in a batch, typically 2 to 3x on code. Harbor (Qwen3-1.7B) is
   already on the phone and the same family, so the draft ships for free.
   Verify the tokenizers match; a mismatch is the one thing that breaks it.
4. **Pay prefill once: a prompt-prefix KV cache on flash.** The harness prefix
   is computed once and restored every turn (llama.cpp can save and restore
   KV state). Cheap, and the largest felt win on a phone.
5. **Runtime: let Apple run the ternary.** Ternary weights with a per-group
   scale are, value for value, a 2-bit palette with three used entries and a
   per-group lookup table, which is what CoreML palettization expresses and
   what the Neural Engine runs natively on recent chips. A CoreML stateful
   model (iOS 18 handles the KV cache) runs on Apple's own compressed-weight
   kernels with no fork and better thermals. The deciding checks: whether
   CoreML's grouping axis matches Bonsai's group-128 layout, and whether a 27B
   stateful CoreML model is practical at all (a spike, not a plan). Fallback:
   PrismML's fork built as an iOS xcframework under a forked LLM.swift, or a
   thin direct llama.cpp binding if the fork's API diverged.

The memory budget on the Air (reported 12 GB): weights 5.95 GB (memory-mapped,
clean file-backed pages, the reason it has a chance), adapter 0.3 to 0.6 GB,
KV at 4K context 8-bit about 0.5 GB, Harbor as draft 1.1 GB, app about 0.4 GB;
total 8.3 to 8.6 GB, inside what the Increased Memory Limit and Extended
Virtual Addressing entitlements can grant on a 12 GB device. A 0.6B draft buys
back 0.7 GB if needed.

The gates, each a kill:

- **Gate 0, the Mac mini, a day, no app work.** Serve Bonsai from PrismML's
  fork (llama.cpp server, OpenAI-compatible) or their MLX build, add a
  provider to `~/.os-code/config.json`, and run the deep eval against the
  14B and 32B, weighting edit and refactor:

  ```json
  {
    "providers": {
      "bonsai": {
        "kind": "openai-compatible",
        "baseUrl": "http://localhost:8080"
      }
    }
  }
  ```

  ```
  osc eval --deep --attempts 3 --provider bonsai --model <served name>
  ```

  If Bonsai plus the harness does not beat the 14B here, nothing below runs.
  The full step-by-step is `docs/air-program-runbook.md`.

- **Gate A, the adapter, still on the Mac.** Train it, then measure how much
  of the gap to FP16 Qwen 27B it closes on the same eval. The teacher and the
  reference line are the same open model, a clean experiment.
- **Gate 1, the runtime.** The CoreML spike and the fork xcframework in
  parallel; whichever loads PTQ1_0 on the Air first wins.
- **Gate 2, the device load test (TestFlight).** Three full replies in a row
  at 4K context with the draft and the prefix cache, no jetsam kill, the
  memory-warning unload path proven to fire cleanly.
- **Gate 3, speed and heat, plus one harness change.** A 27B derives the
  "mid" class and gets the full prompt; the phone host must force the lean
  profile by host budget, not parameter count (tenet 5). Prefix cache makes
  the rest bearable.

What this honestly delivers un-docked, if every gate clears: a real coding
agent on the phone for bounded work (quick fixes, small changes, drafts,
answering questions about the code), with the harness carrying the checklist,
structural checks on every edit, and the class pill saying what it can do.
Premium in this repo's sense: calm, honest, the mechanical work done for the
seat. Three limits no part of this plan removes: (1) speed, 5 to 15 tokens per
second and slower under best-of-N, so long multi-file work feels slow and the
phone throttles after minutes; (2) the oracle lives on a computer: an iPhone
cannot run most projects' test suites, so verify-in-the-loop against the
project's own checks stays Docked by physics, and un-docked verification is
syntax and structure, not the tests; (3) the phone tool slice (the pure-core
phone host, step 7 of the harness plan) is not built yet, so this program
lands as chat-side coding first and grows into repository tools as that host
lands. "Sonnet-grade" and "as smart as Claude" stay off the copy until the
deep eval on the Air says so; the number, per tier, is the claim.

If it clears, where it lands: a pocket model entry in the catalog with an
on-device URL, gated to 12 GB phones, hand-seeded (the builder rejects unknown
publishers), honest "tight" fit copy, a measured deep score before any ribbon,
and the 4B stays the default phone seat until the number says otherwise. Not a
DeepBlue size: that slot is desktop and Ollama.

(Founder, 2026-09-23: making Bonsai the DESKTOP DeepBlue model was considered
and set aside; DeepBlue stays Qwen 2.5 Coder on Ollama. Bonsai stays a measured
candidate only, on the phone track above and, if a Gate 0 number on the hub ever
warrants it, the desktop. See `DECISIONS.md`.)

The cheapest route may still be to wait: the llama.cpp discussion on adding
Bonsai's group-128 ternary format upstream, if it lands, makes the runtime a
catalog entry with zero native work. Watch it while Gate 0 runs.
