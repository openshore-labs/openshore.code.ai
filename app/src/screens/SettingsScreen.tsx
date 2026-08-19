// Settings: the honest page. What this app is, where your data lives, and a
// couple of careful switches. No telemetry to toggle because there is none.
import { useApp } from '../state/store.js';
import { platform } from '../lib/platform.js';
import { clearInsights, insightsAsText, insightsCount } from '../lib/insights.js';
import { BackBar } from '../components/BackBar.js';

function keyStoreLabel(): string {
  switch (platform()) {
    case 'ios':
      return 'iOS Keychain';
    case 'electron':
      return 'system keychain';
    default:
      return 'browser store';
  }
}

export function SettingsScreen() {
  const { order, settings, deleteConversation, showToast, saveSettings, setView } = useApp();
  const insightsOn = Boolean(settings.insightsOptIn);

  const copyLog = async () => {
    const text = insightsAsText();
    try {
      await navigator.clipboard.writeText(text);
      showToast('Activity log copied. Paste it back to the team.');
    } catch {
      showToast('Copy is unavailable here. The log stays on this device.');
    }
  };

  return (
    <div className="screen">
      <BackBar title="Settings" />
      <div className="screen-inner">
        <h1>Settings</h1>
        <p className="lead">OS Code 0.1.0 · running as {platform()}</p>

        <div className="card">
          <h3>Privacy, plainly</h3>
          <div className="sub">
            Local models run on your hardware and nothing leaves it. Cloud models run on your own
            keys and only with your approval. Web search leaves your machine when the agent uses
            it. No telemetry, no analytics, no phone-home, ever.
          </div>
        </div>

        <div className="card">
          <h3>Encrypted on this device</h3>
          <div className="sub">
            Your chats, projects, crew, and settings are sealed at rest with AES-256. The key that
            unlocks them lives in this device's secure store, the {keyStoreLabel()}, and never
            leaves it. API keys are held there too. When you send a turn to a cloud provider, that
            one provider sees that one request on your own account. We do not, and there is nothing
            in between.
          </div>
        </div>

        <div className="card">
          <h3>Local models, honestly</h3>
          <div className="sub">
            Harbor and any model you run on this device are AI. They can be confidently wrong, and
            OpenShore does not filter what a local model says. Harbor is a small built-in guide, not
            a coder. For real work, connect a bigger model. What you type to a local model stays on
            this device. Harbor is Qwen2.5-0.5B-Instruct, used under the Apache License 2.0.
          </div>
        </div>

        <div className="card">
          <div className="card-row">
            <div className="grow">
              <h3>Help improve the test build</h3>
              <div className="sub">
                Records a plain activity log on this device, so we can see where setup goes
                smoothly or gets stuck. It stays here. Nothing is ever sent unless you copy it and
                hand it back yourself. Off by default.
              </div>
            </div>
            <button
              className={`btn ${insightsOn ? 'primary' : 'ghost'}`}
              style={{ padding: '8px 14px' }}
              onClick={() => {
                const next = !insightsOn;
                void saveSettings({ insightsOptIn: next });
                showToast(next ? 'Activity log on. It stays on this device.' : 'Activity log off.');
              }}
            >
              {insightsOn ? 'On' : 'Off'}
            </button>
          </div>
          {insightsOn ? (
            <div className="card-row" style={{ marginTop: 12 }}>
              <div className="grow">
                <div className="hint">{insightsCount()} events recorded on this device.</div>
              </div>
              <button
                className="btn ghost"
                style={{ padding: '8px 14px' }}
                onClick={() => void copyLog()}
              >
                Copy log
              </button>
              <button
                className="btn quiet"
                style={{ padding: '8px 14px' }}
                onClick={() => {
                  void clearInsights();
                  showToast('Activity log cleared.');
                }}
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>

        <div className="card">
          <div className="card-row">
            <div className="grow">
              <h3>Run onboarding again</h3>
              <div className="sub">The three starting paths, any time.</div>
            </div>
            <button
              className="btn ghost"
              style={{ padding: '8px 14px' }}
              onClick={async () => {
                await saveSettings({ onboarded: false });
                setView('onboarding');
              }}
            >
              Open
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-row">
            <div className="grow">
              <h3>Clear conversations</h3>
              <div className="sub">
                Removes every chat from this device. Desktop sessions keep their journals on the
                desktop.
              </div>
            </div>
            <button
              className="btn ghost"
              style={{ padding: '8px 14px' }}
              onClick={() => {
                for (const id of [...order]) deleteConversation(id);
                showToast('Conversations cleared.');
              }}
            >
              Clear
            </button>
          </div>
        </div>

        <p className="hint">
          OS Code by OpenShore. Familiar where it should be, yours where it matters.
        </p>
      </div>
    </div>
  );
}
