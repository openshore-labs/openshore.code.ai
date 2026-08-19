// Top bar for the non-chat rooms: back to chat, the room's name, and the
// always-visible connectivity status.
import { useApp } from '../state/store.js';
import { ProfileStatus } from './ProfileStatus.js';

export function BackBar({ title }: { title: string }) {
  const { setView, setDrawer } = useApp();
  return (
    <header className="topbar">
      <button className="icon-btn" onClick={() => setView('chat')} aria-label="Back">
        {'‹'}
      </button>
      <div className="topbar-title">{title}</div>
      <ProfileStatus />
      <button className="icon-btn" onClick={() => setDrawer(true)} aria-label="Menu">
        {'☰'}
      </button>
    </header>
  );
}
