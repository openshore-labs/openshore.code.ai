// Desktop Offline (founder, 2026-10-07): main's watch on this computer's
// connection. Two things make the desktop offline: no network (Electron's own
// net.isOnline(), read here, which makes no request and asks no server; a LAN
// with no internet beyond it can still read as online), or the person
// choosing Offline in the Status sheet (the renderer passes the choice on).
// Main owns the answer, so it holds with the window closed and the hub serving
// a paired phone from the tray: every change goes to the engine's one machine
// flag (EngineHost.setOffline), which each session reads before its next turn,
// and a change in the network goes to the window too, so its pill and rooms
// flip as promptly as the engine. Plain logic around two injected reads, so it
// is pinned by tests without Electron.

export type OfflineReason = 'network' | 'chosen';

/** Why this computer works offline now, or undefined when it is online. No
 *  network wins over a choice: it is the stronger truth. */
export function offlineReason(netOnline: boolean, chosen: boolean): OfflineReason | undefined {
  if (!netOnline) return 'network';
  return chosen ? 'chosen' : undefined;
}

/** What main answers the renderer: the network as main reads it, and what
 *  the engine was told. */
export interface OfflineAnswer {
  online: boolean;
  offline: boolean;
  reason?: OfflineReason;
}

export interface NetworkWatchDeps {
  /** Electron's net.isOnline(). */
  isOnline: () => boolean;
  /** Tell the engine (EngineHost.setOffline). */
  apply: (reason: OfflineReason | undefined) => void;
  /** Tell the window the network changed. */
  notify: (online: boolean) => void;
}

export class NetworkWatch {
  private chosen = false;
  private lastOnline: boolean | undefined;
  private lastReason: OfflineReason | undefined | null = null;

  constructor(private readonly deps: NetworkWatchDeps) {}

  /** The network as main reads it; a read that throws counts as online, so
   *  a quirk never strands the person on local models. */
  private online(): boolean {
    try {
      return this.deps.isOnline();
    } catch {
      return true;
    }
  }

  /** Read the network again and pass on any change: the engine hears a new
   *  reason, the window a new network state. Cheap; main polls it. */
  tick(): OfflineAnswer {
    const online = this.online();
    const reason = offlineReason(online, this.chosen);
    if (reason !== this.lastReason) {
      this.lastReason = reason;
      this.deps.apply(reason);
    }
    if (online !== this.lastOnline) {
      this.lastOnline = online;
      // A window on its way out cannot take the message; the poll runs on a
      // timer in main, so a failed send is dropped, never thrown (the window
      // reads main's view again on its next report).
      try {
        this.deps.notify(online);
      } catch {
        // Nothing to tell.
      }
    }
    return { online, offline: reason !== undefined, ...(reason ? { reason } : {}) };
  }

  /** The person's choice from the Status sheet (true for Offline), then a
   *  fresh read, answered so the renderer learns main's view at once. */
  choose(chosen: boolean): OfflineAnswer {
    this.chosen = chosen;
    return this.tick();
  }
}
