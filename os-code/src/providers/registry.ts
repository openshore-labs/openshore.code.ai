// Provider registry: instantiate every configured endpoint once, hand out by
// id. The Anthropic key getter is injected so the provider layer never
// touches the credential store directly.
import type { OscConfig } from '../config/schema.js';
import type { EmbeddingProvider, ImageProvider, Provider } from './types.js';
import { OpenAICompatibleProvider } from './openaiCompatible.js';
import { AnthropicProvider } from './anthropic.js';
import { ImageGenProvider } from './imageGen.js';

export class ProviderRegistry {
  private providers = new Map<string, Provider>();
  private image?: ImageProvider;

  constructor(
    private readonly config: OscConfig,
    private readonly getAnthropicKey: () => string | undefined,
  ) {
    for (const [id, endpoint] of Object.entries(config.providers)) {
      if (endpoint.kind === 'openai-compatible') {
        this.providers.set(id, new OpenAICompatibleProvider(id, endpoint));
      } else if (endpoint.kind === 'anthropic') {
        this.providers.set(id, new AnthropicProvider(id, endpoint, getAnthropicKey));
      }
    }
    if (config.imageGen) {
      this.image = new ImageGenProvider(config.imageGen);
    }
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

  /** The embedding path rides any OpenAI-compatible endpoint. */
  embedder(id: string): EmbeddingProvider {
    const p = this.get(id);
    if (p instanceof OpenAICompatibleProvider) return p;
    throw new Error(
      `Provider "${id}" cannot serve embeddings. Point the embedding specialist at a local endpoint.`,
    );
  }

  imageProvider(): ImageProvider | undefined {
    return this.image;
  }

  /** Register or replace a provider (tests and the eval harness use this). */
  register(id: string, provider: Provider): void {
    this.providers.set(id, provider);
  }
}
