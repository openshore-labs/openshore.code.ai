// Where the work runs (founder, 2026-10-12): "in your projects, you can choose
// the Hub to run your project from, either your home computer, home server, or
// remote server." Copy calls that choice Runs on (CX, 2026-10-01: "hub" stays
// out of copy). A device docks to as many machines as the person likes; each
// project may name one, and each chat remembers the machine its engine
// session opened on, so switching the device's active machine, or a project's
// choice, never sends a running chat to a machine that has never heard of it.
//
// The device's active machine (`settings.daemon`) keeps what is the device's
// own: the Stack, the Vault on your computer, Crew, push and the keys sheet.
// A project's machine is only where its coding sessions and its repositories
// live. Pure, so the rule is tested without a store.
import type { DaemonTarget } from '../drivers/remoteDriver.js';

/** A project that runs on the desktop's own engine, whatever this desktop
 *  has docked to. Only a desktop offers it; projects stay on the device that
 *  made them, so a phone never reads one. */
export const THIS_COMPUTER = 'this-computer';

/** What a project names: this desktop, or a docked machine by its address.
 *  Unset follows the device's own choice. */
export type RunsOn = string;

/** Where a session runs, resolved. */
export type Where =
  /** This desktop's own engine, over the bridge. */
  | { kind: 'local' }
  /** A docked machine, with its credential. */
  | { kind: 'docked'; target: DaemonTarget }
  /** Nowhere: a phone with nothing docked. */
  | { kind: 'none' }
  /** A chat whose session lives on a machine this device no longer docks
   *  to (forgotten), or on a desktop's own engine read from elsewhere. */
  | { kind: 'gone'; key: string };

export interface WhereContext {
  /** This is a desktop with its own engine (`isDesktop() && bridge()`). */
  desktopLocal: boolean;
  /** The desktop's "Run on another computer" switch. */
  preferRemoteHub?: boolean;
  /** Every docked machine (`hubList(settings)`), credentials included. */
  hubs: DaemonTarget[];
  /** The device's active machine (`settings.daemon`). */
  active?: DaemonTarget;
}

/** The device's own default, unchanged from before projects could choose: a
 *  desktop runs on itself unless pointed at another machine, and a phone runs
 *  on its active machine. */
export function deviceWhere(ctx: WhereContext): Where {
  if (ctx.desktopLocal && !ctx.preferRemoteHub) return { kind: 'local' };
  const active = ctx.active && findHub(ctx.hubs, ctx.active.baseUrl);
  if (active) return { kind: 'docked', target: active };
  // An active machine missing from the list is a device from before the list
  // existed: it is still the machine.
  if (ctx.active) return { kind: 'docked', target: ctx.active };
  return { kind: 'none' };
}

/** Where a project's new sessions run: its own choice when this device can
 *  honor it, otherwise the device's default. A choice that names a machine
 *  this device has forgotten falls back too (forgetting a machine clears it
 *  from every project, so this is only a race). */
export function projectWhere(project: { runsOn?: RunsOn } | undefined, ctx: WhereContext): Where {
  const choice = project?.runsOn;
  if (choice === THIS_COMPUTER) return ctx.desktopLocal ? { kind: 'local' } : deviceWhere(ctx);
  if (choice) {
    const hub = findHub(ctx.hubs, choice);
    if (hub) return { kind: 'docked', target: hub };
  }
  return deviceWhere(ctx);
}

/** Where an open chat's engine session lives. A chat that recorded its
 *  machine goes back to that machine, or nowhere: never to another one, which
 *  would not know the session. A chat from before the record follows the
 *  device's default, as it always did. A chat with no session yet opens
 *  where its project runs, unless it was made for one machine (a folder this
 *  desktop just made, a session listed from a machine), which it names. */
export function sessionWhere(
  source: { sessionId?: string; hub?: string },
  project: { runsOn?: RunsOn } | undefined,
  ctx: WhereContext,
): Where {
  const key = source.hub;
  if (!key) return source.sessionId ? deviceWhere(ctx) : projectWhere(project, ctx);
  if (key === THIS_COMPUTER) return ctx.desktopLocal ? { kind: 'local' } : { kind: 'gone', key };
  const hub = findHub(ctx.hubs, key);
  return hub ? { kind: 'docked', target: hub } : { kind: 'gone', key };
}

/** What a chat records once its session opens: THIS_COMPUTER, or the
 *  machine's address. Nothing for nowhere. */
export function whereKey(where: Where): string | undefined {
  if (where.kind === 'local') return THIS_COMPUTER;
  if (where.kind === 'docked') return where.target.baseUrl;
  if (where.kind === 'gone') return where.key;
  return undefined;
}

/** The machine a chat's session-scoped work (its terminal, its uploads, its
 *  repositories) talks to: the docked target, or undefined for this desktop's
 *  own engine or nowhere. */
export function dockedTarget(where: Where): DaemonTarget | undefined {
  return where.kind === 'docked' ? where.target : undefined;
}

/** Forgetting a machine: every project that named it goes back to following
 *  the device. Returns the projects unchanged when none did, so a caller can
 *  skip the save. */
export function forgetRunsOn<P extends { runsOn?: RunsOn }>(projects: P[], baseUrl: string): P[] {
  if (!projects.some((p) => p.runsOn === baseUrl)) return projects;
  return projects.map((p) => {
    if (p.runsOn !== baseUrl) return p;
    const { runsOn: _gone, ...rest } = p;
    return rest as P;
  });
}

/** How many projects name a machine, for its row and its Forget confirm. */
export function projectsOn(projects: { runsOn?: RunsOn }[] | undefined, key: string): number {
  return (projects ?? []).filter((p) => p.runsOn === key).length;
}

/** Why a chat cannot reach its machine, in plain words. */
export function goneLine(key: string, name?: string): string {
  if (key === THIS_COMPUTER) {
    return "This chat ran on a computer's own engine, which this device cannot reach.";
  }
  return `This chat ran on ${name ?? hostOfKey(key)}, which this device no longer docks to. Dock to it again from Computer to pick it up.`;
}

function hostOfKey(key: string): string {
  try {
    return new URL(key).hostname;
  } catch {
    return key;
  }
}

function findHub(hubs: DaemonTarget[], baseUrl: string): DaemonTarget | undefined {
  return hubs.find((h) => h.baseUrl === baseUrl);
}
