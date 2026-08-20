// Settings: the honest page. What this app is, where your data lives, and a
// couple of careful switches. No telemetry to toggle because there is none.
import { useEffect, useState } from 'react';
import { isOrgAdmin, useApp } from '../state/store.js';
import { platform } from '../lib/platform.js';
import { bridge } from '../lib/electronBridge.js';
import { tierById, priceLabel } from '../lib/plans.js';
import { clearInsights, insightsAsText, insightsCount } from '../lib/insights.js';
import { BackBar } from '../components/BackBar.js';
import { SignInCard } from '../components/SignInCard.js';
import { StartingPaths } from '../components/StartingPaths.js';
import type { StackHealthSealFact } from 'os-code/protocol';

// The live seal, measured by the engine (never asserted): the same three
// check-rows Stack Health shows, here where someone goes looking for the
// privacy story. Desktop only; the phone's own data is sealed by the app and
// the desktop's journals answer for themselves on the desktop.
function LiveSeal() {
  const [facts, setFacts] = useState<StackHealthSealFact[] | undefined>();
  useEffect(() => {
    const b = bridge();
    if (!b) return;
    let live = true;
    b.stackHealth('day')
      .then((h) => live && setFacts(h.seal))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!facts) return null;
  return (
    <>
      <ul className="sh-seal-facts" style={{ marginTop: 12 }}>
        {facts.map((f) => (
          <li className={`sh-seal-fact sh-${f.state}`} key={f.key}>
            <span className="sh-seal-dot" aria-hidden="true" />
            {f.label}
          </li>
        ))}
      </ul>
      <p className="hint" style={{ marginTop: 8 }}>
        Measured on this machine just now, not promised.
      </p>
    </>
  );
}

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
  const account = settings.account;
  const org = account?.org;

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
            keys and only with your approval. Web search leaves your machine when the agent uses it.
            No telemetry, no analytics, no phone-home, ever.
          </div>
        </div>

        <SignInCard />

        {account ? (
          <div className="card">
            <div className="card-row">
              <div className="grow">
                <h3>
                  {account.type === 'commercial'
                    ? (org?.name ?? 'Company account')
                    : 'Personal account'}
                </h3>
                <div className="sub">
                  {account.type === 'commercial' && org
                    ? `${tierById(org.tierId).name} plan · ${priceLabel(tierById(org.tierId))} · ${org.members.length} ${org.members.length === 1 ? 'person' : 'people'}`
                    : 'Free. For your own work.'}
                </div>
              </div>
              {account.type === 'commercial' && isOrgAdmin(account) ? (
                <button
                  className="btn ghost"
                  style={{ padding: '8px 14px' }}
                  onClick={() => setView('admin')}
                >
                  Manage
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="card">
          <h3>Encrypted on this device</h3>
          <div className="sub">
            Your chats, projects, crew, settings, and session journals are sealed at rest with
            AES-256. The key that unlocks them stays on this device, held in its secure store, the{' '}
            {keyStoreLabel()}, whenever one is available, and it never leaves this machine. API keys
            are held the same way. When you send a turn to a cloud provider, that one provider sees
            that one request on your own account. We do not, and there is nothing in between.
          </div>
          <LiveSeal />
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
                Records a plain activity log on this device, so we can see where setup goes smoothly
                or gets stuck. It stays here. Nothing is ever sent unless you copy it and hand it
                back yourself. Off by default.
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

        <div style={{ marginTop: 22, marginBottom: 6 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 18 }}>
            Add to your setup
          </h3>
          <p className="sub">The starting paths, any time.</p>
        </div>
        <StartingPaths context="settings" />

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
