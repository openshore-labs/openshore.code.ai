// Top bar for the non-chat rooms: the menu (the side panel is the app's main
// navigation, so a room leads back to it, not to chat), the room's name, and
// the always-visible connectivity status. On the desktop the sidebar is
// already beside the room, so the left slot stays empty.
import { useApp } from '../state/store.js';
import { useCompact } from '../hooks/useCompact.js';
import { ProfileStatus } from './ProfileStatus.js';
import { MenuIcon } from './MenuIcon.js';
import { hapticTick } from '../lib/haptics.js';

export function BackBar({ title }: { title: string }) {
  const { setDrawer } = useApp();
  const compact = useCompact();
  return (
    <header className="topbar">
      {compact ? (
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
      <ProfileStatus />
    </header>
  );
}
