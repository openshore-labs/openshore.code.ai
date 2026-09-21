# The Air program: Gate 0 runbook

Status: RUNBOOK for the founder, 2026-09-21. Gate 0 of the Air program
(`docs/house-model-proposal.md`, "The Air program"): does Bonsai 2 27B plus the
OpenShore harness beat Qwen 2.5 Coder 14B on the deep eval? It runs entirely on
the Mac mini, all local, no cloud spend. If Bonsai does not beat the 14B here,
none of the adapter, runtime, or on-device work starts, and DeepBlue on
the mini plus Docked stays the answer.

## Prerequisites (once)

- Node 22.12 or newer, `pnpm`, `git`, Xcode command line tools.
- Ollama installed and running (`ollama serve`, default port 11434).
- The deep-eval tasks are hermetic fixtures built into the engine, so no
  repository or project is needed to run them.

## Steps

1. **Build the engine.** Run these one line at a time. If the repo is already on
   this machine (likely on a dev box), use the existing clone instead of a
   second one: `cd` into it, `git fetch origin`, then check out the branch. The
   build script lives in the `os-code` package, so `pnpm build` must run from
   inside `os-code`, never the repo root.

   ```
   git clone git@github.com:openshore-labs/openshore.code.ai.git ~/openshore.code.ai
   cd ~/openshore.code.ai
   git checkout claude/compact-opus-open-source-aluth4
   pnpm install
   cd os-code
   pnpm build
   ```

2. **Serve Bonsai as an OpenAI-compatible endpoint.** Follow PrismML-Eng/Bonsai-demo
   (their source of truth) to run their MLX server or their llama.cpp-fork
   `llama-server` with the PTQ1_0 file on a port, for example 8080. The ternary
   kernels are not in mainline llama.cpp or Ollama, so this must be PrismML's own
   fork or MLX build. On Apple Silicon the MLX path is usually smoother. Verify
   it is up and note the served model name:

   ```
   curl -s localhost:8080/v1/models
   curl -s localhost:8080/v1/chat/completions -H 'content-type: application/json' \
     -d '{"model":"<served-name>","messages":[{"role":"user","content":"print hello in python"}]}'
   ```

3. **Pull the comparison models through Ollama.**

   ```
   ollama pull qwen2.5-coder:14b
   ollama pull qwen2.5-coder:32b   # optional; skip if the mini's RAM is tight
   ```

4. **Write the global config** at `~/.os-code/config.json`. Keep BOTH providers:
   a `providers` block replaces the default, so omitting `ollama` here breaks the
   14B and 32B runs. Give prefill headroom, since a cold 27B reads a large prompt
   on its first turn.

   ```json
   {
     "providers": {
       "ollama": {
         "kind": "openai-compatible",
         "baseUrl": "http://localhost:11434"
       },
       "bonsai": {
         "kind": "openai-compatible",
         "baseUrl": "http://localhost:8080"
       }
     },
     "resourceBudget": { "streamFirstByteSeconds": 600 }
   }
   ```

5. **Run the three deep evals** from the `os-code` directory (the config is read
   globally, so any cwd with the built CLI works). All local, so no `--yes` and
   no key.

   ```
   node dist/bin/osc.js eval --deep --attempts 3 --provider bonsai --model <served-name>
   node dist/bin/osc.js eval --deep --attempts 3 --provider ollama --model qwen2.5-coder:14b
   node dist/bin/osc.js eval --deep --attempts 3 --provider ollama --model qwen2.5-coder:32b
   ```

   Each prints a scorecard with a per-task why-line and the derived model class.
   The tasks that decide the gate are edit and refactor.

## The gate

Bonsai plus the harness must beat the 14B on the edit and refactor tasks. If it
does, Gate A begins: train the recovery adapter distilled from the open
Qwen3.8-27B on the mini and measure how much of the gap to the FP16 Qwen it
closes. If Bonsai ties or loses, stop; DeepBlue plus Docked is the answer,
and weeks of native work were saved. Either way, record all three scorecards in
`os-code/curation/eval.json` provenance style (a `measured` entry with `box` and
`date`) and bring them back so the next gate can be planned on the number.

## Notes and traps

- `maxResidentModels` defaults to 1, but Bonsai is served by its own process and
  Ollama serves the others, so running the three evals in sequence is fine. Watch
  memory if the 32B (about 20 GB weights, about 24 GB to run) and a served 27B
  are ever loaded at once; run them one at a time.
- If a Bonsai run dies with "No bytes for 300s" or similar, the prefill window is
  too tight for the cold model on this box: raise `streamFirstByteSeconds`
  further (900) and re-run. That is a runtime pacing issue, never a harness bug.
- A tie or a loss is a real, useful result, not a failure of the run. The whole
  point of Gate 0 is to spend a day here instead of weeks on the phone.
