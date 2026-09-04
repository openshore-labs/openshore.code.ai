# Harbor and Harbor Mini: the built-in guides

OpenShore ships two on-device guides. Both are grounded in this repository, so
they are experts on the app: they explain any front-end feature or setup step in
as much depth as the person wants, and they never reveal backend build
internals, infrastructure, or how OpenShore is implemented under the hood.

- **Harbor Mini** (SmolLM2-135M-Instruct, Apache-2.0). The small, fast guide.
  It knows its own limits and, when a question needs real reasoning or real
  coding, says so plainly and walks the person through getting a bigger model
  set up. It is BUNDLED with the app (see below), so it is present the moment
  the app is installed, with nothing to download, and works offline.
- **Harbor** (Qwen3-1.7B, Apache-2.0). The step up: a reasonably capable first
  coding agent and the app's own expert, with real reasoning and web search. It
  is a real download (about 1.1 GB) from Hugging Face, installed and uninstalled
  from Settings.

In the code each is a reserved on-device model id (`harbor-mini` and `harbor`,
see `app/src/lib/harborMini.ts` and `app/src/lib/harbor.ts`), so both flow
through the normal on-device driver and the llama plugin.

## Settings: the Harbor section

The Settings > Harbor group carries one row per guide, below the web-search row.
Each row is a name, a one-sentence byline, and a single control on the right
whose label follows the model's state:

- **Harbor Mini**: shows **Built in**. It ships inside the app and cannot be
  removed, so there is no install/uninstall toggle, just an honest status.
- **Harbor**: **Install** when absent, its live percent (tap to cancel) while it
  downloads, **Retry** after a failure, **Uninstall** once it is on the device.
  Uninstall deletes the weights and re-heals any stack whose Reasoning anchor
  was Harbor to Harbor Mini (which is always present). Re-installable any time.

The store actions are `ensureHarbor` / `removeHarbor` (`app/src/state/store.ts`);
`test/harborGuides.test.ts` pins the rows and the disclosure boundary.

## How Harbor Mini is bundled (native with the app)

Harbor Mini's weights ship inside the app bundle rather than downloading on
first launch. The native `ModelStore` (`ModelStore.swift`) treats any id in
`bundledModelIds` as always present:

- `bundledURL(for:)` resolves it from `Bundle.main` (a `Models/` resource
  folder, or a plain resource).
- `resolvedURL`, `list`, and `ensureLocal` fall back to the bundle, so the model
  loads with nothing downloaded.
- `download` short-circuits (never re-fetches a bundled model) and `delete`
  leaves the bundle intact (so "Built in" is honest and it cannot be removed).

`HARBOR_MINI_BUNDLED` in `app/src/lib/harborMini.ts` is the JS-side flag the
Settings row reads. Keep it in step with `ModelStore.bundledModelIds`.

### The build step

The weights file is NOT committed to the repo. At build time, drop the
SmolLM2-135M-Instruct Q4_K_M GGUF into the iOS app as a bundle resource named
`harbor-mini.gguf` (either directly in the app target's resources, or under a
`Models/` folder reference). `cap sync ios` does not do this for you; add the
file to the Xcode app target (or the packaging script) so it lands in
`Bundle.main`. Verify the URL (see below) is the source of that file, and that
the chat template is embedded in the GGUF.

### The 170 MB budget, and why SmolLM2-135M

The whole App Store download must stay under **170 MB**, and the bundled guide's
weights count against it. That rules out the previous Qwen2.5-0.5B (its Q4_K_M
GGUF is 380 MB, because a 151k-token vocabulary inflates even a 0.5B model), and
also SmolLM2-360M (271 MB at Q4_K_M). SmolLM2-135M-Instruct (Apache-2.0) is the
capable model that fits: its Q4_K_M GGUF is about **105 MB**.

Being 135M, it is a grounded guide, not a reasoner. Its whole job here is to
read the injected app facts (`APP_KNOWLEDGE`) and walk the person through the
front end, so this is retrieval and paraphrase over supplied facts, not
open-ended reasoning, which is where a model this small holds up. For anything
beyond guiding, it hands off to Harbor.

### What it does to the App Store download size

Bundling trades a first-launch download for a larger install:

- The GGUF is about **105 MB** (`HARBOR_MINI_APPROX_LABEL`). Quantized weights
  are already compressed, so App Store thinning shaves little off it.
- The rest of the app (the llama.cpp + Metal binary and the web bundle) is on
  the order of tens of MB. CONFIRM the real base size in a TestFlight build: the
  105 MB model leaves roughly 65 MB of headroom under the 170 MB cap, and if a
  build runs tight there is room to drop to Q4_0 (about 92 MB) or an IQ quant.
- So the App Store download should land around **150 to 165 MB**, under the cap,
  versus a small base app plus a separate ~105 MB download if Mini were not
  bundled. Harbor (1.1 GB) is never bundled; it stays a download.

This is comfortably under Apple's over-cellular download limit, so users can
still install over a mobile network.

## Before a build: verify the URLs

`HARBOR_MODEL_URL` and `HARBOR_MINI_MODEL_URL` point at GGUFs on Hugging Face.
Confirm each resolves (`curl -I` returns 200) and that the chat template is
embedded in the file (the runner reads it from the file). This sandbox cannot
reach the network, so that check is a manual pre-build step. If a filename or
casing has changed upstream, update the constant. The Harbor Mini URL is also
the source of the bundled weights file.

## Desktop

On the Linux desktop the on-device path runs through Ollama, not llama.cpp, so
the guides are not offered in the desktop onboarding or the desktop Settings
rows yet (the Harbor rows are gated to non-desktop). Desktop RAM and disk are
not the constraint the phone is.

## Grounding

Guide accuracy comes from the setup/FAQ facts injected into their system prompts
(`APP_KNOWLEDGE` in `app/src/lib/guideKnowledge.ts`, spliced into both personas).
When the setup flow changes, update those facts in the same change so neither
guide narrates a step that no longer exists. The facts also carry the front-end
open, backend private boundary. Full retrieval over docs is a later upgrade.

## License

Both models are Apache-2.0. Harbor downloads from the source (we do not
redistribute its weights), the same posture as any pocket model. Harbor Mini's
weights are redistributed inside the app bundle; Apache-2.0 permits that,
provided the license and attribution ship with it. The in-app attribution and
the on-device-content disclaimer live in Settings; keep them in step with
whatever the model constants actually point at. See `app/MODEL-LICENSES.md`.
