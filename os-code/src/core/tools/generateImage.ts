// generateImage: the image-generation specialist reached as a tool. The
// diffusion model is not a chat model; the orchestrator asks for a picture
// the same way it asks for a grep.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { ToolDef } from './index.js';
import { oscHome } from '../../config/load.js';

const schema = z.object({
  prompt: z.string().min(1).describe('What to draw'),
  width: z.number().int().min(256).max(2048).optional(),
  height: z.number().int().min(256).max(2048).optional(),
});

export const generateImageTool: ToolDef<typeof schema> = {
  name: 'generateImage',
  description:
    'Generate an image with the local image server (the image-gen specialist). Returns the saved file path.',
  schema,
  risk: 'read', // local compute, no egress, no workspace writes
  async execute(args, ctx) {
    if (!ctx.imageProvider) {
      return {
        ok: false,
        content:
          'No image server is configured. Add an imageGen endpoint to your config (Automatic1111 or an OpenAI-images endpoint), or do without the illustration.',
      };
    }
    try {
      const image = await ctx.imageProvider.generate(args.prompt, {
        width: args.width,
        height: args.height,
      });
      const dir = join(oscHome(), 'images');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `osc-${Date.now()}.png`);
      writeFileSync(file, Buffer.from(image.imageBase64, 'base64'));
      return { ok: true, content: `Image generated and saved to ${file}.` };
    } catch (err) {
      return { ok: false, content: `Image generation failed: ${(err as Error).message}` };
    }
  },
};
