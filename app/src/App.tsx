// The shell: persistent sidebar on wide screens, drawer on the phone, one
// active room. The chat is home; everything else is a short visit.
import { useEffect, useState } from 'react';
import { useApp } from './state/store.js';
import { useAuthDeepLink } from './hooks/useAuthDeepLink.js';
import { Sidebar } from './components/Sidebar.js';
import { ChatScreen } from './screens/ChatScreen.js';
import { MarketplaceScreen } from './screens/MarketplaceScreen.js';
import { StackScreen } from './screens/StackScreen.js';
import { StackHealthScreen } from './screens/StackHealthScreen.js';
import { ConnectionsScreen } from './screens/ConnectionsScreen.js';
import { ReposScreen } from './screens/ReposScreen.js';
import { ProjectsScreen } from './screens/ProjectsScreen.js';
import { CrewScreen } from './screens/CrewScreen.js';
import { AdminScreen } from './screens/AdminScreen.js';
import { LaunchScreen } from './screens/LaunchScreen.js';
import { PairScreen } from './screens/PairScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { OnboardingScreen } from './screens/OnboardingScreen.js';

function useCompact(): boolean {
  const [compact, setCompact] = useState(() => window.innerWidth < 900);
  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return compact;
}

export function App() {
  const { ready, view, drawerOpen, toast, init } = useApp();
  const compact = useCompact();
  useAuthDeepLink();

  useEffect(() => {
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a focused field above the on-screen keyboard. iOS shrinks the visual
  // viewport for the keyboard but not the layout, and our scroll lives in a
  // nested container, so Safari does not reliably lift the field itself. On a
  // touch device, once the keyboard has settled, center any focused field that
  // the keyboard is actually covering (fields already in view are left alone,
  // so a sticky composer is untouched).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !window.matchMedia('(pointer: coarse)').matches) return;
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      if (!el.matches('input, textarea, [contenteditable="true"]')) return;
      window.setTimeout(() => {
        const visibleBottom = vv.offsetTop + vv.height;
        if (el.getBoundingClientRect().bottom > visibleBottom - 24) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }, 300);
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  if (!ready) return <div className="shell" />;

  if (view === 'onboarding') {
    return (
      <div className="shell">
        <OnboardingScreen />
        {toast ? <div className="toast">{toast}</div> : null}
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
    ) : view === 'settings' ? (
      <SettingsScreen />
    ) : (
      <ChatScreen compact={compact} />
    );

  return (
    <div className="shell">
      {!compact ? <Sidebar /> : null}
      <div className="shell-main">{room}</div>
      {compact && drawerOpen ? <Sidebar drawer /> : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
