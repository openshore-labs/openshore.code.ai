# OpenShore

**Your own cloud for AI coding.** OpenShore is an open source coding agent
that runs on a computer you own, or a server you rent, with a model you
choose. Use it from the desktop app, from the terminal (`osc`), or from your
iPhone, which docks to that computer over Tailscale. Your code stays on
machines you control unless you pick a cloud model, on your own key.

[![CI](https://github.com/openshore-labs/openshore.code.ai/actions/workflows/ci.yml/badge.svg)](https://github.com/openshore-labs/openshore.code.ai/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@openshore/os-code)](https://www.npmjs.com/package/@openshore/os-code)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

**Status: early release.** The engine, the desktop app, the CLI and the
iPhone app work today. How well a local model does real coding work is still
being measured: `osc eval` is the instrument, and we publish only the numbers
we have measured.

## Get it

- **Desktop app** (macOS, Windows, Linux): installers on the
  [releases page](https://github.com/openshore-labs/openshore-releases/releases/latest).
  Updates are checked against pinned signing keys before they install. The
  Mac build is not notarized yet, so open it the first time with right-click,
  Open.
- **Terminal**: `npm install -g @openshore/os-code` (below).
- **iPhone**: see [openshore.ai](https://openshore.ai) for the current way in.
- **From source**: every piece builds from this repository (below).

## What it does

- **Any model.** A local server such as Ollama, llama.cpp, vLLM or LM Studio;
  any server that speaks the OpenAI-compatible or the Anthropic API; or one of
  eighteen cloud providers on your own key. OpenShore runs no gateway and
  resells no model.
- **A harness that helps small models.** It finds the right files first, runs
  your project's own tests, and sizes every prompt to the window the model is
  actually served, so a modest model has less to get right on its own.
- **Your phone, docked to your computer.** The work runs on your machine; the
  phone sends instructions, shows the work and approves the next step. It
  works while your computer is on and reachable.
- **A model Local Library.** A catalog that points at Hugging Face and Ollama,
  marks each model as fits, tight or too big for your hardware, and never
  hosts the weights itself.
- **Privacy you can check.** Everything the app sends off a device is listed
  in `app/src/lib/egressManifest.ts`, and a test fails on any new host that
  is not on the list.

## Quick start: the terminal

With Node 22.12 or newer and a local model server such as Ollama:

```
npm install -g @openshore/os-code
osc init
cd ~/your-project && osc
```

`osc doctor` checks your setup. More in [`os-code/README.md`](os-code/README.md).

## Quick start: from source

Everything needs Node 22.12 or newer (`.nvmrc` pins the exact version CI
uses) and pnpm (`corepack enable`).

```
pnpm install
pnpm desktop                 # the desktop app, with the engine in-process
pnpm --filter os-code build  # the engine and the osc CLI
```

Checks across the workspace, the same ones CI runs:

```
pnpm -r build && pnpm -r typecheck && pnpm -r lint && pnpm -r test
```

The iPhone app is a Capacitor project in `app/ios/`; `pnpm --filter
oscode-app ios:sync` builds the web side into it.

## Where to start reading

| If you want to | Read |
| --- | --- |
| Understand how the pieces fit | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Make a change and get it merged | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Find a doc on a feature | [`docs/README.md`](docs/README.md) |
| Use or extend the CLI | [`os-code/README.md`](os-code/README.md) |
| Report a security problem | [`SECURITY.md`](SECURITY.md) |

## The pieces

| Path | What it is |
| --- | --- |
| `os-code/` | The engine and the `osc` CLI: agent loop, tools, harness, daemon, evals. |
| `app/` | The one React codebase both app shells ship. |
| `app/electron/` | The desktop shell; the engine runs in-process. |
| `app/ios/` | The Capacitor iOS project. |
| `app/plugins/oscode-llama/` | Swift plugin: on-device GGUF inference via llama.cpp. |
| `supabase/` | The optional account backend: migrations and edge functions. |
| `docs/` | Feature docs and design history. |

## Security posture

The daemon binds Tailscale or loopback, never `0.0.0.0`, behind a bearer
token. Shell access is default-deny with approvals. API keys live in the
OS credential store (or an encrypted file) and go only to the provider they
belong to. No product analytics, no tracking, no IP address, ever. The one
thing sent to an account is an enforcement record when the guardrail blocks a
request (a category, a hash, no prompt); see Ethical boundaries below for
exactly what and when. The phone profile is stricter than the desktop.

## Ethical boundaries

OpenShore ships an always-on guardrail layer. It wraps every model call, local
and cloud alike, on both sides: the prompt is screened before a model sees it,
and the answer is screened before a person sees it. There is no setting,
configuration key, or environment variable that turns it off, and
`os-code/test/ethicsNoBypass.test.ts` fails the build if one appears.

**What it blocks outright.** Child sexual abuse material. Non-consensual
intimate imagery of real, identifiable people, including the "nudify" family.
Concrete assistance with biological, chemical, nuclear, or high-yield explosive
weapons. No consent option applies to any of these.

**What it gates behind consent.** Recreating the face or voice of a real,
identifiable person, which is allowed only when the person asserts authorization
for that specific subject. The assertion is recorded, and the output carries
provenance metadata.

**What it leaves alone.** Legal adult content, dark and violent fiction, horror,
edgy humor, satire and political parody, security research and red teaming, and
controversial opinion. Over-blocking this work is treated as a defect of the
same severity as under-blocking a real harm, and the Tier 3 controls in
`os-code/test/ethics.test.ts` are what hold that line.

**Fail closed.** If any check errors or times out, the request is blocked rather
than passed through. A degraded guardrail is never an absent one. A check
failure is recorded as our fault, not the person's, and never counts toward
enforcement.

Code: `os-code/src/core/ethics/` (read `index.ts` first, it names the reading
order). App side: `app/src/drivers/guardedDriver.ts` and `app/src/lib/ethics.ts`.
Design notes and the retention posture: `docs/ethics-layer.md`. Terms:
`docs/terms-of-use.md`.

### Framework alignment

OpenShore aligns its practices with the **NIST AI Risk Management Framework**
(Govern, Map, Measure, Manage), **ISO/IEC 42001** (AI management systems), and
**C2PA** content provenance. `docs/ethics-layer.md` maps each control in the
layer to the specific function it serves.

This is a **self-attestation**. No third party has certified, endorsed, or
audited this product against those frameworks, and nothing in this repo says
otherwise. Provenance records the layer writes use the C2PA assertion
vocabulary but are **unsigned**, because a signed manifest needs a certificate
from a C2PA-recognized authority that OpenShore does not hold. The manifest says
so in its own text.

### Honest limits

The truthful claim is narrow, and it is the one made everywhere in this
codebase: the layer is enforced by default, is not user-disableable in the app,
and the app does not help you remove it. Misuse is **not** made impossible.
Once open model weights are on your own machine, they are beyond the reach of
any application, including this one.

### Privacy posture

Screening runs locally. The classifier is deterministic and offline, so a prompt
to a local model is never sent anywhere to be checked, and "local stays local"
stays true of the guardrail itself.

A block records a category, a tier, a timestamp, a SHA-256 of the request, and
the model path. It never records the prompt or the completion, and it never
records an IP address, full stop. On the desktop that record stays in
`~/.os-code/ethics/`. In the app it also reaches the account when the person is
signed in, so enforcement survives a reinstall; signed out, nothing is sent.

## Brand note

The app wears the openshore.ai brand: cream paper, deep ink, deep-water
teal, Fraunces and Inter, and the wave-mark tile, matching the marketing
site 1:1. Local work carries the water teal; cloud and spend carry amber.
Tokens live in `app/src/theme.css`; the CLI mirror is
`os-code/src/brand/theme.ts`. Harbor, the built-in guide model, is
documented in `docs/HARBOR.md`.

## License

OpenShore is open source under the Apache License 2.0 (`LICENSE`, `NOTICE`).
The OpenShore name and logo are trademarks of Open Shore LLC
(`TRADEMARKS.md`). Contributions are welcome under the contributor license
agreement (`CONTRIBUTING.md`, `CLA.md`); security reports go to
`SECURITY.md`.
