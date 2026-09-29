// Release tiers (founder, 2026-09-27; docs/release-tiers.md). One gate for
// what a build carries, so a later tier's surfaces have no door in an
// earlier one:
//
//   v1 Personal: one person, their desktop and their phone. Chats, Projects,
//      Terminal, Repositories, Stack, Vault, Crew, Cloud Connections,
//      Desktop + phone, Settings.
//   v2: Agentic and Harness Currents, Stack Health, Launch with Codemagic.
//   v3: the Marketplace.
//   v4 Enterprise: Admin, teams (shared projects, the team vault, project
//      permissions), and shared-hub members.
//
// A build is Personal unless it says otherwise: VITE_RELEASE_TIER=2, 3 or 4
// carries that tier and every one before it. The code of a later tier stays
// in the tree; the gate keeps its doors shut and its launch-time work from
// running. Read by the Sidebar, the room list, navigation, the Currents
// views, and every surface a later tier owns (app/test/focus.test.ts).

export type ReleaseTier = 1 | 2 | 3 | 4;

/** What each tier is called. */
export const TIER_NAMES: Record<ReleaseTier, string> = {
  1: 'Personal',
  2: 'Currents',
  3: 'Marketplace',
  4: 'Enterprise',
};

/** The features a later tier owns. */
export type TieredFeature =
  'currents' | 'stackhealth' | 'launch' | 'marketplace' | 'admin' | 'teams' | 'hubMembers';

/** The tier each feature ships in. */
export const FEATURE_TIER: Record<TieredFeature, ReleaseTier> = {
  currents: 2,
  stackhealth: 2,
  launch: 2,
  marketplace: 3,
  admin: 4,
  teams: 4,
  hubMembers: 4,
};

/** Rooms that belong to a later tier, by view name. Every other room is v1. */
export const ROOM_FEATURE: Readonly<Record<string, TieredFeature>> = {
  stackhealth: 'stackhealth',
  launch: 'launch',
  marketplace: 'marketplace',
  admin: 'admin',
};

/** The tier a build asked for: 1 (Personal) unless VITE_RELEASE_TIER names
 *  2, 3 or 4. Anything else reads as Personal, never as more. */
export function tierFrom(env: { VITE_RELEASE_TIER?: string } | undefined): ReleaseTier {
  const raw = env?.VITE_RELEASE_TIER?.trim();
  return raw === '2' || raw === '3' || raw === '4' ? (Number(raw) as ReleaseTier) : 1;
}

/** This build's tier. */
// Written as `import.meta.env` literally: Vite replaces only that exact form.
export const RELEASE_TIER: ReleaseTier = tierFrom(import.meta.env);

/** Whether this build carries a feature. */
export function featureOn(feature: TieredFeature, tier: ReleaseTier = RELEASE_TIER): boolean {
  return FEATURE_TIER[feature] <= tier;
}

/** Whether a room has a door in this build. */
export function roomOpen(view: string, tier: ReleaseTier = RELEASE_TIER): boolean {
  const feature = ROOM_FEATURE[view];
  return feature === undefined || featureOn(feature, tier);
}

/** A room list with the later tiers' rooms taken out. */
export function visibleRooms<T extends { view: string }>(
  rooms: T[],
  tier: ReleaseTier = RELEASE_TIER,
): T[] {
  return rooms.filter((r) => roomOpen(r.view, tier));
}
