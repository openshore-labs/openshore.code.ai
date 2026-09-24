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

- **Weights:** Qwen2.5-Coder-3B-Instruct (GGUF, Q4_K_M quantization).
- **Source:** via Hugging Face (`unsloth/Qwen2.5-Coder-3B-Instruct-GGUF`),
  downloaded on demand (`HARBOR_MODEL_URL` in `app/src/lib/harbor.ts`).
- **License:** Qwen Research License (the model card's `license_name:
qwen-research`, checked 2026-09-24), not Apache 2.0 as this file said before:
  research and non-commercial use, commercial use needs permission from Qwen.
  Downloaded from the source, not redistributed by us.

## DeepBlue (pulled through Ollama, on the desktop)

- **Weights:** Qwen 2.5 Coder, sized to the computer: 32B, 14B, 7B, or 3B
  (Ollama's Q4_K_M builds). The slot id is `harbor-master`; the sizes are the
  catalog's own entries (`HARBOR_MASTER_SIZES` in `app/src/lib/harborMaster.ts`).
- **Source:** the Ollama library, pulled by the desktop engine on the person's
  own machine (`ollama pull qwen2.5-coder:<size>`), never through OpenShore.
- **License:** the 32B, 14B, and 7B are Apache License 2.0. The 3B is the Qwen
  Research License (research and non-commercial use; commercial use needs
  permission from Qwen), checked on its model card 2026-09-24.
  Downloaded from the source, not redistributed by us. When OpenShore's own tuned
  weights replace these, the refs, this entry, and the in-app attribution change
  in the same commit (`docs/house-model-proposal.md`).

The in-app attribution and the on-device-content disclaimer live in Settings
("Local models, honestly"). If the model either constant points at ever changes,
re-check its license and update the in-app attribution in the same change. When
Harbor Mini's weights change, update the bundled file too.

## Everything else

Marketplace models show their license before download and pull from Hugging
Face or the Ollama library. The catalog is honest about each model's terms; the
app is a catalog and a client, not a weight host.
