// The sidebar: new chat, recent conversations, and the app's few rooms.
// Persistent on desktop, a slide-over drawer on the phone.
import { sourceLabel } from '../state/types.js';
import { useApp, type ViewName } from '../state/store.js';
import { BrandMark } from './BrandMark.js';

const NAV: Array<{ view: ViewName; glyph: string; label: string }> = [
  { view: 'marketplace', glyph: '⬡', label: 'Marketplace' },
  { view: 'stack', glyph: '≡', label: 'Your stack' },
  { view: 'repos', glyph: '⌥', label: 'Repositories' },
  { view: 'connections', glyph: '⚡', label: 'Cloud Connections' },
  { view: 'pair', glyph: '☍', label: 'Desktop + phone' },
  { view: 'settings', glyph: '⚙', label: 'Settings' },
];

export function Sidebar({ drawer }: { drawer?: boolean }) {
  const { order, conversations, activeId, view, setView, openConversation, setDrawer } = useApp();

  const body = (
    <aside className={`sidebar${drawer ? ' drawer' : ''}`}>
      <div className="sidebar-head">
        <span className="brand-lockup">
          <BrandMark size={26} />
          <span className="wordmark">
            <span className="accent">OS</span> Code
          </span>
        </span>
      </div>
      <button
        className="new-chat-btn"
        onClick={() => {
          setView('chat');
          useApp.setState({ activeId: undefined, drawerOpen: false });
        }}
      >
        + New chat
      </button>
      <div className="conv-list">
        {order.map((id) => {
          const conv = conversations[id];
          if (!conv) return null;
          return (
            <button
              key={id}
              className={`conv-item${id === activeId && view === 'chat' ? ' active' : ''}`}
              onClick={() => openConversation(id)}
            >
              {conv.title}
              <span className="conv-source">{sourceLabel(conv.source)}</span>
            </button>
          );
        })}
      </div>
      <nav className="sidebar-nav">
        {NAV.map((item) => (
          <button
            key={item.view}
            className={`nav-item${view === item.view ? ' active' : ''}`}
            onClick={() => setView(item.view)}
          >
            <span className="glyph">{item.glyph}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );

  if (!drawer) return body;
  return (
    <>
      <div className="drawer-scrim" onClick={() => setDrawer(false)} />
      {body}
    </>
  );
}
