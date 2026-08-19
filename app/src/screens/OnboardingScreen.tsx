// First run: three warm paths in, none required, all skippable. The point is
// a working chat in minutes, complexity strictly opt-in.
import { useApp } from '../state/store.js';
import { isDesktop } from '../lib/platform.js';
import { BrandMark } from '../components/BrandMark.js';

export function OnboardingScreen() {
  const { setView, saveSettings, newConversation } = useApp();

  const done = async (view?: Parameters<typeof setView>[0]) => {
    await saveSettings({ onboarded: true });
    if (view) setView(view);
    else setView('chat');
  };

  return (
    <div className="shell-main">
      <div className="screen">
        <div className="screen-inner" style={{ paddingTop: 'calc(40px + var(--safe-top))' }}>
          <div style={{ textAlign: 'center', marginBottom: 26 }}>
            <span className="brand-lockup">
              <BrandMark size={30} />
              <span className="wordmark" style={{ fontSize: 22 }}>
                <span className="accent">OS</span> Code
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

          {isDesktop() ? (
            <>
              <div className="card">
                <h3>Set up your local stack</h3>
                <div className="sub" style={{ marginBottom: 10 }}>
                  Grab a starter model from the marketplace. It runs on this machine through
                  Ollama; nothing leaves your desk.
                </div>
                <button className="btn primary" style={{ width: '100%' }} onClick={() => void done('marketplace')}>
                  Open the marketplace
                </button>
              </div>
              <div className="card">
                <h3>Open a repository</h3>
                <div className="sub" style={{ marginBottom: 10 }}>
                  Point OS Code at a repo and it reads, edits, and commits with your approval.
                </div>
                <button className="btn ghost" style={{ width: '100%' }} onClick={() => void done('repos')}>
                  Pick a repo
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="card">
                <h3>Put a model in your pocket</h3>
                <div className="sub" style={{ marginBottom: 10 }}>
                  Download a small model that runs fully on this iPhone. Private by construction,
                  works in airplane mode.
                </div>
                <button className="btn primary" style={{ width: '100%' }} onClick={() => void done('marketplace')}>
                  Get a pocket model
                </button>
              </div>
              <div className="card">
                <h3>Connect your desktop</h3>
                <div className="sub" style={{ marginBottom: 10 }}>
                  The full experience: your big models and your repos, from anywhere, over your
                  own private Tailscale network.
                </div>
                <button className="btn ghost" style={{ width: '100%' }} onClick={() => void done('pair')}>
                  Connect over Tailscale
                </button>
              </div>
            </>
          )}

          <div className="card">
            <h3>Or connect Claude</h3>
            <div className="sub" style={{ marginBottom: 10 }}>
              Cloud on your own key, for the hardest tasks. Always asks before it spends.
            </div>
            <button className="btn ghost" style={{ width: '100%' }} onClick={() => void done('connections')}>
              Add an API key
            </button>
          </div>

          <button
            className="btn quiet"
            style={{ width: '100%', marginTop: 6 }}
            onClick={async () => {
              await done();
              await newConversation({ kind: 'mock' });
              useApp.getState().send('Show me how this works.');
            }}
          >
            Just show me a demo
          </button>
        </div>
      </div>
    </div>
  );
}
