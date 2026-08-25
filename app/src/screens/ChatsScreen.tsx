// The Chats room: one place that lists every saved chat in the active project,
// the way the Claude app keeps its chat history behind a "Chats" button instead
// of stacking it down the side of every screen. Start a new chat from the top,
// or tap one to reopen it.
import { useApp } from '../state/store.js';
import { sourceLabel } from '../state/types.js';
import { BackBar } from '../components/BackBar.js';

export function ChatsScreen() {
  const { order, conversations, activeId, view, openConversation, startNewChat, quickChat, settings } =
    useApp();

  const projects = settings.projects ?? [];
  const activeProject =
    projects.find((p) => p.id === settings.activeProjectId) ?? projects[0];

  // The saved chats in the active project. A live quick chat is transient, so it
  // shows only while it is the one open, matching the old sidebar rule.
  const shown = order.filter((id) => {
    const conv = conversations[id];
    if (!conv) return false;
    if (conv.ephemeral) return id === activeId;
    if (activeProject) return conv.projectId === activeProject.id;
    return !conv.projectId;
  });

  return (
    <div className="screen">
      <BackBar title="Chats" />
      <div className="screen-inner">
        <h1>Chats</h1>
        <p className="lead">
          {activeProject
            ? `Every chat in ${activeProject.name}. Start a new one, or pick up where you left off.`
            : 'Your chats live here. Start a new one any time.'}
        </p>

        <div className="chats-actions">
          <button className="btn primary" style={{ flex: 1 }} onClick={startNewChat}>
            + New chat
          </button>
          <button
            className="btn"
            onClick={() => {
              void quickChat();
            }}
          >
            Quick chat
          </button>
        </div>

        {shown.length === 0 ? (
          <p className="hint" style={{ marginTop: 14 }}>
            {activeProject
              ? 'No chats here yet. Start one and it stays with this project.'
              : 'Create a project to start saving your chats.'}
          </p>
        ) : (
          <div className="chat-list">
            {shown.map((id) => {
              const conv = conversations[id]!;
              return (
                <button
                  key={id}
                  className={`chat-row${id === activeId && view === 'chat' ? ' active' : ''}`}
                  onClick={() => openConversation(id)}
                >
                  <span className="chat-row-title">
                    {conv.ephemeral ? <span className="ephemeral-dot" aria-hidden="true" /> : null}
                    {conv.title}
                  </span>
                  <span className="chat-row-sub">
                    {conv.ephemeral ? 'Quick chat · not saved' : sourceLabel(conv.source)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
