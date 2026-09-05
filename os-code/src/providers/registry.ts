// Provider registry: instantiate every configured endpoint once, hand out by
// id. The Anthropic key getter is injected so the provider layer never
// touches the credential store directly.
//
// THE ETHICS LAYER LIVES HERE.
//
// Nothing in this file hands out a raw provider. Every provider, and the image
// provider, is wrapped in its guarded form before it can be held by anything
// else, which is what makes the ethics layer unbypassable rather than merely
// present: the agent loop, the router's specialist delegation, the summarizer,
// the daemon's free chat endpoint, and the eval harness all get their models
// from here, so none of them has an unguarded object to call even by mistake.
// register() wraps too, so a test double or an eval harness provider is
// screened exactly like a real one.
//
// The rule for anyone editing this file: if you add a way to obtain a Provider,
// it returns a guarded one. test/ethicsNoBypass.test.ts fails the build if a
// raw provider ever escapes.
import type { OscConfig } from '../config/schema.js';
import type { EmbeddingProvider, ImageProvider, Provider } from './types.js';
import { OpenAICompatibleProvider } from './openaiCompatible.js';
import { AnthropicProvider } from './anthropic.js';
import { ImageGenProvider } from './imageGen.js';
import {
  GuardedImageProvider,
  GuardedProvider,
  type GuardContext,
} from '../core/ethics/guardedProvider.js';

export class ProviderRegistry {
  private providers = new Map<string, Provider>();
  private image?: ImageProvider;
  /** The raw, unwrapped endpoints. Used only where no prompt is involved:
   *  embeddings, and the escalation-target key check. */
  private raw = new Map<string, Provider>();

  constructor(
    private readonly config: OscConfig,
    private readonly getAnthropicKey: () => string | undefined,
    /** Consent lookup and block reporting for the ethics layer. */
    private readonly ethics: GuardContext = {},
  ) {
    for (const [id, endpoint] of Object.entries(config.providers)) {
      if (endpoint.kind === 'openai-compatible') {
        this.add(id, new OpenAICompatibleProvider(id, endpoint));
      } else if (endpoint.kind === 'anthropic') {
        this.add(id, new AnthropicProvider(id, endpoint, getAnthropicKey));
      }
    }
    if (config.imageGen) {
      this.image = new GuardedImageProvider(new ImageGenProvider(config.imageGen), this.ethics);
    }
  }

  private add(id: string, provider: Provider): void {
    this.raw.set(id, provider);
    this.providers.set(id, new GuardedProvider(provider, this.ethics));
  }

  get(id: string): Provider {
    const p = this.providers.get(id);
    if (!p) {
      const known = [...this.providers.keys()].join(', ') || '(none configured)';
      throw new Error(
        `No provider named "${id}" in your config. Configured providers: ${known}. Check the stack section of your config.`,
      );
    }
    return p;
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  all(): Array<[string, Provider]> {
    return [...this.providers.entries()];
  }

  /** The embedding path rides any OpenAI-compatible endpoint. Embeddings carry
   *  no completion and produce no text, so they use the raw endpoint; the query
   *  that reaches them has already been screened on the way in. */
  embedder(id: string): EmbeddingProvider {
    const p = this.raw.get(id);
    if (p instanceof OpenAICompatibleProvider) return p;
    throw new Error(
      `Provider "${id}" cannot serve embeddings. Point the embedding specialist at a local endpoint.`,
    );
  }

  /** The unwrapped endpoint, for checks that never send a prompt (the router
   *  asks an Anthropic endpoint whether it holds a key). Never use this to run
   *  a completion. */
  rawProvider(id: string): Provider | undefined {
    return this.raw.get(id);
  }

  imageProvider(): ImageProvider | undefined {
    return this.image;
  }

  /** Register or replace a provider (tests and the eval harness use this). The
   *  guard is applied here too, so a registered provider is no different from a
   *  configured one as far as screening is concerned. */
  register(id: string, provider: Provider): void {
    this.add(id, provider);
  }
}
