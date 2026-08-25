// First run: three warm paths in, none required, all skippable. The point is
// a working chat in minutes, complexity strictly opt-in. The path rows are the
// shared StartingPaths component, also reused in Settings so they never drift.
import { useApp } from '../state/store.js';
import { logEvent } from '../lib/insights.js';
import { BrandMark } from '../components/BrandMark.js';
import { AccountSetup } from '../components/AccountSetup.js';
import { StartingPaths } from '../components/StartingPaths.js';

export function OnboardingScreen() {
  const { setView, saveSettings, settings } = useApp();

  // First of all, choose Personal or Commercial. Everything else follows.
  if (!settings.account) return <AccountSetup />;

  const skip = async () => {
    await saveSettings({ onboarded: true });
    logEvent('onboarding_done', { next: 'chat' });
    setView('chat');
  };

  return (
    <div className="shell-main">
      <div className="screen">
        <div className="screen-inner" style={{ paddingTop: 'calc(40px + var(--safe-top))' }}>
          <div style={{ textAlign: 'center', marginBottom: 26 }}>
            <span className="brand-lockup">
              <BrandMark size={30} />
              <span className="wordmark" style={{ fontSize: 22 }}>
                Open<span className="accent">Shore</span>
              </span>
            </span>
            <h1 style={{ marginTop: 14, fontFamily: 'var(--font-display)', fontWeight: 500 }}>
              Your machine. Your models. Your keys.
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
            onClick={() => void skip()}
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
