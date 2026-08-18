# BUILD BRIEF FOR FABLE: "OS Code" (Open Shore Code) - a local-first coding agent, familiar to Claude Code users

You are a principal engineer at OpenShore. Scaffold a new product called
**OS Code** (long form: Open Shore Code; CLI command: `osc`). Build the
**empty shell only**: the full directory structure, typed interfaces, config
schemas, branded TUI chrome, and STUBBED implementations with clear `// TODO`
extension points. It must install and compile, and the onboarding commands
(`osc init`, `osc login`, `osc doctor`, `osc pair`) must actually work. Do NOT
implement the full agent loop, model inference, or GitHub write operations.
Leave those as well-documented stubs.

## The product in one sentence
OS Code is a terminal-first coding agent with an interaction model **familiar to
Claude Code users** (streaming transcript, slash commands, tool-approval
prompts), whose purpose is to run a **personally curated stack of local LLMs that
services the majority of your coding work**. It is **local-first and
self-hosted**: compute runs on the user's own machine, and cloud models run on
the user's own account or key. You connect your Claude account the way you sign
into Cursor or VS Code, so cloud is one deliberate keystroke away for the hardest
tasks or as a fallback, while the local fleet stays the default engine. It runs
on Linux desktop and is driven from an iPhone over SSH (Termius) across a private
Tailscale network, so you can do real coding on the go.

## Build sequence (this ordering is load-bearing, do not reorder)
Prove the narrow core before the seductive breadth. If the fleet router,
mixture-of-agents, marketplace, and vision are built before the core is proven,
the result is a clever demo, not a product.
1. Core loop + tools + tool-call bridge + edit engine + the **eval harness**.
2. Security: daemon threat model + permissions + guardrails.
3. Providers + a single local model working end to end + cloud API-key fallback.
4. Only then: fleet router, marketplace catalog, vision, mixture-of-agents.
Scaffold all modules now (this is the shell), but mark this sequence in the
README so implementation follows it.

## Autonomous execution contract (run non-stop, do not pause)
- **Do not ask for approval or clarification. Do not stop until the Definition of
  Done is met.** If a choice is ambiguous, pick the default in "Pinned stack and
  defaults" below, or the most conventional option, record it in one line in
  `DECISIONS.md`, and keep going.
- **No planning or exploration phase.** The directory tree and specs below ARE
  the plan. Write files directly, top to bottom through the tree, in one pass.
- **One build cycle, at the very end.** Do not build/typecheck/lint after each
  file. Write everything, then run `pnpm install`, `pnpm build`, `pnpm typecheck`,
  `pnpm lint` once, fix compile/type/lint errors until green, then stop.
- **Do not echo file contents into chat and do not narrate each file.** End with:
  the final tree, a one-line status per command (works / stubbed), and run
  instructions. Nothing else.

## Token discipline (spend as little as possible)
- **Minimal stubs.** Each stubbed function is a typed signature plus one
  `// TODO:` line describing the real implementation, and a body that either
  returns a typed placeholder or `throw new NotImplemented("<what>")`. Keep each
  stub file under about 30 lines. No elaborate placeholder logic.
- **Only the three required tests** (see below). No other tests.
- **No boilerplate beyond what is needed to compile.** No duplicate config, no
  speculative abstractions, no commentary essays in code.
- Obey the scope fence. Everything outside it is wasted tokens.

## Pinned stack and defaults (do not deviate, do not research alternatives)
- **Runtime:** Node 20 LTS. **Module system:** ESM (`"type":"module"`).
  **Language:** TypeScript 5.x, `strict: true`, target ES2022,
  `moduleResolution: "NodeNext"`. **Package manager:** pnpm.
- **Deps:** `commander` (CLI), `ink` v5 + `react` (TUI), `zod` (schemas),
  `simple-git` (git), `@octokit/rest` (GitHub), native `fetch` (HTTP). A tiny
  hand-rolled logger, no logging dependency. Pin concrete versions in
  `package.json`.
- **Build:** `tsc` to `dist/`, `bin/osc` shim with a shebang. **Test:** `vitest`.
  **Lint/format:** `eslint` + `prettier` with standard configs (add the config
  files).
- **Tests to write (exactly three, no more):** (1) `em-dash-policy.test.ts` fails
  on any em dash in a user-facing string; (2) `connectorMap.test.ts` fails on
  drift in the connector/secret manifest; (3) `doctor.smoke.test.ts` asserts
  `osc doctor` runs and exits cleanly.
- **No telemetry, no analytics, no phone-home.** Privacy is a feature.
- **Linux-first.** No Windows or macOS special-casing. Assume Ollama at
  `http://localhost:11434`.
- **Housekeeping files:** `.gitignore`, `README.md`, `DECISIONS.md`, a `LICENSE`
  file marked `TODO: business decision` (do not block on the license choice),
  `os-code.config.example.json`, `catalog.sample.json`.

## Exact directory tree (build this, do not redesign it)
```
os-code/
  package.json  tsconfig.json  .eslintrc.json  .prettierrc  .gitignore
  LICENSE  README.md  DECISIONS.md
  os-code.config.example.json  catalog.sample.json
  bin/osc.ts
  src/
    index.ts
    brand/theme.ts
    config/{schema.ts,load.ts}
    commands/{init,login,pair,doctor,run,attach,serve,fleet,market,license,eval,authGithub,attachImage}.ts
    core/
      agent/{loop.ts,types.ts,registry.ts}
      tools/{index.ts,readFile.ts,writeFile.ts,editFile.ts,runShell.ts,grep.ts,glob.ts,git.ts,parser.ts}
      edit/{apply.ts,searchReplace.ts,verify.ts}
      permissions/index.ts
      guardrails/index.ts
      security/{daemonAuth.ts,jail.ts,redaction.ts,profiles.ts}
    providers/{types.ts,registry.ts,openaiCompatible.ts,anthropic.ts,capabilities.ts}
    providers/adapters/{index.ts,qwen.ts,llama.ts}
    router/{router.ts,fleet.ts,roles.ts,resourceBudget.ts}
    context/{codeMap.ts,index.ts,compaction.ts}
    context/vision/ingest.ts
    auth/{claude.ts,github.ts,store.ts,usage.ts}
    git/index.ts
    github/index.ts
    connect/{pair.ts,tailscale.ts,health.ts}
    daemon/{serve.ts,session.ts,attach.ts}
    market/{catalog.ts,install.ts,schema.ts}
    license/{verify.ts,entitlement.ts}
    server/connectorMap.ts
    eval/harness.ts
    tui/{app.tsx,transcript.tsx,statusLine.tsx,input.tsx,approval.tsx,plain.ts}
  test/{em-dash-policy.test.ts,connectorMap.test.ts,doctor.smoke.test.ts}
```

## Scope fence (do NOT build any of this)
No real inference or model calls, no real network calls to providers, no auth
server, no payment integration, no web dashboard, no marketing site, no mobile
app, no Docker/k8s, no CI beyond nothing (skip CI entirely for now), no tests
beyond the three named. The fleet routing logic, RAG indexing, constrained
decoding, edit verification, and license verification are INTERFACES PLUS STUBS
only. Building anything here is out of scope and wastes tokens.

## Definition of Done (stop when all are true)
1. The directory tree above exists and `pnpm install && pnpm build` is green.
2. `pnpm typecheck` and `pnpm lint` pass; the three tests pass.
3. `osc init`, `osc login`, `osc pair`, `osc doctor` run for real; every other
   command runs and prints "not yet implemented" with its intended behavior.
4. `README.md` and `DECISIONS.md` exist. Then STOP and print the closing summary.

## Positioning and economics constraints (these shape the architecture, honor them)
- **Local-first, not "decentralized."** No P2P, no chain, no consensus. The
  framing is "your machine, your models, your keys."
- **Familiar to Claude Code, not a clone.** Match the interaction model. Do NOT
  copy the Claude Code name or branding, and do NOT imply any Anthropic
  affiliation anywhere user-facing. Marketing says "familiar to Claude Code
  users," never "exactly like Claude Code."
- **Never host model weights and never proxy inference.** OpenShore's hosting
  cost must stay near zero. Any design that routes inference through our servers
  or serves weights from our infrastructure is forbidden.
- **The marketplace is a CATALOG, not a weight host.** A small static JSON
  manifest we publish (Cloudflare/GitHub Pages) that points at Hugging Face and
  the Ollama registry, with license flags. Weights are pulled by the client
  directly from those sources.
- **iOS is an SSH client, not an App Store app.** No native iOS app. The phone
  experience is Termius over Tailscale into the desktop daemon.
- **We orchestrate Tailscale and the SSH client, we do not embed them.** OS Code
  provides a first-run pairing wizard that guides install and links an existing
  tailnet.
- **The paywall gates what we control:** the curated catalog, the cloud-connector
  configs, and updates. The shell itself is local and open-ish. Sold on the web,
  so no App Store cut.

## Non-negotiables (read before writing code)
1. **Empty shell.** Scaffold, interfaces, stubs, TODOs. `osc init`, `osc login`,
   `osc doctor`, `osc pair` run for real; everything else is stubbed.
2. **Interaction parity with Claude Code** (familiar, not cloned): streaming
   transcript, slash commands, the same tool-approval rhythm and status line. A
   Claude Code user should feel at home. Local vs cloud is the only visible
   difference, surfaced in the status line.
3. **Local-first is the whole point.** The local fleet is the default engine and
   handles the majority of work. Cloud is deliberate, never silent.
4. **Stack: TypeScript + Node (pnpm).** Ink TUI, `commander` CLI, `simple-git`,
   `@octokit/*`, `zod`, OpenAI SDK shape for providers.
5. **SSH / Termius first.** Keyboard-only TUI, degrades to plain stdout on dumb
   terminals or `--plain`, survives dropped connections, low bandwidth, small
   phone screen.
6. **No em dashes in any user-facing string.** Use periods or commas. OpenShore
   house rule.
7. **Permission model like Claude Code**, plus a separate confirm-before-spend
   prompt on any step that would consume the user's cloud quota.
8. **Security is not a later phase.** The daemon threat model (section 12) is
   scaffolded and enforced in the shell, not deferred.

## Architecture (build each as a typed shell)

### 1. Agent loop and tools - `src/core/agent/`, `src/core/tools/`
ReAct-style tool-use loop. Define the loop, message and turn types, and the tool
registry. Stub the stepping.
- Tools: `readFile`, `writeFile`, `editFile`, `runShell`, `grep`, `glob`,
  `gitStatus`, `gitDiff`, `gitCommit`. Typed zod schemas, real signatures,
  stubbed bodies. **Validate every tool input with zod at the boundary.**
- **Tool-call bridge** (`src/core/tools/parser.ts`), the make-or-break component
  for local models. Support native OpenAI tool-calling AND a JSON-in-text
  fallback, with a bounded repair-and-retry pass and, on repeated failure, a
  cloud fallback. Add **constrained / grammar-based decoding** to force valid
  tool JSON, but do NOT assume one uniform API: the backends differ (llama.cpp
  GBNF, vLLM json-schema/outlines, Ollama structured-output, LM Studio its own).
  Build **per-backend capability detection**, use grammar decoding where
  available, and fall back to validate-plus-repair where it is not.

### 2. Edit engine - `src/core/edit/`  (top failure mode, guard it hard)
Local models fail exact-string edits, so naive old_string/new_string edits break
constantly. But a tolerant matcher that lands a hunk in the WRONG place produces
silent corruption that compiles and ships a bug. So:
- **Structured search/replace blocks** as the primary edit format (not
  exact-string and not whole-file rewrites).
- **Context-anchored fuzzy match**: anchor on surrounding lines, never match on
  the changed text alone.
- **Post-apply verification**: re-read the file, run a cheap structural / lint /
  compile check where available, and reject on mismatch.
- **Diff-for-approval**: show the resulting diff before it lands.
- A **fast-apply model role** (see Fleet): a small model that merges a rough edit
  into the file (the Cursor/Morph and Aider search-replace pattern). Interface
  plus stub.

### 3. Eval harness - `src/eval/`  (the go/no-go instrument, build it early)
The entire product depends on the median local model reliably driving tools and
applying edits. Ship a harness that measures, across a small set of target local
models: **tool-call success rate**, **edit-apply success rate**, and **retrieval
accuracy** on a fixture repo. Output a short list of **blessed model profiles**
that actually pass, rather than infinite flexibility over a shaky base. Stub the
fixtures and scoring; make the command real (`osc eval`).

### 4. Provider layer - `src/providers/`
One `Provider` interface: streaming `chat()`, tool-calling, capability flags
(`supportsTools`, `supportsVision`, `supportsGrammar`, `contextTokens`,
`costTier: "local"|"cloud"`, `latencyTier`). Stubs:
- `OpenAICompatibleProvider` - one adapter, configurable base URL: Ollama, LM
  Studio, llama.cpp server, vLLM. The default engine. Include the per-backend
  capability probe from section 1.
- `AnthropicProvider` - cloud Claude, TWO auth modes: a **bring-your-own
  Anthropic API key** (the dependable, documented, marketed path) and a Claude
  **account** subscription sign-in that is an **experimental, clearly-labeled
  stub only** and appears in NO marketing surface (driving a consumer
  subscription from a third-party client is a ToS gray area and a user-ban /
  overnight-breakage risk). The app must fully work on the API-key path alone.
- `providers/registry.ts` instantiates providers from config.

### 5. Per-model prompt adapters - `src/providers/adapters/`
Claude-tuned prompts and tool schemas port poorly to local models. Provide a
**per-model adapter**: chat template, stop tokens, system-prompt phrasing, tool
format per model family. Interface plus a couple of stubbed adapters.

### 6. Accounts and auth - `src/auth/`
- `osc login` (MUST WORK as a flow shell): connect the Claude account (paste an
  **Anthropic API key**, the primary path; the subscription OAuth is the
  experimental stub above). Tokens in the OS keychain interface or an encrypted
  `~/.os-code/credentials`.
- `osc auth github`: GitHub device-flow OAuth plus PAT fallback, same store.
- A `usage` interface tracking cloud calls so the TUI warns before spending
  quota. Stub the accounting.

### 7. The Fleet and Router - `src/router/`  (the "stack multiple LLMs" feature)
Roles: **Planner**, **Coder**, **Fast-edit**, **Apply**, **Vision**,
**Embedder**. Router inputs: input modality, output type (plan/diff/answer/
search), estimated difficulty and context size, confidence/escalation signal.
Two modes per task: **route** (one model) and **chain / mixture-of-agents**.
- **Default policy: local-first.** Cloud fires only on opt-in or an escalation
  rule (local low-confidence, repeated tool failures, task over a difficulty
  threshold) AND the account is connected AND confirm-before-spend is accepted.
- **VRAM profile selection at first run (REQUIRED, or the fleet feels broken).**
  Stacking causes Ollama load/unload thrash (tens of seconds per role hop on a
  consumer GPU). At first run, detect total VRAM and pick a profile. **Default to
  route-one with roles COLLAPSED onto one resident model** when VRAM is tight;
  make multi-model and mixture-of-agents **opt-in** for users with headroom. Keep
  the **embedder small and persistent** (CPU is fine). Ship a `resourceBudget` in
  config (VRAM budget, `keep_alive` tuning, quantization notes). Never let the
  router assume it can hold five models hot.

### 8. Repo context and RAG - `src/context/`  (retrieval accuracy is core correctness)
Bad retrieval feeds the wrong context and causes the wrong edit, so on
small-context local models this is correctness, not a nice-to-have (and it is part
of the eval harness).
- Ripgrep/glob **code map** (tree + symbol outline via a tree-sitter stub).
- **Embedding index** (Embedder role) at `~/.os-code/index/<repo-hash>/`;
  retrieves only relevant slices.
- **Context compaction**: summarize old turns and file reads to fit small windows.

### 9. Git and GitHub - `src/git/`, `src/github/`
Local ops via `simple-git`; GitHub via Octokit using the token from `src/auth/`.
Verbs familiar from Claude Code. Stub writes.

### 10. Connectivity and daemon - `src/connect/`, `src/daemon/`
- `osc pair` (MUST WORK as a wizard shell): detect Tailscale, guide install if
  missing, show tailnet status, print a QR / copy-paste to connect the phone SSH
  client. It **orchestrates**, it does not embed Tailscale or an SSH server.
  **Include a sleep-inhibit step** (caffeinate / power-setting guidance with
  detect-and-warn), because desktop sleep silently kills a phone user's in-flight
  run.
- `osc serve` (**daemon owns the generation**): the run lives in the background
  daemon, not the TUI, so a dropped phone connection reattaches to an in-flight
  run via `osc attach <id>`. Sessions persist to `~/.os-code/sessions/`. See
  section 12 for how the daemon binds and authenticates. It must NOT bind
  `0.0.0.0`.
- **Health layer with a per-link error taxonomy**: detect and NAME the specific
  broken link (desktop asleep, Ollama down, tailnet down, SSH unreachable, model
  not loaded), never a generic "connection failed."

### 11. Marketplace catalog - `src/market/`
- `osc market` / `osc models`: browse and install from a **curated catalog**.
- The catalog is a **remote static JSON manifest** (configurable URL), per model:
  name, roles it suits, source (Hugging Face or Ollama), pull command, size,
  quantization options, context window, **license flag**, curation note/rank, and
  whether it is a **blessed profile** from the eval harness. Ship a typed schema
  and a small bundled sample manifest.
- Install triggers a **direct pull from the source** (`ollama pull`, etc.), never
  from OpenShore. Show the license before install. Never rehost weights.

### 12. Security: daemon threat model + permissions + guardrails - `src/core/security/`, `src/core/permissions/`, `src/core/guardrails/`
A phone-reachable shell-executing agent is remote code execution by design.
"Reachable over Tailscale" is transport, not authorization. Treat this as the
highest-severity surface and scaffold it enforced, not deferred.
- **Daemon binding + authN**: bind to loopback or the Tailscale interface only,
  never `0.0.0.0`. Authenticate the control channel with its own credential,
  independent of Tailscale reachability.
- **Command policy**: default-deny for `runShell` with explicit approval, not
  just step caps. A **working-directory jail** for file tools. **Secret
  redaction** from the transcript and logs.
- **Profiles**: define phone/headless as a MORE restrictive profile than
  local-interactive, not less (auto-approve is never the phone default).
- **Permissions**: allow / ask / deny per tool, glob-scoped for writes, a
  "trusted repo" concept, and the separate cloud-spend confirmation. Safe
  defaults: reads allow, writes ask, shell asks, push asks, cloud step asks.
- **Guardrails**: hard **max-step caps**, **loop/repeat detection with a real
  stop**, and per-task **wall-clock, token, and dollar budgets** that halt a
  runaway and hand control back. Structurally impossible to leave a `runShell`
  loop running unattended.

### 13. Licensing and entitlement - `src/license/`
- The paid gate lives **server-side on the surfaces we control**: the curated
  catalog feed, the signed cloud-connector configs, and the update channel. Do
  NOT build client-side DRM (crackable, user-hostile, wasted effort). Accept that
  a determined user with the code can bypass; price for the honest majority.
- Support **two entitlement types** in the schema: a **subscription** and a
  **one-time perpetual-fallback** license (keeps working, connectors freeze after
  the update window). Price and tiers are config, not hardcoded.
- `osc license`: activate/show/deactivate a key against a tiny serverless
  endpoint (configurable URL) with an **offline grace-period cache** so a flaky
  network never locks the user out. Stub the verify call with the documented
  request/response shape.

### 14. Connector + secret manifest - `src/server/connectorMap.ts`
Mirror Uki's guardrail discipline from day one, before connectors multiply. A
single **source-of-truth manifest** for every cloud connector and where each
secret lives, plus a classification test that fails CI on drift. Cheap now,
whack-a-mole later. Interface plus a starter manifest and test.

### 15. Vision ingest - `src/context/vision/`
`osc attach-image <path>` and a watched drop folder (`~/.os-code/inbox/`) that
feeds the Vision role. Interface plus stub.

### 16. TUI and session - `src/tui/`
Ink app: scrollable transcript, status line showing active model role AND
local-vs-cloud with a cost indicator, input box, slash commands, tool-approval
prompt, and a distinct cloud-spend confirmation prompt. Runs over SSH with no
mouse; `--plain` line renderer for dumb terminals; resumes via `osc attach`.

### 17. Config and onboarding - `src/config/`, `src/commands/`
- Config in `os-code.config.json` (project) and `~/.os-code/config.json`
  (global). Full **zod schema**: providers/endpoints, the fleet (role to model),
  routing rules and mode, fallback policy, `resourceBudget` (VRAM/keep-alive),
  VRAM profile, catalog URL, license/entitlement, permissions, guardrail limits,
  daemon bind/auth settings.
- `osc init` - MUST WORK: autodetect Ollama, list installed models
  (`GET /api/tags`), pick a VRAM profile, write a starter fleet config.
- `osc login` - MUST WORK as a flow shell (see Auth).
- `osc pair` - MUST WORK as a wizard shell (see Connectivity), including
  sleep-inhibit.
- `osc doctor` - MUST WORK: local server reachable, models present, Claude API
  key connected, GitHub token present, tailnet up, daemon bind is not `0.0.0.0`,
  license status, and every fleet role resolves. Branded, actionable report with
  the per-link error taxonomy.
- Scaffold (stubbed): `osc run`, `osc attach`, `osc serve`, `osc fleet`,
  `osc market`, `osc license`, `osc eval`, `osc auth github`, `osc attach-image`.

### 18. Branding - `src/brand/`
Centralize ALL theme tokens. OpenShore theme with PLACEHOLDER values marked
`// OPENSHORE: replace with real brand tokens`:
- Palette: deep ocean navy background, off-white text, one bright signal accent
  (default cyan/teal) for local, warm amber for cloud/escalation, muted gray for
  secondary.
- An ASCII/Unicode **OS Code** wordmark banner on launch and in `osc doctor`. Do
  not imitate Claude Code branding.
- A theming function so the whole TUI reads from these tokens.

## Deliverables
1. Complete directory tree with every module present.
2. `package.json` with real deps and scripts (`build`, `dev`, `lint`,
   `typecheck`, `osc` bin).
3. Working `osc init`, `osc login`, `osc pair`, `osc doctor`. Every other command
   scaffolded and printing a clear "not yet implemented" with intended behavior.
4. Full zod config schema plus a commented **example `os-code.config.json`** with
   a realistic local fleet (planner, coder, fast-edit, apply, embedder) on an
   Ollama endpoint, a cloud Claude API-key entry, a `resourceBudget` + VRAM
   profile, a catalog URL, entitlement config, daemon bind/auth defaults, and
   local-first routing with escalation.
5. A bundled **sample catalog manifest** and its zod schema, and a starter
   **connectorMap** with its classification test.
6. A `README.md`: the concept, an ASCII architecture diagram, the **build
   sequence** above, a quickstart (install Ollama, pull models, `osc init`,
   `osc login`, `osc doctor`, `osc run`), the marketplace flow, and the
   phone-on-the-go workflow (`osc pair`, Tailscale, Termius, `osc serve` +
   `osc attach`).
7. Inline `// TODO` at every stub marking the extension point and what a real
   implementation must do.

## Acceptance criteria
- `pnpm install && pnpm build` succeeds; `npx osc doctor` reports status;
  `npx osc init` writes a valid config; `npx osc login` and `npx osc pair` run
  their flows.
- No em dash in any user-facing string. No copy implies Anthropic affiliation.
- The daemon never binds `0.0.0.0`; `runShell` is default-deny with approval; the
  phone/headless profile is more restrictive than local-interactive.
- Guardrails (step cap, loop detection, wall-clock/token/dollar budgets) are
  enforced so a runaway agent over SSH is structurally prevented.
- The fuzzy edit path is context-anchored, verifies post-apply, and shows a diff
  for approval before landing.
- The marketplace installs by pulling from the source (Ollama/HF), never from
  OpenShore, and shows the license first.
- The subscription-OAuth path is an experimental stub and appears in no
  user-facing marketing copy.
- All branding reads from `src/brand/`; changing one token restyles the app.

Do not wait for approval. Build the shell now, in one non-stop pass, following
the build sequence, the pinned stack, and the exact directory tree above. Record
any ambiguous decision in `DECISIONS.md` and keep going. Run a single build pass
at the end, fix until green, and stop at the Definition of Done with the closing
summary. Do not echo file contents or narrate individual files.
