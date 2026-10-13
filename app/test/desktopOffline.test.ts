// Desktop Offline (2026-10-07): "Desktop app can use offline when
// there is no internet and it needs to use just the local models, where the
// cloud connections are no longer viable options for work." The app's half,
// pinned without Electron: main's network watch (Electron's own read and the
// person's choice, one reason for the engine), the bridge and the IPC that
// carry it, the engine host that sets the engine's one machine flag, the
// Status sheet's words on the computer itself, and the plain lines every room
// says while cloud models wait. No em dash in any of them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NetworkWatch, offlineReason } from '../electron/networkWatch.js';
import {
  CLOUD_SHEET_OFFLINE,
  CLOUD_WAITS,
  LOCAL_MODEL_READY,
  cloudWaitLine,
  computerOfflineNote,
  computerOfflineOf,
  connectionsOfflineLine,
  desktopOnline,
  desktopStackNote,
  installLocalDoor,
  keyCheckWaits,
  localModelFailedLine,
  networkUp,
  offlineBannerLine,
  offlineChosen,
  offlineNoSeatSub,
  offlineNow,
  offlineSeatSub,
  reasoningSlotSub,
  reportDesktopOffline,
  usablePick,
} from '../src/state/offlineOps.js';
import { profileBlurb, profileUnavailable } from '../src/lib/profiles.js';

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

// The engine host below runs in a throwaway engine home, never the real one.
process.env.OSC_HOME = mkdtempSync(join(tmpdir(), 'osc-home-offline-'));
const EM_DASH = String.fromCharCode(0x2014);
const NO_EM_DASH = new RegExp([EM_DASH, '&' + 'mdash;', '&#x' + '2014;', '&#' + '8212;'].join('|'));

describe("main's network watch", () => {
  it('no network wins over a choice; a choice alone is chosen; else online', () => {
    expect(offlineReason(false, false)).toBe('network');
    expect(offlineReason(false, true)).toBe('network');
    expect(offlineReason(true, true)).toBe('chosen');
    expect(offlineReason(true, false)).toBeUndefined();
  });

  it('tells the engine only on a change, and the window when the network flips', () => {
    let online = true;
    const apply = vi.fn();
    const notify = vi.fn();
    const watch = new NetworkWatch({ isOnline: () => online, apply, notify });
    expect(watch.tick()).toEqual({ online: true, offline: false });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith(undefined);
    watch.tick();
    expect(apply).toHaveBeenCalledTimes(1);

    online = false;
    expect(watch.tick()).toEqual({ online: false, offline: true, reason: 'network' });
    expect(apply).toHaveBeenLastCalledWith('network');
    expect(notify).toHaveBeenLastCalledWith(false);

    online = true;
    watch.tick();
    expect(apply).toHaveBeenLastCalledWith(undefined);
    expect(notify).toHaveBeenLastCalledWith(true);
  });

  it("the person's choice reaches the engine at once, and back", () => {
    const apply = vi.fn();
    const watch = new NetworkWatch({ isOnline: () => true, apply, notify: () => {} });
    expect(watch.choose(true)).toEqual({ online: true, offline: true, reason: 'chosen' });
    expect(apply).toHaveBeenLastCalledWith('chosen');
    expect(watch.choose(false)).toEqual({ online: true, offline: false });
    expect(apply).toHaveBeenLastCalledWith(undefined);
  });

  it('a read that throws counts as online, so a quirk never strands the person', () => {
    const watch = new NetworkWatch({
      isOnline: () => {
        throw new Error('not ready');
      },
      apply: () => {},
      notify: () => {},
    });
    expect(watch.tick().online).toBe(true);
  });

  it('a window that cannot take the message never throws out of the poll, and the engine still hears', () => {
    const apply = vi.fn();
    const watch = new NetworkWatch({
      isOnline: () => false,
      apply,
      notify: () => {
        throw new Error('Object has been destroyed');
      },
    });
    expect(() => watch.tick()).not.toThrow();
    expect(apply).toHaveBeenLastCalledWith('network');
  });
});

describe('the wiring: main, the preload and the bridge', () => {
  const main = read('electron', 'main.ts');
  const preload = read('electron', 'preload.cjs');
  const bridgeTypes = read('src', 'lib', 'electronBridge.ts');

  it('main reads Electron net, polls, rereads on wake, and takes only a boolean', () => {
    expect(main).toMatch(/isOnline: \(\) => net\.isOnline\(\)/);
    expect(main).toMatch(/apply: \(reason\) => host\.setOffline\(reason\)/);
    expect(main).toMatch(/webContents\.send\('osc:network', \{ online \}\)/);
    expect(main).toMatch(
      /guarded\('osc:setOffline', \(chosen: unknown\) => network\.choose\(bool\(chosen\)\)\)/,
    );
    expect(main).toMatch(/setInterval\(\(\) => network\.tick\(\), 3000\)/);
    expect(main).toMatch(/powerMonitor\.on\('resume', \(\) => network\.tick\(\)\)/);
  });

  it('the preload and the typed bridge carry the choice and the network', () => {
    expect(preload).toContain("setOffline: invoke('osc:setOffline')");
    expect(preload).toContain("onNetwork: listen('osc:network')");
    expect(bridgeTypes).toMatch(/setOffline\?\(chosen: boolean\): Promise<DesktopOfflineAnswer>/);
    expect(bridgeTypes).toMatch(/onNetwork\?\(cb: \(payload: \{ online: boolean \}\) => void\)/);
  });
});

describe("the engine host sets the engine's one machine flag", () => {
  afterEach(async () => {
    const { setMachineOffline } = await import('os-code/dist/src/core/agent/offline.js');
    setMachineOffline(undefined);
  });

  it('every session this process hosts reads what main set', async () => {
    const { EngineHost } = await import('../electron/engineHost.js');
    const { machineOffline } = await import('os-code/dist/src/core/agent/offline.js');
    const host = new EngineHost(
      () => {},
      () => {},
      () => {},
      { tailscale: () => ({ running: false, ip: undefined }) },
    );
    expect(host.setOffline('network')).toEqual({ offline: true, reason: 'network' });
    expect(machineOffline()).toEqual({ offline: true, reason: 'network' });
    host.setOffline(undefined);
    expect(host.offline()).toEqual({ offline: false });
    host.disposeAll();
  });

  it("status judges the orchestrator's kind by address, never by a label", () => {
    const host = read('electron', 'engineHost.ts');
    // As a seat (privacy review, 2026-10-08): its server's address, and its
    // model's name, since an Ollama cloud tag answers on ollama.com.
    expect(host).toMatch(
      /seatLeaves\(providers\.get\(orchestratorId\), stackConfig\.orchestrator\?\.model/,
    );
    expect(host).not.toMatch(
      /kind: \(config\.providers\[stackConfig\.orchestrator\.provider\]\?\.kind === 'anthropic'/,
    );
  });
});

describe('what counts as offline here', () => {
  const up = { homeReachable: false, online: true };
  const down = { homeReachable: false, online: false };

  it('the connection or the choice, one rule for every room', () => {
    expect(offlineNow(up)).toBe(false);
    expect(offlineNow(down)).toBe(true);
    expect(offlineNow(up, 'offline')).toBe(true);
    expect(offlineChosen(up, 'offline')).toBe(true);
    // A dropped connection is the connection's Offline, chosen or not.
    expect(offlineChosen(down, 'offline')).toBe(false);
    // Before the store has read the connection, it is taken as up.
    expect(offlineNow(undefined)).toBe(false);
    expect(networkUp(undefined)).toBe(true);
    expect(networkUp(down)).toBe(false);
  });

  it("the window's read and main's both count", () => {
    expect(desktopOnline(true, undefined)).toBe(true);
    expect(desktopOnline(true, false)).toBe(false);
    expect(desktopOnline(false, true)).toBe(false);
  });

  it("reports the choice to main and takes main's read back; no bridge, no read", async () => {
    const setOffline = vi.fn(async (chosen: boolean) => ({
      online: false,
      offline: true,
      ...(chosen ? {} : { reason: 'network' as const }),
    }));
    expect(await reportDesktopOffline({ setOffline }, true)).toBe(false);
    expect(setOffline).toHaveBeenCalledWith(true);
    expect(await reportDesktopOffline(undefined, true)).toBeUndefined();
    expect(await reportDesktopOffline({}, false)).toBeUndefined();
    const failing = { setOffline: async () => Promise.reject(new Error('gone')) };
    expect(await reportDesktopOffline(failing, false)).toBeUndefined();
  });

  it('a new chat never starts on a cloud pick while offline', () => {
    const cloud = { kind: 'cloud' as const, provider: 'anthropic', model: 'claude-x' };
    expect(usablePick(cloud, true)).toBeUndefined();
    expect(usablePick(cloud, false)).toEqual(cloud);
    expect(usablePick({ kind: 'desktop' }, true)).toEqual({ kind: 'desktop' });
  });
});

describe('the Status sheet on the computer itself', () => {
  it('Docked says it is not used here; Offshore says there is no connection right now', () => {
    expect(profileBlurb('docked', true, true)).toBe(
      'For your phone, when it reaches this computer. Not used here.',
    );
    expect(profileUnavailable('docked', false, true, true)).toBe('');
    expect(profileBlurb('offshore', true, true)).toBe(
      "Online. Cloud models and this computer's models.",
    );
    // "Online." then "No connection right now.": the row says what it needs
    // and that it is missing, never that it is online and waiting at once.
    expect(profileUnavailable('offshore', false, true, true)).toBe(' No connection right now.');
    expect(profileBlurb('offline', true, true)).toBe(
      "Only this computer's models. Cloud models wait for a connection.",
    );
    // A phone keeps its own words.
    expect(profileUnavailable('docked', false, true)).toBe(' Not reachable right now.');
    expect(profileBlurb('offline', true)).toBe(
      'Only the models on this device. Your computer and cloud models wait.',
    );
    // True whether the network is down or Offline was chosen, and before a
    // computer is connected it never speaks of one.
    expect(profileBlurb('offline', false)).toBe(
      'Only the models on this device. Cloud models wait.',
    );
  });
});

describe('the lines each room says', () => {
  it('true on the desktop and a phone, plain, no em dash, never hub', () => {
    const lines = [
      CLOUD_WAITS,
      CLOUD_SHEET_OFFLINE,
      LOCAL_MODEL_READY,
      cloudWaitLine('Opus 5', false, 'this computer'),
      cloudWaitLine('Opus 5', true, 'this phone'),
      connectionsOfflineLine(false),
      connectionsOfflineLine(true),
      desktopStackNote(false, false),
      desktopStackNote(true, false),
      desktopStackNote(true, true),
      desktopStackNote(true, true, false),
      keyCheckWaits('Claude'),
      profileBlurb('docked', true, true),
    ];
    for (const line of lines) {
      expect(line, line).not.toMatch(NO_EM_DASH);
      expect(line, line).not.toMatch(/\bhub\b/i);
    }
    expect(cloudWaitLine('Opus 5', false, 'this computer')).toBe(
      'Offline, so Opus 5 waits for a connection. Choose a model on this computer to keep going, or try again once you are online.',
    );
    expect(desktopStackNote(true, false)).toMatch(/Cloud models wait for a connection\.$/);
    // Once the engine names no model that answers offline, the line says so.
    expect(desktopStackNote(true, false, true)).toBe(desktopStackNote(true, false));
    expect(desktopStackNote(true, false, false)).toBe(
      'Offline. No model on this computer can answer yet. Cloud models wait for a connection.',
    );
    expect(desktopStackNote(true, true, false)).toBe(
      'Offline, by your choice. No model on this computer can answer yet. Cloud models wait until you follow the connection again.',
    );
    expect(desktopStackNote(false, false, false)).toBe(desktopStackNote(false, false));
    expect(connectionsOfflineLine(false)).toMatch(/wait for a connection/);
    expect(keyCheckWaits('Claude')).toBe(
      'Saving checks the key with Claude, so it waits for a connection.',
    );
  });

  it("the Stack's reasoning slot says a cloud model waits, and names who answers meanwhile", () => {
    expect(reasoningSlotSub(false, true, 'qwen2.5-coder:7b')).toBe(
      'Reasoning model · Plans every task and routes it.',
    );
    expect(reasoningSlotSub(true, false, 'qwen2.5-coder:7b')).toBe(
      'Reasoning model · Plans every task and routes it.',
    );
    expect(reasoningSlotSub(true, true, 'qwen2.5-coder:7b')).toBe(
      'Reasoning model · Waits for a connection. qwen2.5-coder:7b on this computer answers for now.',
    );
    expect(reasoningSlotSub(true, true)).toMatch(/No model on this computer can answer yet\.$/);
  });

  it('the install door: desktop only, only with the network up, its words follow the download', () => {
    expect(installLocalDoor({ desktop: false, networkUp: true })).toBeUndefined();
    expect(installLocalDoor({ desktop: true, networkUp: false })).toBeUndefined();
    expect(installLocalDoor({ desktop: true, networkUp: true })).toEqual({
      label: 'Install DeepBlue',
      busy: false,
    });
    expect(
      installLocalDoor({ desktop: true, networkUp: true, download: { label: '42%' } }),
    ).toEqual({ label: 'Getting DeepBlue, 42%', busy: true });
    // After a failed download the door is the way on its line names.
    expect(
      installLocalDoor({
        desktop: true,
        networkUp: true,
        download: { label: 'Could not download DeepBlue. Try again.', failed: true },
      }),
    ).toEqual({ label: 'Try DeepBlue again', busy: false });
  });
});

describe('the chat banner while offline', () => {
  const line = (desktop: boolean, paired: boolean, chosen: boolean) =>
    offlineBannerLine({ desktop, paired, chosen, here: 'this phone' });

  it('keeps the network-down words', () => {
    expect(line(true, false, false)).toBe(
      'Offline. Models on this computer still answer. Cloud models wait for a connection.',
    );
    expect(line(false, true, false)).toBe(
      'Offline. Models on this phone still answer. Your computer and cloud models wait for a connection.',
    );
    expect(line(false, false, false)).toBe(
      'Offline. Models on this phone still answer. Cloud models wait for a connection.',
    );
  });

  it('says a chosen Offline is a choice, not a fault, and how to undo it', () => {
    for (const desktop of [true, false]) {
      for (const paired of [true, false]) {
        const chosen = line(desktop, paired, true);
        expect(chosen).toMatch(/^Offline, by your choice\./);
        expect(chosen).toContain('until you follow the connection again');
        expect(chosen).not.toContain(EM_DASH);
      }
    }
    // Before a computer is connected, a phone's banner never speaks of one.
    expect(line(false, false, true)).not.toMatch(/computer/);
    expect(line(true, false, true)).toContain('Models on this computer answer.');
  });
});

describe('a paired computer that works offline (Desktop Offline follow-up)', () => {
  it('reads why from what its daemon answers; an older daemon reads as online', () => {
    expect(computerOfflineOf({ ok: true, offline: 'network' })).toBe('network');
    expect(computerOfflineOf({ ok: true, offline: 'chosen' })).toBe('chosen');
    expect(computerOfflineOf({ ok: true })).toBeUndefined();
    expect(computerOfflineOf({ offline: true })).toBeUndefined();
    expect(computerOfflineOf(null)).toBeUndefined();
    expect(computerOfflineOf(undefined)).toBeUndefined();
  });

  it("the phone's Stack: its cloud models wait, and whether its own models answer", () => {
    expect(computerOfflineNote('network', true)).toBe(
      'Connected to your computer, which is offline. Models on your computer still answer. Its cloud models wait for its connection.',
    );
    expect(computerOfflineNote('network', false)).toBe(
      'Connected to your computer, which is offline. No model on your computer can answer yet. Its cloud models wait for its connection.',
    );
    // Before the computer has said, the line claims nothing about its models.
    expect(computerOfflineNote('network', undefined)).toBe(
      'Connected to your computer, which is offline. Its cloud models wait for its connection.',
    );
    expect(computerOfflineNote('chosen', true)).toBe(
      'Connected to your computer, which is offline by your choice. Models on your computer answer. Its cloud models wait until you follow the connection there.',
    );
    for (const reason of ['network', 'chosen'] as const) {
      for (const seat of [true, false, undefined]) {
        const line = computerOfflineNote(reason, seat);
        expect(line, line).not.toMatch(NO_EM_DASH);
        expect(line, line).not.toMatch(/\bhub\b|this phone|this device/i);
      }
    }
  });

  it('the model sheet names the model that answers there, or says none can yet', () => {
    expect(offlineSeatSub('qwen2.5-coder:7b', 'your computer')).toBe(
      'Offline, so qwen2.5-coder:7b on your computer answers for now',
    );
    expect(offlineSeatSub('qwen3:4b', 'this computer')).toBe(
      'Offline, so qwen3:4b on this computer answers for now',
    );
    expect(offlineNoSeatSub('your computer')).toBe(
      'Offline, and no model on your computer can answer yet.',
    );
  });
});

describe('a DeepBlue download that fails (Desktop Offline follow-up)', () => {
  it('with no network, its words stay as they were', () => {
    expect(localModelFailedLine(false)).toBe(
      'Offline. DeepBlue downloads once you are back online.',
    );
    expect(
      localModelFailedLine(true, { detail: 'Offline. Models download...', reason: 'offline' }),
    ).toBe('Offline. DeepBlue downloads once you are back online.');
  });

  it('with the network up: what failed, by name, and the way on; never the raw error', () => {
    const raw = 'The download of qwen2.5-coder:7b stopped partway. Try again.';
    expect(localModelFailedLine(true, { detail: raw, reason: 'stopped' })).toBe(
      'The download of DeepBlue stopped partway. Try again.',
    );
    // DeepBlue's lines show on the computer itself, so they name it as the
    // desktop's rooms do.
    expect(localModelFailedLine(true, { detail: raw, reason: 'disk' })).toBe(
      'Not enough disk space on this computer for DeepBlue. Free some space, then try again.',
    );
    expect(localModelFailedLine(true, { detail: raw, reason: 'unreachable' })).toBe(
      'Could not reach the Ollama library from this computer. Check its internet connection, then try again.',
    );
    expect(localModelFailedLine(true, { detail: raw, reason: 'update' })).toBe(
      'DeepBlue needs a newer Ollama on this computer. Update Ollama, then try again.',
    );
    // A name the Ollama library lacks is the catalog's, never the person's to check.
    expect(localModelFailedLine(true, { detail: raw, reason: 'not-found' })).toBe(
      'Could not download DeepBlue. Try again.',
    );
    // A bridge that failed outright still reads plainly.
    expect(localModelFailedLine(true)).toBe('Could not download DeepBlue. Try again.');
  });
});

describe("the engine host's status judges local by address (Desktop Offline follow-up)", () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
    rmSync(join(process.env.OSC_HOME!, 'config.json'), { force: true });
  });

  /** A model server on this computer that answers as Ollama does. */
  async function fakeOllama(models: string[]): Promise<string> {
    server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/version') return void res.end(JSON.stringify({ version: '0.6.0' }));
      if (req.url === '/api/tags') {
        return void res.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("lists the server on this network, never a hosted one first in line, and names the engine's offline seat", async () => {
    const local = await fakeOllama(['nomic-embed-text', 'qwen3:4b', 'qwen2.5-coder:7b']);
    writeFileSync(
      join(process.env.OSC_HOME!, 'config.json'),
      JSON.stringify({
        providers: {
          // Its kind label says local; its address leaves this network.
          hosted: { kind: 'openai-compatible', baseUrl: 'https://models.example.invalid/v1' },
          anthropic: { kind: 'anthropic', model: 'claude-sonnet-5' },
          ollama: { kind: 'openai-compatible', baseUrl: local },
        },
        stack: { orchestrator: { provider: 'anthropic', model: 'claude-sonnet-5' } },
      }),
    );
    const { EngineHost } = await import('../electron/engineHost.js');
    const host = new EngineHost(
      () => {},
      () => {},
      () => {},
      { tailscale: () => ({ running: false, ip: undefined }) },
    );
    const status = await host.status();
    expect(status.ollama.models).toEqual(['nomic-embed-text', 'qwen3:4b', 'qwen2.5-coder:7b']);
    expect(status.stack.orchestrator?.kind).toBe('cloud');
    expect(status.offlineSeat).toEqual({ model: 'qwen2.5-coder:7b', provider: 'ollama' });
    host.disposeAll();
  });

  it('pulls and Stack picks land on that same server, judged by address', () => {
    const host = read('electron', 'engineHost.ts');
    expect(host).toMatch(/if \(leavesThisNetwork\(provider\)\) continue;/);
    expect(host).not.toMatch(/if \(provider\.kind !== 'local'\) continue;/);
    expect(host).toMatch(
      /endpoint\.kind === 'openai-compatible' && isLocalUrl\(endpoint\.baseUrl\)/,
    );
  });
});
