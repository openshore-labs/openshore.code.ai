// The sidebar: the project bucket at the top-left, a new chat inside it, a
// throwaway quick chat, the recent conversations in the active project, and the
// app's few rooms. Persistent on desktop, a slide-over drawer on the phone.
import { useState } from 'react';
import { sourceLabel } from '../state/types.js';
import { isOrgAdmin, useApp, type ViewName } from '../state/store.js';
import { BrandMark } from './BrandMark.js';

const NAV: Array<{ view: ViewName; glyph: string; label: string }> = [
  { view: 'projects', glyph: '▤', label: 'Projects' },
  { view: 'crew', glyph: '☺', label: 'My Crew' },
  { view: 'marketplace', glyph: '⬡', label: 'Marketplace' },
  { view: 'stack', glyph: '≡', label: 'Your stack' },
  { view: 'repos', glyph: '⌥', label: 'Repositories' },
  { view: 'connections', glyph: '⚡', label: 'Cloud Connections' },
  { view: 'pair', glyph: '☍', label: 'Desktop + phone' },
  { view: 'settings', glyph: '⚙', label: 'Settings' },
];

export function Sidebar({ drawer }: { drawer?: boolean }) {
  const {
    order,
    conversations,
    activeId,
    view,
    setView,
    openConversation,
    setDrawer,
    settings,
    setActiveProject,
    quickChat,
  } = useApp();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const projects = settings.projects ?? [];
  const activeProject =
    projects.find((p) => p.id === settings.activeProjectId) ?? projects[0];

  // What shows in the list: saved chats in the active project. A live quick
  // chat is transient, so it appears only while it is the one open.
  const shown = order.filter((id) => {
    const conv = conversations[id];
    if (!conv) return false;
    if (conv.ephemeral) return id === activeId;
    if (activeProject) return conv.projectId === activeProject.id;
    return !conv.projectId;
  });

  const startNewChat = () => {
    // A saved chat needs a project to live in. Send the user to create one
    // first if none exists yet; otherwise open a fresh chat in the bucket.
    if (projects.length === 0) {
      setView('projects');
      useApp.setState({ drawerOpen: false });
      return;
    }
    setView('chat');
    useApp.setState({ activeId: undefined, drawerOpen: false });
  };

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

      {/* The project bucket. Everything saved lives inside the active one. */}
      <div className="project-switch">
        <button
          className="project-switch-btn"
          onClick={() => setSwitcherOpen((v) => !v)}
          aria-expanded={switcherOpen}
        >
          <span className="project-switch-label">
            <span className="project-switch-kicker">Project</span>
            <span className="project-switch-name">
              {activeProject ? activeProject.name : 'No project yet'}
            </span>
          </span>
          <span className="project-switch-caret">{switcherOpen ? '▴' : '▾'}</span>
        </button>
        {switcherOpen ? (
          <div className="project-menu">
            {projects.map((p) => (
              <button
                key={p.id}
                className={`project-menu-item${p.id === activeProject?.id ? ' active' : ''}`}
                onClick={() => {
                  setActiveProject(p.id);
                  setSwitcherOpen(false);
                }}
              >
                {p.name}
              </button>
            ))}
            <button
              className="project-menu-item manage"
              onClick={() => {
                setSwitcherOpen(false);
                setView('projects');
                useApp.setState({ drawerOpen: false });
              }}
            >
              {projects.length ? 'Manage projects' : 'Create your first project'}
            </button>
          </div>
        ) : null}
      </div>

      <button className="new-chat-btn" onClick={startNewChat}>
        + New chat
      </button>
      <button
        className="quick-chat-btn"
        onClick={() => {
          void quickChat();
        }}
      >
        Quick chat <span className="quick-chat-note">not saved</span>
      </button>

      <div className="conv-list">
        {shown.length === 0 ? (
          <p className="conv-empty">
            {activeProject
              ? 'No chats here yet. Start one and it stays with this project.'
              : 'Create a project to start saving your chats.'}
          </p>
        ) : (
          shown.map((id) => {
            const conv = conversations[id]!;
            return (
              <button
                key={id}
                className={`conv-item${id === activeId && view === 'chat' ? ' active' : ''}`}
                onClick={() => openConversation(id)}
              >
                {conv.title}
                <span className="conv-source">
                  {conv.ephemeral ? 'Quick chat · not saved' : sourceLabel(conv.source)}
                </span>
              </button>
            );
          })
        )}
      </div>
      <nav className="sidebar-nav">
        {isOrgAdmin(settings.account) && settings.account?.type === 'commercial' ? (
          <button
            className={`nav-item${view === 'admin' ? ' active' : ''}`}
            onClick={() => setView('admin')}
          >
            <span className="glyph">{'♦'}</span>
            Admin
          </button>
        ) : null}
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
