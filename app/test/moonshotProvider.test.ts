// Kimi (Moonshot) is a cloud provider on the user's own key: Kimi K2 is a
// cloud-scale model that does not run locally, so it belongs here alongside
// Claude, OpenAI, and Gemini, not as a local download. Pin that it is wired as
// an openai-compatible provider so key validation and the stack router treat it
// like the others.
import { describe, expect, it } from 'vitest';
import { PROVIDERS, providerInfo } from '../src/lib/providers.js';

describe('Kimi (Moonshot) cloud provider', () => {
  it('is registered as an openai-compatible provider with models', () => {
    const p = providerInfo('moonshot');
    expect(p, 'moonshot provider present').toBeDefined();
    expect(p!.name).toContain('Kimi');
    expect(p!.openaiBaseUrl).toMatch(/^https:\/\//);
    expect(p!.apiKeyUrl).toMatch(/^https:\/\//);
    expect(p!.models.length).toBeGreaterThan(0);
    expect(p!.models.some((m) => m.label.includes('Kimi K2'))).toBe(true);
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
