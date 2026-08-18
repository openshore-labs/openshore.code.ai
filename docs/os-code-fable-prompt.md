# BUILD BRIEF FOR FABLE: "OS Code" (Open Shore Code) - a complete, delightful local-LLM coding agent

You are a principal engineer at OpenShore. Build **OS Code** (long form: Open
Shore Code; CLI command: `osc`): a terminal coding agent that gives local LLMs
the same complete, polished, genuinely delightful experience a developer gets
from Claude Code. This is not a stubbed skeleton. Build real, working software.

## The one priority that overrides the rest
**Index on a complete and incredibly delightful clone of the Claude Code
experience for local LLMs. Do not economize on tokens, scope, or polish to get
there.** When you must trade off, choose completeness and delight over brevity
every time. Take the tokens you need. The measure of success is that a developer
who loves Claude Code opens OS Code, points it at their local models, and feels
at home and delighted, not that the build was cheap.

## The product in one sentence
OS Code is a terminal-first coding agent with the interaction model developers
know from Claude Code (streaming transcript, slash commands, tool-approval
prompts, web search, repo-aware editing), whose purpose is to run a **personally
curated stack of local LLMs that services the majority of your coding work**,
where a stack can be a single general model or a mandatory reasoning model that
delegates to optional specialists. It
is **local-first and self-hosted**: compute runs on the user's own machine, and
cloud models run on the user's own account or key. You connect your Claude
account the way you sign into Cursor or VS Code, so cloud is one deliberate
keystroke away for the hardest tasks or as a fallback, while the local fleet
stays the default engine. It runs on Linux desktop and is driven from an iPhone
over SSH (Termius) across a private Tailscale network, so you can do real coding
on the go.

## Completeness and quality bar (this is where to index)
- **Build working software, not stubs.** Implement every capability for real.
  The ONLY things allowed to remain stubs are the few that genuinely cannot run
  in this environment: the hosted license-verification server, the subscription
  OAuth token exchange, and any secret you do not have. Everything else, the
  agent loop, the tools (including web search), the edit engine, the local
  provider talking to Ollama, the router, RAG, the TUI, the daemon, pairing,
  and the marketplace, is real and functioning.
- **It must actually run.** `osc` installs, builds, and drives a real local model
  through Ollama end to end: read files, search the web, edit code, run tests,
  commit. Where this environment has no Ollama, wire it fully, cover it with
  tests against a mock provider, and make it work with one real command on the
  user's machine.
- **Delight is a requirement, not a finish.** See the Delight bar below.
- **Test what protects the experience.** Write real tests for the agent loop,
  tool-call parsing, the edit engine, routing, and web tools, not just the three
  policy tests. Quality over token count.

## The Delight bar (what "incredibly delightful" means in a terminal)
- **Instant, smooth streaming.** Tokens render as they arrive, no janky
  repaints. Thoughtful, quiet spinners and progress for tool calls and model
  loads. GPU/model load time is surfaced, never a silent hang.
- **Beautiful, legible chrome.** A gorgeous `osc doctor`, a crisp status line
  (active model role, local vs cloud, cost, context used), and a wordmark banner,
  all from the brand tokens. Great typography and color, with a clean `--plain`
  fallback that still feels considered.
- **Zero-friction onboarding.** `osc init`, `osc login`, and `osc pair` feel like
  a premium setup: autodetect everything possible, explain each step in one warm
  sentence, and never dump a wall of config.
- **Microcopy that respects the user.** Every prompt, error, and empty state is
  clear, human, and actionable. Errors name the exact broken link and the fix.
  No stack traces in the user's face.
- **Keyboard ergonomics.** Fast, discoverable slash commands, sensible defaults,
  reversible actions, and a diff-approval flow that is a pleasure, not a chore.
- **It feels alive on a phone.** Over SSH from Termius the app is responsive,
  compact, and never loses your place when the connection blips.
- **Honesty as a feature.** Confirm-before-spend on cloud, show citations for web
  results, and never pretend a local model did something it did not.

## Build sequence (depth-first: finish and polish each layer before widening)
Prove the narrow core, fully working and delightful, before the breadth. If the
fleet router, marketplace, and vision are built before the core genuinely works,
the result is a clever demo, not a product.
1. **Core, fully working:** the agent loop + tools (including web search) + edit
   engine + one local provider driving Ollama end to end + a delightful TUI.
2. **Security, enforced:** daemon threat model + permissions + guardrails.
3. **Breadth, each working before the next:** fleet router and stacking, cloud
   Claude escalation, RAG/code-map, marketplace catalog, connectivity/daemon and
   pairing, vision.
Build depth-first. If you cannot reach the end in one pass, leave working,
polished software at the current layer plus a `PROGRESS.md` note of what remains.
Never leave a half-broken build.

## Autonomous execution contract (run non-stop, do not pause)
- **Do not ask for approval or clarification. Do not stop until the Definition of
  Done is met.** If a choice is ambiguous, pick the default in "Pinned stack and
  defaults" below, or the most conventional and highest-quality option, record it
  in one line in `DECISIONS.md`, and keep going.
- **The directory tree and specs below are the plan.** Follow the build sequence;
  build, run, and test iteratively until each layer genuinely works. Fix compile,
  type, lint, and test failures as you go; the final state is green and runnable.
- End with a clear closing summary: what works, how to run it, and anything left
  in `PROGRESS.md`.

## Pinned stack and defaults (do not deviate, do not research alternatives)
- **Runtime:** Node 20 LTS. **Module system:** ESM (`"type":"module"`).
  **Language:** TypeScript 5.x, `strict: true`, target ES2022,
  `moduleResolution: "NodeNext"`. **Package manager:** pnpm.
- **Deps:** `commander` (CLI), `ink` v5 + `react` (TUI), `zod` (schemas),
  `simple-git` (git), `@octokit/rest` (GitHub), native `fetch` (HTTP),
  `@mozilla/readability` + `jsdom` or `linkedom` (web page extraction),
  `turndown` (HTML to markdown). A tiny hand-rolled logger. Pin concrete versions.
- **Build:** `tsc` to `dist/`, `bin/osc` shim with a shebang. **Test:** `vitest`.
  **Lint/format:** `eslint` + `prettier` with standard configs.
- **Policy tests (at minimum, plus real functional tests):**
  `em-dash-policy.test.ts` (no em dash in user-facing strings) and
  `connectorMap.test.ts` (no drift in the connector/secret manifest). Add
  functional tests for the loop, parser, edit engine, router, and web tools.
- **No telemetry, no analytics, no phone-home.** Privacy is a feature.
- **Linux-first.** Assume Ollama at `http://localhost:11434`.
- **Housekeeping:** `.gitignore`, `README.md`, `DECISIONS.md`, `PROGRESS.md`, a
  `LICENSE` marked `TODO: business decision`, `os-code.config.example.json`,
  `catalog.sample.json`.

## Directory tree (build this; add files freely where completeness needs them)
```
os-code/
  package.json  tsconfig.json  .eslintrc.json  .prettierrc  .gitignore
  LICENSE  README.md  DECISIONS.md  PROGRESS.md
  os-code.config.example.json  catalog.sample.json
  bin/osc.ts
  src/
    index.ts
    brand/theme.ts
    config/{schema.ts,load.ts}
    commands/{init,login,pair,doctor,run,attach,serve,stack,market,license,eval,authGithub,attachImage}.ts
    core/
      agent/{loop.ts,types.ts,registry.ts}
      tools/{index.ts,readFile.ts,writeFile.ts,editFile.ts,runShell.ts,grep.ts,glob.ts,git.ts,webSearch.ts,webFetch.ts,generateImage.ts,parser.ts}
      tools/search/{index.ts,duckduckgo.ts,brave.ts,searxng.ts,tavily.ts,readability.ts}
      edit/{apply.ts,searchReplace.ts,verify.ts}
      permissions/index.ts
      guardrails/index.ts
      security/{daemonAuth.ts,jail.ts,redaction.ts,profiles.ts,egress.ts}
    providers/{types.ts,registry.ts,openaiCompatible.ts,anthropic.ts,imageGen.ts,capabilities.ts}
    providers/adapters/{index.ts,qwen.ts,llama.ts}
    router/{router.ts,stack.ts,roles.ts,resourceBudget.ts}
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
    tui/{app.tsx,transcript.tsx,statusLine.tsx,input.tsx,approval.tsx,citations.tsx,plain.ts}
  test/{em-dash-policy.test.ts,connectorMap.test.ts,agentLoop.test.ts,parser.test.ts,edit.test.ts,router.test.ts,webSearch.test.ts,doctor.smoke.test.ts}
```

## Positioning and economics constraints (honor these)
- **Local-first, not "decentralized."** No P2P, no chain. "Your machine, your
  models, your keys."
- **Familiar to Claude Code, not a clone of its name or brand.** Match the
  experience. Do NOT copy the Claude Code name or branding, and do NOT imply any
  Anthropic affiliation anywhere user-facing.
- **Never host model weights and never proxy inference.** OpenShore's hosting
  cost stays near zero. No routing inference through our servers, no serving
  weights from our infrastructure.
- **The marketplace is a CATALOG, not a weight host:** a static JSON manifest we
  publish, pointing at Hugging Face and Ollama with license flags. The client
  pulls weights directly from those sources.
- **iOS is an SSH client, not an App Store app.** The phone experience is Termius
  over Tailscale into the desktop daemon.
- **We orchestrate Tailscale and the SSH client, we do not embed them.** A
  first-run pairing wizard guides install and links an existing tailnet.
- **The paywall gates what we control:** the curated catalog, the cloud-connector
  configs, and updates. The shell is local and open-ish. Sold on the web.

## Non-negotiables
1. **Working software.** Real implementations everywhere except the few
   environment-blocked stubs named above.
2. **Interaction parity with Claude Code** (familiar, delightful, not cloned):
   streaming transcript, slash commands, tool-approval rhythm, web search,
   repo-aware editing, a status line. A Claude Code user feels at home instantly.
3. **Local-first is the whole point.** The local fleet is the default engine.
   Cloud is deliberate, never silent.
4. **Stack as pinned above.**
5. **SSH / Termius first.** Keyboard-only TUI, `--plain` fallback, survives
   dropped connections, low bandwidth, small phone screen.
6. **No em dashes in any user-facing string.** Periods or commas. OpenShore rule.
7. **Permission model like Claude Code**, plus a separate confirm-before-spend
   prompt on any step that consumes the user's cloud quota.
8. **Security is enforced in the shell, not deferred** (section 12).

## Architecture (build each for real)

### 1. Agent loop and tools - `src/core/agent/`, `src/core/tools/`
A working ReAct-style tool-use loop: system prompt to model, model returns tool
calls, tools run, observations feed back, repeat until done, with streaming.
- Tools, all functioning: `readFile`, `writeFile`, `editFile`, `runShell`,
  `grep`, `glob`, `gitStatus`, `gitDiff`, `gitCommit`, plus the web tools below.
  Typed zod schemas, validated at the boundary.
- **Tool-call bridge** (`src/core/tools/parser.ts`), the make-or-break component
  for local models. Support native OpenAI tool-calling AND a JSON-in-text
  fallback, with a bounded repair-and-retry pass and, on repeated failure, cloud
  escalation. Add **constrained / grammar-based decoding** to force valid tool
  JSON; the backends differ (llama.cpp GBNF, vLLM json-schema/outlines, Ollama
  structured-output, LM Studio its own), so implement **per-backend capability
  detection**, use grammar decoding where available, and validate-plus-repair
  where it is not.

### 2. Web access - `src/core/tools/webSearch.ts`, `webFetch.ts`, `src/core/tools/search/`
Local models have a knowledge cutoff and NO network access on their own, so web
access is a first-class tool the agent provides, exactly like Claude Code.
- **`webSearch(query, {count})`**: returns ranked results (title, url, snippet)
  via a pluggable `SearchProvider`. Implement providers: **DuckDuckGo** (default,
  zero-config, no key), **Brave Search API**, **self-hosted SearXNG** (the
  privacy/local-first choice), and **Tavily**. Backend and key are config; the
  app works out of the box on DuckDuckGo.
- **`webFetch(url)`**: fetches a page and returns clean, readable **markdown**
  via `@mozilla/readability` + `turndown`, stripped of nav/ads, size-capped for
  small local context windows.
- **Citations**: the TUI shows sources for web-derived answers
  (`tui/citations.tsx`), the way Claude Code surfaces them.
- **Privacy and permission**: web queries leave the machine, so gate the web
  tools through the egress policy (section 12), on by default but visible and
  disableable, and note the privacy tradeoff. SearXNG self-host keeps the whole
  path private.
- Make these real and tested against a mocked HTTP layer.

### 3. Edit engine - `src/core/edit/`  (top failure mode, guard it hard)
Local models fail exact-string edits, so naive old_string/new_string edits break
constantly, and a tolerant matcher that lands a hunk in the WRONG place is silent
corruption. Build it right:
- **Structured search/replace blocks** as the primary edit format.
- **Context-anchored fuzzy match**: anchor on surrounding lines, never on the
  changed text alone.
- **Post-apply verification**: re-read, run a cheap structural/lint/compile check
  where available, reject on mismatch.
- **Diff-for-approval** before it lands.
- A **fast-apply model role** (an optional specialist, see section 7): a small model that merges a rough edit
  into the file (the Cursor/Morph and Aider search-replace pattern).

### 4. Provider layer - `src/providers/`
One `Provider` interface: streaming `chat()`, tool-calling, capability flags
(`supportsTools`, `supportsVision`, `supportsGrammar`, `contextTokens`,
`costTier`, `latencyTier`, and a `capabilities` list of the standard categories
from section 7 so the router can match task-need to model). Specialists may be
NON-chat providers: include an `ImageProvider` path for the image-generation
category (a local diffusion server), invoked as a tool, not through `chat()`.
- `OpenAICompatibleProvider`, fully working against Ollama, LM Studio, llama.cpp,
  vLLM. The default engine, with the per-backend capability probe from section 1.
- `AnthropicProvider`, cloud Claude, TWO auth modes: a **bring-your-own Anthropic
  API key** (the dependable, documented, marketed path, implemented for real) and
  a Claude **account** subscription sign-in that is an **experimental, clearly
  labeled stub** appearing in NO marketing surface (driving a consumer
  subscription from a third-party client is a ToS gray area and a user-ban /
  overnight-breakage risk). The app fully works on the API-key path alone.
- `providers/registry.ts` instantiates providers from config.

### 5. Per-model prompt adapters - `src/providers/adapters/`
Claude-tuned prompts and tool schemas port poorly to local models. Implement a
**per-model adapter**: chat template, stop tokens, system-prompt phrasing, tool
format per model family, with adapters for the common local families.

### 6. Accounts and auth - `src/auth/`
- `osc login`: connect the Claude account (paste an **Anthropic API key**, the
  primary implemented path; subscription OAuth is the experimental stub). Tokens
  in the OS keychain, or an encrypted `~/.os-code/credentials`.
- `osc auth github`: GitHub device-flow OAuth plus PAT fallback, same store.
- A `usage` tracker for cloud calls so the TUI warns before spending quota.

### 7. The Stack: a mandatory reasoning orchestrator plus optional specialists - `src/router/`
A "stack" ranges from a **single general model** to a set of specialists. The
design centers on ONE **mandatory reasoning/orchestrator model** that does the
heavy lifting: it plans, reasons, drives the tool loop, and decides when to
delegate a subtask to a specialist. **If it is the only model enabled, it does
every part of the job itself.** It can be a **local** model (Ollama) OR a
**cloud** model (Claude, via the connected account). This is the one required
piece of any stack; a user with room for only one large local model, or who
prefers cloud for reasoning, has a complete, working setup.

**Specialists are optional plug-ins.** The user downloads and enables only the
ones they have room for and need. Tag each by the capability category it is
strong in, using the **industry-standard assessment dimensions** so tagging is
objective and matches how models are actually benchmarked (store the taxonomy in
one place, `router/roles.ts`, and extend it as the standard evolves):
- **Reasoning / general** (the orchestrator): MMLU, GPQA, general reasoning.
  Mandatory.
- **Coding + tool use**: SWE-bench, HumanEval / LiveCodeBench, Berkeley
  Function-Calling (BFCL).
- **Vision / visual analysis** (multimodal understanding): MMMU, MathVista,
  chart and screenshot understanding.
- **Image generation / illustrative output**: a diffusion specialist (NOT a chat
  LLM), reached as a tool via a local image server (ComfyUI / Automatic1111 / an
  OpenAI-image-compatible endpoint).
- **Embeddings / retrieval**: MTEB, powering the RAG index.
- **Fast / lightweight** (optional latency helper): a small model for trivial
  edits and quick answers.

**Delegation is the orchestrator's job.** It calls a specialist the way it calls
any tool ("analyze this screenshot", "generate this illustration", "embed these
files", "write this function"), passes the subtask, and folds the result back
into its reasoning. The router provides the mechanism: match the task need to an
enabled specialist by capability, or fall back to the orchestrator itself when no
specialist is enabled.

**Graceful degradation is a first-class requirement, not an edge case:**
- One model enabled: it is the orchestrator and does everything. Fully supported.
- Orchestrator local or cloud: both supported. The mandatory role can point at
  Ollama or at the connected Claude account.
- A needed specialist missing: the orchestrator does that part itself, with a
  quiet note, rather than failing.

**Cloud escalation (unchanged default: local-first).** When the orchestrator is
local, a hard subtask can still escalate to cloud Claude on opt-in or an
escalation rule (low local confidence, repeated tool failures, difficulty over a
threshold) AND the account is connected AND confirm-before-spend is accepted.

**VRAM profile selection at first run (or the stack feels broken).** Running
several large local models at once thrashes as Ollama loads and unloads per hop.
Detect total VRAM at first run and pick a profile: tight VRAM defaults to the
**single-orchestrator stack**; more headroom unlocks resident specialists. Keep
the embedder small and persistent. Ship a `resourceBudget` (VRAM budget,
`keep_alive`, quantization). Never assume several large models are hot at once.

### 8. Repo context and RAG - `src/context/`  (retrieval accuracy is core correctness)
Bad retrieval feeds the wrong context and causes the wrong edit, so on
small-context local models this is correctness.
- Ripgrep/glob **code map** (tree + symbol outline; tree-sitter where practical).
- **Embedding index** (Embedder role) at `~/.os-code/index/<repo-hash>/`,
  retrieving only relevant slices.
- **Context compaction**: summarize old turns and file reads to fit small windows.

### 9. Git and GitHub - `src/git/`, `src/github/`
Local ops via `simple-git`; GitHub via Octokit using the token from `src/auth/`.
The full Claude Code verb set, working: clone, branch, status, diff, commit,
push, open PR.

### 10. Connectivity and daemon - `src/connect/`, `src/daemon/`
- `osc pair`: a delightful first-run wizard that detects Tailscale, guides
  install if missing, shows tailnet status, and prints a QR / copy-paste to
  connect the phone SSH client. It **orchestrates**, it does not embed Tailscale
  or an SSH server. Include a **sleep-inhibit** step (caffeinate / power-setting
  guidance with detect-and-warn), since desktop sleep silently kills a phone
  user's in-flight run.
- `osc serve`: the **daemon owns the generation**, so a dropped phone connection
  reattaches to an in-flight run via `osc attach <id>`. Sessions persist to
  `~/.os-code/sessions/`. Binds loopback or the Tailscale interface only, never
  `0.0.0.0` (section 12).
- **Health layer with a per-link error taxonomy**: detect and NAME the broken
  link (desktop asleep, Ollama down, tailnet down, SSH unreachable, model not
  loaded), never a generic "connection failed."

### 11. Marketplace catalog - `src/market/`
- `osc market` / `osc models`: browse and install from a **curated catalog**, a
  delightful picker.
- The catalog is a **remote static JSON manifest** (configurable URL): per model,
  name, **capability categories** it is strong in (the standard taxonomy from
  section 7, so users pick a specialist by what it is actually good at), whether
  it can serve as the mandatory reasoning orchestrator, source (Hugging Face or
  Ollama), pull command, size, quantization, context window, **license flag**,
  curation note/rank, and whether it is a **blessed profile** from the eval
  harness. Ship a typed schema and a real bundled sample manifest.
- Install triggers a **direct pull from the source** (`ollama pull`, etc.), never
  from OpenShore. Show the license before install. Never rehost weights.

### 12. Security: daemon threat model + permissions + guardrails + egress - `src/core/security/`, `permissions/`, `guardrails/`
A phone-reachable shell-executing agent is remote code execution by design.
"Reachable over Tailscale" is transport, not authorization. Enforce, do not defer.
- **Daemon binding + authN**: loopback or Tailscale interface only, never
  `0.0.0.0`. Authenticate the control channel with its own credential,
  independent of Tailscale reachability.
- **Command policy**: default-deny for `runShell` with explicit approval. A
  **working-directory jail** for file tools. **Secret redaction** from transcript
  and logs.
- **Egress policy** (`security/egress.ts`): govern the web tools and any outbound
  request; allowlist-capable, visible, on by default for web search but
  disableable.
- **Profiles**: phone/headless is MORE restrictive than local-interactive, not
  less (auto-approve is never the phone default).
- **Permissions**: allow / ask / deny per tool, glob-scoped for writes, a
  "trusted repo" concept, and the cloud-spend confirmation. Defaults: reads
  allow, web search allow, writes ask, shell asks, push asks, cloud step asks.
- **Guardrails**: hard **max-step caps**, **loop/repeat detection with a real
  stop**, per-task **wall-clock, token, and dollar budgets** that halt a runaway
  and hand control back. A `runShell` loop cannot be left running unattended.

### 13. Licensing and entitlement - `src/license/`
- The paid gate lives **server-side on the surfaces we control**: the curated
  catalog feed, the signed cloud-connector configs, and the update channel. Do
  NOT build client-side DRM. Price for the honest majority.
- Support **two entitlement types**: a **subscription** and a **one-time
  perpetual-fallback** license (keeps working, connectors freeze after the update
  window). Price and tiers are config, not hardcoded.
- `osc license`: activate/show/deactivate a key against a serverless endpoint
  (configurable URL) with an **offline grace-period cache**. The hosted verify
  server is a documented stub with its request/response shape; the client side is
  real.

### 14. Connector + secret manifest - `src/server/connectorMap.ts`
A single **source-of-truth manifest** for every cloud connector and where each
secret lives, plus a classification test that fails on drift. Real manifest and
test from day one, before connectors multiply.

### 15. Vision ingest - `src/context/vision/`
`osc attach-image <path>` and a watched drop folder (`~/.os-code/inbox/`) that
feeds the Vision role. Real ingest, wired to the vision-capable provider path.

### 16. TUI and session - `src/tui/`
The heart of the delight. Ink app: scrollable streaming transcript, a status line
(active model role, local vs cloud, cost, context used), input box with slash
commands, tool-approval prompt, a distinct cloud-spend confirmation, and a
citations panel for web results. Runs over SSH with no mouse; a considered
`--plain` renderer; resumes via `osc attach`. Make it feel premium.

### 17. Config and onboarding - `src/config/`, `src/commands/`
- Config in `os-code.config.json` (project) and `~/.os-code/config.json`
  (global). Full **zod schema**: providers/endpoints, the stack (the mandatory
  reasoning orchestrator plus optional specialists mapped by capability), routing
  rules and mode, fallback policy, `resourceBudget`, VRAM profile, search backend,
  egress policy, catalog URL, license/entitlement, permissions, guardrail limits,
  daemon bind/auth.
- `osc init`: autodetect Ollama, list installed models (`GET /api/tags`), pick a
  VRAM profile, and write a starter stack config (defaulting to a single
  orchestrator, with specialists suggested if VRAM allows). Delightful.
- `osc login`, `osc pair`: real, premium onboarding flows.
- `osc doctor`: check local server, models, Claude API key, GitHub token, tailnet,
  daemon bind, search backend, license, the mandatory reasoning orchestrator, and
  every enabled specialist, in a beautiful, actionable report with the per-link
  error taxonomy.
- All other commands (`osc run`, `attach`, `serve`, `stack`, `market`, `license`,
  `eval`, `auth github`, `attach-image`) implemented and working. `osc stack`
  views and edits the stack: the orchestrator and any enabled specialists.

### 18. Branding - `src/brand/`
Centralize ALL theme tokens. OpenShore theme with PLACEHOLDER values marked
`// OPENSHORE: replace with real brand tokens`: deep ocean navy background,
off-white text, a bright signal accent (default cyan/teal) for local, warm amber
for cloud/escalation, muted gray for secondary. An ASCII/Unicode **OS Code**
wordmark banner. Do not imitate Claude Code branding. One theming function feeds
the whole TUI.

## Definition of Done (all true)
1. `pnpm install && pnpm build` is green; `pnpm typecheck`, `pnpm lint`, and the
   test suite pass.
2. `osc` drives a real local model through Ollama end to end (read, web search,
   edit with approval, run a command, commit), and where Ollama is absent the
   same path passes against a mock provider and runs with one real command.
3. Every command works; web search returns real results and citations render.
4. Security is enforced: daemon never binds `0.0.0.0`, `runShell` is default-deny
   with approval, egress governs the web tools, guardrails halt runaways.
5. The experience is delightful per the Delight bar: streaming, status line,
   onboarding, microcopy, `--plain` fallback.
6. `README.md`, `DECISIONS.md`, and `PROGRESS.md` reflect the real state.

Build OS Code now, non-stop, depth-first along the build sequence, to a complete
and delightful state. Index on completeness and delight, not token count. Record
ambiguous decisions in `DECISIONS.md`, leave anything unfinished in `PROGRESS.md`
with working software at the current layer, and close with a summary of what
works and how to run it.
