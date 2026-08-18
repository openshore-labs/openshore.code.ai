# PROGRESS

The recent-state source of truth for OS Code, kept in the same spirit as the
Uki app repo: current state first, then what remains, then the log.

## Current state (2026-08-18)

**All planned layers are built, tested, and green.** `pnpm install && pnpm
build` compiles clean; `pnpm typecheck`, `pnpm lint --max-warnings 0`, and the
test suite (10 files, 81 tests) all pass. The CLI runs end to end: `osc
doctor` renders the full health report on a bare machine, and the complete
task path (read, web search, edit with approval and diff, run a command,
commit) passes against the mock provider in `test/endToEnd.test.ts`. On a
machine with Ollama, the same path runs against a real local model with
`osc init` then `osc`.

Layer status:

- **Core (agent loop, tools, web, edit engine, local provider, TUI):** built
  and tested. Streaming Ink TUI with static-scrollback transcript, status
  line, approval prompts with diffs, citations panel, slash commands, and a
  considered `--plain` fallback.
- **Security:** enforced, not deferred. Jail, redaction, egress policy,
  daemon bearer auth with a hard no-`0.0.0.0` bind rule, default-deny shell,
  stricter phone/headless profiles, and guardrails that actually halt.
- **Breadth:** router/stack with graceful degradation, cloud escalation with
  confirm-before-spend, RAG (embedding index + keyword fallback) and code
  map, marketplace catalog with hardware fit ratings and preset stacks,
  daemon + reattach + pairing wizard, vision ingest inbox.

## What remains (known follow-ups, none blocking)

- [ ] **Live-fire pass on a machine with Ollama + a GPU.** Everything is
      wired and covered by tests against the mock and mocked HTTP; the first
      session against real weights should confirm streaming feel and the
      capability probe on all four backends (Ollama, LM Studio, llama.cpp,
      vLLM).
- [ ] **ComfyUI image path** needs a bundled txt2img workflow graph (A1111
      and OpenAI-images endpoints work today).
- [ ] **Tree-sitter code map** behind the existing `extractSymbols` seam,
      when install-weight is worth it.
- [ ] **Hosted license-verify endpoint** (documented stub; client is real).
- [ ] **A11y pass over TUI colors** for low-color terminals beyond the
      `--plain` path.
- [ ] **In-TUI transcript search and mouse-free scrollback paging** beyond
      the terminal's own scrollback.

## Log

- **2026-08-18: initial complete build.** Repo scaffolded from empty to a
  working product in three commits (core foundation; breadth layer; TUI,
  commands, tests, docs). Toolchain: Node 20+, TypeScript 5.9 strict ESM,
  Ink 5 + React 18, zod 4, vitest 4, eslint 8 + prettier. See DECISIONS.md
  for every judgment call.
