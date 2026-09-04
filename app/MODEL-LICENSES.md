# Model licenses

With one exception, OpenShore does not ship model weights inside the app: every
model is downloaded by the user straight from its own public source, and
OpenShore never rehosts weights. The exception is Harbor Mini, the small guide,
whose weights are bundled with the app so it is present on first launch. Its
license (Apache-2.0) permits that redistribution, and the license and
attribution ship in the app.

## Harbor Mini (bundled with the app)

- **Weights:** SmolLM2-135M-Instruct (GGUF, Q4_K_M quantization), about 105 MB.
  Chosen so the whole app stays under the 170 MB download budget once the guide
  is bundled (Qwen2.5-0.5B was 380 MB, far over).
- **Source:** Hugging Face (`HuggingFaceTB/SmolLM2-135M-Instruct`), via the
  unsloth GGUF repo. The weights are placed into the app bundle at build time
  from `HARBOR_MINI_MODEL_URL` in `app/src/lib/harborMini.ts` (see
  `docs/HARBOR.md`).
- **License:** Apache License 2.0. Redistributed inside the app under its terms,
  with the license and attribution retained.

## Harbor (downloaded)

- **Weights:** Qwen3-1.7B (GGUF, Q4_K_M quantization).
- **Source:** via Hugging Face (`unsloth/Qwen3-1.7B-GGUF`), downloaded on demand
  (`HARBOR_MODEL_URL` in `app/src/lib/harbor.ts`).
- **License:** Apache License 2.0. Downloaded from the source, not redistributed
  by us, the same posture as any pocket model.

The in-app attribution and the on-device-content disclaimer live in Settings
("Local models, honestly"). If the model either constant points at ever changes,
re-check its license and update the in-app attribution in the same change. When
Harbor Mini's weights change, update the bundled file too.

## Everything else

Marketplace models show their license before download and pull from Hugging
Face or the Ollama library. The catalog is honest about each model's terms; the
app is a catalog and a client, not a weight host.
