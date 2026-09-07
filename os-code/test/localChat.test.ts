// Serving a home model to a docked phone (MP-F3): the daemon must resolve a
// LOCAL provider for a by-name model and never reach for a cloud endpoint (a
// phone that pins to a home model is asking for its own hardware, not the
// user's cloud budget). These pin that resolution.
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config/load.js';
import type { OscConfig } from '../src/config/schema.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { localProviderIds, pickLocalProvider, listLocalModels } from '../src/providers/localChat.js';

const noKey = () => undefined;

/** A config with the given providers, keeping everything else at defaults. */
function configWith(providers: OscConfig['providers'], orchestrator?: { provider: string; model: string }): OscConfig {
  const cfg = defaultConfig();
  cfg.providers = providers;
  if (orchestrator) cfg.stack.orchestrator = orchestrator;
  return cfg;
}

const OLLAMA = { kind: 'openai-compatible', baseUrl: 'http://localhost:11434' } as const;
const LMSTUDIO = { kind: 'openai-compatible', baseUrl: 'http://localhost:1234' } as const;
const CLAUDE = {
  kind: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  auth: 'api-key',
  model: 'claude-sonnet-5',
} as const;

describe('local provider resolution for a docked phone', () => {
  it('lists only the local (openai-compatible) providers, in config order', () => {
    expect(localProviderIds(defaultConfig())).toEqual(['ollama']);
    expect(localProviderIds(configWith({ claude: CLAUDE, ollama: OLLAMA, lmstudio: LMSTUDIO }))).toEqual([
      'ollama',
      'lmstudio',
    ]);
    // A cloud-only box has no local provider at all.
    expect(localProviderIds(configWith({ claude: CLAUDE }))).toEqual([]);
  });

  it('picks the orchestrator provider when it is local, else the first local one', () => {
    // A single-Ollama box serves exactly what it already runs.
    const plain = defaultConfig();
    expect(pickLocalProvider(new ProviderRegistry(plain, noKey), plain)?.id).toBe('ollama');

    // Orchestrator is a local provider that is not first: it still wins.
    const orchLocal = configWith({ claude: CLAUDE, ollama: OLLAMA, lmstudio: LMSTUDIO }, {
      provider: 'lmstudio',
      model: 'x',
    });
    expect(pickLocalProvider(new ProviderRegistry(orchLocal, noKey), orchLocal)?.id).toBe('lmstudio');

    // Orchestrator is a CLOUD model: fall to the first local provider, never the
    // cloud one (a home model must not spend the cloud budget).
    const orchCloud = configWith({ claude: CLAUDE, ollama: OLLAMA }, { provider: 'claude', model: 'x' });
    expect(pickLocalProvider(new ProviderRegistry(orchCloud, noKey), orchCloud)?.id).toBe('ollama');
  });

  it('returns undefined when the machine has no local provider', () => {
    const cloudOnly = configWith({ claude: CLAUDE }, { provider: 'claude', model: 'x' });
    expect(pickLocalProvider(new ProviderRegistry(cloudOnly, noKey), cloudOnly)).toBeUndefined();
  });

  it('lists installed models without throwing when a backend is down', async () => {
    // No Ollama is running under test, so listModels errors are swallowed and the
    // list is simply empty rather than failing the whole route.
    const cfg = defaultConfig();
    const models = await listLocalModels(new ProviderRegistry(cfg, noKey), cfg);
    expect(Array.isArray(models)).toBe(true);
  });
});
