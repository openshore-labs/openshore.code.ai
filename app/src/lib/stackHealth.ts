// Stack Health per platform, the same "window onto that machine" shape the
// catalog loader uses. On desktop the Electron bridge folds it from the local
// journals. On the phone there is no bridge, so it reads the paired hub's
// /stack-health over the tailnet: the numbers are still computed on the machine
// that runs the models and only the aggregate crosses, never a copy of the
// sessions. With neither a bridge nor a hub there is nothing to read yet, and the
// screen invites the person to pair one.
import type { StackHealth, StackHealthRange } from 'os-code/protocol';
import { bridge } from './electronBridge.js';
import type { DaemonTarget } from '../drivers/remoteDriver.js';

export type StackHealthResult =
  | { kind: 'ready'; health: StackHealth }
  /** A hub was configured but could not be reached (asleep, off the tailnet). */
  | { kind: 'unreachable' }
  /** No window onto any machine: no desktop bridge and no paired hub. */
  | { kind: 'none' }
  /** The bridge was present but the fold failed. */
  | { kind: 'error' };

/** Read Stack Health for the range: the desktop bridge first, then the paired
 *  hub, then the no-window state. */
export async function loadAppStackHealth(
  range: StackHealthRange,
  daemon?: DaemonTarget,
): Promise<StackHealthResult> {
  const b = bridge();
  if (b) {
    try {
      return { kind: 'ready', health: await b.stackHealth(range) };
    } catch {
      return { kind: 'error' };
    }
  }
  if (daemon) {
    try {
      const res = await fetch(`${daemon.baseUrl}/stack-health?range=${encodeURIComponent(range)}`, {
        headers: { authorization: `Bearer ${daemon.token}` },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        return { kind: 'ready', health: (await res.json()) as StackHealth };
      }
      return { kind: 'unreachable' };
    } catch {
      return { kind: 'unreachable' };
    }
  }
  return { kind: 'none' };
}
