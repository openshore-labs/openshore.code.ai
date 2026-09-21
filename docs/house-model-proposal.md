# The house model: an open-weights coder tuned for OpenShore

Status: PROPOSAL, 2026-09-21. Founder brief: "I love using Opus 4.8. I think
it's such a solid model. I wanted to try to create my own open source version
that is more compact and something that could feasibly be integrated into a
home lab set up. I would want it to be the featured model in OpenShore that you
could download to your hub and get started Docked super quick and basically
start building anything in a real way." This memo grounds that brief in what the
code and the eval record already say, names the one thing it cannot be, and
lays out the build in the order the tenets require (`CLAUDE.md`, the premium
harness). It extends `premium-harness-proposal.md` (Lessons Tier 2, adapters)
and `premium-harness-first-seat-convergence.md` (the hardware-fit table, the
claim ladder, the Home bundle). It replaces neither.

## The brief in one line

An open-weights coding model, compact enough for a home-lab hub, tuned to
OpenShore's own harness so it follows the loop natively, published as weights
anyone can pull, and offered as the one featured pick a person installs on
their hub and starts building on, Docked, in one tap.

## What it can honestly be, and what it cannot

**It cannot be a compact Opus.** Opus 4.8 is closed weights, so there is nothing
to shrink. Training a frontier-class model from scratch is a lab's budget, not
a founder's. And the shortcut everyone reaches for, distilling from Claude's
outputs, is barred by Anthropic's terms (the commercial terms prohibit using
the services or their outputs to develop or train a competing model; verify the
current wording before any data plan is written, but plan on it being so). This
repo's honesty bar would not let the copy say it anyway: "as smart as Claude"
is a rung the claim ladder marks as never.

**It can be the best small model at OpenShore's job.** The eval record is the
argument. On the reference box, qwen2.5-coder:3b went from 0% to 75% on the
deep benchmark between 2026-09-14 and 2026-09-15 with no change to the
weights: every point came from the harness (the edit matcher, verify in the
loop, the lean prompt, best-of-N). What still misses at the end of that cycle
is not intelligence, it is discipline: the seat copies a line it changed
instead of the line it was shown, drops a parameter in a two-file rename, and
will not take the "run it" instruction. Those are exactly the behaviors that
supervised fine-tuning fixes cheaply and reliably. Raw reasoning is what it
does not fix. So the target is a model that speaks the harness as its native
tongue: the SEARCH and REPLACE edit shape, the tool-or-answer schema, the
verify observation and what to do with it, running code it is asked about,
the compact standards digest. A model that never fights the loop is worth
more points on the deep eval than a model that is a little smarter and does.

**"Compact" means the Home class, not the phone.** A home-lab hub is a machine
with more memory than the reference box (16 to 32 GB, or an 8 to 24 GB GPU).
That is the docked tier the progress notes already describe: "a 7B and up
belong to the docked/hub tier". The phone keeps Harbor, Pocket, and Offline;
the CPU-only floor keeps the 3B. The house model is what Docked adds.

## Where it lands: nothing new to build in the rooms

The founder's "download to your hub and get started Docked" is the built path.
The house model rides it as data, not as a feature.

| Piece                  | State today                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docked                 | BUILT. The desktop daemon binds the tailnet, the phone scans a QR and claims a per-device credential, "My computer" appears in the model menu. `app/src/lib/profiles.ts`, `PairScreen.tsx`.         |
| The hub's model runner | BUILT. Ollama on the desktop, with an in-app bridge that reports and can install or start it behind a one-tap card (`app/electron/ollama.ts`). A box-hosted model routes through the daemon.        |
| The featured pick      | BUILT as a mechanism. `os-code/curation/recommended.json` (rank, note), `curation/eval.json` (a measured `deep` score is what a card may quote), `blessed` in the catalog, the license allow-list.  |
| One-tap install        | BUILT. The First Seat card offers one hardware-fit local pick with one tap (`FirstSeat.tsx`, `starterModel.ts`); the Marketplace bundles (Starter, Home) fill a stack in one tap.                   |
| Weights delivery       | BUILT. Catalog sources are `ollama` refs or `huggingface` GGUF URLs; weights download from their source, never through OpenShore. An OpenShore-published repo on Hugging Face is a source like any. |
| The measuring stick    | BUILT. `osc eval --deep --attempts <n>`, per-task traces, the frontier reference run, and the with-and-without discipline (tenet 2).                                                                |
| The trainer            | DESIGNED, not built. Lessons Tier 2 in the proposal: a PEFT-style LoRA sidecar, promotion only when eval v2 scores the adapted model at or above the base, an Ollama Modelfile as a new tag.        |

So "featured" is: a catalog entry, a rank-1 curation note for the hub tier, a
measured deep score in `eval.json`, the Home bundle's pick, and the First Seat
card choosing it on a machine that fits. No room, no new screen, no codename in
copy (tenet 1). The stable-id rule from Harbor applies: the id is a slot
decoupled from the weights (`harbor-mini` kept its id across a weights swap),
so a v2 of the model is a URL and size change, never an id churn.

## What the code says back: four things to change when it ships

The repo holds a promise, "a catalog, not a weight host", in code, docs, the
guide facts, and on the site. The house model keeps that promise as long as
OpenShore publishes weights to a public source and the app downloads from
that source like any other model: OpenShore never proxies inference and never
rehosts another maker's weights. But four places assume no model is
OpenShore's own, and each is a small, deliberate change in the same piece of
work as the catalog entry:

1. **The install notice.** `os-code/src/market/install.ts` prints "Weights
   come straight from the Ollama library, never from OpenShore." For the house
   model that line reads wrong. It becomes "Weights come straight from the
   Ollama library. This one is published by OpenShore." The promise (straight
   from the source, never proxied) is unchanged.
2. **The engine installs Ollama refs only.** A `huggingface` source is printed
   as a command for the person to run, not pulled. So the house model ships
   as an Ollama model first (`ollama pull openshore/coder:7b` or similar); the
   Hugging Face repo is the canonical home for the weights, the model card,
   and other runtimes.
3. **The catalog builder's trust list.** Live discovery admits only the lab
   families in `TRUSTED_PUBLISHERS` and rejects unknown uploads by name, so
   an OpenShore organization is either added to that list or the entry is a
   hand-written seed in `catalog.sample.json`. The seed is the honest first
   step: the builder never invents a star, and the deep score is entered by
   hand as `measured`.
4. **The one-exception line.** `app/MODEL-LICENSES.md` opens with "with one
   exception, OpenShore does not ship model weights inside the app". That
   stays true: the house model is a download, never bundled. The iOS bundle
   has about 65 MB of headroom under the 170 MB cap, and a 7B does not fit in
   any case.

Everything else the founder asked for is already a mechanism, not a change:
`featuredModels()` leads the Marketplace hero row with the editorial picks and
the card's eyebrow already reads "OpenShore pick".

## The name

Harbor is taken (the phone family), Home is the machine, Keel is the internal
harness codename and never copy, and "the anchor" already means the reasoning
seat in My Stack. The house model needs one display name and one stable id:

- **Id:** `openshore-coder-7b` (and `-14b` if a second size ships). Plain,
  sortable, tells the truth about what it is.
- **Display name:** a CMO and Creative Studio call, in the nautical vocabulary
  the rooms already speak. Working handle for this memo: Helm. Not a ruling.

Copy may say "tuned for OpenShore", because the weights really are tuned. That
is a deliberate step past the Harbor guides, which are stock weights and are
framed as "grounded in" the repo (DECISIONS, 2026-09-04). The two framings
must not blur: Harbor is grounded, Helm is tuned.

## The base: chosen by a number, not a belief

Candidates, all on the license allow-list (Apache-2.0) or to be checked
against it before they are considered:

| Candidate                            | Why it is on the list                                                                                                                                        | Check first                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| qwen2.5-coder:7b                     | Rank 1 today, probe 0.86, "follows tools well", 4.7 GB at Q4. The 16 GB laptop and 8 GB GPU pick in the hardware-fit table.                                  | Its loop score on a hub-class box (never measured; the reference box swaps it).                                                                                           |
| qwen2.5-coder:14b                    | "The one to grow into", probe 0.88, about 9 GB at Q4. Multi-file headroom.                                                                                   | Same. Fits 32 GB RAM or a 12 GB GPU.                                                                                                                                      |
| Qwen3 coder family, small-active MoE | A 30B-total, about 3B-active mixture runs at small-model speed on CPU RAM while carrying big-model knowledge; the phone memo's "MoE-first" idea, on the hub. | It exists and is Apache-2.0 to the best of this memo's knowledge; confirm the exact card, size at Q4 (about 18 GB), and that Ollama serves it, before it enters the eval. |

The choice is the candidate with the best `osc eval --deep --attempts 3` score
per GB of memory on the hub reference machine, run cold, stock weights. That
run is also the baseline the tuned model must beat. A base is disqualified if
its license is not on the allow-list, whatever its score.

One license check falls out of this for free and should be done regardless:
the 3B seed entry reads Apache-2.0, but Qwen published the 3B sizes of the
Qwen2.5 family under a separate research license. If that is so, the floor
pick's "Commercial use is fine" note is wrong today and the catalog gate
should drop it. Verify on the model card (egress to Hugging Face is blocked
from the sandbox, so this is a founder or desktop check).

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
keying). The house model is trained on open tasks and open models' verified
work, and says so in its model card.

## Training and publishing

- **Method.** LoRA or QLoRA supervised fine-tuning on the chosen base over the
  verified trajectories, then a preference step (DPO on verified-versus-failed
  pairs, which step 2 yields for free). Merge the adapter, quantize to GGUF
  (Q4_K_M as the default, Q8_0 for GPU hubs), publish to a Hugging Face repo
  under an OpenShore organization and as an Ollama model with a Modelfile
  carrying the chat template the loop expects. The catalog entry points at
  those, `source.kind: ollama` first (the bridge already pulls it).
- **Compute.** Not the reference box. One rented GPU with 24 to 80 GB for a
  few hours per iteration, or an Apple Silicon machine with 32 GB and up
  through MLX for the 7B. The home lab itself can be the hub reference box
  for measuring and, with a 24 GB GPU, the trainer.
- **The trainer is Lessons Tier 2, built once.** The proposal's "Practice"
  sidecar (PEFT-style LoRA, promotion on eval, an Ollama tag, one-tap revert)
  is the same tooling. Build it once to make the house model centrally, and
  the person's own nightly adapter later is the same code pointed at their
  own accepted diffs. One trainer, two uses, in that order.
- **Contamination guard.** The held-out tasks and the four fixture tasks in
  `src/eval/tasks.ts` are never trained on. A CI test pins that the training
  manifest and the eval manifest share no task id.

## The gate (tenet 2, nothing claimed without eval)

The house model becomes the featured pick for the hub tier only when all of
these hold, on the hub reference machine, cold, `--attempts 3`:

- It beats the stock base it was tuned from, with-and-without, by more than
  the run-to-run variance the eval already reports (best of n versus one try).
- It clears the held-out tasks it never saw, not only the training set.
- It does not regress the small-class floor: the 3B's 75% stays the CPU
  floor's number, and the house model is never offered there.
- The numbers land in `curation/eval.json` as `measured`, with `box` and
  `date`, the way the 3B's did.

Losing to the stock base is a real outcome and a useful one: it means the
harness already extracts what tuning would, and the effort goes to a bigger
base or to the harness instead. The featured slot stays with the stock pick
until the number says otherwise.

## The claim ladder for this model

The convergence memo's ladder applies unchanged; only the first rung gains a
word the guides may not use.

1. **Now, at ship:** "An open coder tuned for OpenShore. Runs on your own
   machine. Free, private, yours."
2. **When its hub-tier deep score clears 0.8 on the bounded tasks:** "Fixes
   bugs and ships small changes on its own, checked against your own tests."
3. **When local plus judge, or local plus hand, lands within about ten points
   of the Sonnet 5 reference line on the hub tier:** "Sonnet-grade results for
   everyday coding. Your own key, only when it truly needs it."
4. **Never:** "a compact Opus", "as smart as Claude", "trained on Claude",
   "always on". "Trains itself" stays out until the person's own nightly
   adapter (Lessons Tier 2 on their box) actually ships, which this work makes
   possible but is not.

## Docked in one tap: the path, and the two gaps

The path today: install the desktop app; the daemon starts and binds the
tailnet; the phone scans the QR; the reach pill reads Docked; the First Seat
card on the desktop offers one hardware-fit pick; Install pulls it through
Ollama and seats it as the orchestrator; the first real answer follows. The
house model rides that path once it is a catalog entry. Two gaps stand between
"a catalog entry" and "the featured pick on a hub":

1. **Hardware-aware curation** (ruling 2 of the convergence memo, not yet
   built): `deriveDeviceTier()` in `os-code/src/harness/` plus `fits` in
   `recommended.json`, so the hub tier gets the house model while the CPU floor
   keeps the 3B and the phone keeps its own. Today the rank is global and the
   starter list is a two-entry preference in `starterModel.ts`.
2. **A hub reference machine.** The reference box is deliberately the floor,
   and the floor cannot run the Home class. The founder's home lab is that
   machine: record its RAM, GPU, and free storage as the hub tier's reference
   row, the way `cpu-7.6gb` names the floor, and every hub-tier number is
   measured there.

## The order, each step unlocked by a number

0. **Name the hub reference box and draw the baseline.** Run the stock
   candidates on it with `osc eval --deep --attempts 3`; commit the scores to
   `eval.json`. Pick the base. Do the 3B license check in the same sitting.
1. **Widen the task set, with the split.** Training and held-out manifests, a
   CI guard that they never overlap.
2. **Trace recording and the verify-filtered generator.** A `--record` on the
   deep eval that writes the loop's real prompts and the model's real turns;
   rejection sampling with a larger open model in the seat.
3. **The trainer, built once** (Lessons Tier 2's sidecar). Train v0, merge,
   quantize, publish, Modelfile.
4. **Measure with-and-without.** Ship as a catalog entry and the hub tier's
   rank 1 only if the gate holds; the Home bundle and the First Seat pick
   follow from the curation, not from code.
5. **Copy and record.** The rung-1 line on the card and the site, a model card
   that names its data, a DECISIONS line for the name, and the mirror rule for
   any new on-device record.
6. **Later, the same pipeline pointed at one person's box** is Lessons Tier 2
   proper: nightly Practice on their own accepted diffs, local only, cleared
   with the chats.

Rough cost of the first iteration, so the Board gate has a number to weigh:

| Item                                 | Estimate                                   |
| ------------------------------------ | ------------------------------------------ |
| Engineering to the first tuned model | About one engineer-month                   |
| GPU rental per training iteration    | Tens of dollars to low hundreds            |
| Hub reference box                    | The home lab; a 24 GB GPU also trains      |
| Publishing                           | A Hugging Face org and an Ollama namespace |

## What this is not

Not a new room, not a name in the rooms (the featured pick renders through the
curation like every other model), not a chatbot, not a phone model (the 7B
class is hub-only; the phone keeps Harbor, Pocket, and Offline), not a way to
learn from users (nothing leaves a person's machine, ever), and not a compact
Opus. It is the harness's discipline baked into open weights, measured before
it is claimed, and the featured door into Docked once the number says so.
