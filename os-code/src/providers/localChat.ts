// Serving a by-name LOCAL model to a docked phone. When a phone pulls a bigger
// model onto this machine from the Marketplace, it then wants to CHAT with that
// model, running on this machine's compute, over the tailnet. The weights live
// in a local backend (Ollama, LM Studio, llama.cpp, vLLM), so the phone names a
// model and the daemon runs it on whichever local provider can serve it.
//
// This never reaches for a cloud provider: a phone that pins to a home model is
// asking for its own hardware, not the user's cloud budget. It also goes through
// the guarded registry, so the ethics layer screens the turn like any other.
import type { OscConfig } from '../config/schema.js';
import type { ProviderRegistry } from './registry.js';
import type { Provider } from './types.js';

/** The ids of every LOCAL (openai-compatible) provider configured on this
 *  machine, in config order. Anthropic and any other cloud endpoint are left
 *  out: a home model runs on local hardware, never on a metered API. */
export function localProviderIds(config: OscConfig): string[] {
  return Object.entries(config.providers)
    .filter(([, endpoint]) => endpoint.kind === 'openai-compatible')
    .map(([id]) => id);
}

/** Pick the local provider that should serve a by-name model for a docked
 *  phone. The configured orchestrator wins when it is itself local (a
 *  single-Ollama box then serves exactly what it already runs); otherwise the
 *  first local provider stands in. Undefined when the machine has no local
 *  provider at all, which the caller turns into an honest error rather than a
 *  silent cloud spend. */
export function pickLocalProvider(
  registry: ProviderRegistry,
  config: OscConfig,
): { id: string; provider: Provider } | undefined {
  const localIds = localProviderIds(config);
  if (!localIds.length) return undefined;
  const orchestrator = config.stack.orchestrator?.provider;
  const preferred = orchestrator && localIds.includes(orchestrator) ? orchestrator : localIds[0]!;
  if (!registry.has(preferred)) return undefined;
  return { id: preferred, provider: registry.get(preferred) };
}

/** Every model physically present on this machine's local backends right now,
 *  deduped, in first-seen order. Listing sends no prompt (it is a catalog read
 *  of the backend), so a backend that is down simply contributes nothing rather
 *  than failing the whole list. This is what a docked phone reads to know which
 *  home models it can place on its Bench. */
export async function listLocalModels(
  registry: ProviderRegistry,
  config: OscConfig,
): Promise<string[]> {
  const seen = new Set<string>();
  for (const id of localProviderIds(config)) {
    if (!registry.has(id)) continue;
    try {
      for (const model of await registry.get(id).listModels()) {
        if (model) seen.add(model);
      }
    } catch {
      // A backend that is not running (or does not answer /api/tags) adds
      // nothing. The phone still gets the models the reachable backends report.
    }
  }
  return [...seen];
}
