// The shell: persistent sidebar on wide screens, drawer on the phone, one
// active room. The chat is home; everything else is a short visit.
import { useEffect, useState } from 'react';
import { useApp } from './state/store.js';
import { Sidebar } from './components/Sidebar.js';
import { ChatScreen } from './screens/ChatScreen.js';
import { MarketplaceScreen } from './screens/MarketplaceScreen.js';
import { StackScreen } from './screens/StackScreen.js';
import { ConnectionsScreen } from './screens/ConnectionsScreen.js';
import { ReposScreen } from './screens/ReposScreen.js';
import { ProjectsScreen } from './screens/ProjectsScreen.js';
import { CrewScreen } from './screens/CrewScreen.js';
import { AdminScreen } from './screens/AdminScreen.js';
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

  useEffect(() => {
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
