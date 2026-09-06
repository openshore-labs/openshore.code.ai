import { describe, expect, it } from 'vitest';
import {
  harborRef,
  pickVisionRef,
  stackVisionReady,
  visionCapable,
  type AppStack,
  type StackModelRef,
} from '../src/lib/stack.js';

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
