// Get, for a media model (the model library, 2026-10-12): files straight from
// their source into ComfyUI's models folder, never outside it, checked
// against the SHA-256 the catalog names (and never fetched without one, the
// security review of the same day); a speech server asked to fetch its own; a
// program checked for and never installed; and the job saved in the Stack.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { ConfigSchema } from '../src/config/schema.js';
import { globalConfigPath, saveMediaPlacement } from '../src/config/load.js';
import { CatalogSchema, type Catalog, type CatalogModel } from '../src/market/schema.js';
import {
  comfyModelsCandidates,
  comfyModelsDir,
  destPath,
  getModel,
  installMediaModel,
} from '../src/media/install.js';

// Get records what it downloads beside the config: a temporary home here.
let previousHome: string | undefined;
beforeEach(() => {
  previousHome = process.env.OSC_HOME;
  process.env.OSC_HOME = mkdtempSync(join(tmpdir(), 'osc-home-'));
});
afterEach(() => {
  if (previousHome === undefined) delete process.env.OSC_HOME;
  else process.env.OSC_HOME = previousHome;
});

const seed: Catalog = CatalogSchema.parse(
  JSON.parse(readFileSync(join(__dirname, '..', 'catalog.sample.json'), 'utf8')),
);
const byId = (id: string) => seed.models.find((m) => m.id === id)!;

function modelsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'comfy-models-'));
  return dir;
}

/** A source that serves one body for every file. */
function source(body: string, opts: { length?: number } = {}) {
  const asked: string[] = [];
  const fetchImpl = async (url: string) => {
    asked.push(url);
    return new Response(body, {
      headers: { 'content-length': String(opts.length ?? body.length) },
    });
  };
  return { asked, fetchImpl };
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** A model whose every file the catalog pins to the SHA-256 of `body`, the
 *  way the builder publishes it. */
function pinnedTo(model: CatalogModel, body: string): CatalogModel {
  return {
    ...model,
    source: {
      ...model.source,
      files: (model.source.files ?? []).map((f) => ({ ...f, sha256: sha(body) })),
    },
  };
}

describe("ComfyUI's models folder", () => {
  it('looks in the usual places, Comfy Desktop first', () => {
    expect(comfyModelsCandidates('/home/me', {})).toEqual([
      '/home/me/ComfyUI-Shared/models',
      '/home/me/Documents/ComfyUI/models',
      '/home/me/ComfyUI/models',
    ]);
  });

  it('takes the folder the person set over any it finds', () => {
    const config = ConfigSchema.parse({ media: { comfyui: { modelsDir: '/srv/comfy/models' } } });
    expect(comfyModelsDir(config, ['/nowhere'])).toBe('/srv/comfy/models');
    expect(comfyModelsDir(ConfigSchema.parse({}), ['/nowhere'])).toBeUndefined();
  });

  it('refuses a file that would land outside it', () => {
    expect(() => destPath('/m', '../../etc/passwd')).toThrow(/outside ComfyUI's models folder/);
    expect(() => destPath('/m', '/etc/passwd')).toThrow(/outside ComfyUI's models folder/);
    expect(destPath('/m', 'vae/ae.safetensors')).toBe('/m/vae/ae.safetensors');
    // A folder typed with a trailing slash is the same folder.
    expect(destPath('/m/', 'vae/ae.safetensors')).toBe('/m/vae/ae.safetensors');
  });
});

describe('Get for a ComfyUI model', () => {
  it('puts every file in its folder and fills the job of the shelf it came from', async () => {
    const dir = modelsDir();
    const config = ConfigSchema.parse({ media: { comfyui: { modelsDir: dir } } });
    const src = source('weights');
    const result = await installMediaModel(
      pinnedTo(byId('sam3.1'), 'weights'),
      'select',
      config,
      () => {},
      {
        fetchImpl: src.fetchImpl,
      },
    );
    expect(result.ok).toBe(true);
    expect(
      readFileSync(join(dir, 'checkpoints', 'sam3.1_multiplex_fp16.safetensors'), 'utf8'),
    ).toBe('weights');
    expect(result.placement).toEqual({ runtime: 'comfyui', catalogId: 'sam3.1', graph: 'sam3' });
    expect(src.asked[0]).toMatch(/^https:\/\/huggingface\.co\/Comfy-Org\/sam3\.1\//);
  });

  it('throws a file away when it does not match its published checksum', async () => {
    const dir = modelsDir();
    const config = ConfigSchema.parse({ media: { comfyui: { modelsDir: dir } } });
    const src = source('tampered');
    const result = await installMediaModel(
      pinnedTo(byId('birefnet'), 'the real weights'),
      'background',
      config,
      () => {},
      { fetchImpl: src.fetchImpl },
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/did not match its published checksum/);
    expect(existsSync(join(dir, 'background_removal', 'birefnet.safetensors'))).toBe(false);
    expect(existsSync(join(dir, 'background_removal', 'birefnet.safetensors.part'))).toBe(false);
  });

  it('never fetches a file the catalog names no checksum for', async () => {
    const dir = modelsDir();
    const config = ConfigSchema.parse({ media: { comfyui: { modelsDir: dir } } });
    const src = source('weights');
    const result = await installMediaModel(byId('birefnet'), 'background', config, () => {}, {
      fetchImpl: src.fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/has no published checksum yet, so it was not fetched/);
    expect(src.asked).toHaveLength(0);
  });

  it('cuts off a source that sends more than the file is said to be', async () => {
    const dir = modelsDir();
    const config = ConfigSchema.parse({ media: { comfyui: { modelsDir: dir } } });
    const body = 'x'.repeat(4096);
    const model = pinnedTo(byId('birefnet'), body);
    const result = await installMediaModel(
      {
        ...model,
        source: {
          ...model.source,
          files: model.source.files!.map((f) => ({ ...f, sizeGB: 1e-6 })),
        },
      },
      'background',
      config,
      () => {},
      { fetchImpl: source(body, { length: 1000 }).fetchImpl },
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/ran past its published size/);
    expect(existsSync(join(dir, 'background_removal', 'birefnet.safetensors.part'))).toBe(false);
  });

  it('keeps a file already in place at its size', async () => {
    const dir = modelsDir();
    mkdirSync(join(dir, 'upscale_models'), { recursive: true });
    writeFileSync(
      join(dir, 'upscale_models', 'RealESRGAN_x4plus.safetensors'),
      'x'.repeat(70_000_000),
    );
    const config = ConfigSchema.parse({ media: { comfyui: { modelsDir: dir } } });
    const src = source('new');
    const result = await installMediaModel(byId('realesrgan-x4plus'), 'upscale', config, () => {}, {
      fetchImpl: src.fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(src.asked).toHaveLength(0);
  });

  it("refuses a file that does not start at its source kind's host", async () => {
    const dir = modelsDir();
    const config = ConfigSchema.parse({ media: { comfyui: { modelsDir: dir } } });
    const bad: CatalogModel = {
      ...byId('birefnet'),
      source: {
        ...byId('birefnet').source,
        files: [{ url: 'https://evil.example/b.safetensors', dest: 'b.safetensors' }],
      },
    };
    const result = await installMediaModel(bad, 'background', config, () => {}, {
      fetchImpl: source('x').fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/does not start at a huggingface host/);
  });

  it('says where to set the folder when it cannot find one', async () => {
    const result = await installMediaModel(
      byId('lama'),
      'remove',
      ConfigSchema.parse({}),
      () => {},
      {
        comfyCandidates: ['/nowhere/at/all'],
      },
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/Set it once in Stack, Media servers/);
  });

  it('refuses a job the model does not do', async () => {
    const result = await installMediaModel(byId('lama'), 'transcribe', ConfigSchema.parse({}));
    expect(result.ok).toBe(false);
  });
});

describe('Get for a speech model and a program', () => {
  it('asks the speech server to fetch it from its gallery, then places it with its voice', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
      const path = new URL(url).pathname;
      if (path === '/v1/models') return new Response('{"data":[]}');
      if (path === '/models/apply') return new Response(JSON.stringify({ uuid: 'j1' }));
      return new Response(JSON.stringify({ processed: true }));
    };
    const result = await installMediaModel(
      byId('kokoro-82m'),
      'speak',
      ConfigSchema.parse({}),
      () => {},
      {
        fetchImpl,
        sleep: async () => {},
      },
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['GET /v1/models', 'POST /models/apply', 'GET /models/jobs/j1']);
    expect(result.placement).toEqual({
      runtime: 'speech',
      catalogId: 'kokoro-82m',
      model: 'kokoro',
      voice: 'af_heart',
    });
  });

  it('places a voice that copies yours as itself, with no watermark flag to carry', async () => {
    const fetchImpl = async (url: string) =>
      new URL(url).pathname === '/models/apply'
        ? new Response(JSON.stringify({ uuid: 'j' }))
        : new Response(JSON.stringify({ processed: true }));
    const result = await installMediaModel(
      byId('chatterbox'),
      'clone',
      ConfigSchema.parse({}),
      () => {},
      {
        fetchImpl,
        sleep: async () => {},
      },
    );
    expect(result.placement).toEqual({
      runtime: 'speech',
      catalogId: 'chatterbox',
      model: 'chatterbox',
    });
  });

  it('sends nothing to a speech server off this network over plain http', async () => {
    const calls: string[] = [];
    const result = await installMediaModel(
      byId('kokoro-82m'),
      'speak',
      ConfigSchema.parse({ media: { speech: { baseUrl: 'http://speech.example:8080' } } }),
      () => {},
      {
        fetchImpl: async (url: string) => {
          calls.push(url);
          return new Response('{}');
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/off this network over plain http, so nothing was sent/);
    expect(calls).toEqual([]);
  });

  it('never installs a program, and says the exact line when one is missing', async () => {
    const result = await installMediaModel(
      byId('htdemucs-ft'),
      'stems',
      ConfigSchema.parse({}),
      () => {},
      {
        programRuns: async () => false,
      },
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toBe(
      'audio-separator is not installed on this computer. Install it with: pip install audio-separator, then tap Get again.',
    );
    const ready = await installMediaModel(
      byId('htdemucs-ft'),
      'stems',
      ConfigSchema.parse({}),
      () => {},
      {
        programRuns: async () => true,
      },
    );
    expect(ready.placement).toEqual({
      runtime: 'separator',
      catalogId: 'htdemucs-ft',
      model: 'htdemucs_ft.yaml',
    });
  });
});

describe('one Get for every model', () => {
  it('saves the placement for the job of the shelf, and the folder it found', async () => {
    const dir = modelsDir();
    const saved: unknown[] = [];
    const result = await getModel(
      pinnedTo(byId('flux2-klein-4b'), 'w'),
      seed,
      ConfigSchema.parse({}),
      () => {},
      {
        shelfId: 'imageEdit.instruct',
        deps: { fetchImpl: source('w').fetchImpl, comfyCandidates: [dir] },
        save: (p) => saved.push(p),
      },
    );
    expect(result.ok).toBe(true);
    expect(saved).toEqual([
      {
        job: 'instruct',
        placement: { runtime: 'comfyui', catalogId: 'flux2-klein-4b', graph: 'flux2-klein' },
        modelsDir: dir,
      },
    ]);
  });

  it('refuses a shelf the model is not a pick on', async () => {
    const saved: unknown[] = [];
    const result = await getModel(byId('kokoro-82m'), seed, ConfigSchema.parse({}), () => {}, {
      shelfId: 'voice.own',
      deps: { fetchImpl: async () => new Response('{}'), sleep: async () => {} },
      save: (p) => saved.push(p),
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/is not a pick on that shelf/);
    expect(saved).toEqual([]);
  });

  it("falls back to the model's first pick when no shelf is named", async () => {
    const saved: unknown[] = [];
    await getModel(byId('htdemucs-ft'), seed, ConfigSchema.parse({}), () => {}, {
      deps: { programRuns: async () => true },
      save: (p) => saved.push(p),
    });
    expect(JSON.stringify(saved)).toContain('"stems"');
  });
});

describe('saving a placement', () => {
  it('replaces the job whole, so nothing of the model before it is left, and takes it out', () => {
    const previous = process.env.OSC_HOME;
    process.env.OSC_HOME = mkdtempSync(join(tmpdir(), 'osc-home-'));
    onTestFinished(() => {
      if (previous === undefined) delete process.env.OSC_HOME;
      else process.env.OSC_HOME = previous;
    });
    saveMediaPlacement('speak', {
      runtime: 'speech',
      catalogId: 'kokoro-82m',
      model: 'kokoro',
      voice: 'af_heart',
    });
    saveMediaPlacement('speak', { runtime: 'speech', catalogId: 'voxcpm2', model: 'voxcpm2' });
    const read = () => JSON.parse(readFileSync(globalConfigPath(), 'utf8'));
    expect(read().stack.media.speak).toEqual({
      runtime: 'speech',
      catalogId: 'voxcpm2',
      model: 'voxcpm2',
    });
    saveMediaPlacement('speak', undefined);
    expect(read().stack.media.speak).toBeUndefined();
  });
});
