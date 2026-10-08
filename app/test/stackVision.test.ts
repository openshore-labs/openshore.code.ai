import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  harborRef,
  pickVisionRef,
  stackVisionReady,
  visionCapable,
  visionSlots,
  type AppStack,
  type StackModelRef,
} from '../src/lib/stack.js';
import {
  DEFAULT_CLAUDE_MODEL,
  claudeModelLabel,
  visionFallbackClaudeModel,
} from '../src/lib/claudeModels.js';
import { PROVIDERS, cloudImageReaders } from '../src/lib/providers.js';
import { ownerFor, type PlayStep } from '../src/lib/play.js';

const claude: StackModelRef = {
  kind: 'cloud',
  provider: 'anthropic',
  model: 'claude-opus-5',
  label: 'Claude',
};
const byom: StackModelRef = {
  kind: 'byom',
  id: 'b1',
  label: 'My server',
  baseUrl: 'http://localhost:1234/v1',
  model: 'local-vl',
};
const device = harborRef();

const reachAll = () => true;
const reachNone = () => false;

describe('visionCapable', () => {
  it('a cloud vision model reads images', () => {
    expect(visionCapable(claude)).toBe(true);
  });
  it('a BYOM endpoint placed for vision is trusted', () => {
    expect(visionCapable(byom)).toBe(true);
  });
  it('an on-device model cannot read images on this build', () => {
    expect(visionCapable(device)).toBe(false);
  });
});

describe('pickVisionRef', () => {
  it('prefers a capable model placed in the vision category', () => {
    const stack: AppStack = {
      reasoning: device,
      active: [{ ref: claude, placement: { category: 'vision' } }],
      saved: {},
    };
    expect(pickVisionRef(stack, reachAll)?.ref).toEqual(claude);
  });

  it('falls back to the reasoning anchor when it can see and no capable specialist is placed', () => {
    const stack: AppStack = {
      reasoning: claude,
      // a local model placed for vision cannot actually read images
      active: [{ ref: device, placement: { category: 'vision' } }],
      saved: {},
    };
    expect(pickVisionRef(stack, reachAll)?.ref).toEqual(claude);
  });

  it('returns nothing when only device models are present', () => {
    const stack: AppStack = {
      reasoning: device,
      active: [{ ref: device, placement: { category: 'vision' } }],
      saved: {},
    };
    expect(pickVisionRef(stack, reachAll)).toBeUndefined();
  });

  it('returns nothing when the only capable model is unreachable', () => {
    const stack: AppStack = { reasoning: claude, active: [], saved: {} };
    expect(pickVisionRef(stack, reachNone)).toBeUndefined();
  });
});

describe('stackVisionReady', () => {
  const deviceOnly: AppStack = { reasoning: device, active: [], saved: {} };

  it('is true when a capable model sits in the stack', () => {
    const stack: AppStack = { reasoning: claude, active: [], saved: {} };
    expect(
      stackVisionReady(stack, { reachable: reachAll, cloudReachable: true, connected: () => true }),
    ).toBe(true);
  });

  it('falls back to a connected cloud provider when nothing capable is placed', () => {
    expect(
      stackVisionReady(deviceOnly, {
        reachable: reachAll,
        cloudReachable: true,
        connected: (p) => p === 'anthropic',
      }),
    ).toBe(true);
  });

  it('is false when cloud is out of reach (offline) and only a local model is placed', () => {
    expect(
      stackVisionReady(deviceOnly, {
        reachable: (r) => r.kind === 'device',
        cloudReachable: false,
        connected: () => true,
      }),
    ).toBe(false);
  });

  it('is false when no cloud provider is connected and nothing capable is placed', () => {
    expect(
      stackVisionReady(deviceOnly, {
        reachable: reachAll,
        cloudReachable: true,
        connected: () => false,
      }),
    ).toBe(false);
  });
});

describe('visionSlots and the default cloud position', () => {
  // D13 (founder, 2026-10-07, B): until the person chooses one, an image goes
  // to the least costly Claude model, and every surface names it. This
  // reverses the 2026-09-25 "most capable cloud model" default the old pin
  // held (Opus 5).
  it('reads images on the least costly Claude model until one is chosen, named', () => {
    const [first] = cloudImageReaders();
    const claude = visionFallbackClaudeModel();
    expect(first).toEqual({
      provider: 'anthropic',
      model: claude.id,
      label: `Claude ${claudeModelLabel(claude.id)}`,
    });
    expect(first!.label).toBe('Claude Haiku 4.5');
    expect(first!.model).not.toBe(DEFAULT_CLAUDE_MODEL);
  });

  it('tries each other provider with an image model after Claude, named once', () => {
    const readers = cloudImageReaders();
    const withVision = PROVIDERS.filter(
      (p) => p.id !== 'anthropic' && p.models.some((m) => m.categories?.includes('vision')),
    );
    expect(readers.slice(1).map((r) => r.provider)).toEqual(withVision.map((p) => p.id));
    for (const r of readers) {
      // "Gemini 2.5 Pro", never "Gemini Gemini 2.5 Pro".
      const brand = PROVIDERS.find((p) => p.id === r.provider)!.name.split(' ')[0]!;
      expect(r.label.split(brand).length - 1, r.label).toBe(1);
    }
  });

  // A plan never carries a picture (CX and CMO, 2026-10-08, E): an unplaced
  // vision step goes to the Reasoning model, never to the reader a picture
  // in the chat would go to.
  it('a play keeps an unplaced vision step on the Reasoning model, whatever the chat would use', () => {
    const step: PlayStep = {
      id: 's',
      title: 'Read it',
      category: 'vision',
      brief: '',
      dependsOn: [],
    };
    const reader: StackModelRef = { kind: 'cloud', ...cloudImageReaders()[0]! };
    const stack: AppStack = { reasoning: harborRef(), active: [], saved: {} };
    expect(ownerFor(step, { ...stack, imageReader: reader })).toEqual({
      ref: harborRef(),
      placement: undefined,
      fellBack: true,
    });
    // With no reader in reach, the anchor covers the step, and says so.
    expect(ownerFor(step, stack)).toMatchObject({ ref: harborRef(), fellBack: true });
    // A filled slot still wins over the reader.
    const placed: AppStack = {
      ...stack,
      active: [{ ref: claude, placement: { category: 'vision' } }],
    };
    expect(ownerFor(step, { ...placed, imageReader: reader }).ref).toEqual(claude);
  });

  it("the driver gives a play the chat path's own reader, and asks the shared list", () => {
    const src = readFileSync(new URL('../src/drivers/stackDriver.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/imageReader: \(await this\.routeVision\(\)\)\?\.ref/);
    expect(src).toMatch(/executePlay\([^;]*roster,\s*planLocalOnly,?\s*\)/);
    expect(src).toMatch(/for \(const reader of cloudImageReaders\(\)\)/);
    // No vision path names Opus as its default any more.
    expect(readFileSync(new URL('../src/lib/play.ts', import.meta.url), 'utf8')).not.toMatch(
      /defaultVisionCloudRef/,
    );
  });

  it('splits vision placements into a local slot and a cloud slot', () => {
    const stack: AppStack = {
      reasoning: harborRef(),
      active: [
        { ref: device, placement: { category: 'vision', effort: 'low' } },
        { ref: claude, placement: { category: 'vision', effort: 'high' } },
        { ref: byom, placement: { category: 'coding' } },
      ],
      saved: {},
    };
    const slots = visionSlots(stack);
    expect(slots.local?.ref).toEqual(device);
    expect(slots.cloud?.ref).toEqual(claude);
    // A BYOM model counts as local (your own server), not the cloud slot.
    expect(
      visionSlots({ ...stack, active: [{ ref: byom, placement: { category: 'vision' } }] }).local
        ?.ref,
    ).toEqual(byom);
  });

  it('prefers the local slot over the cloud slot when the local model can see', () => {
    // A BYOM vision model in the local slot wins over a cloud model.
    const stack: AppStack = {
      reasoning: harborRef(),
      active: [
        { ref: claude, placement: { category: 'vision' } },
        { ref: byom, placement: { category: 'vision', effort: 'medium' } },
      ],
      saved: {},
    };
    const pick = pickVisionRef(stack, reachAll);
    expect(pick?.ref).toEqual(byom);
    expect(pick?.placement?.effort).toBe('medium');
  });

  it('carries the placement effort through for the cloud slot', () => {
    const stack: AppStack = {
      reasoning: harborRef(),
      active: [{ ref: claude, placement: { category: 'vision', effort: 'high' } }],
      saved: {},
    };
    expect(pickVisionRef(stack, reachAll)?.placement?.effort).toBe('high');
  });
});
