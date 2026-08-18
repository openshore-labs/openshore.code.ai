// Settings: the honest page. What this app is, where your data lives, and a
// couple of careful switches. No telemetry to toggle because there is none.
import { useApp } from '../state/store.js';
import { platform } from '../lib/platform.js';
import { BackBar } from '../components/BackBar.js';

export function SettingsScreen() {
  const { order, deleteConversation, showToast, saveSettings, setView } = useApp();

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
