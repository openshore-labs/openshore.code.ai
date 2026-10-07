// The "starting paths": Harbor / your computer / repository / API key on the
// phone, or local stack / repository / API key on the desktop. The setup page
// shows them as cards, each idle one a single tap target with a one-line sub
// (D9, founder 2026-10-07); the explanations live in the rooms they open. The
// rows variant is the same paths as ledger rows, from the same source. In
// onboarding, choosing a path also marks onboarding done; in Settings we are
// already in, so it just navigates.
import { SAMPLE_ROW_LABEL, SAMPLE_ROW_SUB } from '../lib/sampleProject.js';
import { useApp, type ViewName } from '../state/store.js';
import { isDesktop } from '../lib/platform.js';
import { logEvent } from '../lib/insights.js';
import { HARBOR_APPROX_LABEL, HARBOR_MODEL_ID } from '../lib/harbor.js';
import { HARBOR_MINI_APPROX_LABEL, HARBOR_MINI_MODEL_ID } from '../lib/harborMini.js';
import { SettingsRow } from './SettingsRow.js';
import { thisDeviceNoun } from '../lib/deviceNoun.js';

export function StartingPaths({
  context,
  variant = 'cards',
}: {
  context: 'onboarding' | 'settings';
  /** `cards` is the setup page; `rows` is the settings ledger's list, the
   *  same paths as one-line rows. One source, two renderings. */
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
    trySampleProject,
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

  // One idle path is one tap target (D9, founder 2026-10-07): the card is the
  // button, its title the verb, one line under it, and the drawn chevron of
  // every card or row that opens something. No inner button.
  const pathCard = (title: string, sub: string, onClick: () => void) => (
    <button type="button" className="card card-disclosure press-fb press-fb--row" onClick={onClick}>
      <span className="path-card-text">
        <span className="path-card-title">{title}</span>
        <span className="sub">{sub}</span>
      </span>
      <span className="disclosure-chevron" aria-hidden="true" />
    </button>
  );

  // Harbor's download, retry and cancel states keep their controls, since a
  // card that is busy has more than one thing to say.
  const harborCard = settings.harborReady ? (
    pathCard(
      'Chat with Harbor',
      `Ready on ${thisDeviceNoun()}`,
      () => void getGuideAndGo(HARBOR_MODEL_ID),
    )
  ) : harborDownload?.failed ? (
    <div className="card">
      <h3>Harbor</h3>
      <div className="hint" style={{ color: 'var(--danger)', marginBottom: 10 }}>
        {harborDownload.label} Check your connection and try again.
      </div>
      <button className="btn ghost block" onClick={() => void getGuideAndGo(HARBOR_MODEL_ID)}>
        Try again
      </button>
    </div>
  ) : harborDownload ? (
    <div className="card">
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
      <button className="btn quiet block" style={{ marginTop: 8 }} onClick={() => cancelHarbor()}>
        Cancel download
      </button>
    </div>
  ) : (
    pathCard('Get Harbor', `A coding model on ${thisDeviceNoun()}, ${HARBOR_APPROX_LABEL}`, () =>
      beginHarborWithIntro(),
    )
  );

  if (variant === 'rows') {
    const guideRow = (
      id: string,
      name: string,
      size: string,
      sub: string,
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
      return <SettingsRow label={`Get ${name}`} sub={sub} value={size} onClick={begin} />;
    };
    return (
      <>
        {!isDesktop()
          ? guideRow(
              HARBOR_MODEL_ID,
              'Harbor',
              HARBOR_APPROX_LABEL,
              'A coding model on this device',
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
              'The built-in guide',
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
              sub="Reads, edits, and commits, and shows you every change"
              onClick={() => void go('repos')}
            />
            <SettingsRow
              label={SAMPLE_ROW_LABEL}
              sub={SAMPLE_ROW_SUB}
              onClick={() => void trySampleProject()}
            />
          </>
        ) : (
          <>
            <SettingsRow
              label="Connect your computer"
              sub="Your computer's models, from here, while it is on"
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
          label="Add an API key"
          sub="Claude, OpenAI, or Gemini, at your provider's price"
          onClick={() => void go('connections')}
        />
      </>
    );
  }

  return (
    <>
      {!isDesktop() ? (
        // The built-in guide is the chat a new person opens into, and this page
        // is the optional tier, reached from Harbor Lite's greeting. Creative
        // Studio "The Standing Light" (2026-09-04; founder 2026-09-23).
        <>
          {harborCard}
          {pathCard(
            'Connect your computer',
            'Use its models from here while it is on',
            () => void go('pair'),
          )}
          {pathCard(
            'Set up a repository',
            'Connect GitHub, GitLab, or Bitbucket',
            () => void go('repos'),
          )}
        </>
      ) : (
        <>
          {pathCard(
            'Build your stack',
            'A model on this computer, through Ollama',
            () => void go('stack'),
          )}
          {pathCard(
            'Open a repository',
            'Reads, edits, and commits, and shows you every change',
            () => void go('repos'),
          )}
        </>
      )}
      {pathCard(
        'Add an API key',
        'Claude, OpenAI, or Gemini, at their price',
        () => void go('connections'),
      )}
    </>
  );
}
