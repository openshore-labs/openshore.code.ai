// Which rooms are day-one and which are second-session, per device. Pure, so
// the split is a tested rule rather than a constant someone has to remember.
//
// Terminal is day-one on a desktop (the shell is right there) and on a phone
// that has paired a hub (the terminal reaches it). On a bare phone it is a
// dead room until a hub exists (review 6, blocker A), so it moves to the
// second-session group where the room's own "Connect your hub" card still
// explains the way in. Nothing else moves.
import {
  RELEASE_TIER,
  SHIPS_LAUNCH,
  SHIPS_MARKETPLACE,
  SHIPS_STACKHEALTH,
  visibleRooms,
  type ReleaseTier,
} from './focus.js';

export type NavRoom =
  | 'chats'
  | 'projects'
  | 'terminalroom'
  | 'repos'
  | 'stack'
  | 'vault'
  | 'crew'
  | 'marketplace'
  | 'stackhealth'
  | 'launch'
  | 'connections'
  | 'pair'
  | 'settings';

export interface NavEntry {
  view: NavRoom;
  label: string;
}

/** The one list of room names (brand sweep, founder 2026-09-24). The Sidebar,
 *  the BackBar, and the guides all read these, so a room is named one way
 *  everywhere. Title Case only for proper nouns (Crew, Stack Health, Cloud
 *  Connections, Vault, Marketplace); Sentence case for the rest. The stack is
 *  named "Stack", never "Your stack" or "My Stack". A later tier's room has no
 *  name in a build without it, the way it has no door there, so its name is
 *  not in that build's bundle either (lib/focus.ts, SHIPS_). */
export const ROOM_LABELS: Record<NavRoom, string> = {
  chats: 'Chats',
  projects: 'Projects',
  terminalroom: 'Terminal',
  repos: 'Repositories',
  stack: 'Stack',
  vault: 'Vault',
  crew: 'Crew',
  marketplace: SHIPS_MARKETPLACE ? 'Marketplace' : '',
  stackhealth: SHIPS_STACKHEALTH ? 'Stack Health' : '',
  launch: SHIPS_LAUNCH ? 'Launch with Codemagic' : '',
  connections: 'Cloud Connections',
  pair: 'Computer',
  settings: 'Settings',
};

const entry = (view: NavRoom): NavEntry => ({ view, label: ROOM_LABELS[view] });

const TERMINAL: NavEntry = entry('terminalroom');

const PRIMARY_BASE: NavEntry[] = (['chats', 'projects', 'repos', 'stack', 'vault'] as const).map(
  entry,
);

const EXPLORE_BASE: NavEntry[] = (
  ['crew', 'marketplace', 'stackhealth', 'launch', 'connections', 'pair', 'settings'] as const
).map(entry);

/** Whether Terminal belongs in the day-one set on this device. */
export function terminalIsDayOne(input: { desktop: boolean; hubPaired: boolean }): boolean {
  return input.desktop || input.hubPaired;
}

/** The two nav groups for a device. Terminal sits third in the day-one set
 *  where it belongs there, and leads the second-session group otherwise. */
export function navRooms(
  input: { desktop: boolean; hubPaired: boolean },
  tier: ReleaseTier = RELEASE_TIER,
): {
  primary: NavEntry[];
  explore: NavEntry[];
} {
  if (terminalIsDayOne(input)) {
    return {
      primary: visibleRooms(
        [...PRIMARY_BASE.slice(0, 2), TERMINAL, ...PRIMARY_BASE.slice(2)],
        tier,
      ),
      explore: visibleRooms([...EXPLORE_BASE], tier),
    };
  }
  return {
    primary: visibleRooms([...PRIMARY_BASE], tier),
    explore: visibleRooms([TERMINAL, ...EXPLORE_BASE], tier),
  };
}
