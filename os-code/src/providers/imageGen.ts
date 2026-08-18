// The image-generation specialist is NOT a chat model. It is a diffusion
// server reached as a tool: Automatic1111, ComfyUI, or any OpenAI-images
// compatible endpoint. The orchestrator calls it the way it calls grep.
import type { ImageProvider } from './types.js';
import { ProviderError } from './types.js';
import type { ImageGenEndpoint } from '../config/schema.js';

export class ImageGenProvider implements ImageProvider {
  readonly id = 'imageGen';

  constructor(private readonly endpoint: ImageGenEndpoint) {}

  get label(): string {
    return this.endpoint.label ?? `image server (${this.endpoint.kind})`;
  }

  private get baseUrl(): string {
    return this.endpoint.baseUrl.replace(/\/$/, '');
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const probe =
        this.endpoint.kind === 'a1111'
          ? `${this.baseUrl}/sdapi/v1/options`
          : this.endpoint.kind === 'comfyui'
            ? `${this.baseUrl}/system_stats`
            : `${this.baseUrl}/v1/models`;
      const res = await fetch(probe, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return { ok: false, detail: `${this.label} answered ${res.status}.` };
      return { ok: true, detail: `${this.label} is up at ${this.baseUrl}` };
    } catch {
      return {
        ok: false,
        detail: `No image server at ${this.baseUrl}. Start it, or remove the imageGen specialist from your stack.`,
      };
    }
  }

  async generate(
    prompt: string,
    opts: { width?: number; height?: number; model?: string } = {},
  ): Promise<{ imageBase64: string; mediaType: string }> {
    const width = opts.width ?? 768;
    const height = opts.height ?? 768;
    if (this.endpoint.kind === 'a1111') {
      const res = await fetch(`${this.baseUrl}/sdapi/v1/txt2img`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, width, height, steps: 24 }),
      });
      if (!res.ok) throw new ProviderError(this.id, `Image generation failed: ${res.status} ${await res.text()}`);
      const body = (await res.json()) as { images?: string[] };
      const image = body.images?.[0];
      if (!image) throw new ProviderError(this.id, 'The image server returned no image.');
      return { imageBase64: image, mediaType: 'image/png' };
    }
    if (this.endpoint.kind === 'openai-images') {
      const res = await fetch(`${this.baseUrl}/v1/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt,
          model: opts.model ?? this.endpoint.model,
          size: `${width}x${height}`,
          response_format: 'b64_json',
        }),
      });
      if (!res.ok) throw new ProviderError(this.id, `Image generation failed: ${res.status} ${await res.text()}`);
      const body = (await res.json()) as { data?: Array<{ b64_json?: string }> };
      const image = body.data?.[0]?.b64_json;
      if (!image) throw new ProviderError(this.id, 'The image server returned no image.');
      return { imageBase64: image, mediaType: 'image/png' };
    }
    // ComfyUI needs a workflow graph; OS Code ships a minimal txt2img graph.
    throw new ProviderError(
      this.id,
      'ComfyUI support needs a workflow file. Point imageGen at an Automatic1111 or OpenAI-images endpoint, or add comfyWorkflow support in a follow-up.',
    );
  }
}
