// generateImage: the image-generation specialist reached as a tool. The
// diffusion model is not a chat model; the orchestrator asks for a picture
// the same way it asks for a grep.
//
// The provider this reaches is a GuardedImageProvider (providers/registry.ts),
// so two things have already happened by the time bytes come back: the prompt
// was screened by the ethics layer, and the image carries C2PA-vocabulary
// provenance marking it as AI-generated. Neither is optional and neither is
// done here, which is the point: this tool cannot forget to do it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { ToolDef } from './index.js';
import { oscHome } from '../../config/load.js';
import { EthicsBlocked } from '../ethics/guardedProvider.js';

const schema = z.object({
  prompt: z.string().min(1).describe('What to draw'),
  width: z.number().int().min(256).max(2048).optional(),
  height: z.number().int().min(256).max(2048).optional(),
});

export const generateImageTool: ToolDef<typeof schema> = {
  name: 'generateImage',
  description:
    'Generate an image with the local image server (the image-gen specialist). Returns the saved file path. Generated images carry provenance metadata marking them as AI-generated.',
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
      return {
        ok: true,
        content: `Image generated and saved to ${file}. It carries provenance metadata marking it as AI-generated.`,
      };
    } catch (err) {
      // A refusal from the ethics layer is not a failure to report as a bug.
      // Hand the model the plain message so it tells the person and moves on,
      // rather than retrying the same prompt.
      if (err instanceof EthicsBlocked) {
        return { ok: false, content: err.message };
      }
      return { ok: false, content: `Image generation failed: ${(err as Error).message}` };
    }
  },
};
