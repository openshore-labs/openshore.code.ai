// The Chats room, in the shape of the Claude app's history: a plain nav
// title with a compose icon, a search pill, then one flat list of chats
// sorted by recency, each a one-line title over a quiet "2h ago · Claude".
// No cards, no date captions, no grouping; the timestamp carries recency.
// Tap to open, swipe to delete (with a confirm, since it cannot be undone),
// hold to name.
// Sessions running on the paired desktop with no chat here yet sit in the
// same list, marked, so a job started at the desk is picked up from the couch.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { DaemonSessionInfo } from 'os-code/protocol';
import { useApp } from '../state/store.js';
import { sourceLabel, type Conversation } from '../state/types.js';
import { BackBar } from '../components/BackBar.js';
import { SwipeRow } from '../components/SwipeRow.js';
import { Sheet } from '../components/Sheet.js';
import { daemonListSessions } from '../drivers/remoteDriver.js';
import { hapticTick } from '../lib/haptics.js';

/** "just now", "12m ago", "2h ago", "Yesterday", "Mon", "Sep 1". */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = new Date(t);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (t >= startOfToday - 86_400_000) return 'Yesterday';
  if (t >= startOfToday - 6 * 86_400_000)
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The quiet source half of the secondary line. */
export function sourceShort(conv: Conversation): string {
  const s = conv.source;
  switch (s.kind) {
    case 'cloud':
      return 'Claude';
    case 'desktop':
      return s.repoName ?? 'Desktop';
    case 'device':
      return sourceLabel(s).split(' · ')[0] ?? 'On device';
    case 'stack':
      return 'Your stack';
    case 'desktop-chat':
      return 'Desktop';
    case 'mock':
      return 'Demo';
  }
}

function ComposeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </svg>
  );
}

/** How long a deleted row takes to leave before it unmounts. */
const ROW_OUT_MS = 300;

type Row =
  | { kind: 'chat'; id: string; at: number; conv: Conversation }
  | { kind: 'desktop'; id: string; at: number; session: DaemonSessionInfo };

export function ChatsScreen() {
  const {
    order,
    conversations,
    activeId,
    view,
    openConversation,
    startNewChat,
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
  const [leavingId, setLeavingId] = useState<string | undefined>();
  const [desktopSessions, setDesktopSessions] = useState<DaemonSessionInfo[]>([]);
  const leaveTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    },
    [],
  );

  const projects = settings.projects ?? [];
  const activeProject = projects.find((p) => p.id === settings.activeProjectId) ?? projects[0];

  // The chats in the active project.
  const q = query.trim().toLowerCase();
  const chats: Row[] = order
    .filter((id) => {
      const conv = conversations[id];
      if (!conv) return false;
      if (q && !conv.title.toLowerCase().includes(q)) return false;
      if (activeProject) return conv.projectId === activeProject.id;
      return !conv.projectId;
    })
    .map((id) => ({
      kind: 'chat' as const,
      id,
      at: new Date(conversations[id]!.updatedAt).getTime(),
      conv: conversations[id]!,
    }));

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

  const desktopRows: Row[] = desktopSessions
    .filter((s) => {
      const name = s.title && !/^Session /.test(s.title) ? s.title : s.cwd;
      return !q || name.toLowerCase().includes(q);
    })
    .map((s) => ({
      kind: 'desktop' as const,
      id: `d:${s.id}`,
      at: s.updatedAt ? new Date(s.updatedAt).getTime() : 0,
      session: s,
    }));

  const rows = [...chats, ...desktopRows].sort((a, b) => b.at - a.at);

  const confirmConv = confirmId ? conversations[confirmId] : undefined;
  const renameConv = renameId ? conversations[renameId] : undefined;

  const beginRename = (id: string) => {
    const conv = conversations[id];
    if (!conv) return;
    hapticTick();
    setRenameDraft(conv.title === 'New chat' ? '' : conv.title);
    setRenameId(id);
  };

  // The row leaves before it unmounts, then the chat is gone.
  const removeChat = (id: string) => {
    setConfirmId(undefined);
    setLeavingId(id);
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null;
      deleteConversation(id);
      setLeavingId(undefined);
      showToast('Chat deleted.');
    }, ROW_OUT_MS);
  };

  const compose = (
    <button
      type="button"
      className="icon-btn press-fb"
      aria-label="New chat"
      title="New chat"
      onClick={() => {
        hapticTick();
        startNewChat();
      }}
    >
      <ComposeIcon />
    </button>
  );

  return (
    <div className="screen">
      <BackBar title="Chats" action={compose} />
      <div className="screen-inner chats">
        <div className="chat-search">
          <input
            type="search"
            value={query}
            placeholder="Search"
            aria-label="Search chats"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="chat-list">
          <button
            type="button"
            className="chat-row chat-row-new press-fb press-fb--row"
            onClick={() => {
              hapticTick();
              startNewChat();
            }}
          >
            <span className="chat-row-title">
              <span className="chat-new-plus" aria-hidden="true">
                +
              </span>
              New chat
            </span>
          </button>

          {rows.map((row, i) => {
            const style = { '--stagger': `${Math.min(i, 8) * 22}ms` } as CSSProperties;
            if (row.kind === 'desktop') {
              const s = row.session;
              const name =
                s.title && !/^Session /.test(s.title)
                  ? s.title
                  : (s.cwd.split(/[\\/]/).filter(Boolean).pop() ?? s.cwd);
              return (
                <div key={row.id} className="swipe-row chat-swipe" style={style}>
                  <button
                    type="button"
                    className="chat-row press-fb press-fb--row"
                    onClick={() => {
                      hapticTick();
                      void openDesktopSession({ id: s.id, cwd: s.cwd, title: s.title }).catch(
                        (err: unknown) =>
                          showToast(err instanceof Error ? err.message : String(err)),
                      );
                    }}
                  >
                    <span className="chat-row-title">
                      <span className="chat-row-remote" aria-hidden="true" />
                      {name}
                    </span>
                    <span className="chat-row-sub">
                      {s.updatedAt ? `${relativeTime(s.updatedAt)} · ` : ''}Running on desktop
                      {s.busy ? ' · working' : ''}
                    </span>
                  </button>
                </div>
              );
            }
            const conv = row.conv;
            return (
              <SwipeRow
                key={row.id}
                variant="danger"
                label="Delete"
                style={style}
                onTap={() => openConversation(row.id)}
                onToggle={() => setConfirmId(row.id)}
                onLongPress={() => beginRename(row.id)}
              >
                <div
                  className={`chat-row${row.id === activeId && view === 'chat' ? ' active' : ''}${row.id === leavingId ? ' leaving' : ''}`}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    beginRename(row.id);
                  }}
                >
                  <span className="chat-row-title">
                    {conv.thread.busy ? (
                      <span className="chat-row-live" aria-label="working" />
                    ) : null}
                    {conv.title}
                  </span>
                  <span className="chat-row-sub">
                    {relativeTime(conv.updatedAt)} · {sourceShort(conv)}
                  </span>
                </div>
              </SwipeRow>
            );
          })}
        </div>

        {rows.length === 0 ? (
          <div className="chat-empty">
            <h2>{q ? 'No chat called that.' : 'Nothing here yet.'}</h2>
            {!q ? (
              <p>
                {activeProject
                  ? `Start a chat and it stays with ${activeProject.name}.`
                  : 'Create a project to start saving your chats.'}
              </p>
            ) : null}
          </div>
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
              <button className="btn danger" onClick={() => removeChat(confirmId!)}>
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
