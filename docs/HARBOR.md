# Harbor: the built-in guide model

Harbor is a small model (Qwen2.5-0.5B-Instruct, Apache-2.0) that ships inside
the app so a brand-new user has an instant, offline assistant to walk them
through setup. It is a concierge, not a coding model: scoped to guidance,
grounded on the app's own setup facts, and it hands off to a real model for
actual work. In the code it is a reserved on-device model with id `harbor`
(see `app/src/lib/harbor.ts`), so it flows through the normal on-device driver
and the llama plugin.

## iOS: ship Harbor as an On-Demand Resource (initial install)

On-Demand Resources let Harbor ride the first download (present offline at
first launch), count toward the app size, and still be OS-purgeable and
re-downloadable from Apple's CDN. That satisfies both "instant, offline on
first launch" and "removable to free space, re-addable" without OpenShore
hosting a weight.

One-time setup in Xcode (`app/ios/App/App.xcodeproj`):

1. Get the GGUF: **Qwen2.5-0.5B-Instruct, Q4_K_M** quantization, from the
   Qwen Hugging Face repo. Name the file
   `qwen2.5-0.5b-instruct-q4_k_m.gguf` (the base name must match
   `HarborResource.fileName` in the native plugin).
2. Add the file to the **App** target (Build Phases, Copy Bundle Resources is
   handled by the tag below; do not also add it to a plain copy phase, or it
   ships twice).
3. Select the file, open the File Inspector, and set **On Demand Resource
   Tags** to `HarborModel`.
4. In the target's **Resource Tags** tab, drag `HarborModel` into
   **Initial Install Tags** (so it is present at first launch, not fetched
   later over the network).
5. Confirm the ChatML chat template is embedded in the GGUF (the official
   Qwen2.5 GGUFs embed it; the runner reads it from the file). A raw/base
   quant without a template will format replies wrong.

The native accessor is `HarborResource.swift`; `OscodeLlamaPlugin.load` resolves
the tag for id `harbor` and loads from the bundled URL, and `deleteModel`
releases it so iOS can reclaim the space.

If the tag is not configured, `ensure` fails gracefully: Harbor reports it is
not bundled and the rest of the app is unaffected.

## Desktop

On the Linux desktop, ship Harbor by pulling the same GGUF via Ollama (or
bundling it in the installer). Desktop RAM and disk are not the constraint the
500MB phone cap is.

## Grounding

Harbor's accuracy comes from the setup/FAQ facts injected into its system
prompt (`buildHarborSystemPrompt` in `app/src/lib/harbor.ts`). When the setup
flow changes, update those facts in the same change so Harbor never narrates a
step that no longer exists. Full retrieval over docs is a later upgrade.

## License

Qwen2.5-0.5B-Instruct is Apache-2.0, which permits bundling the weights with
attribution. See `app/LICENSES-BUNDLED.md`, and keep the in-app attribution
(Settings, "Local model licenses") in step with whatever model actually ships.
