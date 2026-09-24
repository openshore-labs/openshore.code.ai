// The "starting paths" rows: Harbor / desktop / repository / Claude on the
// phone, or local stack / repository / Claude on the desktop. Shown on
// first-run onboarding and, as a permanent shortcut, in Settings, from one
// source so the two never drift. In onboarding, choosing a path also marks
// onboarding done; in Settings we are already in, so it just navigates.
import { useApp, type ViewName } from '../state/store.js';
import { isDesktop } from '../lib/platform.js';
import { logEvent } from '../lib/insights.js';
import { HARBOR_APPROX_LABEL, HARBOR_MODEL_ID } from '../lib/harbor.js';
import { HARBOR_MINI_APPROX_LABEL, HARBOR_MINI_MODEL_ID } from '../lib/harborMini.js';
import { SettingsRow } from './SettingsRow.js';

export function StartingPaths({
  context,
  variant = 'cards',
}: {
  context: 'onboarding' | 'settings';
  /** `cards` is the onboarding wall; `rows` is the settings ledger's list,
   *  the same paths as one-line rows. One source, two renderings. */
  variant?: 'cards' | 'rows';
}) {
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
            The coder is ready. It runs on this iPhone and can search the web.
          </div>
          <button
            className="btn ghost"
            style={{ width: '100%' }}
            onClick={() => void getGuideAndGo(HARBOR_MODEL_ID)}
          >
            Open Harbor
          </button>
        </>
      ) : harborDownload?.failed ? (
        <>
          <h3>Get Harbor</h3>
          <div className="hint" style={{ color: 'var(--danger)', marginBottom: 10 }}>
            {harborDownload.label} Check your connection and try again.
          </div>
          <button
            className="btn ghost"
            style={{ width: '100%' }}
            onClick={() => void getGuideAndGo(HARBOR_MODEL_ID)}
          >
            Try again
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
          <h3>Get Harbor</h3>
          <div className="sub" style={{ marginBottom: 10 }}>
            A coding model that runs on this iPhone. Real reasoning, web search, writes real code.
            About {HARBOR_APPROX_LABEL}.
          </div>
          <button
            className="btn ghost"
            style={{ width: '100%' }}
            onClick={() => beginHarborWithIntro()}
          >
            Get Harbor
          </button>
        </>
      )}
    </div>
  );

  if (variant === 'rows') {
    const guideRow = (
      id: string,
      name: string,
      size: string,
      ready: boolean | undefined,
      dl: typeof harborDownload,
      begin: () => void,
      cancel: () => void,
    ) => {
      if (ready) {
        return (
          <SettingsRow
            label={`Chat with ${name}`}
            sub="Ready on this device"
            value="Open"
            onClick={() => void getGuideAndGo(id)}
          />
        );
      }
      if (dl?.failed) {
        return (
          <SettingsRow
            label={`Get ${name}`}
            sub={`${dl.label} Check your connection.`}
            value="Try again"
            onClick={() => void getGuideAndGo(id)}
          />
        );
      }
      if (dl) {
        return (
          <SettingsRow
            label={`Getting ${name}`}
            sub={
              <span className="settings-progress">
                <span className="progress-track">
                  <span
                    className={`progress-fill${dl.indeterminate ? ' indeterminate' : ''}`}
                    style={
                      dl.indeterminate ? undefined : { transform: `scaleX(${dl.percent / 100})` }
                    }
                  />
                </span>
                {dl.label}
              </span>
            }
            value="Cancel"
            onClick={cancel}
          />
        );
      }
      return (
        <SettingsRow
          label={`Get ${name}`}
          sub="A guide that runs on this device"
          value={size}
          onClick={begin}
        />
      );
    };
    return (
      <>
        {!isDesktop()
          ? guideRow(
              HARBOR_MODEL_ID,
              'Harbor',
              HARBOR_APPROX_LABEL,
              settings.harborReady,
              harborDownload,
              beginHarborWithIntro,
              cancelHarbor,
            )
          : null}
        {!isDesktop()
          ? guideRow(
              HARBOR_MINI_MODEL_ID,
              'Harbor Lite',
              HARBOR_MINI_APPROX_LABEL,
              settings.harborMiniReady,
              harborMiniDownload,
              beginHarborMiniWithIntro,
              cancelHarborMini,
            )
          : null}
        {isDesktop() ? (
          <>
            <SettingsRow
              label="Build your stack"
              sub="A model on this computer, through Ollama"
              onClick={() => void go('stack')}
            />
            <SettingsRow
              label="Open a repository"
              sub="Read, edit, and commit with your approval"
              onClick={() => void go('repos')}
            />
          </>
        ) : (
          <>
            <SettingsRow
              label="Connect your computer"
              sub="Your model, from anywhere, over Tailscale"
              onClick={() => void go('pair')}
            />
            <SettingsRow
              label="Set up a repository"
              sub="Connect GitHub and pick a home repository"
              onClick={() => void go('repos')}
            />
          </>
        )}
        <SettingsRow
          label="Connect your own API key"
          sub="Claude, OpenAI, or Gemini, at your provider's price"
          onClick={() => void go('connections')}
        />
      </>
    );
  }

  return (
    <>
      {!isDesktop() ? (
        // The built-in guide is the chat a new person opens into, and its
        // greeting links here, so this page is only the "go further" tier.
        // Creative Studio "The Standing Light" (2026-09-04; founder 2026-09-23).
        <>
          <p className="paths-further-head">When you're ready to go further</p>
          {harborCard}
          <div className="card">
            <h3>Connect your computer</h3>
            <div className="sub" style={{ marginBottom: 10 }}>
              Run your model on your own computer and reach it from your phone over your private
              Tailscale network. Your computer does the work, so it does not drain your battery, and
              a long answer keeps going even when you close the app.
            </div>
            <button className="btn ghost" style={{ width: '100%' }} onClick={() => void go('pair')}>
              Connect your computer
            </button>
          </div>
          <div className="card">
            <h3>Set up a repository</h3>
            <div className="sub" style={{ marginBottom: 10 }}>
              Connect GitHub or another platform on your own access token and pick a home
              repository. OpenShore reads, edits, and commits there with your approval.
            </div>
            <button
              className="btn ghost"
              style={{ width: '100%' }}
              onClick={() => void go('repos')}
            >
              Set up a repository
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="card">
            <h3>Set up your local stack</h3>
            <div className="sub" style={{ marginBottom: 10 }}>
              Point OpenShore at a model running on this computer through Ollama. Open Stack to
              install DeepBlue, sized to your computer. It stays on your desk.
            </div>
            <button
              className="btn primary"
              style={{ width: '100%' }}
              onClick={() => void go('stack')}
            >
              Build your stack
            </button>
          </div>
          <div className="card">
            <h3>Open a repository</h3>
            <div className="sub" style={{ marginBottom: 10 }}>
              Point OpenShore at a repository and it reads, edits, and commits with your approval.
            </div>
            <button
              className="btn ghost"
              style={{ width: '100%' }}
              onClick={() => void go('repos')}
            >
              Pick a repository
            </button>
          </div>
        </>
      )}

      <div className="card">
        <h3>Connect your own API key</h3>
        <div className="sub" style={{ marginBottom: 10 }}>
          Chat stays free. Add an API key for Claude, OpenAI, or Gemini and go further, at your
          provider's price. Your API key stays on your device.
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
