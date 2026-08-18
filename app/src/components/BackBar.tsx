// Top bar for the non-chat rooms: back to chat, plus the room's name.
import { useApp } from '../state/store.js';

export function BackBar({ title }: { title: string }) {
  const { setView, setDrawer } = useApp();
  return (
    <header className="topbar">
      <button className="icon-btn" onClick={() => setView('chat')} aria-label="Back">
        {'‹'}
      </button>
      <div className="topbar-title">{title}</div>
      <button className="icon-btn" onClick={() => setDrawer(true)} aria-label="Menu">
        {'☰'}
      </button>
    </header>
  );
}
