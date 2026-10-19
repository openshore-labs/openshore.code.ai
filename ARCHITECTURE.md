# Architecture

OpenShore is one engine and three ways in. The engine (`os-code/`) runs the
coding agent on a computer you own or a server you rent. The desktop app and
the `osc` CLI run that engine directly; the iPhone app docks to it over a
private network. One React codebase (`app/`) is both app shells.

```
  Desktop app (Electron)        Terminal (osc)          iPhone (Capacitor)
  engine runs in-process        engine runs in-process  docks over Tailscale
          \                            |                        /
           \                           |              daemon (osc serve)
            +------------------- the engine (os-code) ---------+
                                       |
                 agent loop, tools, harness, router, providers
                                       |
                 a model: a local server, a server you rent,
                 or a cloud provider on your own key
```

## The engine: `os-code/`

| Path | What it does |
| --- | --- |
| `src/core/agent/` | The agent loop (`loop.ts`), the system prompt and its standards, checkpoints and verify-in-the-loop. |
| `src/core/tools/` | The tools a model can call: files, search, shell, the vault, the web. |
| `src/core/exec/`, `src/core/permissions/`, `src/core/security/` | Running commands: default-deny with approvals, a clean child environment, lockdown enforced at one seam (`executeCall`). |
| `src/core/ethics/` | The always-on guardrail layer. Read its `index.ts` first. |
| `src/harness/` | The pure harness core: model-class profiles, tolerant parsing, retrieval, verify, handoff, the vault pack. No Node built-ins, so the phone can run it; exported through `os-code/protocol`. |
| `src/providers/` | Model clients: OpenAI-compatible, Anthropic, and the served-window budget (`servedWindow.ts`). |
| `src/router/` | Which model takes which turn, within the machine's resource budget. |
| `src/daemon/` | `osc serve`: the HTTP daemon a docked phone talks to. It binds a tailnet or loopback address only, behind per-device credentials. |
| `src/commands/` | The `osc` commands: `init`, `serve`, `pair`, `attach`, `market`, `doctor`, `stack`, `key`, `eval`, `login`, `trust`, `token` and the rest. |
| `src/eval/` | `osc eval`: the task suites and the scoring behind every number we publish. |
| `src/routines/` | Scheduled routines that run headless on your own computer. |
| `src/config/` | Config loading and project trust (`projectPolicy.ts` classifies every key). |
| `scripts/build-catalog/` | The daily Local Library catalog build and its gates. |

## The apps: `app/`

| Path | What it does |
| --- | --- |
| `src/screens/` | One file per room: Chats, Projects, Stack, Vault, Agents (`CrewScreen`), Local Library, Settings and the rest. |
| `src/drivers/` | How a chat reaches a model: `electronDriver.ts` (the in-process engine), `remoteDriver.ts` (a docked computer), `onDeviceDriver.ts` (llama.cpp on the phone), `providerClient.ts` (cloud providers, streamed, with abort). |
| `src/state/store.ts` | The app store. New logic goes in a sibling module (`*Ops.ts`) and `store.ts` only wires it in. |
| `src/lib/` | Pure helpers. Three are rules, not utilities: `focus.ts` (release tiers: which rooms ship), `egressManifest.ts` (everything that leaves a device), `accountGate.ts` (what needs a sign-in). |
| `electron/` | The desktop shell: hosts the engine, verifies every update against pinned keys (`releaseVerify.ts`). |
| `ios/`, `plugins/oscode-llama/` | The iOS project and the Swift plugin for on-device inference. |

## The account backend: `supabase/`

Optional. Chatting needs no account; a free sign-in carries a few
preferences between devices. Migrations are numbered by production's history
(`production-history.tsv`) and never edited once applied. See
`supabase/README.md`.

## How changes are kept honest: the tests

Tests run with Vitest: `pnpm --filter os-code test` and
`pnpm --filter oscode-app test`. Beside the unit tests, a set of guard tests
turns project rules into failures, so a rule cannot drift:

| Guard | What it fails on |
| --- | --- |
| `app/test/egressManifest.test.ts` | A network host in the source that is not on the egress list. |
| `os-code/test/projectTrust.test.ts` | A config key with no trust classification. |
| `*/test/em-dash-policy.test.ts` | An em dash anywhere in tracked source. |
| `app/test/uiGuards*.test.ts`, `polish-standards.test.ts`, `motion-tokens.test.ts` | UI drift: raw motion values, typed glyphs, layout transitions. |
| `app/test/tierPersonal.test.ts` | A later-tier room that leaks into the shipping build. |
| `os-code/test/ethicsNoBypass.test.ts` | Any switch that turns the guardrail layer off. |

If a guard fails on your change, it is usually pointing at a real rule; the
failure message names it. `CONTRIBUTING.md` says how to ask when it is not.

## Where decisions live

`os-code/DECISIONS.md` is the decision log: one entry per judgment call, with
who made it and why. `os-code/PROGRESS.md` is the running build log. Neither
is required reading; search them when a design choice looks already settled.
Design history for larger features is in `docs/design/`.
