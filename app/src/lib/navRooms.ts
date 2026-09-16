// Which rooms are day-one and which are second-session, per device. Pure, so
// the split is a tested rule rather than a constant someone has to remember.
//
// Terminal is day-one on a desktop (the shell is right there) and on a phone
// that has paired a hub (the terminal reaches it). On a bare phone it is a
// dead room until a hub exists (review 6, blocker A), so it moves to the
// second-session group where the room's own "Connect your hub" card still
// explains the way in. Nothing else moves.
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

const TERMINAL: NavEntry = { view: 'terminalroom', label: 'Terminal' };

const PRIMARY_BASE: NavEntry[] = [
  { view: 'chats', label: 'Chats' },
  { view: 'projects', label: 'Projects' },
  { view: 'repos', label: 'Repositories' },
  { view: 'stack', label: 'Your stack' },
  { view: 'vault', label: 'Vault' },
];

const EXPLORE_BASE: NavEntry[] = [
  { view: 'crew', label: 'My Crew' },
  { view: 'marketplace', label: 'Marketplace' },
  { view: 'stackhealth', label: 'Stack Health' },
  { view: 'launch', label: 'App Launch with Codemagic' },
  { view: 'connections', label: 'Cloud Connections' },
  { view: 'pair', label: 'Desktop + phone' },
  { view: 'settings', label: 'Settings' },
];

/** Whether Terminal belongs in the day-one set on this device. */
export function terminalIsDayOne(input: { desktop: boolean; hubPaired: boolean }): boolean {
  return input.desktop || input.hubPaired;
}

/** The two nav groups for a device. Terminal sits third in the day-one set
 *  where it belongs there, and leads the second-session group otherwise. */
export function navRooms(input: { desktop: boolean; hubPaired: boolean }): {
  primary: NavEntry[];
  explore: NavEntry[];
} {
  if (terminalIsDayOne(input)) {
    return {
      primary: [...PRIMARY_BASE.slice(0, 2), TERMINAL, ...PRIMARY_BASE.slice(2)],
      explore: [...EXPLORE_BASE],
    };
  }
  return { primary: [...PRIMARY_BASE], explore: [TERMINAL, ...EXPLORE_BASE] };
}
