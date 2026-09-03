// Top bar for the non-chat rooms: the way back, the room's name, and the
// always-visible connectivity status. The side panel is the app's main
// navigation, so a room opened from it shows the menu; a room reached from
// inside another room (a settings path, Manage, the terminal) shows a back
// chevron to the room it came from, the iOS grammar. On the desktop the
// sidebar is already beside the room, so a root's left slot stays empty.
import type { ReactNode } from 'react';
import { useApp, type ViewName } from '../state/store.js';
import { useCompact } from '../hooks/useCompact.js';
import { ProfileStatus } from './ProfileStatus.js';
import { MenuIcon } from './MenuIcon.js';
import { hapticTick } from '../lib/haptics.js';

const ROOM_NAMES: Record<ViewName, string> = {
  chat: 'Chat',
  chats: 'Chats',
  marketplace: 'Marketplace',
  stack: 'Your stack',
  stackhealth: 'Stack Health',
  connections: 'Cloud Connections',
  repos: 'Repositories',
  vault: 'Vault',
  projects: 'Projects',
  crew: 'My Crew',
  admin: 'Admin',
  launch: 'Launch',
  pair: 'Desktop + phone',
  settings: 'Settings',
  terminal: 'Terminal',
  onboarding: 'Setup',
};

export function BackBar({ title, action }: { title: string; action?: ReactNode }) {
  const { setDrawer, goBack, viewTrail } = useApp();
  const compact = useCompact();
  const from = viewTrail[viewTrail.length - 1];
  return (
    <header className="topbar">
      {from ? (
        <button
          className="icon-btn back-btn press-fb"
          onClick={() => {
            hapticTick();
            goBack();
          }}
          aria-label={`Back to ${ROOM_NAMES[from]}`}
          title={`Back to ${ROOM_NAMES[from]}`}
        >
          <span className="back-chevron" aria-hidden="true" />
          {!compact ? <span className="back-label">{ROOM_NAMES[from]}</span> : null}
        </button>
      ) : compact ? (
        <button
          className="icon-btn menu-btn press-fb"
          onClick={() => {
            hapticTick();
            setDrawer(true);
          }}
          aria-label="Menu"
        >
          <MenuIcon />
        </button>
      ) : null}
      <div className="topbar-title">{title}</div>
      {action}
      <ProfileStatus />
    </header>
  );
}
