// The Chats room: one place that lists every saved chat in the active project,
// the way the Claude app keeps its chat history behind a "Chats" button instead
// of stacking it down the side of every screen. Chats group by when they were
// last touched (today, yesterday, this week, earlier), a search field narrows
// them by title, a tap reopens one, a swipe deletes it (with a confirm, since
// it cannot be undone), and a long press names it. Sessions running on the
// paired desktop that have no chat here yet are listed too, so a job started
// at the desk can be picked up from the couch.
import { useEffect, useState, type CSSProperties } from 'react';
import type { DaemonSessionInfo } from 'os-code/protocol';
import { useApp } from '../state/store.js';
import { sourceLabel, type Conversation } from '../state/types.js';
import { BackBar } from '../components/BackBar.js';
import { SwipeRow } from '../components/SwipeRow.js';
import { Sheet } from '../components/Sheet.js';
import { daemonListSessions } from '../drivers/remoteDriver.js';
import { hapticTick } from '../lib/haptics.js';

type Bucket = 'Today' | 'Yesterday' | 'This week' | 'Earlier';

function bucketFor(iso: string, now = new Date()): Bucket {
  const d = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startOfToday) return 'Today';
  if (t >= startOfToday - 86_400_000) return 'Yesterday';
  if (t >= startOfToday - 6 * 86_400_000) return 'This week';
  return 'Earlier';
}

const BUCKETS: Bucket[] = ['Today', 'Yesterday', 'This week', 'Earlier'];

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
    renameConversation,
    openDesktopSession,
    showToast,
    settings,
  } = useApp();
  const [confirmId, setConfirmId] = useState<string | undefined>();
  const [renameId, setRenameId] = useState<string | undefined>();
  const [renameDraft, setRenameDraft] = useState('');
  const [query, setQuery] = useState('');
  const [desktopSessions, setDesktopSessions] = useState<DaemonSessionInfo[]>([]);

  const projects = settings.projects ?? [];
  const activeProject = projects.find((p) => p.id === settings.activeProjectId) ?? projects[0];

  // The saved chats in the active project. A live quick chat is transient, so it
  // shows only while it is the one open, matching the old sidebar rule.
  const q = query.trim().toLowerCase();
  const shown = order.filter((id) => {
    const conv = conversations[id];
    if (!conv) return false;
    if (q && !conv.title.toLowerCase().includes(q)) return false;
    if (conv.ephemeral) return id === activeId;
    if (activeProject) return conv.projectId === activeProject.id;
    return !conv.projectId;
  });
  const grouped = new Map<Bucket, string[]>();
  for (const id of shown) {
    const b = bucketFor(conversations[id]!.updatedAt);
    grouped.set(b, [...(grouped.get(b) ?? []), id]);
  }

  // Sessions on the paired desktop with no chat here. Best effort: a desktop
  // that is asleep just yields an empty list.
  const daemon = settings.daemon;
  useEffect(() => {
    if (!daemon) return;
    let live = true;
    void daemonListSessions(daemon)
      .then((rows) => {
        if (!live) return;
        const known = new Set(
          order
            .map((id) => conversations[id])
            .filter((c): c is Conversation => Boolean(c))
            .map((c) => (c.source.kind === 'desktop' ? c.source.sessionId : undefined)),
        );
        setDesktopSessions(rows.filter((r) => !known.has(r.id)).slice(0, 12));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daemon?.baseUrl, order.length]);

  const confirmConv = confirmId ? conversations[confirmId] : undefined;
  const renameConv = renameId ? conversations[renameId] : undefined;

  // A hold on a row names the chat (SwipeRow raises it; a right-click on the
  // desktop does the same).
  const beginRename = (id: string) => {
    const conv = conversations[id];
    if (!conv) return;
    hapticTick();
    setRenameDraft(conv.title === 'New chat' ? '' : conv.title);
    setRenameId(id);
  };

  let stagger = 0;

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

        {order.length > 6 ? (
          <div className="field chats-search">
            <input
              type="search"
              value={query}
              placeholder="Search chats"
              aria-label="Search chats"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        ) : null}

        {shown.length === 0 ? (
          <p className="hint" style={{ marginTop: 14 }}>
            {q
              ? 'No chat by that name.'
              : activeProject
                ? 'No chats here yet. Start one and it stays with this project.'
                : 'Create a project to start saving your chats.'}
          </p>
        ) : (
          BUCKETS.filter((b) => grouped.has(b)).map((bucket) => (
            <section key={bucket} className="chat-section">
              <h2 className="chat-section-title">{bucket}</h2>
              <div className="chat-group">
                {grouped.get(bucket)!.map((id) => {
                  const conv = conversations[id]!;
                  // Cap the stagger so a long history never keeps the eye waiting.
                  const style = {
                    '--stagger': `${Math.min(stagger++, 8) * 22}ms`,
                  } as CSSProperties;
                  return (
                    <SwipeRow
                      key={id}
                      variant="danger"
                      label="Delete"
                      style={style}
                      onTap={() => openConversation(id)}
                      onToggle={() => setConfirmId(id)}
                      onLongPress={() => beginRename(id)}
                    >
                      <div
                        className={`chat-row${id === activeId && view === 'chat' ? ' active' : ''}`}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          beginRename(id);
                        }}
                      >
                        <span className="chat-row-title">
                          {conv.ephemeral ? (
                            <span className="ephemeral-dot" aria-hidden="true" />
                          ) : null}
                          {conv.thread.busy ? (
                            <span className="chat-row-live" aria-label="working" />
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
            </section>
          ))
        )}

        {desktopSessions.length ? (
          <section className="chat-section">
            <h2 className="chat-section-title">On your desktop</h2>
            <p className="hint">Sessions running there that are not in this app yet.</p>
            <div className="chat-group">
              {desktopSessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="chat-row chat-row-btn press-fb press-fb--row"
                  onClick={() => {
                    hapticTick();
                    void openDesktopSession({ id: s.id, cwd: s.cwd, title: s.title }).catch(
                      (err: unknown) => showToast(err instanceof Error ? err.message : String(err)),
                    );
                  }}
                >
                  <span className="chat-row-title">
                    {s.busy ? <span className="chat-row-live" aria-label="working" /> : null}
                    {s.title && !/^Session /.test(s.title)
                      ? s.title
                      : (s.cwd.split(/[\\/]/).filter(Boolean).pop() ?? s.cwd)}
                  </span>
                  <span className="chat-row-sub">{s.cwd}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <Sheet open={Boolean(confirmConv)} onClose={() => setConfirmId(undefined)} variant="confirm">
        {confirmConv ? (
          <>
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
          </>
        ) : null}
      </Sheet>

      <Sheet open={Boolean(renameConv)} onClose={() => setRenameId(undefined)} variant="confirm">
        {renameConv ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (renameDraft.trim()) void renameConversation(renameConv.id, renameDraft);
              setRenameId(undefined);
            }}
          >
            <h3>Name this chat</h3>
            <div className="field">
              <input
                autoFocus
                value={renameDraft}
                maxLength={80}
                placeholder="A short name"
                onChange={(e) => setRenameDraft(e.target.value)}
              />
            </div>
            <div className="confirm-row">
              <button type="button" className="btn ghost" onClick={() => setRenameId(undefined)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={!renameDraft.trim()}>
                Save
              </button>
            </div>
          </form>
        ) : null}
      </Sheet>
    </div>
  );
}
