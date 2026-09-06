import { describe, expect, it } from 'vitest';
import {
  defaultVisionCloudRef,
  harborRef,
  pickVisionRef,
  stackVisionReady,
  visionCapable,
  visionSlots,
  type AppStack,
  type StackModelRef,
} from '../src/lib/stack.js';
import { DEFAULT_CLAUDE_MODEL } from '../src/lib/claudeModels.js';

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
  it('the default cloud vision model is the most capable cloud model', () => {
    const ref = defaultVisionCloudRef();
    expect(ref.kind).toBe('cloud');
    expect(ref).toMatchObject({ provider: 'anthropic', model: DEFAULT_CLAUDE_MODEL });
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
