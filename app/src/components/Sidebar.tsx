// The sidebar is the app's main navigation (founder, 2026-09-02): the day-one
// rooms at the top, the second-session rooms at the bottom, nothing else. New
// chat and the project switcher live in the Chats and Projects rooms. Persistent on desktop, a slide-over drawer on the phone.
import type { CSSProperties } from 'react';
import { isOrgAdmin, useApp, type ViewName } from '../state/store.js';
import { useAuth } from '../hooks/useAuth.js';
import type { GestureProps } from '../hooks/useDrawerGesture.js';
import { BrandMark } from './BrandMark.js';

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
  'chat' | 'onboarding' | 'terminal' | 'project' | 'projectmemory'
>;

// The nav is split so a first-week user is not met with a dozen destinations
// at once (CMO ruling). PRIMARY is the day-one set, pinned to the top: chat,
// its project bucket, the coding surface (Repositories), where a model is
// attached (Your stack), and the Vault. Everything else is real but
// second-session, grouped at the bottom under an honest "More rooms" so it
// reads as depth, not clutter, with Settings as the last item.
const PRIMARY_NAV: Array<{ view: NavIconName; label: string }> = [
  { view: 'chats', label: 'Chats' },
  { view: 'projects', label: 'Projects' },
  { view: 'terminalroom', label: 'Terminal' },
  { view: 'repos', label: 'Repositories' },
  { view: 'stack', label: 'Your stack' },
  { view: 'vault', label: 'Vault' },
];

const EXPLORE_NAV: Array<{ view: NavIconName; label: string }> = [
  { view: 'crew', label: 'My Crew' },
  { view: 'marketplace', label: 'Marketplace' },
  { view: 'stackhealth', label: 'Stack Health' },
  { view: 'launch', label: 'Launch with Codemagic' },
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

export function Sidebar({
  drawer,
  closing,
  dragX = null,
  settleMs = null,
  exitMs = null,
  dragging = false,
  viaGesture = false,
  progress = null,
  dragProps,
}: {
  drawer?: boolean;
  closing?: boolean;
  /** Inline translateX while the drawer follows the finger or settles. */
  dragX?: number | null;
  /** Spring duration for a settle in flight (feeds --drawer-settle). */
  settleMs?: number | null;
  /** Exit duration after a drag-to-close (feeds --drawer-exit on panel and scrim). */
  exitMs?: number | null;
  dragging?: boolean;
  /** Opened by the edge swipe: skip the CSS entrance (the finger already did it). */
  viaGesture?: boolean;
  /** 0..1 for the scrim while dragging; null lets CSS own it. */
  progress?: number | null;
  dragProps?: GestureProps;
}) {
  const { view, setView, setDrawer, settings, personalUnlockedNow } = useApp();
  const { configured: authConfigured, signedIn } = useAuth();
  // Free is chat only. The Marketplace needs Personal, so a locked pill signals
  // it before the tap (tapping still opens the upgrade sheet via setView).
  const unlocked = personalUnlockedNow();
  const LOCKED_VIEWS = new Set<NavIconName>(['marketplace']);

  // --i is the row's place in the drawer's entrance stagger (theme.css
  // drawer-row-in): the wordmark is 0, the primary rooms follow, and the
  // bottom group carries on counting so the whole door fills top to bottom.
  const stagger = (i: number) => ({ '--i': i }) as CSSProperties;
  const item = ({ view: v, label }: { view: NavIconName; label: string }, i: number) => {
    const locked = !unlocked && LOCKED_VIEWS.has(v);
    return (
      <button
        key={v}
        className={`nav-item press-fb press-fb--row${view === v ? ' active' : ''}`}
        style={stagger(1 + i)}
        onClick={() => setView(v, { root: true })}
      >
        <span className="glyph">
          <NavIcon name={v} />
        </span>
        {label}
        {locked ? <span className="nav-lock-pill">Personal</span> : null}
      </button>
    );
  };

  const body = (
    <aside
      className={`sidebar${drawer ? ' drawer' : ''}${closing ? ' closing' : ''}${dragging ? ' dragging' : ''}${viaGesture ? ' via-gesture' : ''}`}
      // --drawer-x lets the exit keyframe (theme.css drawer-out) start from
      // the finger's position after a drag-to-close, so the door keeps sliding
      // rather than jumping back to open first.
      style={
        dragX !== null
          ? ({
              transform: `translateX(${dragX}px)`,
              '--drawer-x': `${dragX}px`,
              ...(settleMs !== null ? { '--drawer-settle': `${settleMs}ms` } : {}),
              // A drag-to-close leaves on the standard curve: its front-loaded
              // velocity carries the finger's momentum, where the glide's soft
              // start would read as a hitch.
              ...(exitMs !== null
                ? { '--drawer-exit': `${exitMs}ms`, '--drawer-exit-ease': 'var(--ease-standard)' }
                : {}),
            } as CSSProperties)
          : undefined
      }
      {...(drawer ? dragProps : {})}
    >
      <div className="sidebar-head" style={stagger(0)}>
        <span className="brand-lockup">
          <BrandMark size={26} />
          <span className="wordmark">
            Open<span className="accent">Shore</span>
          </span>
        </span>
      </div>

      {/* The day-one rooms, pinned to the top where the hand lands first. */}
      <nav className="sidebar-nav sidebar-nav--primary">
        {isOrgAdmin(settings.account) && settings.account?.type === 'commercial' ? (
          <button
            className={`nav-item press-fb press-fb--row${view === 'admin' ? ' active' : ''}`}
            style={stagger(1)}
            onClick={() => setView('admin', { root: true })}
          >
            <span className="glyph">
              <NavIcon name="admin" />
            </span>
            Admin
          </button>
        ) : null}
        {PRIMARY_NAV.map(item)}
      </nav>

      <div className="sidebar-spacer" />

      {authConfigured && !signedIn ? (
        <button
          type="button"
          className="sidebar-signin"
          style={stagger(1 + PRIMARY_NAV.length)}
          onClick={() => {
            setView('settings', { root: true });
            setDrawer(false);
          }}
        >
          <span className="sidebar-signin-avatar" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="8.5" r="3.4" />
              <path d="M5 20v-1a7 7 0 0 1 14 0v1" />
            </svg>
          </span>
          <span className="sidebar-signin-label">
            <span className="sidebar-signin-title">Sign in</span>
            <span className="sidebar-signin-sub">Sync chats across your devices</span>
          </span>
        </button>
      ) : null}

      {/* The second-session rooms stay at the bottom, Settings last. */}
      <nav className="sidebar-nav">
        <div className="nav-section-label">More rooms</div>
        {EXPLORE_NAV.map((entry, i) => item(entry, PRIMARY_NAV.length + 1 + i))}
      </nav>
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
                ...(exitMs !== null
                  ? { '--drawer-exit': `${exitMs}ms`, '--drawer-exit-ease': 'var(--ease-standard)' }
                  : {}),
              } as CSSProperties)
            : undefined
        }
        onClick={() => setDrawer(false)}
      />
      {body}
    </>
  );
}
