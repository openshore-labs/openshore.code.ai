// The desktop shell's lifecycle rules (A2), as pure helpers so they are pinned
// without a display: the window closes to the tray instead of quitting, Quit
// really quits, the power-save blocker holds only while a run is active, the
// daemon re-binds from loopback to the tailnet when Tailscale comes up, and
// launch-at-login is an XDG autostart entry on Linux (Electron's login item
// API covers only macOS and Windows), and the person's own Turn off and
// chosen Offline hold across launches, a login launch with no window included.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NetworkWatch, offlineReason, type OfflineReason } from '../electron/networkWatch.js';
import {
  autostartEntry,
  autostartEntryPath,
  closeAction,
  isHiddenLaunch,
  launchAtLoginSupport,
  powerBlockerNext,
  readOfflineChosen,
  shouldRebind,
  trayMenuTemplate,
  writeOfflineChosen,
} from '../electron/lifecycle.js';

describe('tray menu', () => {
  it('offers Open, New chat, Pause phone access, and Quit, in that order', () => {
    const items = trayMenuTemplate({ hubRunning: true });
    expect(items.map((i) => i.id)).toEqual(['open', 'new', 'hub', 'quit']);
    expect(items[0]!.label).toBe('Open OpenShore');
    expect(items[1]!.label).toBe('New chat');
    expect(items[2]!.label).toBe('Pause phone access');
    expect(items[3]!.label).toBe('Quit OpenShore');
  });

  it('reads Resume phone access while it is paused', () => {
    expect(trayMenuTemplate({ hubRunning: false })[2]!.label).toBe('Resume phone access');
  });
});

describe('closing the window', () => {
  it('hides to the tray while a tray exists and nobody asked to quit', () => {
    expect(closeAction({ quitting: false, trayReady: true })).toBe('hide');
  });
  it('quits when Quit was chosen, or when there is no tray to hide into', () => {
    expect(closeAction({ quitting: true, trayReady: true })).toBe('quit');
    expect(closeAction({ quitting: false, trayReady: false })).toBe('quit');
  });
});

describe('power-save blocker', () => {
  it('starts on the first active run and stops when the last one ends', () => {
    expect(powerBlockerNext({ active: false, busyRuns: 1 })).toBe('start');
    expect(powerBlockerNext({ active: true, busyRuns: 2 })).toBe('keep');
    expect(powerBlockerNext({ active: true, busyRuns: 0 })).toBe('stop');
    expect(powerBlockerNext({ active: false, busyRuns: 0 })).toBe('keep');
  });
});

describe('re-bind to the tailnet', () => {
  it('re-binds only a loopback daemon once Tailscale is up with an address', () => {
    expect(
      shouldRebind({ running: true, host: '127.0.0.1', tailscaleUp: true, ip: '100.64.0.9' }),
    ).toBe(true);
    expect(
      shouldRebind({ running: true, host: '100.64.0.9', tailscaleUp: true, ip: '100.64.0.9' }),
    ).toBe(false);
    expect(shouldRebind({ running: true, host: '127.0.0.1', tailscaleUp: false })).toBe(false);
    expect(shouldRebind({ running: false, tailscaleUp: true, ip: '100.64.0.9' })).toBe(false);
  });
});

describe('launch at login', () => {
  it('is native on macOS and Windows, an XDG autostart entry on Linux', () => {
    expect(launchAtLoginSupport('darwin')).toBe('native');
    expect(launchAtLoginSupport('win32')).toBe('native');
    expect(launchAtLoginSupport('linux')).toBe('xdg');
  });

  it('writes a desktop entry that starts the app hidden, quoted for spaces', () => {
    const text = autostartEntry({ execPath: '/home/j/Apps/Open Shore.AppImage' });
    expect(text).toContain('[Desktop Entry]');
    expect(text).toContain('Name=OpenShore');
    expect(text).toContain('Exec="/home/j/Apps/Open Shore.AppImage" --hidden');
    expect(text).toContain('X-GNOME-Autostart-enabled=true');
    expect(text.endsWith('\n')).toBe(true);
    expect(autostartEntryPath('/home/j')).toBe('/home/j/.config/autostart/openshore.desktop');
  });

  it('recognizes the hidden launch flag the entry passes', () => {
    expect(isHiddenLaunch(['/usr/bin/openshore', '--hidden'])).toBe(true);
    expect(isHiddenLaunch(['/usr/bin/openshore'])).toBe(false);
  });
});

describe('Turn off holds across launches (pairing review, UX review 2026-10-01)', () => {
  it('remembers a pause and forgets it on resume', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { readHubPaused, writeHubPaused } = await import('../electron/lifecycle.js');
    const dir = mkdtempSync(join(tmpdir(), 'osc-paused-'));
    expect(readHubPaused(dir)).toBe(false);
    writeHubPaused(dir, true);
    expect(readHubPaused(dir)).toBe(true);
    writeHubPaused(dir, false);
    expect(readHubPaused(dir)).toBe(false);
  });

  it('skips the start at launch while paused', async () => {
    const { readFileSync } = await import('node:fs');
    const main = readFileSync('electron/main.ts', 'utf8');
    expect(main).toMatch(
      /hubPaused = readHubPaused\(app\.getPath\('userData'\)\);\s*if \(!hubPaused\)/,
    );
  });
});

describe('a chosen Offline holds across launches (privacy review, 2026-10-08)', () => {
  it('remembers the choice and forgets it once the person goes back online', () => {
    const dir = mkdtempSync(join(tmpdir(), 'osc-offline-'));
    expect(readOfflineChosen(dir)).toBe(false);
    writeOfflineChosen(dir, true);
    expect(readOfflineChosen(dir)).toBe(true);
    writeOfflineChosen(dir, false);
    expect(readOfflineChosen(dir)).toBe(false);
  });

  it('a choice saved last launch is the engine flag before anything reads the network', () => {
    const dir = mkdtempSync(join(tmpdir(), 'osc-offline-'));
    // Last launch: the window reported Offline, then again on its next
    // refresh. Only the change is written.
    const writes: boolean[] = [];
    const last = new NetworkWatch({
      isOnline: () => true,
      apply: () => {},
      notify: () => {},
      remember: (chosen) => {
        writes.push(chosen);
        writeOfflineChosen(dir, chosen);
      },
    });
    last.choose(true);
    last.choose(true);
    expect(writes).toEqual([true]);

    // This launch is a login launch: no window, so nothing reports the
    // choice. Main restores it before the hub starts, and the engine hears
    // it without a single read of the network.
    const applied: Array<OfflineReason | undefined> = [];
    let reads = 0;
    const now = new NetworkWatch({
      isOnline: () => {
        reads += 1;
        return true;
      },
      apply: (reason) => applied.push(reason),
      notify: () => {},
    });
    now.restore(readOfflineChosen(dir));
    expect(applied).toEqual(['chosen']);
    expect(reads).toBe(0);
    expect(offlineReason(true, readOfflineChosen(dir))).toBe('chosen');

    // The first poll keeps it, and tells the engine nothing new; a dropped
    // network is still the stronger truth.
    expect(now.tick()).toEqual({ online: true, offline: true, reason: 'chosen' });
    expect(applied).toEqual(['chosen']);
  });

  it('with nothing saved, the restore says nothing and the first poll reads online', () => {
    const applied: Array<OfflineReason | undefined> = [];
    const watch = new NetworkWatch({
      isOnline: () => true,
      apply: (reason) => applied.push(reason),
      notify: () => {},
    });
    watch.restore(false);
    expect(applied).toEqual([]);
    expect(watch.tick()).toEqual({ online: true, offline: false });
    expect(applied).toEqual([undefined]);
  });

  it('choosing Online again forgets it for the next launch; a failed write still takes effect now', () => {
    const dir = mkdtempSync(join(tmpdir(), 'osc-offline-'));
    writeOfflineChosen(dir, true);
    const watch = new NetworkWatch({
      isOnline: () => true,
      apply: () => {},
      notify: () => {},
      remember: (chosen) => writeOfflineChosen(dir, chosen),
    });
    watch.restore(readOfflineChosen(dir));
    expect(watch.choose(false)).toEqual({ online: true, offline: false });
    expect(readOfflineChosen(dir)).toBe(false);

    const failing = new NetworkWatch({
      isOnline: () => true,
      apply: () => {},
      notify: () => {},
      remember: () => {
        throw new Error('read-only disk');
      },
    });
    expect(failing.choose(true)).toEqual({ online: true, offline: true, reason: 'chosen' });
  });

  it('main restores the saved choice as it starts, before the hub can serve', () => {
    const main = readFileSync(join('electron', 'main.ts'), 'utf8');
    expect(main).toMatch(
      /remember: \(chosen\) => writeOfflineChosen\(app\.getPath\('userData'\), chosen\),/,
    );
    expect(main).toMatch(/return readOfflineChosen\(app\.getPath\('userData'\)\);/);
    const restore = main.indexOf('network.restore(savedOfflineChoice());');
    expect(restore).toBeGreaterThan(main.indexOf('const network = new NetworkWatch('));
    // Before whenReady, so before the hub's first start and the first poll.
    expect(restore).toBeLessThan(main.indexOf('void app.whenReady()'));
    expect(restore).toBeLessThan(main.indexOf('host.daemonStart()'));
    expect(restore).toBeLessThan(main.indexOf('startLifecyclePolls();'));
  });
});
