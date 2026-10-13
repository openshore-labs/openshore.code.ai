// Upkeep for the media jobs (security review of the model library,
// 2026-10-12): the pictures, clips and sounds they made can be cleared, and
// removing a job can delete its model's files, but only the files Get itself
// downloaded and no other placed model needs.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../src/config/schema.js';
import { CatalogSchema, type Catalog } from '../src/market/schema.js';
import { recordDownload } from '../src/media/downloads.js';
import {
  clearMediaOutputs,
  mediaOutputs,
  removableFiles,
  removeModelFiles,
} from '../src/media/upkeep.js';

const seed: Catalog = CatalogSchema.parse(
  JSON.parse(readFileSync(join(__dirname, '..', 'catalog.sample.json'), 'utf8')),
);

function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

describe('what the media jobs made', () => {
  it('is counted and cleared, the image maker’s pictures with it', () => {
    const home = mkdtempSync(join(tmpdir(), 'osc-home-'));
    put(join(home, 'media', 'stems', '1-vocals.flac'), 'abc');
    put(join(home, 'images', 'a.png'), 'de');
    put(join(home, 'config.json'), '{}');
    expect(mediaOutputs(home)).toEqual({ files: 2, bytes: 5 });
    expect(clearMediaOutputs(home)).toEqual({ files: 2, bytes: 5 });
    expect(mediaOutputs(home)).toEqual({ files: 0, bytes: 0 });
    // Nothing else in the home is touched.
    expect(existsSync(join(home, 'config.json'))).toBe(true);
  });
});

describe("a removed model's files", () => {
  /** A models folder holding FLUX.2 klein's files (Get wrote all three) and
   *  Z-Image's own, with Z-Image placed for pictures and klein for edits. */
  function setup() {
    const home = mkdtempSync(join(tmpdir(), 'osc-home-'));
    const dir = join(home, 'models');
    const ledger = join(home, 'media-downloads.json');
    const klein = seed.models.find((m) => m.id === 'flux2-klein-4b')!;
    for (const f of klein.source.files!) {
      put(join(dir, f.dest), 'x'.repeat(10));
      recordDownload(join(dir, f.dest), 'flux2-klein-4b', ledger);
    }
    // Z-Image's own model file was already there: the person's, not Get's.
    put(join(dir, 'diffusion_models', 'z_image_turbo_int8_convrot.safetensors'), 'mine');
    const config = ConfigSchema.parse({
      media: { comfyui: { modelsDir: dir } },
      stack: {
        media: {
          instruct: { runtime: 'comfyui', catalogId: 'flux2-klein-4b', graph: 'flux2-klein' },
          create: { runtime: 'comfyui', catalogId: 'z-image-turbo', graph: 'z-image-turbo' },
        },
      },
    });
    return { dir, ledger, config };
  }

  it('are the ones Get wrote that no other placed model needs', () => {
    const { dir, ledger, config } = setup();
    const { files, bytes } = removableFiles(seed, config, 'instruct', ledger);
    // The shared text encoder stays for Z-Image.
    expect(files.map((f) => f.path).sort()).toEqual(
      [
        join(dir, 'diffusion_models', 'flux-2-klein-4b-fp8.safetensors'),
        join(dir, 'vae', 'flux2-vae.safetensors'),
      ].sort(),
    );
    expect(bytes).toBe(20);
  });

  it('never include a file the person had before Get', () => {
    const { ledger, config } = setup();
    expect(removableFiles(seed, config, 'create', ledger).files).toEqual([]);
  });

  it('are deleted and forgotten, leaving the rest', () => {
    const { dir, ledger, config } = setup();
    expect(removeModelFiles(seed, config, 'instruct', ledger)).toEqual({ files: 2, bytes: 20 });
    expect(existsSync(join(dir, 'vae', 'flux2-vae.safetensors'))).toBe(false);
    expect(existsSync(join(dir, 'text_encoders', 'qwen_3_4b_fp8_mixed.safetensors'))).toBe(true);
    expect(
      existsSync(join(dir, 'diffusion_models', 'z_image_turbo_int8_convrot.safetensors')),
    ).toBe(true);
    expect(removableFiles(seed, config, 'instruct', ledger).files).toEqual([]);
  });
});
