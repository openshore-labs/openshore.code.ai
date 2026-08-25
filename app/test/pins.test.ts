import { describe, expect, it } from 'vitest';
import type { ConversationSource } from '../src/state/types.js';
import { isPinnable, isPinned, pinKey, togglePin } from '../src/lib/pins.js';

const opus: ConversationSource = { kind: 'cloud', provider: 'anthropic', model: 'claude-opus-5' };
const sonnet: ConversationSource = {
  kind: 'cloud',
  provider: 'anthropic',
  model: 'claude-sonnet-5',
};
const device: ConversationSource = { kind: 'device', modelId: 'harbor', modelName: 'Harbor' };

describe('pins', () => {
  it('keys concrete models and rejects the stack and mock', () => {
    expect(pinKey(opus)).toBe('cloud:anthropic:claude-opus-5');
    expect(pinKey(device)).toBe('device:harbor');
    expect(pinKey({ kind: 'stack' })).toBeUndefined();
    expect(pinKey({ kind: 'mock' })).toBeUndefined();
    expect(isPinnable(opus)).toBe(true);
    expect(isPinnable({ kind: 'stack' })).toBe(false);
  });

  it('adds an absent model and removes a present one', () => {
    let pins = togglePin(undefined, opus);
    expect(pins).toHaveLength(1);
    expect(isPinned(pins, opus)).toBe(true);
    expect(isPinned(pins, sonnet)).toBe(false);

    pins = togglePin(pins, sonnet);
    expect(pins).toHaveLength(2);

    pins = togglePin(pins, opus);
    expect(pins.map(pinKey)).toEqual(['cloud:anthropic:claude-sonnet-5']);
  });

  it('never pins an unpinnable source', () => {
    expect(togglePin([opus], { kind: 'stack' })).toEqual([opus]);
  });

  it('matches pins by identity, not object reference', () => {
    const pins = [{ kind: 'cloud', provider: 'anthropic', model: 'claude-opus-5' } as const];
    expect(isPinned(pins, opus)).toBe(true);
  });
});
