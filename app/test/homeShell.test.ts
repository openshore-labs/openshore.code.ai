// The plain home shell: which host the Terminal room gets, and that the phone's
// host drives only the hub's home-shell terminal routes (no session stream, no
// other server). Also the split "can't reach" vs "pairing turned down" answer.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOME_SHELL_ID } from 'os-code/protocol';
import { canOpenHomeShell, homeShellHost } from '../src/lib/homeShell.js';
import { ElectronDriver } from '../src/drivers/electronDriver.js';
import {
  HUB_UNREACHABLE,
  PAIRING_REJECTED,
  RemoteDriver,
  daemonHealth,
} from '../src/drivers/remoteDriver.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as { window?: unknown }).window;
});

const hub = { baseUrl: 'http://desktop', token: 't' };

describe('homeShellHost', () => {
  it('is never offered to a member device, nor with no computer to open it on', () => {
    expect(canOpenHomeShell({ desktopLocal: false, daemon: hub, member: true })).toBe(false);
    expect(homeShellHost({ desktopLocal: false, daemon: hub, member: true })).toBeUndefined();
    expect(canOpenHomeShell({ desktopLocal: false, member: false })).toBe(false);
    expect(homeShellHost({ desktopLocal: false, member: false })).toBeUndefined();
  });

  it('on the desktop, opens the engine PTY under the reserved home scope', async () => {
    const calls: unknown[][] = [];
    (globalThis as unknown as { window: unknown }).window = {
      oscode: {
        onEvent: () => () => {},
        openTerminal: (...args: unknown[]) => {
          calls.push(args);
          return Promise.resolve({ termId: 'tm1', cols: 80, rows: 24 });
        },
      },
    };
    const host = homeShellHost({ desktopLocal: true, member: false });
    expect(host).toBeInstanceOf(ElectronDriver);
    await host!.openTerminal!({ cols: 80, rows: 24 });
    expect(calls).toEqual([[HOME_SHELL_ID, 80, 24]]);
    host!.dispose();
  });

  it('on a paired phone, hits only the hub home-shell terminal routes', async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return {
        ok: true,
        status: 201,
        json: async () => ({ termId: 'tm1', cols: 80, rows: 24 }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const host = homeShellHost({ desktopLocal: false, daemon: hub, member: false });
    expect(host).toBeInstanceOf(RemoteDriver);
    const opened = await host!.openTerminal!({ cols: 80, rows: 24 });
    host!.dispose();
    expect(opened).toEqual({ termId: 'tm1', cols: 80, rows: 24 });
    expect(urls).toEqual([`http://desktop/sessions/${HOME_SHELL_ID}/term`]);
  });
});

describe('daemonHealth when /health fails outright', () => {
  it('says the pairing was turned down when the computer still answers', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/health')) throw new TypeError('Load failed');
      return { ok: false, status: 400, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;
    const health = await daemonHealth(hub);
    expect(health).toEqual({ ok: false, detail: PAIRING_REJECTED });
  });

  it("says it can't reach the computer when nothing answers", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Load failed');
    }) as unknown as typeof fetch;
    const health = await daemonHealth(hub);
    expect(health).toEqual({ ok: false, detail: HUB_UNREACHABLE });
  });

  it('probes with an empty claim, so the probe can never redeem a pairing code', async () => {
    const bodies: unknown[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/health')) throw new TypeError('Load failed');
      bodies.push(init?.body);
      return { ok: false, status: 400, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;
    await daemonHealth(hub);
    expect(bodies).toEqual(['{}']);
  });
});
