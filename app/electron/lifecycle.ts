// The desktop shell's lifecycle rules (A2), kept free of Electron so they are
// unit-tested without a display. main.ts wires them to the real Tray, window,
// powerSaveBlocker, and login-item APIs.
import { join } from 'node:path';

export interface TrayMenuItem {
  id: 'open' | 'hub' | 'quit';
  label: string;
}

/** The tray's three choices. The hub line flips between Pause and Resume. */
export function trayMenuTemplate(state: { hubRunning: boolean }): TrayMenuItem[] {
  return [
    { id: 'open', label: 'Open OpenShore' },
    { id: 'hub', label: state.hubRunning ? 'Pause hub' : 'Resume hub' },
    { id: 'quit', label: 'Quit OpenShore' },
  ];
}

/** Closing the window hides it while a tray exists to bring it back; Quit
 *  (from the tray or the app menu) sets `quitting` and really quits. With no
 *  tray (a desktop without a status area) a close still quits, as before. */
export function closeAction(state: { quitting: boolean; trayReady: boolean }): 'hide' | 'quit' {
  return !state.quitting && state.trayReady ? 'hide' : 'quit';
}

/** The power-save blocker holds only while a run is active, so an unattended
 *  routine or a phone's long task is not killed by the machine dozing off, and
 *  an idle desktop is free to sleep. */
export function powerBlockerNext(state: {
  active: boolean;
  busyRuns: number;
}): 'start' | 'stop' | 'keep' {
  if (!state.active && state.busyRuns > 0) return 'start';
  if (state.active && state.busyRuns === 0) return 'stop';
  return 'keep';
}

/** A daemon that had to fall back to loopback (Tailscale down at start) moves
 *  onto the tailnet as soon as an address appears. A daemon already on the
 *  tailnet, or a paused one, stays put. */
export function shouldRebind(state: {
  running: boolean;
  host?: string;
  tailscaleUp: boolean;
  ip?: string;
}): boolean {
  return state.running && state.host === '127.0.0.1' && state.tailscaleUp && Boolean(state.ip);
}

/** Electron's login-item settings cover macOS and Windows; Linux desktops read
 *  an XDG autostart entry instead. */
export function launchAtLoginSupport(platform: NodeJS.Platform): 'native' | 'xdg' {
  return platform === 'darwin' || platform === 'win32' ? 'native' : 'xdg';
}

export const HIDDEN_LAUNCH_FLAG = '--hidden';

export function autostartEntryPath(home: string): string {
  return join(home, '.config', 'autostart', 'openshore.desktop');
}

/** The XDG autostart entry: launch the app hidden (to the tray) at login. The
 *  executable is quoted so an AppImage in a folder with spaces still runs. */
export function autostartEntry(opts: { execPath: string }): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=OpenShore',
    'Comment=Start the OpenShore hub with your computer',
    `Exec="${opts.execPath.replace(/"/g, '\\"')}" ${HIDDEN_LAUNCH_FLAG}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

export function isHiddenLaunch(argv: readonly string[]): boolean {
  return argv.includes(HIDDEN_LAUNCH_FLAG);
}
