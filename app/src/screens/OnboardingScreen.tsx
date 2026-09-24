// The setup page: the ways to go further than the built-in guide, none
// required. A new person never lands here first; they open into Harbor Lite's
// chat, and its greeting carries the button that brings them here (founder,
// 2026-09-23). No Personal-or-Business question either: with no account,
// OpenShore runs as personal, and the choice is asked when an account is made.
// The path rows are the shared StartingPaths component, also reused in
// Settings so they never drift.
import { useApp } from '../state/store.js';
import { logEvent } from '../lib/insights.js';
import { BrandMark } from '../components/BrandMark.js';
import { StartingPaths } from '../components/StartingPaths.js';

export function OnboardingScreen() {
  const { setView, saveSettings } = useApp();

  const back = async () => {
    await saveSettings({ onboarded: true });
    logEvent('setup_page_back', { next: 'chat' });
    setView('chat');
  };

  return (
    <div className="shell-main">
      <div className="screen">
        <div className="screen-inner" style={{ paddingTop: 'calc(40px + var(--safe-top))' }}>
          <div style={{ textAlign: 'center', marginBottom: 26 }}>
            <span className="brand-lockup">
              <BrandMark size={30} />
              <span className="wordmark wordmark-lg">
                Open<span className="accent">Shore</span>
              </span>
            </span>
            <h1 style={{ marginTop: 14, fontFamily: 'var(--font-display)', fontWeight: 500 }}>
              Your computer. Your models. Your keys.
            </h1>
            <p className="lead" style={{ marginTop: 8 }}>
              Chat and build with local AI you own. Pick any starting point; you can add the rest
              whenever you want.
            </p>
          </div>

          <StartingPaths context="onboarding" />

          <button
            className="btn quiet"
            style={{ width: '100%', marginTop: 6 }}
            onClick={() => void back()}
          >
            Back to chat
          </button>
        </div>
      </div>
    </div>
  );
}
