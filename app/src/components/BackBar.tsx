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

export const ROOM_NAMES: Record<ViewName, string> = {
  chat: 'Chat',
  chats: 'Chats',
  marketplace: 'Marketplace',
  stack: 'Your stack',
  stackhealth: 'Stack Health',
  connections: 'Cloud Connections',
  repos: 'Repositories',
  vault: 'Vault',
  projects: 'Projects',
  project: 'Project',
  projectmemory: 'Project notes',
  crew: 'My Crew',
  admin: 'Admin',
  launch: 'Launch',
  pair: 'Desktop + phone',
  settings: 'Settings',
  terminal: 'Terminal',
  terminalroom: 'Terminal',
  onboarding: 'Setup',
};

/** A way back that lives inside the room: a page the room opened over its own
 *  list (a model's product page in the Marketplace, a note in the Vault, the
 *  embedded site in Launch). It wins over the room trail, because the nearest
 *  step back is the one the eye expects (founder, 2026-09-03: every page or
 *  sheet reached from a main page needs a back to where it started). */
export interface InRoomBack {
  /** The name of what the chevron returns to, shown beside it with room. */
  to: string;
  onBack: () => void;
}

export function BackBar({
  title,
  action,
  back,
}: {
  title: string;
  action?: ReactNode;
  back?: InRoomBack;
}) {
  const { setDrawer, goBack, viewTrail, drawerOpen } = useApp();
  const compact = useCompact();
  const from = viewTrail[viewTrail.length - 1];
  const way = back ?? (from ? { to: ROOM_NAMES[from], onBack: goBack } : undefined);
  return (
    <header className="topbar">
      {way ? (
        <button
          className="icon-btn back-btn press-fb"
          onClick={() => {
            hapticTick();
            way.onBack();
          }}
          aria-label={`Back to ${way.to}`}
          title={`Back to ${way.to}`}
        >
          <span className="back-chevron" aria-hidden="true" />
          {!compact ? <span className="back-label">{way.to}</span> : null}
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
          <MenuIcon open={drawerOpen} />
        </button>
      ) : null}
      {/* Keyed so a new title (a page opening inside the room) remounts and
          plays its cross-fade; data-depth gives it a direction (a page arrives
          from the right, a return to a root from the left). */}
      <div className="topbar-title" key={title} data-depth={way ? 'page' : 'root'}>
        {title}
      </div>
      {action}
      <ProfileStatus />
    </header>
  );
}
