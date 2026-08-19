// First run: three warm paths in, none required, all skippable. The point is
// a working chat in minutes, complexity strictly opt-in.
import { useApp } from '../state/store.js';
import { isDesktop } from '../lib/platform.js';
import { logEvent } from '../lib/insights.js';
import { HARBOR_APPROX_LABEL } from '../lib/harbor.js';
import { BrandMark } from '../components/BrandMark.js';

export function OnboardingScreen() {
  const { setView, saveSettings, startGuide, cancelHarbor, settings, harborDownload } = useApp();

  const done = async (view?: Parameters<typeof setView>[0]) => {
    await saveSettings({ onboarded: true });
    logEvent('onboarding_done', { next: view ?? 'chat' });
    if (view) setView(view);
    else setView('chat');
  };

  // Get Harbor here (progress shows in the card below), then drop into its
  // chat. startGuide downloads first if needed and only opens once ready.
  const getHarborAndGo = async () => {
    const id = await startGuide();
    if (id) {
      await saveSettings({ onboarded: true });
      logEvent('onboarding_done', { next: 'harbor' });
    }
  };

  const harborCard = (
    <div className="card">
      {settings.harborReady ? (
        <>
          <h3>Chat with Harbor</h3>
          <div className="sub" style={{ marginBottom: 10 }}>
            Your built-in guide is ready. It runs on this iPhone, offline.
          </div>
          <button className="btn primary" style={{ width: '100%' }} onClick={() => void getHarborAndGo()}>
            Open Harbor
          </button>
        </>
      ) : harborDownload?.failed ? (
        <>
          <h3>Start with Harbor</h3>
          <div className="hint" style={{ color: 'var(--danger)', marginBottom: 10 }}>
            {harborDownload.label} Check your connection and try again.
          </div>
          <button className="btn primary" style={{ width: '100%' }} onClick={() => void getHarborAndGo()}>
            Retry
          </button>
        </>
      ) : harborDownload ? (
        <>
          <h3>Getting Harbor</h3>
          <div className="progress-track" style={{ marginTop: 4 }}>
            <div
              className={`progress-fill${harborDownload.indeterminate ? ' indeterminate' : ''}`}
              style={harborDownload.indeterminate ? undefined : { width: `${harborDownload.percent}%` }}
            />
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {harborDownload.label}. A one-time download, then you chat offline.
          </div>
          <button
            className="btn quiet"
            style={{ width: '100%', marginTop: 8 }}
            onClick={() => cancelHarbor()}
          >
            Cancel, I will connect my own stack
          </button>
        </>
      ) : (
        <>
          <h3>Start with Harbor, your free guide</h3>
          <div className="sub" style={{ marginBottom: 10 }}>
            Download a small assistant ({HARBOR_APPROX_LABEL}) that runs on this iPhone. It gets you
            set up and answers questions, offline once it is here.
          </div>
          <button className="btn primary" style={{ width: '100%' }} onClick={() => void getHarborAndGo()}>
            Get Harbor and start chatting
          </button>
        </>
      )}
    </div>
  );

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

          {!isDesktop() ? harborCard : null}

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
                <h3>Add a bigger pocket model</h3>
                <div className="sub" style={{ marginBottom: 10 }}>
                  When you want more than a guide, download a larger model that runs fully on this
                  iPhone. Private by construction, works in airplane mode.
                </div>
                <button className="btn ghost" style={{ width: '100%' }} onClick={() => void done('marketplace')}>
                  Browse pocket models
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
            onClick={() => void done()}
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
