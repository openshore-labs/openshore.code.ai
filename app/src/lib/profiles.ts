// Connectivity profiles. OpenShore is one system with the same chats, history,
// connections, and stack everywhere; what changes device to device and moment
// to moment is REACH. Which of your stack you can actually use depends on two
// signals: can we reach your home system (the always-on desktop / Mac mini that
// holds your local LLMs, over Tailscale), and is there any internet at all.
//
//   Docked   - home system reachable. Full stack: home models, cloud, on-device.
//   Offshore - online, but home is not reachable. Cloud and on-device.
//   Offline  - no connection. On-device models only.
//
// The active profile is detected from those two signals; the user can manually
// step DOWN to a more restrictive profile (e.g. force Offline) but never up to
// one the connection cannot support.

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
    blurb: 'Connected to your home system. Full stack: home models, cloud, and on-device.',
  },
  offshore: {
    id: 'offshore',
    label: 'Offshore',
    dot: 'var(--cloud)',
    blurb: 'Online, but your home system is out of reach. Cloud and on-device models.',
  },
  offline: {
    id: 'offline',
    label: 'Offline',
    dot: 'var(--muted)',
    blurb: 'No connection. Your on-device models only.',
  },
};

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
