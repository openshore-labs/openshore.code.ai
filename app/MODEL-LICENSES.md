# Model licenses

OS Code does not ship model weights inside the app. Every model, including
Harbor (the built-in guide), is downloaded by the user straight from its own
public source. OpenShore never rehosts weights.

## Harbor

- **Weights:** Qwen2.5-0.5B-Instruct (GGUF, Q4_K_M quantization).
- **Source:** the Qwen team, via Hugging Face (`Qwen/Qwen2.5-0.5B-Instruct`),
  downloaded on first launch (`HARBOR_MODEL_URL` in `app/src/lib/harbor.ts`).
- **License:** Apache License 2.0.

The in-app attribution and the on-device-content disclaimer live in Settings
("Local models, honestly"). Because Harbor is downloaded from the source rather
than redistributed by us, it carries the same license posture as any pocket
model. If the starter model that `HARBOR_MODEL_URL` points at ever changes,
re-check its license and update the in-app attribution in the same change.

## Everything else

Marketplace models show their license before download and pull from Hugging
Face or the Ollama library. The catalog is honest about each model's terms; the
app is a catalog and a client, not a weight host.
