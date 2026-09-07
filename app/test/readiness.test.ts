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

const phone = (
  downloaded: string[] = [],
  clouds: string[] = [],
  homeReachable = false,
): ReadinessSignals => ({
  onDeviceHost: true,
  deviceModelReady: (id) => downloaded.includes(id),
  cloudReady: (p) => clouds.includes(p),
  homeReachable,
});

const desktop = (clouds: string[] = [], homeReachable = false): ReadinessSignals => ({
  onDeviceHost: false, // a desktop/web build cannot run on-device inference
  deviceModelReady: () => false,
  cloudReady: (p) => clouds.includes(p),
  homeReachable,
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

  it('a hub model is ready only while the home machine is reachable (docked)', () => {
    // A model pulled onto the hub runs on the hub over Tailscale, so it can only
    // answer while docked. Away from home it benches (unreachable), exactly like
    // the profile system's locationAllowed(profile, "home").
    const ref: StackModelRef = { kind: 'hub', ref: 'qwen3-coder:30b', label: 'Qwen3 Coder 30B' };
    expect(refReady(ref, phone([], [], /* homeReachable */ true))).toBe(true);
    expect(refReady(ref, phone([], [], /* homeReachable */ false))).toBe(false);
    // Its readiness does not depend on the device hosting local inference: it
    // runs on the hub, not this device, so a desktop docked to another hub is
    // ready too.
    expect(refReady(ref, desktop([], /* homeReachable */ true))).toBe(true);
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
