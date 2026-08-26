// The Chats room: one place that lists every saved chat in the active project,
// the way the Claude app keeps its chat history behind a "Chats" button instead
// of stacking it down the side of every screen. Start a new chat from the top,
// tap one to reopen it, or swipe a row to delete it (with a confirm, since it
// cannot be undone).
import { useState, type CSSProperties } from 'react';
import { useApp } from '../state/store.js';
import { sourceLabel } from '../state/types.js';
import { BackBar } from '../components/BackBar.js';
import { SwipeRow } from '../components/SwipeRow.js';

export function ChatsScreen() {
  const {
    order,
    conversations,
    activeId,
    view,
    openConversation,
    startNewChat,
    quickChat,
    deleteConversation,
    showToast,
    settings,
  } = useApp();
  const [confirmId, setConfirmId] = useState<string | undefined>();

  const projects = settings.projects ?? [];
  const activeProject = projects.find((p) => p.id === settings.activeProjectId) ?? projects[0];

  // The saved chats in the active project. A live quick chat is transient, so it
  // shows only while it is the one open, matching the old sidebar rule.
  const shown = order.filter((id) => {
    const conv = conversations[id];
    if (!conv) return false;
    if (conv.ephemeral) return id === activeId;
    if (activeProject) return conv.projectId === activeProject.id;
    return !conv.projectId;
  });

  const confirmConv = confirmId ? conversations[confirmId] : undefined;

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
            className="btn ghost"
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
          <div className="chat-group">
            {shown.map((id, i) => {
              const conv = conversations[id]!;
              // Cap the stagger so a long history never keeps the eye waiting.
              const stagger = { '--stagger': `${Math.min(i, 8) * 22}ms` } as CSSProperties;
              return (
                <SwipeRow
                  key={id}
                  variant="danger"
                  label="Delete"
                  style={stagger}
                  onTap={() => openConversation(id)}
                  onToggle={() => setConfirmId(id)}
                >
                  <div className={`chat-row${id === activeId && view === 'chat' ? ' active' : ''}`}>
                    <span className="chat-row-title">
                      {conv.ephemeral ? (
                        <span className="ephemeral-dot" aria-hidden="true" />
                      ) : null}
                      {conv.title}
                    </span>
                    <span className="chat-row-sub">
                      {conv.ephemeral ? 'Quick chat · not saved' : sourceLabel(conv.source)}
                    </span>
                  </div>
                </SwipeRow>
              );
            })}
          </div>
        )}
      </div>

      {confirmConv ? (
        <div className="confirm-scrim" onClick={() => setConfirmId(undefined)}>
          <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
            <h3>Delete this chat?</h3>
            <p>{confirmConv.title}. This cannot be undone.</p>
            <div className="confirm-row">
              <button className="btn ghost" onClick={() => setConfirmId(undefined)}>
                Cancel
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  deleteConversation(confirmId!);
                  setConfirmId(undefined);
                  showToast('Chat deleted.');
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
