// B6, the driver half: the pocket model's system prompt carries the standing
// instructions the factory hands it, so a project's context reaches the model
// that answers on the phone too.
import { describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({ system: [] as string[] }));

vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async () => ({ remove: async () => {} }),
    stop: async () => {},
    ensureLocal: async () => ({ ready: true }),
    load: async () => ({ ok: true }),
    generate: async ({ system }: { system: string }) => {
      seen.system.push(system);
      return { started: true };
    },
  },
}));

const { OnDeviceDriver } = await import('../src/drivers/onDeviceDriver.js');

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('OnDeviceDriver standing instructions (B6)', () => {
  it('appends the instructions to the system prompt', async () => {
    const driver = new OnDeviceDriver('m1', 'Pocket', undefined, false, 'Answer in French.');
    driver.send('hi');
    await tick();
    await tick();
    expect(seen.system.at(-1)).toContain('Answer in French.');
    driver.dispose();
  });

  it('leaves the prompt alone when there are none', async () => {
    const driver = new OnDeviceDriver('m1', 'Pocket');
    driver.send('hi');
    await tick();
    await tick();
    expect(seen.system.at(-1)).not.toContain('French');
    driver.dispose();
  });
});
