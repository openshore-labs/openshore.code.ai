// Humanize Writing (Settings toggle): the stack driver holds generated text to
// the plain, honest voice standard by default, drops it when the person turns
// the setting off, and skips on-device pocket models to protect their small
// context. This pins the wiring decision; the standard's content is proven in
// os-code (test/humanizer.test.ts).
import { describe, expect, it } from 'vitest';
import { MODEL_CLASSES } from 'os-code/protocol';
import { humanizerApplies } from '../src/drivers/stackDriver.js';
import { cloudHumanizer } from '../src/drivers/cloudChat.js';
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

// The direct cloud chats (a Claude or provider model picked by itself, not
// through the Stack) hold to the same rule as a Stack seat (build 2026-09-29,
// package cloud): the two readings must never drift apart.
describe('Humanize Writing in the direct cloud chats', () => {
  it('agrees with the Stack rule for every setting and seat class', () => {
    for (const humanize of [undefined, true, false]) {
      for (const modelClass of [undefined, ...MODEL_CLASSES]) {
        expect(Boolean(cloudHumanizer(humanize, modelClass)), `${humanize} ${modelClass}`).toBe(
          humanizerApplies(cloud, humanize, modelClass),
        );
      }
    }
  });
});
