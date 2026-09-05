// The Electron IPC surface is untrusted input (UI-6): every handler must go
// through the one `guarded` wrapper that checks the sender is the app's own
// bundled page and validates its arguments, so a future XSS in rendered
// markdown can never become code execution in the main process. Read-tests,
// because registering real handlers needs a running Electron.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const main = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8');
const preload = readFileSync(join(process.cwd(), 'electron', 'preload.cjs'), 'utf8');

const channels = (src: string, call: string): string[] =>
  [...src.matchAll(new RegExp(`${call}\\('(osc:[A-Za-z]+)'`, 'g'))].map((m) => m[1]!);

describe('main-process IPC guard (UI-6)', () => {
  it('registers handlers only through guarded()', () => {
    // The one raw registration is inside the wrapper itself.
    const raw = [...main.matchAll(/ipcMain\.handle\(/g)];
    expect(raw).toHaveLength(1);
    const guardedDef = main.indexOf('function guarded');
    expect(guardedDef).toBeGreaterThan(-1);
    const wrapperEnd = main.indexOf('\n}\n', guardedDef);
    expect(raw[0]!.index).toBeGreaterThan(guardedDef);
    expect(raw[0]!.index).toBeLessThan(wrapperEnd);
  });

  it('checks the sender frame against the bundled app entry', () => {
    expect(main).toMatch(/senderFrame\?\.url/);
    expect(main).toMatch(/appEntry\.href/);
  });

  it('every channel the preload invokes is guarded in main, and nothing else is', () => {
    const invoked = channels(preload, 'invoke').sort();
    const guarded = channels(main, 'guarded').sort();
    expect(invoked.length).toBeGreaterThan(40);
    expect(guarded).toEqual(invoked);
  });

  it('type-checks string arguments and requires cwd to be a directory', () => {
    expect(main).toMatch(/typeof v !== 'string'/);
    expect(main).toMatch(/statSync\([^)]*\)\.isDirectory\(\)/);
    // createSession's cwd goes through the directory check.
    expect(main).toMatch(/guarded\('osc:createSession'[\s\S]*?dir\(/);
  });

  it('exposes secureHas so the renderer can tell absent from unreadable (P0-3)', () => {
    expect(preload).toContain("secureHas: invoke('osc:secureHas')");
    expect(main).toMatch(/guarded\('osc:secureHas'/);
  });
});
