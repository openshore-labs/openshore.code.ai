# Harbor: the built-in guide model

Harbor is a small model (Qwen2.5-0.5B-Instruct, Apache-2.0) that a brand-new
user is prompted to download on first launch, so they have an instant, private
assistant to walk them through setup before connecting anything else. It is a
concierge, not a coding model: scoped to guidance, grounded on the app's own
setup facts, and it hands off to a real model for actual work.

In the code it is a reserved on-device model with id `harbor` (see
`app/src/lib/harbor.ts`), so it flows through the normal on-device driver and
the llama plugin, and downloads through the same path as any pocket model.

## How it is delivered

- **Not bundled.** Harbor's weights are NOT shipped inside the app. The base
  app download stays small, and "weights come straight from the source, never
  from OpenShore" holds for the guide too.
- **First-launch download.** The onboarding screen leads with a "Get Harbor"
  card. `store.ensureHarbor()` pulls the GGUF from Hugging Face
  (`HARBOR_MODEL_URL` in `app/src/lib/harbor.ts`) into the app's Models
  directory with a live progress bar, records `settings.harborReady`, then
  drops the user into a Harbor chat. It is about 380 MB, roughly a minute on
  wifi, and once here Harbor runs fully offline.
- **Removable and re-addable.** Deleting Harbor removes the file like any
  pocket model; the next launch reconciles `harborReady` against the
  filesystem and the onboarding card re-prompts the download.
- **No Xcode step.** There is nothing to configure in the project for Harbor.

## Before a build: verify the URL

`HARBOR_MODEL_URL` points at the Qwen2.5-0.5B-Instruct Q4_K_M GGUF on Hugging
Face. Confirm it resolves (`curl -I` returns 200) and that the ChatML chat
template is embedded in the file (the official Qwen2.5 GGUFs embed it; the
runner reads it from the file). This sandbox cannot reach the network, so that
check is a manual pre-build step. If the filename or casing has changed
upstream, update the constant.

## Desktop

On the Linux desktop the on-device path runs through Ollama, not llama.cpp, so
Harbor is not offered in the desktop onboarding yet (pulling the same model via
Ollama is a follow-up). Desktop RAM and disk are not the constraint the phone
is.

## Grounding

Harbor's accuracy comes from the setup/FAQ facts injected into its system
prompt (`buildHarborSystemPrompt` in `app/src/lib/harbor.ts`). When the setup
flow changes, update those facts in the same change so Harbor never narrates a
step that no longer exists. Full retrieval over docs is a later upgrade.

## License

Qwen2.5-0.5B-Instruct is Apache-2.0. Because the user downloads it from the
source (we do not redistribute the weights), this is the same posture as any
pocket model. The in-app attribution and the on-device-content disclaimer live
in Settings; keep them in step with whatever model `HARBOR_MODEL_URL` actually
points at. See `app/MODEL-LICENSES.md`.
