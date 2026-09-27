// A phone session revived after the computer restarts keeps the person's
// switches (Personal v1 readiness): Humanize Writing, Memory, and Chain of
// Thought ride into info.json when the session opens and come back on
// rehydrate, the way the project name and standing instructions already do.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDriver, sessionsDir, storedSessionProject } from '../src/daemon/session.js';

let home: string;
const prior = process.env.OSC_HOME;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'osc-switches-'));
  process.env.OSC_HOME = home;
});
afterEach(() => {
  if (prior === undefined) delete process.env.OSC_HOME;
  else process.env.OSC_HOME = prior;
  rmSync(home, { recursive: true, force: true });
});

describe("a revived session keeps the app's switches", () => {
  it('stores them at open and reads them back', () => {
    const driver = new LocalDriver(home, {
      project: {
        projectName: 'Bakery site',
        switches: { humanize: false, memory: false, chainOfThought: true },
      },
      checkpoints: false,
    });
    expect(storedSessionProject(driver.id)).toEqual({
      projectName: 'Bakery site',
      switches: { humanize: false, memory: false, chainOfThought: true },
    });
    // Plain booleans in the file, no content.
    const info = JSON.parse(readFileSync(join(sessionsDir(), driver.id, 'info.json'), 'utf8')) as {
      switches?: unknown;
    };
    expect(info.switches).toEqual({ humanize: false, memory: false, chainOfThought: true });
  });

  it('writes nothing when the app sent no switch', () => {
    const driver = new LocalDriver(home, { project: { switches: {} }, checkpoints: false });
    expect(storedSessionProject(driver.id).switches).toBeUndefined();
  });

  it('bootstrap falls back to the stored switches for a revived session', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'core', 'agent', 'bootstrap.ts'), 'utf8');
    expect(src).toContain('const humanize = options.humanize ?? stored.switches?.humanize;');
    expect(src).toContain('const memorySwitch = options.memory ?? stored.switches?.memory;');
    expect(src).toContain('humanizerEnabled(config.humanizer?.standard, humanize)');
    expect(src).toContain('memoryEnabled(config.memory?.enabled, memorySwitch)');
  });
});
