# Docs

Start with the top-level [`README.md`](../README.md) and
[`ARCHITECTURE.md`](../ARCHITECTURE.md). The docs below go deeper on one
feature each. Nothing here is required reading before a first change.

## Start here: how OpenShore works

| Doc | What it covers |
| --- | --- |
| [`workflow.md`](workflow.md) | How a prompt becomes a run: the harness, the plan, and the handoffs between models. |
| [`interaction-model.md`](interaction-model.md) | How the app works with a person, and the UX bar for its own screens. |
| [`HARBOR.md`](HARBOR.md) | The three built-in models: Harbor Lite, Harbor and DeepBlue. |
| [`release-tiers.md`](release-tiers.md) | Which rooms ship in this build, and how later tiers stay shut. |
| [`ethics-layer.md`](ethics-layer.md) | The always-on guardrail layer: what it blocks, what it records, and what it leaves alone. |
| [`agentic-currents.md`](agentic-currents.md) | Currents: opt-in agent modalities, chosen per project. |
| [`video-attachments.md`](video-attachments.md) | How a video becomes frames a vision model can read. |
| [`terms-of-use.md`](terms-of-use.md) | The terms for the apps and accounts. |

## The engine and the CLI

| Doc | What it covers |
| --- | --- |
| [`os-code/README.md`](../os-code/README.md) | The `osc` CLI: install, commands, config. |
| [`os-code/docs/MARKETPLACE.md`](../os-code/docs/MARKETPLACE.md) | The model catalog: sources, gates, hardware fit. |
| [`os-code/docs/STACK-HEALTH.md`](../os-code/docs/STACK-HEALTH.md) | Stack Health (a later tier). |
| [`os-code/docs/voice-mode.md`](../os-code/docs/voice-mode.md) | Voice mode. |
| [`os-code/docs/guide-eval-2026-09-24.md`](../os-code/docs/guide-eval-2026-09-24.md) | Eval results for Harbor Lite's guide harness. |
| [`supabase/README.md`](../supabase/README.md) | The optional account backend and its migration rules. |

## Design history

How larger features were reviewed and decided. Useful for the reasoning
behind a choice; the code is the source of truth for what ships.

| Doc | What it covers |
| --- | --- |
| [`design/connect-anywhere-proposal.md`](design/connect-anywhere-proposal.md) | Docking a phone to a computer or a rented server. |
| [`design/byok-any-provider-plan.md`](design/byok-any-provider-plan.md) | Bring your own keys, any provider, and keys on your server. |
| [`design/pairing-review.md`](design/pairing-review.md) | The pairing flow, reviewed and rebuilt. |
| [`design/new-chat-buttons-proposal.md`](design/new-chat-buttons-proposal.md) | New chat as an action: the doors that open a chat. |
| [`design/vault-v1-plan.md`](design/vault-v1-plan.md) | Vault v1: the ship plan. |
| [`design/vault-v1-review-findings.md`](design/vault-v1-review-findings.md) | Vault v1: every verified review finding. |
| [`design/vault-v1-test-map.md`](design/vault-v1-test-map.md) | Vault v1: each must-fix finding mapped to its test. |
| [`design/vault-iphone-folder-design.md`](design/vault-iphone-folder-design.md) | Opening an Obsidian vault in place on iPhone. |
| [`design/build-2026-09-29/`](design/build-2026-09-29/) | The September build: notes per work package. |
| [`design/stack-page-redesign.md`](design/stack-page-redesign.md), [`design/crew-page-redesign.md`](design/crew-page-redesign.md), [`design/project-room-redesign.md`](design/project-room-redesign.md), [`design/vault-page-redesign.md`](design/vault-page-redesign.md), [`design/jump-to-latest-redesign.md`](design/jump-to-latest-redesign.md), [`design/slack-water.md`](design/slack-water.md) | Room-by-room UX reviews. |

## Logs

[`os-code/DECISIONS.md`](../os-code/DECISIONS.md) records each judgment call
and who made it. [`os-code/PROGRESS.md`](../os-code/PROGRESS.md) is the
running build log. Search them; do not read them front to back.
