# OpenShore

Chat and build with your own stack of local LLMs. A native app for the
Linux desktop and the iPhone, in the familiar shape of a modern coding
agent, running on models you download and keys you hold.

## The idea

- **Local is the default.** Your stack is built from local models. One
  model is the quarterback: it plans, reasons, and decides which model gets
  each play. Specialists plug into industry-standard task categories
  (coding, writing, analysis, vision, retrieval, fast). Anything missing,
  the quarterback covers itself.
- **Cloud is a manual flip.** Connect your own Claude or ChatGPT account if
  you want; the app never routes to the cloud on its own, and spend always
  asks first.
- **The marketplace is a catalog, not a weight host.** Models download
  straight from their public sources (Hugging Face, Ollama), license flags
  shown honestly. OpenShore never rehosts weights or proxies inference.
- **Desktop is home, the phone rides along.** The desktop runs the engine
  and a private daemon; the iPhone pairs to it over Tailscale, and can also
  run pocket-class GGUF models fully on-device (llama.cpp on Metal).

## The pieces

| Path                        | What it is                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `os-code/`                  | The engine: agent loop, tools, edit engine, router, daemon, security. Also a parked terminal UI. |
| `app/`                      | The one React codebase both shells ship.                                                         |
| `app/electron/`             | Linux desktop shell; the engine runs in-process.                                                 |
| `app/ios/`                  | Capacitor iOS project (SPM mode, iOS 16+).                                                       |
| `app/plugins/oscode-llama/` | Swift plugin: on-device GGUF inference via llama.cpp.                                            |
| `codemagic.yaml`            | CI to TestFlight. Setup walkthrough in `docs/TESTFLIGHT.md`.                                     |

## Running it

Everything needs Node 22+ (22.12 or newer; `.nvmrc` pins the exact version
CI and Codemagic use) and pnpm (`corepack enable`).

Desktop (Linux):

```
pnpm install
pnpm desktop
```

Point it at Ollama (or any OpenAI-compatible local server), grab a model in
the marketplace, pick your quarterback, and chat. Package installers with
`pnpm --filter oscode-app package:linux`.

iPhone: builds ship through TestFlight; see `docs/TESTFLIGHT.md`.

Checks across the workspace:

```
pnpm -r build && pnpm -r typecheck && pnpm -r lint && pnpm -r test
```

## Security posture

The daemon binds Tailscale or loopback, never `0.0.0.0`, behind a bearer
token. Shell access is default-deny with approvals. API keys live in the
OS credential store (or an encrypted file) and go only to the provider they
belong to. No telemetry. The phone profile is stricter than the desktop.

## Brand note

The app wears the openshore.ai brand: cream paper, deep ink, deep-water
teal, Fraunces and Inter, and the wave-mark tile, matching the marketing
site 1:1. Local work carries the water teal; cloud and spend carry amber.
Tokens live in `app/src/theme.css`; the CLI mirror is
`os-code/src/brand/theme.ts`. Harbor, the built-in guide model, is
documented in `docs/HARBOR.md`.
