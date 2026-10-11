// The shell: persistent sidebar on wide screens, drawer on the phone, one
// active room. The chat is home; everything else is a short visit.
import { applyAppIcon } from './lib/appIconApply.js';
import { Suspense, lazy, useEffect, useRef, type ComponentType } from 'react';
import { Keyboard } from '@capacitor/keyboard';
import { useApp, type ViewName } from './state/store.js';
import { useAuthDeepLink } from './hooks/useAuthDeepLink.js';
import { useAutoUpdate } from './hooks/useAutoUpdate.js';
import { useSheetFocusTrap } from './hooks/useSheetFocusTrap.js';
import { hapticTick } from './lib/haptics.js';
import { platform } from './lib/platform.js';
import { Sidebar } from './components/Sidebar.js';
import { AuthConfirmSheet } from './components/AuthConfirmSheet.js';
import { WebSearchAsk } from './components/WebSearchAsk.js';
import { AccountGateSheet } from './components/AccountGateSheet.js';
import { ProfileSheet } from './components/ProfileSheet.js';
import { featureOn, roomOpen } from './lib/focus.js';
import { SlackWater } from './components/SlackWater.js';
import { CurrentArrival, CurrentWaterline } from './components/CurrentArrival.js';
import { UpdateBanner } from './components/UpdateBanner.js';
import { ChatScreen } from './screens/ChatScreen.js';
import { OnboardingScreen } from './screens/OnboardingScreen.js';
import { useCompact } from './hooks/useCompact.js';
import { useExitPresence } from './hooks/useExitPresence.js';
import { useRoomGhost } from './hooks/useRoomGhost.js';
import { useScrollMemory } from './hooks/useScrollMemory.js';
import { useDrawerGesture } from './hooks/useDrawerGesture.js';
import { useKeyboardInset } from './hooks/useKeyboardInset.js';
import { revealActionOf, revealPlan, scrollParentOf, viewTopOf } from './lib/revealField.js';
import { drawerExitMs, drawerWidth } from './lib/motion.js';

// Every room but the chat is its own chunk (review 9: the whole app used to
// arrive as one 2.5 MB file). The chat is home, on screen at launch, so it
// stays in the first chunk. The rest load a moment after launch, while the
// person reads the chat, so the first visit to a room does not wait on it.
const roomLoaders: Array<() => Promise<unknown>> = [];
function room<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  roomLoaders.push(load);
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}
/** How long after launch the rooms start loading in the background. */
const ROOM_WARM_MS = 1500;

const ChatsScreen = room(() => import('./screens/ChatsScreen.js'), 'ChatsScreen');
const StackScreen = room(() => import('./screens/StackScreen.js'), 'StackScreen');
const ConnectionsScreen = room(() => import('./screens/ConnectionsScreen.js'), 'ConnectionsScreen');
const ReposScreen = room(() => import('./screens/ReposScreen.js'), 'ReposScreen');
// The Vault inside its error boundary: a fault fails inside the room with a
// way out that works, never a blank app (0.10).
const VaultRoom = room(() => import('./screens/VaultScreen.js'), 'VaultRoom');
const ProjectsScreen = room(() => import('./screens/ProjectsScreen.js'), 'ProjectsScreen');
const ProjectDetailScreen = room(
  () => import('./screens/ProjectDetailScreen.js'),
  'ProjectDetailScreen',
);
const ProjectMemoryScreen = room(
  () => import('./screens/ProjectMemoryScreen.js'),
  'ProjectMemoryScreen',
);
const CrewScreen = room(() => import('./screens/CrewScreen.js'), 'CrewScreen');
const CrewCommandScreen = room(() => import('./screens/CrewCommandScreen.js'), 'CrewCommandScreen');
const PairScreen = room(() => import('./screens/PairScreen.js'), 'PairScreen');
const TerminalScreen = room(() => import('./screens/TerminalScreen.js'), 'TerminalScreen');
const TerminalRoomScreen = room(
  () => import('./screens/TerminalRoomScreen.js'),
  'TerminalRoomScreen',
);
const SettingsScreen = room(() => import('./screens/SettingsScreen.js'), 'SettingsScreen');

// The later tiers' rooms and surfaces (lib/focus.ts ROOM_FEATURE, and the
// teams sheets) exist only in a build that carries them. The gate is spelled
// here as comparisons on import.meta.env, not read from focus.ts, because the
// bundler settles which chunks a file emits from that file alone, before it
// folds another module's constants: only a literal in this file keeps a
// Personal build from emitting these rooms at all. roomOpen is the same gate
// at run time. app/test/tierBundle.test.ts holds these tiers to focus.ts and
// builds a Personal bundle to check none of it is there.
const BUILT_TIER = import.meta.env?.VITE_RELEASE_TIER?.trim();
const BUILT_V2 = BUILT_TIER === '2' || BUILT_TIER === '3' || BUILT_TIER === '4';
const BUILT_V3 = BUILT_TIER === '3' || BUILT_TIER === '4';
const BUILT_V4 = BUILT_TIER === '4';

const StackHealthScreen =
  BUILT_V2 && roomOpen('stackhealth')
    ? room(() => import('./screens/StackHealthScreen.js'), 'StackHealthScreen')
    : null;
const LaunchScreen =
  BUILT_V2 && roomOpen('launch')
    ? room(() => import('./screens/LaunchScreen.js'), 'LaunchScreen')
    : null;
const MarketplaceScreen =
  BUILT_V3 && roomOpen('marketplace')
    ? room(() => import('./screens/MarketplaceScreen.js'), 'MarketplaceScreen')
    : null;
const AdminScreen =
  BUILT_V4 && roomOpen('admin')
    ? room(() => import('./screens/AdminScreen.js'), 'AdminScreen')
    : null;
const AccountSetup =
  BUILT_V4 && featureOn('teams')
    ? room(() => import('./components/AccountSetup.js'), 'AccountSetup')
    : null;
const OrgJoinSheet =
  BUILT_V4 && featureOn('teams')
    ? room(() => import('./components/OrgJoinSheet.js'), 'OrgJoinSheet')
    : null;

/** The room each view opens. Chat, onboarding, and any view not listed fall
 *  to the chat. */
const ROOMS: Partial<Record<ViewName, ComponentType | null>> = {
  chats: ChatsScreen,
  stack: StackScreen,
  connections: ConnectionsScreen,
  repos: ReposScreen,
  vault: VaultRoom,
  projects: ProjectsScreen,
  project: ProjectDetailScreen,
  projectmemory: ProjectMemoryScreen,
  terminalroom: TerminalRoomScreen,
  terminal: TerminalScreen,
  crew: CrewScreen,
  crewcommand: CrewCommandScreen,
  pair: PairScreen,
  settings: SettingsScreen,
  stackhealth: StackHealthScreen,
  launch: LaunchScreen,
  marketplace: MarketplaceScreen,
  admin: AdminScreen,
};

export function App() {
  const { ready, view, drawerOpen, toast, init, reconcileEntitlementOnForeground, accountChoice } =
    useApp();
  const theme = useApp((s) => s.settings.theme);
  const appIcon = useApp((s) => s.settings.appIcon);
  const compact = useCompact();
  // The keyboard inset listener lives here, from boot, so no screen can
  // mount after the keyboard has already started to rise and miss it.
  useKeyboardInset();
  // The drawer and the toast stay mounted through their exits (motion standard:
  // everything that animates in animates out). The toast keeps its last text so
  // the fade-out does not empty the pill mid-flight. The drawer's hold is the
  // door clock (--dur-7 plus a hair), longer than the generic exit, so its
  // glide is never cut short.
  const drawer = useExitPresence(compact && drawerOpen, drawerExitMs());
  const toastPresence = useExitPresence(Boolean(toast));
  const lastToast = useRef(toast);
  if (toast) lastToast.current = toast;
  // The outgoing room dissolves under the incoming one (a DOM snapshot, not a
  // second mount), and the drawer follows the finger from the screen's edge.
  const mainRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  useRoomGhost(mainRef, ghostRef);
  useScrollMemory(mainRef);
  const setDrawer = useApp((s) => s.setDrawer);
  const gesture = useDrawerGesture({
    enabled: compact && view !== 'onboarding',
    open: drawerOpen,
    setOpen: setDrawer,
    width: drawerWidth(),
  });
  useAuthDeepLink();
  useAutoUpdate();
  useSheetFocusTrap();

  useEffect(() => {
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warm the rooms once the app is up, one at a time so no single task holds
  // the main thread long. A failed load is left for the room's own open to
  // retry.
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const t = window.setTimeout(() => {
      void (async () => {
        for (const load of roomLoaders) {
          if (!live) return;
          await load().catch(() => undefined);
        }
      })();
    }, ROOM_WARM_MS);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [ready]);

  // Apply the appearance preference to the document root. 'system' removes the
  // attribute so prefers-color-scheme decides; light/dark pin it. The browser
  // chrome's theme-color follows: index.html carries one meta per system
  // scheme, and a pinned theme points both at the active --bg.
  useEffect(() => {
    const root = document.documentElement;
    const pinned = theme === 'light' || theme === 'dark';
    if (pinned) root.dataset.theme = theme;
    else delete root.dataset.theme;
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      meta.dataset.system ??= meta.content;
      meta.content = pinned && bg ? bg : meta.dataset.system;
    });
  }, [theme]);

  // The app icon (Settings, Appearance): the in-app mark follows `data-icon`
  // at once; the device's own icon (the iPhone's Home Screen, the desktop's
  // Dock or window) is set only once the saved settings are in, so a launch
  // never flips it to the default and back. Setting the icon it already has
  // is a no-op on the iPhone, so iOS says nothing on a launch.
  useEffect(() => {
    const root = document.documentElement;
    if (appIcon && appIcon !== 'default') root.dataset.icon = appIcon;
    else delete root.dataset.icon;
    if (ready) void applyAppIcon(appIcon ?? 'default');
  }, [appIcon, ready]);

  // Keep a focused field above the on-screen keyboard. Our scroll lives in a
  // nested container, so Safari does not reliably lift the field itself. On a
  // touch device, once the keyboard has settled, lift any focused field the
  // keyboard is actually covering to just above it (fields already in view
  // are left alone, so a sticky composer is untouched).
  //
  // Coverage used to be measured from visualViewport shrinking for the
  // keyboard, but capacitor.config.ts now sets Keyboard.resize: 'none' (see
  // hooks/useKeyboardInset.ts for why), which means the webview's
  // frame, and so visualViewport, no longer shrinks for the keyboard at all.
  // Coverage is measured against the plugin's own keyboardHeight instead,
  // which stays correct under 'none'.
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    let keyboardHeight = 0;
    // The plugin is native only; where it is missing (the web) the inset
    // still comes from useKeyboardInset's kb-open reading, so a failed
    // registration must never stop the focus listener below.
    const listen = (event: 'keyboardWillShow' | 'keyboardWillHide', run: (h: number) => void) => {
      try {
        return Keyboard.addListener(event as 'keyboardWillShow', (info) =>
          run(info?.keyboardHeight ?? 0),
        ).catch(() => undefined);
      } catch {
        return Promise.resolve(undefined);
      }
    };
    const showHandle = listen('keyboardWillShow', (h) => {
      keyboardHeight = h;
    });
    const hideHandle = listen('keyboardWillHide', () => {
      keyboardHeight = 0;
    });
    const FIELD = 'input, textarea, [contenteditable="true"]';
    const reveal = (el: Element | null) => {
      if (!(el instanceof HTMLElement) || !el.matches(FIELD)) return;
      // The composer is already anchored just above the keyboard, so it never
      // needs recentering. Scrolling it forces a large page scroll that drags
      // the pinned empty-state greeting upward, which is exactly the jump we
      // do not want. Leave it be.
      if (el.closest('.composer')) return;
      // The inset the composer lifts by (useKeyboardInset corrects a stray
      // zero, a bare bar, and a hardware keyboard); the raw reading only when
      // that hook has not lifted.
      const root = document.documentElement;
      const inset = root.classList.contains('kb-open')
        ? parseFloat(getComputedStyle(root).getPropertyValue('--kb-inset')) || keyboardHeight
        : keyboardHeight;
      // Rest the field just above the keyboard (founder, 2026-10-02), not
      // centred: its own scroller moves, and the kb-open padding gives a field
      // near the foot of a room the room to rise.
      // A field marked with its commit button rises with it (CX, 2026-10-02).
      const scroller = scrollParentOf(el);
      const box = el.getBoundingClientRect();
      const delta = revealPlan({
        fieldTop: box.top,
        fieldBottom: box.bottom,
        actionBottom: revealActionOf(el)?.getBoundingClientRect().bottom,
        viewTop: viewTopOf(scroller),
        viewportHeight: window.innerHeight,
        inset,
      });
      if (delta > 0) scroller.scrollBy({ top: delta, behavior: 'smooth' });
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      window.setTimeout(() => reveal(el instanceof Element ? el : null), 300);
    };
    document.addEventListener('focusin', onFocusIn);
    // A field focused before the keyboard finished rising (a Connect tap that
    // autofocuses its key field) saw no inset at focus time: reveal it again
    // the moment the shell marks the keyboard open, on the next frame so the
    // kb-open padding has landed.
    let wasOpen = document.documentElement.classList.contains('kb-open');
    const watcher = new MutationObserver(() => {
      const open = document.documentElement.classList.contains('kb-open');
      if (open && !wasOpen) requestAnimationFrame(() => reveal(document.activeElement));
      wasOpen = open;
    });
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      watcher.disconnect();
      void showHandle.then((h) => h?.remove());
      void hideHandle.then((h) => h?.remove());
    };
  }, []);

  // Every tap gets a light haptic, one listener instead of wiring hapticTick
  // into every button across the app. The keyboard is exempt on its own: it
  // isn't a <button> and iOS already gives it system haptics. Capture phase
  // so a handler that calls stopPropagation downstream still gets counted.
  // This is the ONLY tick for a tap (UI-7): a component never ticks inside a
  // button's onClick, or the finger feels two. Components mark only the
  // moments a click cannot: a gesture's lift, arm, and drop, a keyboard
  // commit, and the streaming pulse.
  useEffect(() => {
    if (platform() !== 'ios') return;
    const onTap = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest('button:not(:disabled), [role="button"], a[href]')) hapticTick();
    };
    document.addEventListener('click', onTap, true);
    return () => document.removeEventListener('click', onTap, true);
  }, []);

  // When the app returns to the foreground, re-check a commercial org's seat
  // billing: Stripe checkout completes in the system browser, so seats land
  // on return. Native uses the Capacitor app-state event; web and Electron use
  // visibilitychange.
  useEffect(() => {
    let removeNative: (() => void) | undefined;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reconcileEntitlementOnForeground();
    };
    if (platform() === 'ios') {
      void (async () => {
        const { App: CapApp } = await import('@capacitor/app');
        const l = await CapApp.addListener('appStateChange', ({ isActive }) => {
          if (isActive) void reconcileEntitlementOnForeground();
        });
        removeNative = () => void l.remove();
      })();
    } else {
      document.addEventListener('visibilitychange', onVisible);
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      removeNative?.();
    };
  }, [reconcileEntitlementOnForeground]);

  if (!ready) return <div className="shell" />;

  // The setup page (reached from Harbor Lite's greeting) and the Personal or
  // Business choice (asked once, right after a new account is created) are
  // full-screen, over the rest of the app.
  // The Personal or Business choice is v4 (teams): a Personal build never
  // shows it (signUpAccount makes the account Personal instead).
  const choosingAccount = Boolean(accountChoice) && featureOn('teams');
  if (view === 'onboarding' || choosingAccount) {
    return (
      <div className="shell">
        {choosingAccount && AccountSetup ? (
          <Suspense fallback={null}>
            <AccountSetup />
          </Suspense>
        ) : (
          <OnboardingScreen />
        )}
        {toastPresence.mounted ? (
          <div
            className={`toast${toastPresence.closing ? ' closing' : ''}`}
            role="status"
            aria-live="polite"
          >
            {toast ?? lastToast.current}
          </div>
        ) : null}
      </div>
    );
  }

  // A later tier's room is null in a build without it, so its view (which
  // setView never opens there) falls through to the chat like any unknown one.
  const Room = ROOMS[view];
  const room = Room ? <Room /> : <ChatScreen compact={compact} />;

  return (
    // The frame stacks the desktop's update bar (when one is showing) above the
    // app, in the layout, so it never covers a screen's header.
    <div className="app-frame">
      <UpdateBanner />
      <div className="shell">
        {!compact ? <Sidebar /> : null}
        {/* Keyed on the view so switching rooms replays a soft fade-in instead of
          a hard cut. Same view (e.g. opening another chat) keeps the key, so a
          live transcript is never remounted mid-stream. */}
        {/* A room opened for the first time waits on its chunk in an empty
          shell-main with the same fade, then arrives with a fade of its own:
          a dissolve, never a spinner. */}
        <Suspense fallback={<div className="shell-main room-swap" aria-busy="true" />}>
          <div className="shell-main room-swap" key={view} ref={mainRef}>
            {room}
          </div>
        </Suspense>
        <div className="room-ghost-host" ref={ghostRef} aria-hidden="true" />
        {/* The zone must outlive the gesture it started: it holds the pointer
          capture, and an element removed mid-gesture loses it, so its release
          handler would never fire and the scrim would stay up, invisible,
          eating every tap. Hence `|| gesture.peek`, never `&& !gesture.peek`. */}
        {compact && (!drawerOpen || gesture.peek) ? (
          <div className="edge-swipe-zone" {...gesture.edgeProps} aria-hidden="true" />
        ) : null}
        {compact && (drawer.mounted || gesture.peek) ? (
          <Sidebar
            drawer
            closing={drawer.closing && !gesture.peek}
            dragX={gesture.dragX}
            settleMs={gesture.settleMs}
            exitMs={gesture.exitMs}
            dragging={gesture.dragging}
            viaGesture={gesture.viaGesture}
            progress={gesture.progress}
            dragProps={gesture.drawerProps}
          />
        ) : null}
        <AuthConfirmSheet />
        {OrgJoinSheet ? (
          <Suspense fallback={null}>
            <OrgJoinSheet />
          </Suspense>
        ) : null}
        <WebSearchAsk />
        <AccountGateSheet />
        <ProfileSheet />
        {/* Agentic Currents: the arrival that flows from the switch to the
          edges, and the faint water-line that frames every screen while a
          current is on. Both render nothing when none is on. */}
        <CurrentArrival />
        <CurrentWaterline />
        {/* Slack Water: the one-time carry from the setup walk's chat to the
            main chat page when the person chooses to just chat. */}
        <SlackWater />
        {toastPresence.mounted ? (
          <div
            className={`toast${toastPresence.closing ? ' closing' : ''}`}
            role="status"
            aria-live="polite"
          >
            {toast ?? lastToast.current}
          </div>
        ) : null}
      </div>
    </div>
  );
}
