// The shell: persistent sidebar on wide screens, drawer on the phone, one
// active room. The chat is home; everything else is a short visit.
import { useEffect, useRef } from 'react';
import { Keyboard } from '@capacitor/keyboard';
import { useApp } from './state/store.js';
import { useAuthDeepLink } from './hooks/useAuthDeepLink.js';
import { useSheetFocusTrap } from './hooks/useSheetFocusTrap.js';
import { hapticTick } from './lib/haptics.js';
import { platform } from './lib/platform.js';
import { Sidebar } from './components/Sidebar.js';
import { Paywall } from './components/Paywall.js';
import { ChatScreen } from './screens/ChatScreen.js';
import { ChatsScreen } from './screens/ChatsScreen.js';
import { MarketplaceScreen } from './screens/MarketplaceScreen.js';
import { StackScreen } from './screens/StackScreen.js';
import { StackHealthScreen } from './screens/StackHealthScreen.js';
import { ConnectionsScreen } from './screens/ConnectionsScreen.js';
import { ReposScreen } from './screens/ReposScreen.js';
import { VaultScreen } from './screens/VaultScreen.js';
import { ProjectsScreen } from './screens/ProjectsScreen.js';
import { CrewScreen } from './screens/CrewScreen.js';
import { AdminScreen } from './screens/AdminScreen.js';
import { LaunchScreen } from './screens/LaunchScreen.js';
import { PairScreen } from './screens/PairScreen.js';
import { TerminalScreen } from './screens/TerminalScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { OnboardingScreen } from './screens/OnboardingScreen.js';
import { useCompact } from './hooks/useCompact.js';
import { useExitPresence } from './hooks/useExitPresence.js';
import { useRoomGhost } from './hooks/useRoomGhost.js';
import { useScrollMemory } from './hooks/useScrollMemory.js';
import { useDrawerGesture } from './hooks/useDrawerGesture.js';
import { useKeyboardInset } from './hooks/useKeyboardInset.js';
import { drawerWidth } from './lib/motion.js';

export function App() {
  const { ready, view, drawerOpen, toast, init, reconcileEntitlementOnForeground } = useApp();
  const theme = useApp((s) => s.settings.theme);
  const compact = useCompact();
  // The keyboard inset listener lives here, from boot, so no screen can
  // mount after the keyboard has already started to rise and miss it.
  useKeyboardInset();
  // The drawer and the toast stay mounted through their exits (motion standard:
  // everything that animates in animates out). The toast keeps its last text so
  // the fade-out does not empty the pill mid-flight.
  const drawer = useExitPresence(compact && drawerOpen);
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
  useSheetFocusTrap();

  useEffect(() => {
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply the appearance preference to the document root. 'system' removes the
  // attribute so prefers-color-scheme decides; light/dark pin it.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
    else delete root.dataset.theme;
  }, [theme]);

  // Keep a focused field above the on-screen keyboard. Our scroll lives in a
  // nested container, so Safari does not reliably lift the field itself. On a
  // touch device, once the keyboard has settled, center any focused field that
  // the keyboard is actually covering (fields already in view are left alone,
  // so a sticky composer is untouched).
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
    const showHandle = Keyboard.addListener('keyboardWillShow', (info) => {
      keyboardHeight = info.keyboardHeight;
    });
    const hideHandle = Keyboard.addListener('keyboardWillHide', () => {
      keyboardHeight = 0;
    });
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      if (!el.matches('input, textarea, [contenteditable="true"]')) return;
      // The composer is already anchored just above the keyboard, so it never
      // needs recentering. Scrolling it to center forces a large page scroll
      // that drags the pinned empty-state greeting upward, which is exactly the
      // jump we do not want. Leave it be.
      if (el.closest('.composer')) return;
      window.setTimeout(() => {
        const visibleBottom = window.innerHeight - keyboardHeight;
        if (el.getBoundingClientRect().bottom > visibleBottom - 24) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }, 300);
    };
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      void showHandle.then((h) => h.remove());
      void hideHandle.then((h) => h.remove());
    };
  }, []);

  // Every tap gets a light haptic, one listener instead of wiring hapticTick
  // into every button across the app. The keyboard is exempt on its own: it
  // isn't a <button> and iOS already gives it system haptics. Capture phase
  // so a handler that calls stopPropagation downstream still gets counted.
  useEffect(() => {
    if (platform() !== 'ios') return;
    const onTap = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest('button:not(:disabled)')) hapticTick();
    };
    document.addEventListener('click', onTap, true);
    return () => document.removeEventListener('click', onTap, true);
  }, []);

  // When the app returns to the foreground, re-check the Personal entitlement.
  // Stripe checkout completes in the system browser, so the unlock is written
  // server-side while OS Code is backgrounded. This makes it land on return
  // instead of leaving a paid user staring at the paywall. Native uses the
  // Capacitor app-state event; web and Electron use visibilitychange.
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

  if (view === 'onboarding') {
    return (
      <div className="shell">
        <OnboardingScreen />
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

  const room =
    view === 'marketplace' ? (
      <MarketplaceScreen />
    ) : view === 'stack' ? (
      <StackScreen />
    ) : view === 'stackhealth' ? (
      <StackHealthScreen />
    ) : view === 'connections' ? (
      <ConnectionsScreen />
    ) : view === 'repos' ? (
      <ReposScreen />
    ) : view === 'vault' ? (
      <VaultScreen />
    ) : view === 'projects' ? (
      <ProjectsScreen />
    ) : view === 'crew' ? (
      <CrewScreen />
    ) : view === 'admin' ? (
      <AdminScreen />
    ) : view === 'launch' ? (
      <LaunchScreen />
    ) : view === 'pair' ? (
      <PairScreen />
    ) : view === 'terminal' ? (
      <TerminalScreen />
    ) : view === 'settings' ? (
      <SettingsScreen />
    ) : view === 'chats' ? (
      <ChatsScreen />
    ) : (
      <ChatScreen compact={compact} />
    );

  return (
    <div className="shell">
      {!compact ? <Sidebar /> : null}
      {/* Keyed on the view so switching rooms replays a soft fade-in instead of
          a hard cut. Same view (e.g. opening another chat) keeps the key, so a
          live transcript is never remounted mid-stream. */}
      <div className="shell-main room-swap" key={view} ref={mainRef}>
        {room}
      </div>
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
      <Paywall />
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
