# OS Code (Open Shore Code)

A local-first coding agent, familiar to Claude Code users, that runs a
personally curated stack of local LLMs and connects a cloud Claude account as a
deliberate fallback. Runs on Linux desktop and is driven from a phone over SSH
(Termius) across a private Tailscale network.

## Status

Pre-scaffold. This repository currently holds the build brief only. The
application shell is generated from it.

- **Build brief:** [`docs/os-code-fable-prompt.md`](docs/os-code-fable-prompt.md)

The brief is written to be handed to a code-generation agent (Fable) to scaffold
the `os-code/` shell in one non-stop pass. It is the single source of truth for
the architecture, the pinned stack, the scope fence, and the definition of done.

## Product shape (summary)

- **Local-first, self-hosted.** Compute runs on the user's machine. Cloud models
  run on the user's own key or account. OpenShore never hosts weights or proxies
  inference.
- **A curated stack of local models** (planner, coder, fast-edit, apply, vision,
  embedder) routed by task, with cloud Claude as a deliberate, confirmed
  escalation.
- **Marketplace is a catalog, not a weight host:** a static manifest pointing at
  Hugging Face and Ollama, with license flags.
- **Phone on the go:** Tailscale plus an SSH client, orchestrated with a pairing
  wizard, not embedded.
- **The paid gate** sits on the curated catalog, the cloud-connector configs,
  and updates, server-side.

See the build brief for the full architecture and the load-bearing build
sequence (prove the core behind an eval harness before building the breadth).
