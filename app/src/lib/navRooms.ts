// The rooms in the Menu, in two groups (founder, 2026-10-19): Chats,
// Projects, Stack, Agents, the Local Library and Cloud Connections above the
// recent chats, and Terminal, Repositories, the Vault and Computer below
// them, above Settings. Pure, so the split is a tested rule rather than a
// constant someone has to remember. The Sidebar's default order reads it.
// It replaced one group with Terminal placed by device (D10, 2026-10-07).
import {
  RELEASE_TIER,
  SHIPS_LAUNCH,
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
  | 'library'
  | 'stackhealth'
  | 'launch'
  | 'connections'
  | 'pair'
  | 'settings';

export interface NavEntry {
  view: NavRoom;
  label: string;
}

/** The one list of room names (brand sweep, 2026-09-24). The Sidebar,
 *  the BackBar, and the guides all read these, so a room is named one way
 *  everywhere. Title Case only for proper nouns (Agents, Stack Health, Cloud
 *  Connections, Vault, Local Library); Sentence case for the rest. The stack is
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
  crew: 'Agents',
  library: 'Local Library',
  stackhealth: SHIPS_STACKHEALTH ? 'Stack Health' : '',
  launch: SHIPS_LAUNCH ? 'Launch with Codemagic' : '',
  connections: 'Cloud Connections',
  pair: 'Computer',
  settings: 'Settings',
};

const entry = (view: NavRoom): NavEntry => ({ view, label: ROOM_LABELS[view] });

// The founder's two groups (2026-10-19): the rooms a person lives in above
// the recent chats, in this order, then the later tiers' rooms; and the
// machine and storage rooms below them, just above Settings.
const PRIMARY_BASE: NavEntry[] = (
  ['chats', 'projects', 'stack', 'crew', 'library', 'connections', 'stackhealth', 'launch'] as const
).map(entry);

const EXPLORE_BASE: NavEntry[] = (
  ['terminalroom', 'repos', 'vault', 'pair', 'settings'] as const
).map(entry);

/** The two nav groups, the same on every device since 2026-10-19: Terminal
 *  sits in the lower group whether or not a computer is connected, and its
 *  own room still says Connect your computer until one is. */
export function navRooms(tier: ReleaseTier = RELEASE_TIER): {
  primary: NavEntry[];
  explore: NavEntry[];
} {
  return {
    primary: visibleRooms([...PRIMARY_BASE], tier),
    explore: visibleRooms([...EXPLORE_BASE], tier),
  };
}
