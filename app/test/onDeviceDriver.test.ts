// G3: the on-device driver must remove its two Llama listeners on dispose, or
// every opened device chat leaks them (retaining the driver and its history).
import { describe, expect, it, vi } from 'vitest';

const { listeners, removed } = vi.hoisted(() => ({
  listeners: [] as string[],
  removed: [] as string[],
}));

vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async (event: string) => {
      listeners.push(event);
      return {
        remove: async () => {
          removed.push(event);
        },
      };
    },
    stop: async () => {},
    load: async () => ({ ok: true }),
    generate: async () => {},
  },
}));

const { OnDeviceDriver } = await import('../src/drivers/onDeviceDriver.js');

describe('OnDeviceDriver listener lifecycle (G3)', () => {
  it('adds two listeners and removes both on dispose', async () => {
    listeners.length = 0;
    removed.length = 0;
    const driver = new OnDeviceDriver('some-model', 'Some Model');
    // attachListeners runs asynchronously in the constructor.
    await new Promise((r) => setTimeout(r, 0));
    expect(listeners.filter((l) => l === 'token' || l === 'generationDone')).toHaveLength(2);

    driver.dispose();
    await new Promise((r) => setTimeout(r, 0));
    expect([...removed].sort()).toEqual(['generationDone', 'token']);
  });
});
