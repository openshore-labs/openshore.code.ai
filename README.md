# OS Code

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

| Path | What it is |
| --- | --- |
| `os-code/` | The engine: agent loop, tools, edit engine, router, daemon, security. Also a parked terminal UI. |
| `app/` | The one React codebase both shells ship. |
| `app/electron/` | Linux desktop shell; the engine runs in-process. |
| `app/ios/` | Capacitor iOS project (SPM mode, iOS 16+). |
| `app/plugins/oscode-llama/` | Swift plugin: on-device GGUF inference via llama.cpp. |
| `codemagic.yaml` | CI to TestFlight. Setup walkthrough in `docs/TESTFLIGHT.md`. |

## Running it

Everything needs Node 20+ and pnpm (`corepack enable`).

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

Colors and type follow the OpenShore direction (deep ocean navy, signal
teal, amber for cloud moments) with `OPENSHORE:` markers at every token
site, so the real openshore.ai palette is a two-file swap when it lands.
