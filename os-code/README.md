# OS Code engine

**The brain of the OS Code apps: agent loop, router, marketplace, security.**
Your machine, your models, your keys.

> STATUS (2026-08-18): this package is now the shared ENGINE behind the native
> OS Code apps (Linux desktop and iOS, in `../app`). The terminal CLI/TUI
> (`osc`) below still works but is PARKED: no new features land on it. The
> founder's call; the native apps are the product.

OS Code (`osc`) gives local models the complete, polished experience developers
know from the best cloud coding agents: a streaming transcript, slash commands,
tool approvals with real diffs, web search with citations, repo-aware editing,
and a status line that always tells the truth. The local fleet is the default
engine. Cloud Claude is one deliberate, always-confirmed keystroke away, on
your own key.

## Zero to working in a few minutes

1. Install dependencies and build:

   ```
   cd os-code && pnpm install && pnpm build
   ```

2. Put `osc` on your PATH (or use `node dist/bin/osc.js` directly):

   ```
   pnpm link --global
   ```

3. Set up your stack. This detects your GPU and VRAM, guides an Ollama install
   if you need one, offers preset stacks in plain language, and pulls a starter
   model:

   ```
   osc init
   ```

4. Open any repository and start:

   ```
   cd ~/your-project && osc
   ```

That is the whole onboarding. A first-time user gets a working single-model
agent from `osc init` alone; specialists, routing, and cloud stay opt-in.

## What it does

- **The agent loop.** A ReAct-style tool loop with streaming: read, grep, glob,
  edit, run commands, commit, search the web. Tools validate their arguments
  with zod at the boundary.
- **Edits that hold up.** Structured search/replace blocks, exact-first
  matching with a context-anchored fuzzy fallback, ambiguity always rejected,
  post-apply verification, and a diff before anything lands.
- **The tool-call bridge.** Native tool calling where the model supports it, a
  JSON-in-text protocol where it does not, bounded repair of almost-JSON, and
  grammar-constrained retries on backends that can do that (Ollama structured
  outputs, llama.cpp, vLLM, LM Studio are detected per backend).
- **A stack, not just a model.** One mandatory reasoning orchestrator (local or
  cloud) that does everything itself, plus optional specialists it delegates
  to: coding, vision, image generation, embeddings, fast edits. A missing
  specialist degrades quietly to the orchestrator, never to a failure.
- **Web access.** `webSearch` (DuckDuckGo by default with zero config, Brave,
  Tavily, or self-hosted SearXNG for a fully private path) and `webFetch`
  (readable markdown via Readability, capped for small context windows), with
  citations rendered in the transcript. Every request passes the egress policy.
- **Repo context.** A code map (tree plus symbol outline), an incremental
  embedding index under `~/.os-code/index/`, keyword fallback when no embedder
  is enabled, and automatic context compaction for small windows.
- **Phone-first remote.** `osc pair` walks Tailscale plus Termius; `osc serve`
  runs the daemon that owns the generation; `osc attach` reattaches to a live
  run after a dropped connection with nothing lost. `osc doctor` names the
  exact broken link (desktop asleep, Ollama down, tailnet down, SSH
  unreachable, model not pulled) and the one command that fixes it.
- **Marketplace catalog.** `osc market` browses a curated catalog described in
  plain language, rated against your hardware, license shown before any pull.
  Weights come straight from Ollama or Hugging Face; OpenShore never hosts or
  proxies them.

## Security posture

- The daemon binds loopback or your Tailscale interface, never `0.0.0.0`, and
  authenticates every request with its own bearer token. Reachability is not
  authorization.
- `runShell` is default-deny with per-command approval. File tools live in a
  working-directory jail that stops traversal and symlink escapes.
- Secrets are redacted from transcripts, logs, and shell output before a model
  ever sees them. Credentials live in the OS keychain (via `secret-tool`) or an
  encrypted local file, mode 600.
- Phone and headless sessions are stricter than sitting at the desk: shell and
  cloud spend can never be auto-approved remotely.
- Guardrails stop runaways: step caps, identical-call loop detection,
  wall-clock, token, and dollar budgets. When a rail trips, the loop halts and
  hands control back with a plain sentence.
- Cloud spend always asks first, with an estimate, and the status line shows
  the session total. Local work is free and stays free.
- No telemetry, no analytics, no phone-home. Privacy is a feature.

## Commands

| Command            | What it does                                                 |
| ------------------ | ------------------------------------------------------------ |
| `osc`              | Open a session here (TUI; `--plain` for any terminal)        |
| `osc init`         | Detect hardware, pick a preset stack, pull a starter model   |
| `osc doctor`       | Check every link in the chain, with one-line fixes           |
| `osc login`        | Connect Claude with your own API key (stays on this machine) |
| `osc auth github`  | Connect GitHub (device flow or a token)                      |
| `osc pair`         | Put OS Code on your phone (Tailscale + Termius)              |
| `osc serve`        | Run the daemon so sessions survive dropped connections       |
| `osc attach`       | Reattach to the latest (or a named) session                  |
| `osc stack`        | View and edit the orchestrator and specialists               |
| `osc market`       | Browse and install models from the curated catalog           |
| `osc eval`         | Probe whether a model holds up as an orchestrator            |
| `osc license`      | Activate, show, or remove a license                          |
| `osc attach-image` | Drop a screenshot into the vision inbox                      |

## Configuration

Global config lives at `~/.os-code/config.json`, per-project overrides in
`os-code.config.json`. An empty config is valid and working; see
`os-code.config.example.json` for every knob: providers and endpoints, the
stack, routing and escalation rules, the resource budget, search backend,
egress policy, permissions, guardrail limits, daemon bind, catalog URL, and
license settings.

## Development

```
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

The suite covers the agent loop, the tool-call bridge, the edit engine, the
router, the web tools, security (jail, redaction, egress, daemon auth,
profiles), plus two policy guards: no em dashes in user-facing strings, and no
drift in the connector/secret manifest (`src/server/connectorMap.ts`).

`DECISIONS.md` records the calls made during the build; `PROGRESS.md` tracks
current state and what remains.
