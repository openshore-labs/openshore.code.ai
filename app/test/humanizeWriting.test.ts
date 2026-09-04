// Humanize Writing (Settings toggle): the stack driver holds generated text to
// the plain, honest voice standard by default, drops it when the person turns
// the setting off, and skips on-device pocket models to protect their small
// context. This pins the wiring decision; the standard's content is proven in
// os-code (test/humanizer.test.ts).
import { describe, expect, it } from 'vitest';
import { humanizerApplies } from '../src/drivers/stackDriver.js';
import type { StackModelRef } from '../src/lib/stack.js';

const cloud: StackModelRef = { kind: 'cloud', provider: 'openai', model: 'gpt', label: 'GPT' };
const device: StackModelRef = { kind: 'device', modelId: 'reason', modelName: 'Reasoner' };

describe('Humanize Writing wiring', () => {
  it('is on by default (setting unset) for a cloud model', () => {
    expect(humanizerApplies(cloud, undefined)).toBe(true);
  });

  it('applies when the setting is on', () => {
    expect(humanizerApplies(cloud, true)).toBe(true);
  });

  it('drops out when the person turns it off', () => {
    expect(humanizerApplies(cloud, false)).toBe(false);
  });

  it('skips on-device pocket models to protect their small context', () => {
    expect(humanizerApplies(device, true)).toBe(false);
    expect(humanizerApplies(device, undefined)).toBe(false);
  });
});
