// The Chats room, in the shape of the Claude app's history: a plain nav
// title with a compose icon, a search pill, then one flat list of chats
// sorted by recency, each a one-line title over a quiet "2h ago · Claude".
// No cards, no date captions, no grouping; the timestamp carries recency.
// Tap to open, swipe to delete (with a confirm, since it cannot be undone),
// hold to name; a quiet line under the list says so, since a gesture nobody
// mentions is a gesture nobody finds.
// Search reads inside the chats too: a title hit is marked in place, a hit in
// the conversation shows its line under the title. Each row carries a small
// dot in the house reach colours (teal local, amber cloud) when the reach is
// known, and nothing when it is not.
// Sessions running on the paired desktop with no chat here yet sit in the
// same list, marked, so a job started at the desk is picked up from the couch.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { DaemonSessionInfo } from 'os-code/protocol';
import { useApp } from '../state/store.js';
import { computerName, sourceLabel, type Conversation } from '../state/types.js';
import { BackBar } from '../components/BackBar.js';
import { SwipeRow } from '../components/SwipeRow.js';
import { useChatActions } from '../components/ChatMenu.js';
import { daemonListSessions } from '../drivers/remoteDriver.js';
import { plainError } from '../lib/plainError.js';
import { Icon } from '../components/Icon.js';
import { ComposeGlyph, PlusGlyph } from '../components/SheetGlyphs.js';
import { useCompact } from '../hooks/useCompact.js';
import { inChatScope } from '../lib/chatScope.js';
import { relativeTime } from '../lib/relativeTime.js';

// The time and line-start helpers live in lib/relativeTime.ts, so a room
// that only shows a time never loads this screen; re-exported for its callers.
export { lineStart, relativeTime } from '../lib/relativeTime.js';

/** The quiet source half of the secondary line. */
export function sourceShort(conv: Conversation): string {
  const s = conv.source;
  switch (s.kind) {
    case 'cloud':
      return sourceLabel(s).split(' · ')[0] ?? 'Cloud';
    case 'desktop':
      return s.repoName ?? computerName();
    case 'device':
      return sourceLabel(s).split(' · ')[0] ?? 'On device';
    case 'stack':
      return 'Stack';
    case 'desktop-chat':
      return sourceLabel(s);
    case 'mock':
      return 'Demo';
  }
}

/** Where a chat's model ran, when that is known: the last turn's model wins,
 *  then the source's own kind. A Stack or engine chat with no turn yet is
 *  unknown, and gets a ring rather than a guess. */
export function chatReach(conv: Conversation): 'local' | 'cloud' | undefined {
  const served = conv.thread.model?.kind;
  if (served) return served;
  switch (conv.source.kind) {
    case 'cloud':
      return 'cloud';
    case 'device':
    case 'desktop-chat':
      return 'local';
    default:
      return undefined;
  }
}

const REACH_HINT = {
  local: 'Ran on a local model',
  cloud: 'Ran on a cloud model',
} as const;

/** The reach dot: filled teal or amber when known, and nothing at all when
 *  not, so the second line starts on the title's edge in every state: at the
 *  dot when there is one, at the time when there is not. An empty box the
 *  dot's width once pushed the time 13px right of the title (2026-10-07). */
export function ReachDot({ reach }: { reach: 'local' | 'cloud' | undefined }) {
  if (!reach) return null;
  return (
    <span
      className={`chat-reach chat-reach-${reach}`}
      title={REACH_HINT[reach]}
      aria-hidden="true"
    />
  );
}

/** The plus badge on the "New chat" row. */
export function NewChatGlyph() {
  return (
    <span className="chat-new-plus" aria-hidden="true">
      <Icon size={16}>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </Icon>
    </span>
  );
}

/** Where a search found a chat: its title, or a line inside it. */
export type ChatMatch =
  { where: 'title' } | { where: 'body'; before: string; hit: string; after: string };

const SNIPPET_RADIUS = 36;

/** Plain text for matching: markdown marks dropped, whitespace collapsed. */
function plain(text: string): string {
  return text
    .replace(/[`*_#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Find `query` in a chat's title, else in its messages, newest first. */
export function matchChat(conv: Conversation, query: string): ChatMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return { where: 'title' };
  if (conv.title.toLowerCase().includes(q)) return { where: 'title' };
  const items = conv.thread.items;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind !== 'user' && item.kind !== 'assistant') continue;
    const text = plain(item.text);
    const at = text.toLowerCase().indexOf(q);
    if (at < 0) continue;
    const from = Math.max(0, at - SNIPPET_RADIUS);
    const to = Math.min(text.length, at + q.length + SNIPPET_RADIUS * 2);
    return {
      where: 'body',
      before: (from > 0 ? '…' : '') + text.slice(from, at),
      hit: text.slice(at, at + q.length),
      after: text.slice(at + q.length, to) + (to < text.length ? '…' : ''),
    };
  }
  return null;
}

/** `text` with each case-insensitive occurrence of `query` marked. */
export function Marked({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, i)) {
    if (at > i) out.push(text.slice(i, at));
    out.push(
      <mark key={at} className="chat-hit">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    i = at + needle.length;
  }
  if (i < text.length) out.push(text.slice(i));
  return <>{out}</>;
}

function SearchIcon() {
  return (
    <Icon size={18}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </Icon>
  );
}

/** The search pill at the top of a list room: Chats everywhere, and Projects
 *  on the desktop (D11). Escape clears it, Enter opens the top match, and the
 *  clear button rides in only while there is something to clear. */
export function SearchPill({
  value,
  onChange,
  label,
  onEnter,
}: {
  value: string;
  onChange: (next: string) => void;
  /** The placeholder, and the field's spoken name. */
  label: string;
  /** Open the top match, when there is one. */
  onEnter?: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={`chat-search${value ? ' has-query' : ''}`}>
      <span className="chat-search-icon">
        <SearchIcon />
      </span>
      <input
        ref={ref}
        type="search"
        value={value}
        placeholder={label}
        aria-label={label}
        enterKeyHint="go"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onChange('');
          } else if (e.key === 'Enter' && value.trim() && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
      />
      <button
        type="button"
        className="chat-search-clear press-fb"
        aria-label="Clear search"
        tabIndex={value ? 0 : -1}
        aria-hidden={!value}
        onClick={() => {
          onChange('');
          ref.current?.focus();
        }}
      >
        <Icon size={12}>
          <path d="M6 6l12 12" />
          <path d="M18 6 6 18" />
        </Icon>
      </button>
    </div>
  );
}

/** How long a deleted row takes to leave before it unmounts. */
const ROW_OUT_MS = 300;

type Row =
  | { kind: 'chat'; id: string; at: number; conv: Conversation; match: ChatMatch }
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
    openDesktopSession,
    showToast,
    settings,
  } = useApp();
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
  const compact = useCompact();

  const projects = settings.projects ?? [];

  // The chats in scope (lib/chatScope.ts), each with where the search found it.
  const q = query.trim().toLowerCase();
  const chats: Row[] = useMemo(
    () =>
      order.flatMap((id) => {
        const conv = conversations[id];
        if (!conv) return [];
        if (!inChatScope(conv)) return [];
        const match = matchChat(conv, q);
        if (!match) return [];
        const at = new Date(conv.updatedAt).getTime();
        return [{ kind: 'chat' as const, id, at, conv, match }];
      }),
    [order, conversations, q],
  );

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

  const openRow = (row: Row) => {
    if (row.kind === 'chat') {
      openConversation(row.id);
      return;
    }
    const s = row.session;
    // Listed from the active machine, so it opens there (lib/runsOn.ts).
    void openDesktopSession({ id: s.id, cwd: s.cwd, title: s.title, hub: daemon?.baseUrl }).catch(
      (err: unknown) => showToast(plainError(err)),
    );
  };

  // The row leaves before it unmounts, then the chat is gone.
  const removeChat = (id: string) => {
    setLeavingId(id);
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null;
      deleteConversation(id);
      setLeavingId(undefined);
      showToast('Chat deleted.');
    }, ROW_OUT_MS);
  };
  // Right-click: Open, Rename, Delete (components/ChatMenu.tsx); a hold
  // renames and a swipe deletes, both through the same sheets.
  const actions = useChatActions({ onDelete: removeChat });

  // The phone's bar carries the compose mark, and the list leads with a New
  // chat row. At 900px and wider the bar holds the labelled New chat, the
  // same button as Projects' New project (D11's grammar), and the row goes.
  const compose = compact ? (
    <button
      type="button"
      className="icon-btn press-fb"
      aria-label="New chat"
      title="New chat"
      onClick={() => {
        startNewChat();
      }}
    >
      <ComposeGlyph />
    </button>
  ) : (
    <button
      type="button"
      className="btn primary sm projects-bar-new"
      onClick={() => {
        startNewChat();
      }}
    >
      <PlusGlyph size={16} />
      New chat
    </button>
  );

  return (
    <div className="screen">
      <BackBar title="Chats" action={compose} />
      <div className="screen-inner chats">
        {/* No search over nothing: the field shows once there is a chat to
            find, and stays while anything is typed, spaces included. */}
        {rows.length > 0 || query ? (
          <SearchPill
            value={query}
            onChange={setQuery}
            label="Search chats"
            onEnter={rows[0] ? () => openRow(rows[0]!) : undefined}
          />
        ) : null}

        <div className="chat-list">
          {q || rows.length === 0 || !compact ? null : (
            <button
              type="button"
              className="chat-row chat-row-new press-fb press-fb--row"
              onClick={() => {
                startNewChat();
              }}
            >
              <span className="chat-row-title">
                <NewChatGlyph />
                New chat
              </span>
            </button>
          )}

          {rows.map((row, i) => {
            const style = { '--i': Math.min(i, 8) } as CSSProperties;
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
                    onClick={() => openRow(row)}
                  >
                    <span className="chat-row-title">
                      <span className="chat-row-remote" aria-hidden="true" />
                      <Marked text={name} query={q} />
                    </span>
                    <span className="chat-row-sub">
                      {s.updatedAt ? `${relativeTime(s.updatedAt)} · ` : ''}Running on your computer
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
                onToggle={() => actions.confirmDelete(row.id)}
                onLongPress={() => actions.rename(row.id)}
              >
                <div
                  className={`chat-row${row.id === activeId && view === 'chat' ? ' active' : ''}${row.id === leavingId ? ' leaving' : ''}`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openConversation(row.id);
                    } else if (e.key === 'Delete' || e.key === 'Backspace') {
                      e.preventDefault();
                      actions.confirmDelete(row.id);
                    }
                  }}
                  onContextMenu={(e) => actions.openMenu(e, row.id)}
                >
                  <span className="chat-row-title">
                    {conv.thread.busy ? (
                      <span className="chat-row-live" aria-label="working" />
                    ) : null}
                    <Marked text={conv.title} query={row.match.where === 'title' ? q : ''} />
                  </span>
                  {row.match.where === 'body' ? (
                    <span className="chat-row-snippet">
                      {row.match.before}
                      <mark className="chat-hit">{row.match.hit}</mark>
                      {row.match.after}
                    </span>
                  ) : null}
                  <span className="chat-row-sub">
                    <ReachDot reach={chatReach(conv)} />
                    {relativeTime(conv.updatedAt)} ·{' '}
                    {(conv.projectId && projects.find((p) => p.id === conv.projectId)?.name) ||
                      sourceShort(conv)}
                  </span>
                </div>
              </SwipeRow>
            );
          })}
        </div>

        {rows.length > 0 && !q ? (
          <p className="chat-list-hint">
            <span className="chat-hint-touch">
              Swipe a chat left to delete it. Hold it to rename.
            </span>
            <span className="chat-hint-pointer">
              Drag a chat left to delete it. Right-click for more.
            </span>
          </p>
        ) : null}

        {rows.length === 0 ? (
          <div className="chat-empty">
            <h2>{q ? `Nothing matches “${query.trim()}”` : 'Nothing here yet'}</h2>
            {q ? <p>Search looks through chat names and what was said in them.</p> : null}
            {!q ? <p>Every chat you start shows here, the ones in your projects too.</p> : null}
            {!q ? (
              <button type="button" className="btn ghost press-fb" onClick={() => startNewChat()}>
                Start a chat
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {actions.node}
    </div>
  );
}
