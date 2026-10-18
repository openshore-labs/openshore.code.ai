// Harbor reads pictures (founder, 2026-10-18): Qwen3.5 4B with its vision file,
// through the runner's mtmd path. These hold the JS half: Harbor alone among
// device models passes the vision gates, and only while its vision file is on
// the device; a Harbor chat loads with the wider window and the vision file;
// the newest pictures ride their turn (a video's frames spread across at most
// four) and count against the window; and the Swift half keeps the same
// picture cap, the same contract, and no trace of the text-only wrapper.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attachment } from '../src/lib/attachments.js';

const { calls, generates, loads, handlers } = vi.hoisted(() => ({
  calls: [] as string[],
  generates: [] as Array<Record<string, unknown>>,
  loads: [] as Array<Record<string, unknown>>,
  handlers: new Map<string, (data: unknown) => void>(),
}));

vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async (event: string, cb: (data: unknown) => void) => {
      handlers.set(event, cb);
      return { remove: async () => {} };
    },
    stop: async () => {},
    ensureLocal: async () => ({ ready: true }),
    load: async (options: Record<string, unknown>) => {
      calls.push(`load:${String(options.id)}`);
      loads.push(options);
      return { ok: true };
    },
    generate: async (options: Record<string, unknown>) => {
      generates.push(options);
      return { started: true };
    },
  },
}));

const {
  HARBOR_CONTEXT_TOKENS,
  HARBOR_IMAGE_TOKENS,
  HARBOR_MAX_IMAGES,
  HARBOR_MODEL_ID,
  HARBOR_PICTURE_NOTE,
  HARBOR_SAMPLING,
  HARBOR_VISION_MODEL_ID,
  buildHarborSystemPrompt,
  setHarborVision,
} = await import('../src/lib/harbor.js');
const {
  DEVICE_CONTEXT_TOKENS,
  EARLIER_PICTURES_NOTE,
  deviceLoadFor,
  deviceMessages,
  devicePictures,
  deviceSamplingFor,
  forgetDeviceModel,
} = await import('../src/drivers/deviceModel.js');
const { visionCapable } = await import('../src/lib/stack.js');
const { sourceSupportsVision } = await import('../src/state/types.js');
const { OnDeviceDriver } = await import('../src/drivers/onDeviceDriver.js');

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

function image(name: string, base64 = name): Attachment {
  return {
    id: name,
    name,
    mime: 'image/jpeg',
    dataUrl: `data:image/jpeg;base64,${base64}`,
    isImage: true,
  };
}
function frame(i: number, count: number): Attachment {
  return {
    ...image(`f${i}`),
    frame: { groupId: 'g', videoName: 'clip.mov', index: i, count, timeSec: i },
  };
}

afterEach(() => setHarborVision(false));

describe('the vision gates', () => {
  it('pass Harbor only while its vision file is here, and no other device model', () => {
    const harbor = { kind: 'device' as const, modelId: HARBOR_MODEL_ID, modelName: 'Harbor' };
    const other = { kind: 'device' as const, modelId: 'qwen3-4b-phone', modelName: 'Qwen' };
    expect(visionCapable(harbor)).toBe(false);
    expect(sourceSupportsVision(harbor)).toBe(false);
    setHarborVision(true);
    expect(visionCapable(harbor)).toBe(true);
    expect(sourceSupportsVision(harbor)).toBe(true);
    expect(visionCapable(other)).toBe(false);
    expect(sourceSupportsVision(other)).toBe(false);
  });

  it('tell Harbor how to read a picture only while it can see one', () => {
    expect(buildHarborSystemPrompt(true)).not.toContain(HARBOR_PICTURE_NOTE);
    setHarborVision(true);
    expect(buildHarborSystemPrompt(true)).toContain(HARBOR_PICTURE_NOTE);
  });
});

describe('how a device model loads and samples', () => {
  it('gives Harbor the wider window and its vision file, and the rest the default', () => {
    expect(deviceLoadFor(HARBOR_MODEL_ID)).toEqual({ contextSize: HARBOR_CONTEXT_TOKENS });
    setHarborVision(true);
    expect(deviceLoadFor(HARBOR_MODEL_ID)).toEqual({
      contextSize: HARBOR_CONTEXT_TOKENS,
      visionId: HARBOR_VISION_MODEL_ID,
    });
    expect(deviceLoadFor('harbor-mini')).toEqual({ contextSize: DEVICE_CONTEXT_TOKENS });
  });

  it("samples Harbor on Qwen's own numbers and others on the caller's temperature", () => {
    expect(deviceSamplingFor(HARBOR_MODEL_ID, 0.4)).toEqual(HARBOR_SAMPLING);
    expect(deviceSamplingFor('other', 0.4)).toEqual({ temperature: 0.4 });
  });
});

describe('the pictures a device turn carries', () => {
  it('takes the images as base64 and leaves other files out', () => {
    const file: Attachment = { ...image('notes.txt'), isImage: false };
    expect(devicePictures([image('a', 'AAA'), file])).toEqual(['AAA']);
    expect(devicePictures(undefined)).toEqual([]);
  });

  it("spreads a video's frames across the cap, first and last kept", () => {
    const frames = Array.from({ length: 10 }, (_, i) => frame(i + 1, 10));
    const picked = devicePictures(frames);
    expect(picked).toHaveLength(HARBOR_MAX_IMAGES);
    expect(picked[0]).toBe('f1');
    expect(picked.at(-1)).toBe('f10');
    expect(new Set(picked).size).toBe(picked.length);
  });

  it('sends only the newest pictures, notes the older ones, and counts them against the window', () => {
    const history = [
      { role: 'user' as const, content: 'first', images: ['OLD'] },
      { role: 'assistant' as const, content: 'saw it' },
      { role: 'user' as const, content: 'and this', images: ['NEW1', 'NEW2'] },
    ];
    const sent = deviceMessages('system', history, 768, HARBOR_CONTEXT_TOKENS);
    expect(sent[0]).toEqual({ role: 'user', content: `${EARLIER_PICTURES_NOTE}\nfirst` });
    expect(sent[2]).toEqual({ role: 'user', content: 'and this', images: ['NEW1', 'NEW2'] });
    // A window with room for the words but not the two pictures drops the
    // older turns first, never the live one.
    const tight = deviceMessages('s', history, 0, 2 * HARBOR_IMAGE_TOKENS + 20);
    expect(tight).toHaveLength(1);
    expect(tight[0]!.images).toEqual(['NEW1', 'NEW2']);
  });
});

describe('a Harbor chat on this device', () => {
  beforeEach(() => {
    calls.length = 0;
    generates.length = 0;
    loads.length = 0;
    forgetDeviceModel();
  });

  it('loads with the vision file and sends the pictures with the turn', async () => {
    setHarborVision(true);
    const driver = new OnDeviceDriver(HARBOR_MODEL_ID, 'Harbor');
    await tick();
    driver.send('What error is this?', [image('shot', 'PNGDATA')]);
    for (let i = 0; i < 6; i++) await tick();
    expect(loads[0]).toMatchObject({
      id: HARBOR_MODEL_ID,
      contextSize: HARBOR_CONTEXT_TOKENS,
      visionId: HARBOR_VISION_MODEL_ID,
    });
    const sent = generates[0]!;
    const messages = sent.messages as Array<{ content: string; images?: string[] }>;
    expect(messages.at(-1)).toEqual({
      role: 'user',
      content: 'What error is this?',
      images: ['PNGDATA'],
    });
    expect(sent).toMatchObject({ ...HARBOR_SAMPLING, thinking: false });
    expect(String(sent.system)).toContain(HARBOR_PICTURE_NOTE);
    driver.dispose();
  });

  it('sends no picture while the vision file is missing', async () => {
    const driver = new OnDeviceDriver(HARBOR_MODEL_ID, 'Harbor');
    await tick();
    driver.send('hi', [image('shot')]);
    for (let i = 0; i < 6; i++) await tick();
    expect(loads[0]).not.toHaveProperty('visionId');
    const messages = generates[0]!.messages as Array<{ images?: string[] }>;
    expect(messages.at(-1)).not.toHaveProperty('images');
    driver.dispose();
  });
});

describe('the Swift half', () => {
  const plugin = 'plugins/oscode-llama';
  const runner = read(`${plugin}/ios/Sources/OscodeLlamaPlugin/LlamaRunner.swift`);
  const bridge = read(`${plugin}/ios/Sources/OscodeLlamaPlugin/OscodeLlamaPlugin.swift`);
  const pkg = read(`${plugin}/Package.swift`);

  it('caps a picture at the same tokens the JS side counts', () => {
    expect(runner).toContain(`static let imageMaxTokens: Int32 = ${HARBOR_IMAGE_TOKENS}`);
    expect(runner).toContain('params.image_max_tokens = LlamaRunner.imageMaxTokens');
  });

  it('links llama.cpp directly, pinned, with no trace of the text-only wrapper', () => {
    expect(pkg).not.toMatch(/eastriverlee\/LLM\.swift/);
    expect(pkg).toMatch(/releases\/download\/b\d+\/llama-b\d+-xcframework\.zip/);
    expect(pkg).toMatch(/checksum: "[0-9a-f]{64}"/);
    expect(runner).toMatch(/^import llama$/m);
    expect(runner).not.toMatch(/^import LLM$/m);
  });

  it('reads the same fields the JS contract sends', () => {
    for (const key of [
      'visionId',
      'images',
      'maxTokens',
      'temperature',
      'topK',
      'topP',
      'minP',
      'repeatPenalty',
      'thinking',
    ]) {
      expect(bridge, key).toContain(`"${key}"`);
    }
  });
});
