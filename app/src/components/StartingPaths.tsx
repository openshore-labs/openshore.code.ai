// The "starting paths": Harbor / your computer / repository / API key on the
// phone, or local stack / repository / API key on the desktop. The setup page
// shows them as cards, each idle one a single tap target with a one-line sub
// (D9, 2026-10-07); the explanations live in the rooms they open.
// Cards are the one rendering: the Settings rows variant rendered nowhere
// after D9 and is gone. In onboarding, choosing a path also marks onboarding
// done; anywhere else it just navigates.
import { useApp, type ViewName } from '../state/store.js';
import { isDesktop } from '../lib/platform.js';
import { logEvent } from '../lib/insights.js';
import { HARBOR_APPROX_LABEL, HARBOR_MODEL_ID } from '../lib/harbor.js';
import { thisDeviceNoun } from '../lib/deviceNoun.js';

/** Each idle path's name and its one line, in one table, so a card's words
 *  are said in one place. */
const PATH_COPY = {
  pair: { title: 'Connect your computer', sub: 'Use its models from here while it is on' },
  reposPhone: { title: 'Set up a repository', sub: 'Connect GitHub, GitLab, or Bitbucket' },
  stack: { title: 'Build your stack', sub: 'A model that runs on this computer' },
  reposDesk: {
    title: 'Open a repository',
    sub: 'OpenShore edits, commits, and shows you every change',
  },
  keys: { title: 'Add an API key', sub: 'Claude, OpenAI, or Gemini. You pay them directly.' },
} as const;

export function StartingPaths({ context }: { context: 'onboarding' | 'settings' }) {
  const {
    setView,
    saveSettings,
    startGuide,
    cancelHarbor,
    beginHarborWithIntro,
    settings,
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

  // One idle path is one tap target (D9, 2026-10-07): the card is the
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
    // The verb stays the title through every state: Get Harbor, Getting
    // Harbor, and Get Harbor again with Try again when it stopped.
    <div className="card path-card-state">
      <h3>Get Harbor</h3>
      <div className="hint path-card-failed">
        {harborDownload.label} Check your connection and try again.
      </div>
      <button
        className="btn ghost block press-fb"
        onClick={() => void getGuideAndGo(HARBOR_MODEL_ID)}
      >
        Try again
      </button>
    </div>
  ) : harborDownload ? (
    <div className="card path-card-state">
      <h3>Getting Harbor</h3>
      <div className="progress-track">
        <div
          className={`progress-fill${harborDownload.indeterminate ? ' indeterminate' : ''}`}
          style={
            harborDownload.indeterminate
              ? undefined
              : { transform: `scaleX(${harborDownload.percent / 100})` }
          }
        />
      </div>
      <div className="hint">
        {harborDownload.label}. Downloads once. Then it chats, and looks things up when it needs to.
      </div>
      <button className="btn quiet block press-fb" onClick={() => cancelHarbor()}>
        Cancel download
      </button>
    </div>
  ) : (
    pathCard('Get Harbor', `A coding model on ${thisDeviceNoun()}, ${HARBOR_APPROX_LABEL}`, () =>
      beginHarborWithIntro(),
    )
  );

  return (
    <>
      {!isDesktop() ? (
        // The built-in guide is the chat a new person opens into, and this page
        // is the optional tier, reached from Harbor Lite's greeting. Creative
        // Studio "The Standing Light" (2026-09-04; 2026-09-23).
        <>
          {harborCard}
          {pathCard(PATH_COPY.pair.title, PATH_COPY.pair.sub, () => void go('pair'))}
          {pathCard(PATH_COPY.reposPhone.title, PATH_COPY.reposPhone.sub, () => void go('repos'))}
        </>
      ) : (
        <>
          {pathCard(PATH_COPY.stack.title, PATH_COPY.stack.sub, () => void go('stack'))}
          {pathCard(PATH_COPY.reposDesk.title, PATH_COPY.reposDesk.sub, () => void go('repos'))}
        </>
      )}
      {pathCard(PATH_COPY.keys.title, PATH_COPY.keys.sub, () => void go('connections'))}
    </>
  );
}
