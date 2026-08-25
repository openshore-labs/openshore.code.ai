// Cloud Connections: add the big cloud LLM providers on your own key. Each
// provider you connect puts its models on your Bench, ready to place in your
// stack (as the Reasoning LLM or a specialist). Keys live in this device's
// Keychain, scoped to the provider, and are spent only with your approval.
import { useState } from 'react';
import { useApp } from '../state/store.js';
import { PROVIDERS } from '../lib/providers.js';
import { BackBar } from '../components/BackBar.js';
import { openInAppBrowser } from '../lib/platform.js';

export function ConnectionsScreen() {
  const { connectedProviders, connectProvider, disconnectProvider, showToast, setView } = useApp();
  const [editing, setEditing] = useState<string | undefined>();
  const [value, setValue] = useState('');

  const save = async (id: string, name: string) => {
    const key = value.trim();
    setEditing(undefined);
    setValue('');
    if (!key) return;
    await connectProvider(id, key);
    showToast(`${name} connected. Its models are on your bench.`);
  };

  return (
    <div className="screen">
      <BackBar title="Cloud Connections" />
      <div className="screen-inner">
        <h1>Cloud Connections</h1>
        <p className="lead">
          Add a provider on your own key. Its models land on your Bench, ready to place. Keys stay
          on this device, and nothing cloud runs without your say.
        </p>

        {PROVIDERS.map((p) => {
          const on = Boolean(connectedProviders[p.id]);
          return (
            <div className="card" key={p.id}>
              <div className="card-row">
                <div className="grow">
                  <h3>{p.name}</h3>
                  <div className="sub">
                    {p.models.length} models. Key looks like {p.keyHint}
                  </div>
                </div>
                {on ? <span className="pill ok">connected</span> : null}
                {on ? (
                  <button
                    className="btn ghost"
                    style={{ padding: '8px 14px' }}
                    onClick={async () => {
                      await disconnectProvider(p.id);
                      showToast(`${p.name} disconnected.`);
                    }}
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    className="btn ghost"
                    style={{ padding: '8px 14px' }}
                    onClick={() => {
                      setEditing(p.id);
                      setValue('');
                    }}
                  >
                    Connect
                  </button>
                )}
              </div>
              {editing === p.id ? (
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="linklike"
                    style={{ marginBottom: 8 }}
                    onClick={() => openInAppBrowser(p.apiKeyUrl)}
                  >
                    Get a {p.name} API key ↗
                  </button>
                  <div className="field">
                    <input
                      autoFocus
                      type="password"
                      placeholder={p.keyHint}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void save(p.id, p.name)}
                    />
                  </div>
                  <button
                    className="btn primary"
                    style={{ width: '100%' }}
                    onClick={() => void save(p.id, p.name)}
                  >
                    Save
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}

        <p className="hint">
          Place a connected model in{' '}
          <button
            className="hint"
            style={{ display: 'inline', padding: 0, textDecoration: 'underline' }}
            onClick={() => setView('stack')}
          >
            your stack
          </button>{' '}
          to make it your Reasoning LLM or a specialist. OpenShore defers to cheaper models for the
          right tasks, so you keep control of cost.
        </p>
      </div>
    </div>
  );
}
