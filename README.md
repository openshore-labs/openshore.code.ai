# OS Code (Open Shore Code)

A local-first coding agent that gives local LLMs a complete, genuinely
delightful clone of the Claude Code experience. It runs a personally curated
stack of local models, searches the web, and connects a cloud Claude account as
a deliberate fallback. Runs on Linux desktop and is driven from a phone over SSH
(Termius) across a private Tailscale network.

## Status

Pre-scaffold. This repository currently holds the build brief only. The
application is generated from it.

- **Build brief:** [`docs/os-code-fable-prompt.md`](docs/os-code-fable-prompt.md)

The brief is written to be handed to a code-generation agent (Fable) to build
the `os-code/` application in one non-stop, depth-first pass. It is the single
source of truth for the architecture, the pinned stack, the delight bar, and the
definition of done. It indexes on completeness and delight, not token thrift.

## Product shape (summary)

- **Local-first, self-hosted.** Compute runs on the user's machine. Cloud models
  run on the user's own key or account. OpenShore never hosts weights or proxies
  inference.
- **A curated stack of local models** (planner, coder, fast-edit, apply, vision,
  embedder) routed by task, with cloud Claude as a deliberate, confirmed
  escalation.
- **Web access is a first-class tool.** Local models cannot browse on their own,
  so OS Code ships `webSearch` and `webFetch` with a pluggable backend
  (DuckDuckGo by default, Brave, self-hosted SearXNG, or Tavily), readability
  extraction, and citations in the TUI.
- **Marketplace is a catalog, not a weight host:** a static manifest pointing at
  Hugging Face and Ollama, with license flags.
- **Phone on the go:** Tailscale plus an SSH client, orchestrated with a pairing
  wizard, not embedded.
- **The paid gate** sits on the curated catalog, the cloud-connector configs,
  and updates, server-side.

See the build brief for the full architecture and the load-bearing build
sequence (prove the core end to end before building the breadth).
