// The first-answer readiness gate. A user's first message must never be sent
// into a brain that cannot answer (no downloaded on-device model, no paired
// computer, no cloud key). These pin the shared definition of "ready" that the
// composer gate and the model sheet both rely on.
import { describe, expect, it } from 'vitest';
import {
  refReady,
  stackReady,
  emptyStack,
  harborRef,
  type ReadinessSignals,
  type AppStack,
  type StackModelRef,
} from '../src/lib/stack.js';

const phone = (downloaded: string[] = [], clouds: string[] = []): ReadinessSignals => ({
  onDeviceHost: true,
  deviceModelReady: (id) => downloaded.includes(id),
  cloudReady: (p) => clouds.includes(p),
});

const desktop = (clouds: string[] = []): ReadinessSignals => ({
  onDeviceHost: false, // a desktop/web build cannot run on-device inference
  deviceModelReady: () => false,
  cloudReady: (p) => clouds.includes(p),
});

describe('source readiness', () => {
  it('a device model is ready only on a device host that has it downloaded', () => {
    const ref: StackModelRef = { kind: 'device', modelId: 'm1', modelName: 'M1' };
    expect(refReady(ref, phone(['m1']))).toBe(true);
    expect(refReady(ref, phone([]))).toBe(false); // not downloaded
    expect(refReady(ref, desktop())).toBe(false); // desktop cannot host it
  });

  it('a cloud ref is ready only when its provider key is present', () => {
    const ref: StackModelRef = { kind: 'cloud', provider: 'anthropic', model: 'x', label: 'X' };
    expect(refReady(ref, desktop(['anthropic']))).toBe(true);
    expect(refReady(ref, desktop([]))).toBe(false);
  });

  it('the default empty stack is NOT ready on desktop (its anchor is on-device)', () => {
    // This is the exact first-run bug: emptyStack points at Harbor Mini, which a
    // desktop build cannot run, so the gate must catch it and open the chooser.
    expect(stackReady(emptyStack(), desktop())).toBe(false);
  });

  it('the default empty stack is ready on a phone once Harbor Mini is downloaded', () => {
    const anchor = harborRef();
    expect(stackReady(emptyStack(), phone([]))).toBe(false); // not downloaded yet
    expect(stackReady(emptyStack(), phone([anchor.kind === 'device' ? anchor.modelId : '']))).toBe(
      true,
    );
  });

  it('a stack with no reasoning anchor is never ready', () => {
    const noAnchor: AppStack = { active: [], saved: {} };
    expect(stackReady(noAnchor, phone(['anything']))).toBe(false);
  });
});
