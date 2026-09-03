// Kimi (Moonshot) is a cloud provider on the user's own key: the Kimi models
// are cloud-scale and do not run locally, so they belong here alongside
// Claude, OpenAI, and Gemini, not as a local download. Pin that it is wired as
// an openai-compatible provider so key validation and the stack router treat it
// like the others, and that the lineup is the current one.
import { describe, expect, it } from 'vitest';
import { PROVIDERS, RETIRED_PROVIDER_MODEL_IDS, providerInfo } from '../src/lib/providers.js';

describe('Kimi (Moonshot) cloud provider', () => {
  it('is registered as an openai-compatible provider with the current models', () => {
    const p = providerInfo('moonshot');
    expect(p, 'moonshot provider present').toBeDefined();
    expect(p!.name).toContain('Kimi');
    expect(p!.openaiBaseUrl).toMatch(/^https:\/\//);
    expect(p!.apiKeyUrl).toMatch(/^https:\/\//);
    expect(p!.models.length).toBeGreaterThan(0);
    expect(p!.models.some((m) => m.label === 'Kimi K3')).toBe(true);
    expect(p!.models.some((m) => m.label.startsWith('Kimi K2.7 Code'))).toBe(true);
    expect(p!.models.some((m) => m.label === 'Kimi K2.6')).toBe(true);
  });

  it('carries no retired id: those are dead buttons in the stack', () => {
    for (const p of PROVIDERS) {
      for (const m of p.models) {
        expect(RETIRED_PROVIDER_MODEL_IDS, `${p.id}/${m.id}`).not.toContain(m.id);
      }
    }
  });

  it('every provider that lists an openai base validates the same way', () => {
    // Guards the assumption the validator relies on: an openai-compatible
    // provider exposes a /models endpoint under openaiBaseUrl.
    for (const p of PROVIDERS) {
      if (p.id === 'anthropic') continue;
      expect(p.openaiBaseUrl, `${p.id} has an openai base`).toBeTruthy();
    }
  });
});
