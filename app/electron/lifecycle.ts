// The desktop shell's lifecycle rules (A2), kept free of Electron so they are
// unit-tested without a display. main.ts wires them to the real Tray, window,
// powerSaveBlocker, and login-item APIs.
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';

export interface TrayMenuItem {
  id: 'open' | 'new' | 'hub' | 'quit';
  label: string;
}

/** The tray's three choices. The hub line flips between Pause and Resume. */
export function trayMenuTemplate(state: { hubRunning: boolean }): TrayMenuItem[] {
  return [
    { id: 'open', label: 'Open OpenShore' },
    { id: 'new', label: 'New chat' },
    { id: 'hub', label: state.hubRunning ? 'Pause phone access' : 'Resume phone access' },
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

/** Where the XDG entry goes. Only a Linux desktop reads one, so the path is
 *  a Linux path with "/" whatever machine composes it. */
export function autostartEntryPath(home: string): string {
  return posix.join(home, '.config', 'autostart', 'openshore.desktop');
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

/** The person's own Turn off (or the tray's Pause), kept across launches
 *  (pairing review, CX 2026-10-01): a computer someone took off the phone
 *  stays off until they turn it back on, never silently reopened by the next
 *  launch. A marker file in userData; present means paused. */
export const HUB_PAUSED_FILE = 'hub-paused';

export function readHubPaused(userData: string): boolean {
  return existsSync(join(userData, HUB_PAUSED_FILE));
}

export function writeHubPaused(userData: string, paused: boolean): void {
  writeMarker(join(userData, HUB_PAUSED_FILE), paused, 'paused\n');
}

/** The person's chosen Offline (Desktop Offline, privacy review 2026-10-08),
 *  kept in main across launches the way the pause is: a login launch starts
 *  in the tray with no window, so no renderer is there to report the choice,
 *  and main reads it from here before the hub serves a phone. A marker file in
 *  userData; present means Offline was chosen. The window still reports the
 *  choice on every refresh, and main keeps the two in step. */
export const OFFLINE_CHOSEN_FILE = 'offline-chosen';

export function readOfflineChosen(userData: string): boolean {
  return existsSync(join(userData, OFFLINE_CHOSEN_FILE));
}

export function writeOfflineChosen(userData: string, chosen: boolean): void {
  writeMarker(join(userData, OFFLINE_CHOSEN_FILE), chosen, 'offline\n');
}

/** Quit (the tray's, the app menu's, an update's) leaves this marker; the next
 *  launch takes it and opens fresh, with the full splash and no chat restored
 *  (lib/resumePoint.ts). A crash or a reboot leaves none, so that launch still
 *  returns to the open chat. */
const QUIT_MARKER_FILE = 'quit-clean';

export function writeQuitMarker(userData: string): void {
  writeMarker(join(userData, QUIT_MARKER_FILE), true, 'quit\n');
}

/** Whether the last run ended in Quit, removing the marker so it counts once. */
export function takeQuitMarker(userData: string): boolean {
  const path = join(userData, QUIT_MARKER_FILE);
  if (!existsSync(path)) return false;
  writeMarker(path, false, '');
  return true;
}

function writeMarker(path: string, present: boolean, body: string): void {
  try {
    if (present) writeFileSync(path, body);
    else rmSync(path, { force: true });
  } catch {
    // Best effort: a write that fails leaves this launch's state as it is.
  }
}
