// Connectivity profiles. OpenShore is one system with the same chats, history,
// connections, and stack everywhere; what changes device to device and moment
// to moment is REACH. Which of your stack you can actually use depends on two
// signals: can we reach your home system (the always-on desktop / Mac mini that
// holds your local LLMs, over Tailscale), and is there any internet at all.
//
//   Docked   - connected to your computer. Its models, cloud models, and this
//              device's models.
//   Offshore - online, but your computer is out of reach. Cloud models and
//              this device's models.
//   Offline  - no connection. Only the models on this device.
//
// The active profile is detected from those two signals; the user can manually
// step DOWN to a more restrictive profile (e.g. force Offline) but never up to
// one the connection cannot support. The pill that names it shows once a
// computer is connected to this device (reachPillShown).

export type ProfileId = 'docked' | 'offshore' | 'offline';
export type ModelLocation = 'home' | 'cloud' | 'device';

export interface ProfileInfo {
  id: ProfileId;
  label: string;
  /** A CSS color token for the status bubble. */
  dot: string;
  blurb: string;
}

export const PROFILES: Record<ProfileId, ProfileInfo> = {
  docked: {
    id: 'docked',
    label: 'Docked',
    dot: 'var(--ok)',
    blurb: "Connected to your computer. Its models, cloud models, and this device's models.",
  },
  offshore: {
    id: 'offshore',
    label: 'Offshore',
    // Neutral ink, not amber: amber marks cloud spend, and a status is not a charge.
    dot: 'var(--ink-soft)',
    blurb: "Online, but your computer is out of reach. Cloud models and this device's models.",
  },
  offline: {
    id: 'offline',
    label: 'Offline',
    dot: 'var(--muted)',
    blurb: 'No connection. Only the models on this device.',
  },
};

/** The blurb a person reads under a status. Before any computer is connected,
 *  Docked names the condition (its row cannot be tapped, so it never borrows
 *  the Connect your computer door's words) and Offshore does not speak of a
 *  computer that is out of reach. Callers pass paired = isDesktop() || Boolean(settings.daemon),
 *  because on the desktop the device is the computer. */
export function profileBlurb(id: ProfileId, paired: boolean): string {
  if (!paired && id === 'docked') return "Your computer's models, once you connect it.";
  if (!paired && id === 'offshore') return "Online. Cloud models and this device's models.";
  return PROFILES[id].blurb;
}

/** Whether the reach pill shows in the top bar (founder, 2026-10-07, D1 built
 *  as recommended, B: show it once it can mean something). Until a computer
 *  is connected to this device the pill could only say Offshore, about a
 *  computer the person never connected, so it waits. Offline still shows on
 *  its own: it is true without any computer, and it is the one door back
 *  from an Offline the person chose. Once a computer is connected, Docked,
 *  Offshore and Offline all show, as before. `connected` is
 *  Boolean(settings.daemon) alone, never isDesktop(): the desktop app is the
 *  computer, its own engine is not a reach the pill measures, so a desktop
 *  follows the same rule until it is pointed at another computer. */
export function reachPillShown(active: ProfileId, connected: boolean): boolean {
  return connected || active === 'offline';
}

// Most capable first. A lower index is more capable.
export const PROFILE_ORDER: ProfileId[] = ['docked', 'offshore', 'offline'];

export interface Connectivity {
  homeReachable: boolean;
  online: boolean;
}

/** The best profile the current connection can support. */
export function autoProfile(c: Connectivity): ProfileId {
  if (c.homeReachable) return 'docked';
  if (c.online) return 'offshore';
  return 'offline';
}

/** The effective profile: an override only ever steps down from the auto max. */
export function effectiveProfile(auto: ProfileId, override?: ProfileId): ProfileId {
  if (!override) return auto;
  const rank = (p: ProfileId) => PROFILE_ORDER.indexOf(p);
  return rank(override) > rank(auto) ? override : auto;
}

/** Can this profile reach a model in that location? */
export function locationAllowed(profile: ProfileId, loc: ModelLocation): boolean {
  if (loc === 'device') return true;
  if (loc === 'cloud') return profile !== 'offline';
  return profile === 'docked'; // home
}

/** Can the user select this profile given the connection? (down only) */
export function selectable(profile: ProfileId, auto: ProfileId): boolean {
  return PROFILE_ORDER.indexOf(profile) >= PROFILE_ORDER.indexOf(auto);
}
