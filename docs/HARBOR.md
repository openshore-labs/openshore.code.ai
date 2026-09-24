# Harbor, Harbor Lite, and DeepBlue: the out-of-the-box models

OpenShore ships three curated models out of the box, never behind the
Marketplace: Harbor Lite, the tiny built-in guide for the phone; Harbor, a
coder that runs on the phone; and DeepBlue, the coder that runs on the
computer. All three are grounded in this repository, so they answer app
questions from the front end without ever revealing backend build internals,
infrastructure, or how OpenShore is implemented under the hood. DeepBlue is
the most capable, and the one a home-lab hub runs.

- **Harbor Lite** (SmolLM2-135M-Instruct, Apache-2.0). The small, fast guide.
  It knows its own limits and, when a question needs real reasoning or real
  coding, says so plainly and walks the person through getting a bigger model
  set up. It is BUNDLED with the app (see below), so it is present the moment
  the app is installed, with nothing to download, and works offline.
- **Harbor** (Qwen 2.5 Coder 3B, Apache-2.0). The mobile coder: a coding agent
  that runs fully on the phone, writing and explaining real code, with real
  reasoning and web search. It can also answer app questions, but it leads as a
  coder (Harbor Lite is the guide). A real download (about 1.9 GB) from Hugging
  Face, installed and uninstalled from Settings.
- **DeepBlue** (Qwen 2.5 Coder, sized to the computer: 32B, 14B, 7B, or 3B,
  Apache-2.0). The third and most capable: a real coding agent that plans and
  edits repositories on the desktop engine. It is pulled through Ollama on the
  person's own computer, straight from the Ollama library, and seated as the
  Reasoning LLM in one tap from the First Seat card or the Settings row.
  Docked, the phone reaches it as "My computer". Founder brief 2026-09-21.

In the code each is a reserved model id (`harbor-mini`, `harbor`, and
`harbor-master`, see `app/src/lib/harborMini.ts`, `app/src/lib/harbor.ts`, and
`app/src/lib/harborMaster.ts`). Harbor Lite and Harbor flow through the normal
on-device driver and the llama plugin; DeepBlue lives in the desktop
engine's config (its Ollama ref is the orchestrator), so the app never keeps a
copy of its presence: the Settings row reads the engine's Ollama list.

Every id is a stable slot decoupled from the weights it points at. DeepBlue's sizes are stock Qwen 2.5 Coder today, the catalog's own picks; when
OpenShore's tuned weights ship (`docs/house-model-proposal.md`), the refs, the
size labels, and the attribution change, never the id.

## Settings: the Harbor section

The Settings > Harbor group carries one row per guide, below the web-search row.
Each row is a name, a one-sentence byline, and a single control on the right
whose label follows the model's state:

- **Harbor Lite**: shows **Built in**. It ships inside the app and cannot be
  removed, so there is no install/uninstall toggle, just an honest status.
- **Harbor**: **Install** when absent, its live percent (tap to cancel) while it
  downloads, **Retry** after a failure, **Uninstall** once it is on the device.
  Uninstall deletes the weights and re-heals any stack whose Reasoning anchor
  was Harbor to Harbor Lite (which is always present). Re-installable any time.

- **DeepBlue** (desktop only): **Install** when absent, its live percent as
  a plain status while it pulls (Ollama owns the pull, so there is no cancel),
  **Retry** after a failure, **Installed** once the engine's Ollama list holds a
  size. No uninstall here: `ollama rm` is the honest remove, since the weights
  belong to Ollama, not the app.

The store actions are `ensureHarbor` / `removeHarbor` and `ensureHarborMaster`
(`app/src/state/store.ts`); `test/harborGuides.test.ts` pins the guide rows and
the disclosure boundary, `test/harborMaster.test.ts` pins the third.

## How Harbor Lite is bundled (native with the app)

Harbor Lite's weights ship inside the app bundle rather than downloading on
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

The weights file is NOT committed to the repo. The Codemagic iOS workflow does
this for you (2026-09-24, step "Bundle Harbor Lite's weights"): after `cap sync`
it downloads `HARBOR_MINI_MODEL_URL` into `ios/App/App/public/models/`, and
`ModelStore.bundledURL` finds it at `public/models/harbor-mini.gguf`, since the
Capacitor `public` folder is already a folder reference in the app target.
Before that step existed, TestFlight builds shipped without the file and
downloaded it on first open. For a local Xcode build, drop the
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
casing has changed upstream, update the constant. The Harbor Lite URL is also
the source of the bundled weights file.

## Desktop: DeepBlue

On the desktop the on-device path runs through Ollama, not llama.cpp, so the
two guides are not offered there (their rows stay gated to the phone). The
desktop's out-of-the-box model is DeepBlue:

- **Sized to the computer.** `resolveHarborMaster(hw)` picks the largest size
  that is not too big by the engine's own budget (`fitVerdict`): the 3B on the
  CPU-only reference box (measured 75% on the coding loop, best of 2), the 7B
  on a 16 GB laptop or an 8 GB GPU, the 14B on a hub with room, and the 32B on
  a big hub (a 48 GB GPU class). Before the machine is read it offers the 7B,
  never the biggest on a guess. The First
  Seat card and the Settings row name what is really behind the slot ("On Qwen
  2.5 Coder 7B. 4.7 GB download.") and the engine's class line.
- **One tap.** `ensureHarborMaster` pulls the size by catalog id through the
  engine (progress on the install channel) and seats its Ollama ref as the
  orchestrator, then refreshes the gate so a chat opens at once. The First
  Seat card, the Stack screen's starter button, and the Settings row all ride
  this one action, so they show the same state.
- **Docked.** Pair the phone under Desktop + phone and DeepBlue is "My
  computer" in the model menu, for chat and for coding on repositories.
- **Claim ladder.** The copy says "the most capable Harbor" and "a real coding
  agent"; never "as smart as Claude", "a compact Opus", "trains itself", or
  "always on". "Tuned for OpenShore" is written only when an adapter ships.

DeepBlue is the same list the Starter bundle and the Stack screen already
used (`starterModel.ts` now derives from `harborMaster.ts`), given its name and
its front-door place.

## Grounding

Guide accuracy comes from the setup/FAQ facts injected into their system prompts
(`APP_KNOWLEDGE` in `app/src/lib/guideKnowledge.ts`, spliced into both personas).
When the setup flow changes, update those facts in the same change so neither
guide narrates a step that no longer exists. The facts also carry the front-end
open, backend private boundary. Full retrieval over docs is a later upgrade.

## License

All three are Apache-2.0 as the catalog records them. Harbor downloads from the
source (we do not redistribute its weights), the same posture as any pocket
model; DeepBlue is pulled from the Ollama library by the person's own
engine, the same posture as any desktop model. Harbor Lite's
weights are redistributed inside the app bundle; Apache-2.0 permits that,
provided the license and attribution ship with it. The in-app attribution and
the on-device-content disclaimer live in Settings; keep them in step with
whatever the model constants actually point at. See `app/MODEL-LICENSES.md`.
