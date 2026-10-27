// The sidebar is the app's main navigation (2026-09-02), in two groups
// (founder, 2026-10-19): Chats, Projects, Stack, Agents, the Local Library
// and Cloud Connections at the top, and Terminal, Repositories, the Vault and
// Computer under the recent chats, above Settings, in navRooms' order. The project switcher lives in the Projects room. New chat
// is an action, not a room (design review, 2026-10-12): the phone's drawer
// carries it as a floating button over its bottom right, the desktop's
// sidebar as a compose icon in its head, never as a nav row. Persistent on desktop, a slide-over drawer on the phone.
//
// The person's own order (2026-10-01): every room can be dragged to
// a new place, in its group or across to the other (hooks/useNavReorder.ts,
// lib/sidebarOrder.ts). The recent chats sit under the top group, as many as
// fit cleanly, with View all to the Chats room. Settings and the sign-in card
// are pinned to the bottom and never move.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { roomOpen } from '../lib/focus.js';
import { platform } from '../lib/platform.js';
import { isMacLike, newChatShortcutLabel } from '../lib/newChat.js';
import { ComposeGlyph } from './SheetGlyphs.js';
import { ACCOUNT_SIGN_IN_SUB } from '../lib/accountGate.js';
import { accountInitial, useProfileSheet } from '../lib/profile.js';
import { isOrgAdmin, useApp, type ViewName } from '../state/store.js';
import { useAuth } from '../hooks/useAuth.js';
import { BrandMark } from './BrandMark.js';
import { ROOM_LABELS, navRooms, type NavRoom } from '../lib/navRooms.js';
import { Icon } from './Icon.js';
import {
  NAV_ORDER_VERSION,
  recentFit,
  resolveNavOrder,
  type MovableRoom,
  type NavOrder,
} from '../lib/sidebarOrder.js';
import { useNavReorder } from '../hooks/useNavReorder.js';
import { durationMs } from '../lib/motion.js';
import type { Conversation } from '../state/types.js';
import { inChatScope } from '../lib/chatScope.js';
import { useChatActions } from './ChatMenu.js';

// Every view that has a nav glyph: all ViewNames except the ones that never
// appear as a nav item (chat is home; onboarding and terminal are full-screen
// takeovers reached from within a chat). 'admin' is already a ViewName, so this
// is the honest form of the reviewer's `Record<ViewName | 'admin', ...>` without
// demanding unused icons. Typing ICON_NODES and NavIcon by it makes a missing or
// misspelled key a compile error instead of a silently empty SVG (CR3).
// 'project' is a detail room reached by tapping a project, not a nav
// destination, so it never appears in the sidebar or needs an icon; likewise
// 'projectmemory' is the read-only notes view reached from the Vault.
type NavIconName = Exclude<
  ViewName,
  'chat' | 'onboarding' | 'terminal' | 'project' | 'projectmemory' | 'crewcommand'
>;

// A page inside a room keeps that room lit: the project room lights Projects,
// Crew command lights Crew, and the full-screen terminal lights Terminal.
const ROOM_OF: Partial<Record<ViewName, NavIconName>> = {
  project: 'projects',
  crewcommand: 'crew',
  terminal: 'terminalroom',
};

const nav = (view: NavIconName & NavRoom) => ({ view, label: ROOM_LABELS[view] });

type NavEntry = { view: NavIconName; label: string };

// Settings is pinned to the bottom, under every room and above the sign-in
// card, in both layouts (2026-10-01).
const SETTINGS: NavEntry = nav('settings');

/** The order before the person has moved anything (founder, 2026-10-19):
 *  navRooms' upper group above the recent chats and its lower group under
 *  them, above Settings. It replaced one group above the recent chats
 *  (2026-10-01). The release tier takes a later tier's rooms out inside
 *  navRooms, at the one door (a Personal build shows the v1 rooms only; see
 *  lib/focus.ts). */
export function defaultNavOrder(): NavOrder {
  const { primary, explore } = navRooms();
  const movable = (list: { view: NavRoom }[]) =>
    list.map((e) => e.view).filter((v): v is MovableRoom => v !== 'settings');
  return { top: movable(primary), bottom: movable(explore) };
}

const entryOf = (view: MovableRoom): NavEntry => nav(view);

// Hand-drawn line icons for the nav, in the same language as PairScreen's
// download tiles: a 24-unit grid, 2px round-cap / round-join strokes, and
// currentColor so `.nav-item.active` tints the current room's glyph --accent
// with no per-icon color.
// Each depicts its room in a calm monochrome studio style. Decorative only; the
// text label beside each carries the name for assistive tech.
const ICON_NODES: Record<NavIconName, JSX.Element> = {
  // Two overlapping speech bubbles: the chat history, the way Claude marks it.
  chats: (
    <>
      <path d="M4 15.5V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H7.5L4 15.5Z" />
      <path d="M9 16.2a2 2 0 0 0 2 2h5.5L20 21.7V13" />
    </>
  ),
  // Stacked project layers (buckets seen edge-on).
  projects: (
    <>
      <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" />
      <path d="M3 12l9 4.5 9-4.5" />
      <path d="M3 16.5 12 21l9-4.5" />
    </>
  ),
  // A terminal window with a prompt caret: the shell, wrapped in.
  terminalroom: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 10l3 2.5L7 15" />
      <path d="M12.5 15H16" />
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
  // A storefront with its awning: the Local Library.
  library: (
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
  // A cut gem, the shape every Obsidian hand knows: the vault.
  vault: (
    <>
      <path d="M12 3 19 9l-7 12L5 9l7-6Z" />
      <path d="M5 9h14" />
      <path d="M12 3 9.6 9l2.4 12" />
      <path d="M12 3l2.4 6L12 21" />
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
    <Icon size={20} className="nav-glyph">
      {ICON_NODES[name]}
    </Icon>
  );
}

/** A room's own glyph, where a screen draws the same thing (the project tile,
 *  the repositories door). */
export function RoomGlyph({ name, size }: { name: 'projects' | 'repos' | 'crew'; size: number }) {
  return <Icon size={size}>{ICON_NODES[name]}</Icon>;
}

export function Sidebar({
  drawer,
  closing,
  dragX = null,
  settleMs = null,
  dragging = false,
  viaGesture = false,
  progress = null,
}: {
  drawer?: boolean;
  closing?: boolean;
  /** Inline translateX while the drawer follows the finger or settles. */
  dragX?: number | null;
  /** Spring duration for a settle in flight (feeds --drawer-settle). */
  settleMs?: number | null;
  dragging?: boolean;
  /** Opened by the edge swipe: skip the CSS entrance (the finger already did it). */
  viaGesture?: boolean;
  /** 0..1 for the scrim while dragging; null lets CSS own it. */
  progress?: number | null;
}) {
  const { view, viewTrail, setView, setDrawer, settings, saveSettings, startNewChat } = useApp();
  const { configured: authConfigured, signedIn, email } = useAuth();
  const showProfile = useProfileSheet((st) => st.show);
  // An order saved under an older default is set aside once, so every room
  // comes up in the founder's two groups (2026-10-19); the person's moves
  // from here on keep.
  const savedOrder = settings.navOrder?.v === NAV_ORDER_VERSION ? settings.navOrder : undefined;
  const saved = resolveNavOrder(savedOrder, defaultNavOrder());
  const reorder = useNavReorder(
    saved,
    (next) => void saveSettings({ navOrder: { ...next, v: NAV_ORDER_VERSION } }),
  );
  const order = reorder.order;

  // The drawer's rows arrive one after another, once. After that (or the
  // moment a row is lifted) the entrance is switched off, so a row that moves
  // to the other group, and so mounts again there, never replays it.
  const [entered, setEntered] = useState(!drawer);
  useEffect(() => {
    if (entered) return;
    const t = window.setTimeout(
      () => setEntered(true),
      durationMs('--dur-2', 120) + durationMs('--dur-5', 320) + 20 * durationMs('--stagger', 40),
    );
    return () => window.clearTimeout(t);
  }, [entered]);
  if (reorder.lifted && !entered) setEntered(true);

  // --i is the row's place in the drawer's entrance stagger (theme.css
  // drawer-row-in): the wordmark is 0, the top rooms follow, and the rest
  // carry on counting so the whole door fills top to bottom.
  const stagger = (i: number) => ({ '--i': i }) as CSSProperties;
  const shortcut = newChatShortcutLabel(platform(), isMacLike());
  // The project notes open from a project or from the Vault; light the one they came from.
  const lit =
    view === 'projectmemory'
      ? viewTrail.includes('vault')
        ? 'vault'
        : 'projects'
      : (ROOM_OF[view] ?? view);
  const item = ({ view: v, label }: NavEntry, i: number, opts: { movable?: boolean } = {}) => {
    const movable = opts.movable && v !== 'settings' && v !== 'admin';
    const lifted = movable && reorder.lifted === v;
    return (
      <button
        key={v}
        className={`nav-item press-fb press-fb--row${lit === v ? ' active' : ''}${movable ? ' nav-item--movable' : ''}${lifted ? ' lifted' : ''}`}
        style={stagger(1 + i)}
        aria-current={lit === v ? 'page' : undefined}
        onClick={() => setView(v, { root: true })}
        {...(movable ? reorder.rowProps(v as MovableRoom) : {})}
      >
        <span className="glyph">
          <NavIcon name={v} />
        </span>
        {label}
      </button>
    );
  };

  const adminItem = (i: number) =>
    isOrgAdmin(settings.account) && settings.account?.type === 'commercial' && roomOpen('admin')
      ? item({ view: 'admin', label: 'Admin' }, i)
      : null;

  // The person's two groups as they left them.
  const top = order.top.map(entryOf);
  const bottom = order.bottom.map(entryOf);
  const hasAdmin = adminItem(0) !== null;
  const afterTop = top.length;
  const afterRecents = afterTop + 1;
  const afterBottom = afterRecents + (hasAdmin ? 1 : 0) + bottom.length;

  const body = (
    <aside
      className={`sidebar${drawer ? ' drawer' : ''}${drawer && entered ? ' entered' : ''}${closing ? ' closing' : ''}${dragging ? ' dragging' : ''}${viaGesture ? ' via-gesture' : ''}`}
      // --drawer-x lets the exit keyframe (theme.css drawer-out) start from
      // wherever the panel stands, so a tap during a settle slides on from
      // there rather than jumping back to open first.
      style={
        dragX !== null
          ? ({
              transform: `translateX(${dragX}px)`,
              '--drawer-x': `${dragX}px`,
              ...(settleMs !== null ? { '--drawer-settle': `${settleMs}ms` } : {}),
            } as CSSProperties)
          : undefined
      }
    >
      <div className="sidebar-head" style={stagger(0)}>
        <span className="brand-lockup">
          <BrandMark size={26} />
          <span className="wordmark">
            Open<span className="accent">Shore</span>
          </span>
        </span>
        {/* The desktop's door to a new chat, where Claude's desktop keeps it;
            the phone's drawer has the floating button instead. */}
        {!drawer ? (
          <button
            type="button"
            className="icon-btn sidebar-compose press-fb"
            onClick={() => startNewChat()}
            aria-label="New chat"
            title={shortcut ? `New chat (${shortcut})` : 'New chat'}
          >
            <ComposeGlyph size={20} />
          </button>
        ) : null}
      </div>

      {/* The top group, where the hand lands first, the person's to reorder. */}
      <nav className="sidebar-nav sidebar-nav--primary">
        {top.map((entry, i) => item(entry, i, { movable: true }))}
      </nav>

      <RecentChats divider={reorder.dividerRef} i={1 + afterTop} drawer={drawer} />

      {/* The second-session rooms, the person's to reorder. Admin, when the
          account carries it, leads the group. */}
      <nav className="sidebar-nav">
        {adminItem(afterRecents)}
        {bottom.map((entry, i) =>
          item(entry, afterRecents + (hasAdmin ? 1 : 0) + i, { movable: true }),
        )}
      </nav>

      {/* Pinned to the bottom: Settings, then the account
          card under it (2026-10-01): Sign in while signed out, and
          once signed in the same card names the account and opens the
          profile (2026-10-02). */}
      <div className="sidebar-foot">
        {/* The drawer's New chat floats over its bottom right, above the foot,
            where the thumb already is; it arrives with the door and leaves
            with it. Always a plain chat: the drawer is global. */}
        {drawer ? (
          <button
            type="button"
            className="sidebar-fab press-fb"
            style={stagger(3 + afterBottom)}
            onClick={() => startNewChat()}
            aria-label="New chat"
          >
            <ComposeGlyph size={22} />
          </button>
        ) : null}
        {item(SETTINGS, afterBottom)}
        {authConfigured && !signedIn ? (
          <button
            type="button"
            className="sidebar-signin"
            style={stagger(2 + afterBottom)}
            onClick={() => {
              setView('settings', { root: true });
              setDrawer(false);
            }}
          >
            <span className="sidebar-signin-avatar" aria-hidden="true">
              <Icon size={18}>
                <circle cx="12" cy="8.5" r="3.4" />
                <path d="M5 20v-1a7 7 0 0 1 14 0v1" />
              </Icon>
            </span>
            <span className="sidebar-signin-label">
              <span className="sidebar-signin-title">Sign in</span>
              <span className="sidebar-signin-sub">{ACCOUNT_SIGN_IN_SUB}</span>
            </span>
          </button>
        ) : authConfigured && signedIn ? (
          <button
            type="button"
            className="sidebar-signin sidebar-account"
            style={stagger(2 + afterBottom)}
            aria-label={`Profile, signed in as ${email ?? 'you'}`}
            onClick={() => {
              setDrawer(false);
              showProfile();
            }}
          >
            <span className="sidebar-signin-avatar sidebar-account-avatar" aria-hidden="true">
              {accountInitial(email)}
            </span>
            <span className="sidebar-signin-label">
              <span className="sidebar-signin-title sidebar-account-name">{email}</span>
            </span>
          </button>
        ) : null}
      </div>
    </aside>
  );

  if (!drawer) return body;
  return (
    <>
      <div
        // While closing, the scrim hands its held opacity to the exit keyframe
        // (--drawer-scrim) instead of freezing under the dragging class.
        className={`drawer-scrim${closing ? ' closing' : ''}${dragging || (progress !== null && !closing) ? ' dragging' : ''}${viaGesture ? ' via-gesture' : ''}`}
        style={
          progress !== null
            ? ({
                opacity: progress,
                '--drawer-scrim': progress,
              } as CSSProperties)
            : undefined
        }
        onClick={() => setDrawer(false)}
      />
      {body}
    </>
  );
}

// The recent chats between the two groups: as many as fit cleanly in the space
// the groups leave, newest first, then View all to the Chats room. Same reach
// as that room (lib/chatScope.ts), so View all shows the same list continued.
// The fixed row heights live in theme.css (.sidebar-recents).
const RECENT_ROW = 34;
const RECENT_HEAD = 30;
const RECENT_FOOT = 36;
/** In the drawer the last rows keep clear of the floating New chat. */
const RECENT_FAB = 16;
/** With no way to measure (no ResizeObserver), a short list rather than none. */
const RECENT_UNMEASURED = 5;

export function recentChats(
  order: readonly string[],
  conversations: Record<string, Conversation>,
): Conversation[] {
  return order
    .map((id) => conversations[id])
    .filter(
      (c): c is Conversation =>
        Boolean(c) &&
        // A fresh chat with nothing said yet is not a place to dip back into.
        !(c!.title === 'New chat' && c!.thread.items.length === 0) &&
        inChatScope(c!),
    )
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function RecentChats({
  divider,
  i,
  drawer,
}: {
  divider?: (el: HTMLElement | null) => void;
  i: number;
  drawer?: boolean;
}) {
  const { order, conversations, activeId, view, openConversation, setView } = useApp();
  const chats = recentChats(order, conversations);
  // Right-click a recent chat: Open, Rename, Delete (components/ChatMenu.tsx).
  const actions = useChatActions();
  const box = useRef<HTMLElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    setHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit =
    height === null
      ? Math.min(chats.length, RECENT_UNMEASURED)
      : recentFit(
          height,
          RECENT_ROW,
          RECENT_HEAD + RECENT_FOOT + (drawer ? RECENT_FAB : 0),
          chats.length,
        );
  const shown = chats.slice(0, fit);

  return (
    <section
      className="sidebar-recents"
      aria-label="Recent chats"
      style={{ '--i': i } as CSSProperties}
      ref={(el) => {
        box.current = el;
        divider?.(el);
      }}
    >
      {shown.length > 0 ? (
        <>
          <h2 className="sidebar-recents-head">
            <span>Recents</span>
          </h2>
          {shown.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`sidebar-recent press-fb press-fb--row${view === 'chat' && activeId === c.id ? ' active' : ''}`}
              onClick={() => openConversation(c.id)}
              onContextMenu={(e) => actions.openMenu(e, c.id)}
            >
              {c.title || 'New chat'}
            </button>
          ))}
          <button
            type="button"
            className="sidebar-recents-all press-fb press-fb--row"
            onClick={() => setView('chats', { root: true })}
          >
            View all
            <Icon size={14}>
              <path d="M9 6l6 6-6 6" />
            </Icon>
          </button>
        </>
      ) : null}
      {actions.node}
    </section>
  );
}
