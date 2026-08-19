# Bundled model licenses

OS Code ships one model inside the app: **Harbor**, the built-in on-device
guide. Every other model is downloaded by the user from its own public source,
never redistributed by OpenShore.

## Harbor

- **Weights:** Qwen2.5-0.5B-Instruct (GGUF, Q4_K_M quantization).
- **Source:** the Qwen team, via Hugging Face (`Qwen/Qwen2.5-0.5B-Instruct`).
- **License:** Apache License 2.0.

Apache-2.0 permits redistribution of the weights inside the app, provided the
license and attribution travel with it. The full license text and NOTICE are
shipped in-app (Settings, then "Local model licenses") and reproduced from the
upstream model card. Qwen2.5-0.5B is released under Apache-2.0 by Alibaba
Cloud; see the model card for the authoritative terms.

If the bundled starter model is ever changed, its license must be re-checked
for redistribution rights before it ships, and this file plus the in-app
attribution updated in the same change.
