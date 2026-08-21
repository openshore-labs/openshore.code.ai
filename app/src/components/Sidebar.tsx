// The sidebar: the project bucket at the top-left, a new chat inside it, a
// throwaway quick chat, the recent conversations in the active project, and the
// app's few rooms. Persistent on desktop, a slide-over drawer on the phone.
import { useRef, useState } from 'react';
import { sourceLabel } from '../state/types.js';
import { isOrgAdmin, useApp, type ViewName } from '../state/store.js';
import { useDismissable } from '../lib/useDismissable.js';
import { BrandMark } from './BrandMark.js';

// Every view that has a nav glyph: all ViewNames except the two that never
// appear as a nav item (chat is home; onboarding is a full-screen takeover).
// 'admin' is already a ViewName, so this is the honest form of the reviewer's
// `Record<ViewName | 'admin', ...>` without demanding unused chat/onboarding
// icons. Typing ICON_NODES and NavIcon by it makes a missing or misspelled key
// a compile error instead of a silently empty SVG (CR3).
type NavIconName = Exclude<ViewName, 'chat' | 'onboarding'>;

const NAV: Array<{ view: NavIconName; label: string }> = [
  { view: 'projects', label: 'Projects' },
  { view: 'crew', label: 'My Crew' },
  { view: 'marketplace', label: 'Marketplace' },
  { view: 'stack', label: 'Your stack' },
  { view: 'stackhealth', label: 'Stack Health' },
  { view: 'repos', label: 'Repositories' },
  { view: 'launch', label: 'Launch' },
  { view: 'connections', label: 'Cloud Connections' },
  { view: 'pair', label: 'Desktop + phone' },
  { view: 'settings', label: 'Settings' },
];

// Hand-drawn line icons for the nav, in the same language as PairScreen's
// download tiles: a 24-unit grid, 2px round-cap / round-join strokes, and
// currentColor so `.nav-item.active` tints them --local with no per-icon color.
// Each depicts its room in a calm monochrome studio style. Decorative only; the
// text label beside each carries the name for assistive tech.
const ICON_NODES: Record<NavIconName, JSX.Element> = {
  // Stacked project layers (buckets seen edge-on).
  projects: (
    <>
      <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" />
      <path d="M3 12l9 4.5 9-4.5" />
      <path d="M3 16.5 12 21l9-4.5" />
    </>
  ),
  // Two people, a small crew.
  crew: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19v-1a5 5 0 0 1 9.6-2" />
      <circle cx="16.6" cy="9.6" r="2.4" />
      <path d="M15 15.4a4.3 4.3 0 0 1 5.5 3.2V19" />
    </>
  ),
  // A storefront with its awning: the marketplace.
  marketplace: (
    <>
      <path d="M4 9.6V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.6" />
      <path d="M3 6.6 4.5 4h15L21 6.6a2.2 2.2 0 0 1-4.35 0 2.2 2.2 0 0 1-4.3 0 2.2 2.2 0 0 1-4.3 0A2.2 2.2 0 0 1 3 6.6Z" />
      <path d="M9.5 20v-4.4h5V20" />
    </>
  ),
  // Flat slabs stacked: your stack.
  stack: (
    <>
      <rect x="4" y="14.6" width="16" height="4.4" rx="1.2" />
      <rect x="4" y="9.8" width="16" height="4.4" rx="1.2" />
      <rect x="4" y="5" width="16" height="4.4" rx="1.2" />
    </>
  ),
  // The brand wave, cradled in a ring: stack health.
  stackhealth: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M6.5 12.6q2.75-2 5.5 0t5.5 0" />
    </>
  ),
  // A git branch: repositories.
  repos: (
    <>
      <circle cx="7" cy="6" r="2.2" />
      <circle cx="7" cy="18" r="2.2" />
      <circle cx="17" cy="8" r="2.2" />
      <path d="M7 8.2v7.6" />
      <path d="M17 10.2v1.1a3.6 3.6 0 0 1-3.6 3.6H9.2" />
    </>
  ),
  // A paper plane heading up and out: launch / ship.
  launch: (
    <>
      <path d="M20.5 3.5 3 11l6.3 2.4L12 20.5l2.7-5.2 5.8-11.8Z" />
      <path d="M20.5 3.5 9.3 13.4" />
    </>
  ),
  // A cloud with a plug: cloud connections.
  connections: (
    <>
      <path d="M7.5 16.5h8a3.5 3.5 0 0 0 .4-6.96 5 5 0 0 0-9.55-1.3A3.75 3.75 0 0 0 7.5 16.5Z" />
      <path d="M10 20v-2M14 20v-2" />
    </>
  ),
  // A monitor and a phone, linked: desktop + phone.
  pair: (
    <>
      <rect x="2.5" y="4" width="12" height="8.5" rx="1.4" />
      <path d="M8.5 12.5V16M6 16h5" />
      <rect x="15" y="8.5" width="6.5" height="11.5" rx="1.6" />
      <path d="M17.6 10.6h1.3" />
    </>
  ),
  // A gear: settings.
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.6v3M12 18.4v3M21.4 12h-3M5.6 12h-3M18.65 5.35l-2.1 2.1M7.45 16.55l-2.1 2.1M18.65 18.65l-2.1-2.1M7.45 7.45 5.35 5.35" />
    </>
  ),
  // A shield with a check: the org admin badge.
  admin: (
    <>
      <path d="M12 3 5 6v5c0 4.2 3 7.4 7 9 4-1.6 7-4.8 7-9V6l-7-3Z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
};

// Wrap the icon nodes in the shared svg frame. Decorative: aria-hidden, and the
// stroke is currentColor so the active-state teal flows through untouched.
function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      className="nav-glyph"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_NODES[name]}
    </svg>
  );
}

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
    startNewChat,
    personalUnlockedNow,
  } = useApp();
  // Free is chat only. The Marketplace needs Personal, so a locked pill signals
  // it before the tap (tapping still opens the upgrade sheet via setView).
  const unlocked = personalUnlockedNow();
  const LOCKED_VIEWS = new Set<NavIconName>(['marketplace']);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  useDismissable(switcherRef, switcherOpen, () => setSwitcherOpen(false));

  const projects = settings.projects ?? [];
  const activeProject = projects.find((p) => p.id === settings.activeProjectId) ?? projects[0];

  // What shows in the list: saved chats in the active project. A live quick
  // chat is transient, so it appears only while it is the one open.
  const shown = order.filter((id) => {
    const conv = conversations[id];
    if (!conv) return false;
    if (conv.ephemeral) return id === activeId;
    if (activeProject) return conv.projectId === activeProject.id;
    return !conv.projectId;
  });

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
      <div className="project-switch" ref={switcherRef}>
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
          <span className={`project-switch-caret${switcherOpen ? ' open' : ''}`} aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
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
                {conv.ephemeral ? <span className="ephemeral-dot" aria-hidden="true" /> : null}
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
            <span className="glyph">
              <NavIcon name="admin" />
            </span>
            Admin
          </button>
        ) : null}
        {NAV.map((item) => {
          const locked = !unlocked && LOCKED_VIEWS.has(item.view);
          return (
            <button
              key={item.view}
              className={`nav-item${view === item.view ? ' active' : ''}`}
              onClick={() => setView(item.view)}
            >
              <span className="glyph">
                <NavIcon name={item.view} />
              </span>
              {item.label}
              {locked ? <span className="nav-lock-pill">Personal</span> : null}
            </button>
          );
        })}
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
