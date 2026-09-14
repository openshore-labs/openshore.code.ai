// Perplexity's Sonar models are cloud, search-grounded, and priced per call on
// the user's own key, so they belong in Cloud Connections alongside Claude,
// OpenAI, Gemini, and Kimi, not as a local download and not as an Agentic
// Current (a Current is an exclusive agent runtime; a provider model is a
// placeable selection). Pin that Perplexity is wired as an openai-compatible
// provider so key validation and the stack router treat it like the others.
import { describe, expect, it } from 'vitest';
import { PROVIDERS, providerInfo, providerModelVision } from '../src/lib/providers.js';

describe('Perplexity (Sonar) cloud provider', () => {
  it('is registered as an openai-compatible provider with Sonar models', () => {
    const p = providerInfo('perplexity');
    expect(p, 'perplexity provider present').toBeDefined();
    expect(p!.name).toBe('Perplexity');
    expect(p!.openaiBaseUrl).toBe('https://api.perplexity.ai');
    expect(p!.apiKeyUrl).toMatch(/^https:\/\//);
    expect(p!.keyHint).toContain('pplx-');
    expect(p!.models.length).toBeGreaterThan(0);
    for (const m of p!.models) {
      expect(m.id, 'every Sonar id starts with sonar').toMatch(/^sonar/);
    }
    expect(p!.models.some((m) => m.id === 'sonar')).toBe(true);
    expect(p!.models.some((m) => m.id === 'sonar-deep-research')).toBe(true);
  });

  it('claims no vision until a tier is verified: an unverified claim is a dead attach button', () => {
    for (const m of providerInfo('perplexity')!.models) {
      expect(providerModelVision('perplexity', m.id), `${m.id} vision`).toBe(false);
    }
  });

  it('rides the shared openai-compatible base assumption every non-Anthropic provider relies on', () => {
    const p = providerInfo('perplexity')!;
    expect(p.openaiBaseUrl, 'perplexity has an openai base').toBeTruthy();
    // The provider list stays deduplicated on id.
    expect(PROVIDERS.filter((x) => x.id === 'perplexity').length).toBe(1);
  });
});
