// The desktop shell's lifecycle rules (A2), as pure helpers so they are pinned
// without a display: the window closes to the tray instead of quitting, Quit
// really quits, the power-save blocker holds only while a run is active, the
// daemon re-binds from loopback to the tailnet when Tailscale comes up, and
// launch-at-login is an XDG autostart entry on Linux (Electron's login item
// API covers only macOS and Windows).
import { describe, expect, it } from 'vitest';
import {
  autostartEntry,
  autostartEntryPath,
  closeAction,
  isHiddenLaunch,
  launchAtLoginSupport,
  powerBlockerNext,
  shouldRebind,
  trayMenuTemplate,
} from '../electron/lifecycle.js';

describe('tray menu', () => {
  it('offers Open, Pause hub, and Quit, in that order', () => {
    const items = trayMenuTemplate({ hubRunning: true });
    expect(items.map((i) => i.id)).toEqual(['open', 'hub', 'quit']);
    expect(items[0]!.label).toBe('Open OpenShore');
    expect(items[1]!.label).toBe('Pause hub');
    expect(items[2]!.label).toBe('Quit OpenShore');
  });

  it('reads Resume hub while the hub is paused', () => {
    expect(trayMenuTemplate({ hubRunning: false })[1]!.label).toBe('Resume hub');
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
