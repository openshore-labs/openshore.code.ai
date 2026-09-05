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
