// The "starting paths" rows: Harbor / bigger pocket model / desktop / Claude on
// the phone, or local stack / repository / Claude on the desktop. Shown on
// first-run onboarding and, as a permanent shortcut, in Settings, from one
// source so the two never drift. In onboarding, choosing a path also marks
// onboarding done; in Settings we are already in, so it just navigates.
import { useApp, type ViewName } from '../state/store.js';
import { isDesktop } from '../lib/platform.js';
import { logEvent } from '../lib/insights.js';
import { HARBOR_APPROX_LABEL, HARBOR_MODEL_ID } from '../lib/harbor.js';
import { HARBOR_MINI_APPROX_LABEL, HARBOR_MINI_MODEL_ID } from '../lib/harborMini.js';

export function StartingPaths({ context }: { context: 'onboarding' | 'settings' }) {
  const {
    setView,
    saveSettings,
    startGuide,
    cancelHarborMini,
    cancelHarbor,
    beginHarborMiniWithIntro,
    beginHarborWithIntro,
    settings,
    harborMiniDownload,
    harborDownload,
  } = useApp();

  const go = async (view: ViewName) => {
    if (context === 'onboarding') {
      await saveSettings({ onboarded: true });
      logEvent('onboarding_done', { next: view });
    }
    setView(view);
  };

  // Get a guide here (progress shows in the card), then drop into its chat.
  // startGuide downloads first if needed and only opens once ready.
  const getGuideAndGo = async (modelId: string) => {
    const id = await startGuide(modelId);
    if (id && context === 'onboarding') {
      await saveSettings({ onboarded: true });
      logEvent('onboarding_done', { next: modelId });
    }
  };

  const harborCard = (
    <div className="card">
      {settings.harborReady ? (
        <>
          <h3>Chat with Harbor</h3>
          <div className="sub" style={{ marginBottom: 10 }}>
            Your preferred guide is ready. It runs on this iPhone and can search the web.
          </div>
          <button
            className="btn primary"
            style={{ width: '100%' }}
            onClick={() => void getGuideAndGo(HARBOR_MODEL_ID)}
          >
            Open Harbor
          </button>
        </>
      ) : harborDownload?.failed ? (
        <>
          <h3>Start with Harbor</h3>
          <div className="hint" style={{ color: 'var(--danger)', marginBottom: 10 }}>
            {harborDownload.label} Check your connection and try again.
          </div>
          <button
            className="btn primary"
            style={{ width: '100%' }}
            onClick={() => void getGuideAndGo(HARBOR_MODEL_ID)}
          >
            Retry
          </button>
        </>
      ) : harborDownload ? (
        <>
          <h3>Getting Harbor</h3>
          <div className="progress-track" style={{ marginTop: 4 }}>
            <div
              className={`progress-fill${harborDownload.indeterminate ? ' indeterminate' : ''}`}
              style={
                harborDownload.indeterminate
                  ? undefined
                  : { transform: `scaleX(${harborDownload.percent / 100})` }
              }
            />
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {harborDownload.label}. A one-time download, then you chat, and search when it needs to.
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
          <h3>Start with Harbor, your preferred guide</h3>
          <div className="sub" style={{ marginBottom: 10 }}>
            The recommended first model ({HARBOR_APPROX_LABEL}), running on this iPhone. It gets you
            set up, answers questions, and searches the web when it needs to.
          </div>
          <button
            className="btn primary"
            style={{ width: '100%' }}
            onClick={() => beginHarborWithIntro()}
          >
            Get Harbor
          </button>
        </>
      )}
    </div>
  );

  const harborMiniCard = (
    <div className="card">
      {settings.harborMiniReady ? (
        <>
          <h3>Chat with Harbor Mini</h3>
          <div className="sub" style={{ marginBottom: 10 }}>
            Your smaller built-in guide is ready. It runs on this iPhone, offline.
          </div>
          <button
            className="btn ghost"
            style={{ width: '100%' }}
            onClick={() => void getGuideAndGo(HARBOR_MINI_MODEL_ID)}
          >
            Open Harbor Mini
          </button>
        </>
      ) : harborMiniDownload?.failed ? (
        <>
          <h3>Start with Harbor Mini</h3>
          <div className="hint" style={{ color: 'var(--danger)', marginBottom: 10 }}>
            {harborMiniDownload.label} Check your connection and try again.
          </div>
          <button
            className="btn ghost"
            style={{ width: '100%' }}
            onClick={() => void getGuideAndGo(HARBOR_MINI_MODEL_ID)}
          >
            Retry
          </button>
        </>
      ) : harborMiniDownload ? (
        <>
          <h3>Getting Harbor Mini</h3>
          <div className="progress-track" style={{ marginTop: 4 }}>
            <div
              className={`progress-fill${harborMiniDownload.indeterminate ? ' indeterminate' : ''}`}
              style={
                harborMiniDownload.indeterminate
                  ? undefined
                  : { transform: `scaleX(${harborMiniDownload.percent / 100})` }
              }
            />
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {harborMiniDownload.label}. A one-time download, then you chat offline.
          </div>
          <button
            className="btn quiet"
            style={{ width: '100%', marginTop: 8 }}
            onClick={() => cancelHarborMini()}
          >
            Cancel, I will connect my own stack
          </button>
        </>
      ) : (
        <>
          <h3>Or start with Harbor Mini, the smaller guide</h3>
          <div className="sub" style={{ marginBottom: 10 }}>
            A lighter download ({HARBOR_MINI_APPROX_LABEL}), no web search, otherwise the same idea.
          </div>
          <button
            className="btn ghost"
            style={{ width: '100%' }}
            onClick={() => beginHarborMiniWithIntro()}
          >
            Get Harbor Mini instead
          </button>
        </>
      )}
    </div>
  );

  return (
    <>
      {!isDesktop() ? harborCard : null}
      {!isDesktop() ? harborMiniCard : null}

      {isDesktop() ? (
        <>
          <div className="card">
            <h3>Set up your local stack</h3>
            <div className="sub" style={{ marginBottom: 10 }}>
              Grab a starter model from the marketplace. It runs on this machine through Ollama;
              nothing leaves your desk.
            </div>
            <button
              className="btn primary"
              style={{ width: '100%' }}
              onClick={() => void go('marketplace')}
            >
              Open the marketplace
            </button>
          </div>
          <div className="card">
            <h3>Open a repository</h3>
            <div className="sub" style={{ marginBottom: 10 }}>
              Point OpenShore at a repo and it reads, edits, and commits with your approval.
            </div>
            <button
              className="btn ghost"
              style={{ width: '100%' }}
              onClick={() => void go('repos')}
            >
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
            <button
              className="btn ghost"
              style={{ width: '100%' }}
              onClick={() => void go('marketplace')}
            >
              Browse pocket models
            </button>
          </div>
          <div className="card">
            <h3>Connect your desktop</h3>
            <div className="sub" style={{ marginBottom: 10 }}>
              The full experience: your big models and your repos, from anywhere, over your own
              private Tailscale network.
            </div>
            <button className="btn ghost" style={{ width: '100%' }} onClick={() => void go('pair')}>
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
        <button
          className="btn ghost"
          style={{ width: '100%' }}
          onClick={() => void go('connections')}
        >
          Add an API key
        </button>
      </div>
    </>
  );
}
