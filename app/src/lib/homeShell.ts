// The plain home shell: a terminal in the home folder of the computer the
// Terminal room points at, with no coding session behind it, so a person can
// open a shell before (or without) opening a repository. On the desktop it is
// the in-process engine's PTY; on a paired phone it is the hub's, over the same
// direct connection the chat uses. Nothing here reaches any other server.
//
// The agent never reads this shell: readTerminal only sees a session's own
// terminal, and this one belongs to no session. The engine and the daemon both
// reopen the shell they left running, so leaving the room and coming back
// lands in the same shell.
import { HOME_SHELL_ID } from 'os-code/protocol';
import { ElectronDriver } from '../drivers/electronDriver.js';
import { RemoteDriver, type DaemonTarget } from '../drivers/remoteDriver.js';
import type { TerminalHost } from '../drivers/types.js';

export interface HomeShellHost extends TerminalHost {
  dispose(): void;
}

/** The host for the home shell on the room's target, or undefined when this
 *  device has no computer to open one on. A member device is refused the
 *  shell by the hub (a raw shell is admin-only), so it is never offered one. */
export function homeShellHost(input: {
  desktopLocal: boolean;
  daemon?: DaemonTarget;
  member: boolean;
}): HomeShellHost | undefined {
  if (input.member) return undefined;
  if (input.desktopLocal) return new ElectronDriver(HOME_SHELL_ID);
  if (input.daemon) return new RemoteDriver(HOME_SHELL_ID, input.daemon, 0, { terminalOnly: true });
  return undefined;
}

/** Whether the room can offer the home shell at all (same rule, no host built). */
export function canOpenHomeShell(input: {
  desktopLocal: boolean;
  daemon?: DaemonTarget;
  member: boolean;
}): boolean {
  return !input.member && (input.desktopLocal || Boolean(input.daemon));
}
