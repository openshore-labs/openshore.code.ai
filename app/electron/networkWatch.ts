// Desktop Offline (2026-10-07): main's watch on this computer's
// connection. Two things make the desktop offline: no network (Electron's own
// net.isOnline(), read here, which makes no request and asks no server; a LAN
// with no internet beyond it can still read as online), or the person
// choosing Offline in the Status sheet (the renderer passes the choice on, on
// every refresh). Main owns the answer, and it keeps the choice across
// launches (lifecycle.ts OFFLINE_CHOSEN_FILE, read back through restore()
// before the hub serves), so a chosen Offline holds with the window closed,
// from a login launch that starts in the tray with no window, and with the
// hub serving a paired phone: every change goes to the engine's one machine
// flag (EngineHost.setOffline), which each session reads before its next turn,
// and a change in the network goes to the window too, so its pill and rooms
// flip as promptly as the engine. Plain logic around injected reads and
// writes, so it is pinned by tests without Electron.

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
  /** Keep the person's choice across launches (lifecycle.ts
   *  writeOfflineChosen). Called only when the choice changes, never on the
   *  window's repeat reports. */
  remember?: (chosen: boolean) => void;
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
   *  fresh read, answered so the renderer learns main's view at once. A
   *  change is kept for the next launch; a write that fails never stops the
   *  choice taking effect now. */
  choose(chosen: boolean): OfflineAnswer {
    if (chosen !== this.chosen) {
      this.chosen = chosen;
      try {
        this.deps.remember?.(chosen);
      } catch {
        // Best effort: this launch holds the choice either way.
      }
    }
    return this.tick();
  }

  /** The choice kept from the last launch, set the moment main starts and
   *  before anything reads the network (Electron's net waits for the app to
   *  be ready): a chosen Offline reaches the engine's flag at once, so no
   *  session, routine, or paired phone sees this computer online first. The
   *  next tick reads the network as usual; nothing is written back. */
  restore(chosen: boolean): void {
    this.chosen = chosen;
    if (!chosen) return;
    this.lastReason = 'chosen';
    this.deps.apply('chosen');
  }
}
