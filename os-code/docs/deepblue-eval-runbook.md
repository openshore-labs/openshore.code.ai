# DeepBlue deep-eval runbook

How to put each DeepBlue size through the premium harness deep eval and record
the result honestly. DeepBlue is Qwen 2.5 Coder, sized to the machine (32B, 14B,
7B, 3B). Only the 3B has a measured loop number so far; this runbook is for
getting the larger sizes measured on hardware that fits them, then committing the
numbers.

Companion decisions: `DECISIONS.md` (Harbor Lite is out of the coding eval; only
Harbor and DeepBlue go through the harness; DeepBlue stays Qwen 2.5 Coder, with
Bonsai 2 a measured candidate only).

## Current state (2026-09-23)

| Size  | Ollama ref            | eval.json key          | Number today                | Through the harness? |
| ----- | --------------------- | ---------------------- | --------------------------- | -------------------- |
| 3B    | `qwen2.5-coder:3b`    | `qwen2.5-coder-3b`     | deep 0.75, best of 2, measured | Yes (cpu-7.6gb, 2026-09-15) |
| 7B    | `qwen2.5-coder:7b`    | `qwen2.5-coder-7b`     | probe 0.86, published (seed) | No                   |
| 14B   | `qwen2.5-coder:14b`   | `qwen2.5-coder-14b`    | probe 0.88, published (seed) | No                   |
| 32B   | `qwen2.5-coder:32b`   | `qwen2.5-coder-32b`    | probe 0.94, published (seed) | No                   |

"Published" is a seed number from public benchmarks. It clears the gate but is
NOT a run through our harness. Only a "measured" `deep` number is.

## Two things to know before you run

1. **A measured `deep` number REPLACES the published `probe`, it does not sit
   beside it.** The gate reader (`scripts/build-catalog/evals.ts`, `evalScore`)
   reads `probe` first and only falls back to `deep`. So if an entry keeps its
   `probe`, a `deep` added next to it is ignored. When you record a measured
   number, swap the whole entry to the deep-only shape below.

2. **`curation/eval.json` is a hand-edited file.** The catalog builder reads it
   and never writes it (`curation/README.md`). Nothing goes in that was not
   published or measured: no blank rows, no guesses. That is also why this
   runbook exists instead of pre-filled placeholder entries, which would fail
   `test/curationEval.test.ts` (every entry must carry a finite 0..1 score).

## Hardware fit

The reference box (CPU-only, 7.6 GB) tops out at the 3B. A 7B at Q4 is about
4.7 GB of weights plus context and server overhead, so it needs real headroom.

| Size  | Weights (Q4) | Run it on                          |
| ----- | ------------ | ---------------------------------- |
| 7B    | ~4.7 GB      | a 16 GB laptop, or an 8 GB GPU     |
| 14B   | ~9 GB        | a hub-class box                    |
| 32B   | ~20 GB       | a ~48 GB-GPU-class box             |

Run each size only where it fits in real memory. A model that spills into swap
inference-crawls and does not measure what a real person feels (the 7B scored 0%
on the 7.6 GB box for exactly this reason, which is a fit result, not a harness
bug).

## The run, per size

On a machine that fits the size, with Ollama installed and serving:

```
ollama pull qwen2.5-coder:7b
osc eval --deep --provider ollama --model qwen2.5-coder:7b --attempts 2
```

Swap `:7b` for `:14b` or `:32b` as appropriate. Notes:

- `--attempts 2` matches how the 3B was measured (best of 2, the number a card
  may quote). The report prints one-try and best-of-2 side by side.
- The command uses the Ollama ref (colon, `qwen2.5-coder:7b`); the eval.json key
  uses the dash id (`qwen2.5-coder-7b`). They are not the same string.
- A cold larger model can take minutes to first token on a modest box. The deep
  eval already applies the split stream-idle windows, so let it sit through
  prefill rather than assuming it hung.
- The full report is saved under `~/.os-code/eval/v2-qwen2.5-coder:7b.json`. The
  terminal shows the average, the per-task breakdown, and the by-category line.

## Recording the result

Take the best-of-2 average from the report and REPLACE the size's entry in
`curation/eval.json` with the deep-only measured shape (fill in the real number,
box, and date):

```json
  "qwen2.5-coder-7b": {
    "deep": 0.00,
    "attempts": 2,
    "box": "REPLACE-with-box, e.g. gpu-24gb or ram-32gb",
    "date": "YYYY-MM-DD",
    "source": "measured"
  },
```

Then run `pnpm test` in `os-code/` so `test/curationEval.test.ts` and the
provenance guard pass, rebuild the catalog, and commit.

Honesty rules that stay in force:

- If a size scores below the gate bar, it DROPS from the orchestrator feed. That
  is the correct, honest outcome, not a reason to keep the seed number. Record
  the measured number anyway; do not paper over it with the published one.
- Do not quote a measured DeepBlue number as a product claim until the entry is
  committed and the catalog is rebuilt from it.

## Where eval numbers surface, and where they do not (finding, 2026-09-23)

Checked so the slot-to-weights mapping does not silently quote the wrong number
when a card is redesigned later:

- **No Harbor or DeepBlue card quotes a coding eval number today.** The First
  Seat card (`app/src/components/FirstSeat.tsx`) shows a hardware FIT line (size
  plus fits or too-big), not a score. The DeepBlue Settings row
  (`app/src/lib/harborMaster.ts`) shows a size and attribution line. Harbor's row
  shows a byline. None reads a rating.
- **Eval stars surface only in the catalog-driven Marketplace**, keyed by the
  catalog id (`qwen2.5-coder-3b`, `-7b`, ...), which is the correct key. The
  reserved app slots (`harbor`, `harbor-master`, `harbor-mini`) resolve to those
  catalog ids for install, not for rating display.
- **So there is nothing to fix now.** The mapping only becomes a real gap if a
  DeepBlue or Harbor card is later designed to quote its measured score. At that
  point it must resolve the slot to its weights id (DeepBlue's active size to its
  `catalogId`, Harbor to `qwen2.5-coder-3b`) and read that entry, never invent a
  per-slot number. This paragraph is the reminder to do that when the time comes.

## Harbor and the phone

Harbor runs the same Qwen 2.5 Coder 3B weights as DeepBlue's floor size, so the
desktop 0.75 characterizes the weights. Harbor ships on the phone, where the
harness loop does not run yet (`app/src/drivers/onDeviceDriver.ts` is a single
search protocol, no tool loop, no verify, no best-of-N). Measuring Harbor through
the harness on its real runtime waits on the pure-core extraction and the phone
host (see `PROGRESS.md`, What remains). Until then, the honest line is: Harbor's
weights score 0.75 through the harness on desktop, and Harbor on the phone is
chat coding without the harness loop.
