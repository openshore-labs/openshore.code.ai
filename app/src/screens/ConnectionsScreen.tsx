// Cloud Connections: add the big cloud LLM providers on your own key. Each
// provider you connect puts its models on your Bench, ready to place in your
// stack (as the Reasoning LLM or a specialist). Keys live in this device's
// Keychain, scoped to the provider, and are spent only with your approval.
import { useEffect, useState } from 'react';
import { useApp } from '../state/store.js';
import { PROVIDERS, validateProviderKey } from '../lib/providers.js';
import { BackBar } from '../components/BackBar.js';
import { openInAppBrowser } from '../lib/platform.js';

export function ConnectionsScreen() {
  const {
    connectedProviders,
    connectProvider,
    disconnectProvider,
    showToast,
    setView,
    startGuideChat,
    settings,
    connectionsFocus,
    clearConnectionsFocus,
  } = useApp();
  const [editing, setEditing] = useState<string | undefined>();
  const [value, setValue] = useState('');
  // Anthropic: the workspace the key acts in. Required, and preset to the id
  // last saved on this device so a reconnect is one paste, not two.
  const [workspace, setWorkspace] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    // Arrived from a Connect tap elsewhere (the Marketplace's frontier shelf):
    // open that provider's form and bring its card into view, so the person
    // lands on the paste field, not at the top of a list to hunt through.
    if (!connectionsFocus) return;
    if (!connectedProviders[connectionsFocus]) {
      setEditing(connectionsFocus);
      setValue('');
      setWorkspace(settings.anthropicWorkspaceId ?? '');
    }
    document
      .getElementById(`provider-${connectionsFocus}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    clearConnectionsFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionsFocus]);

  const save = async (id: string, name: string) => {
    const key = value.trim();
    if (!key) return;
    // Verify the key actually works before claiming "connected", so a typo is
    // caught here, not later mid-chat. A hard rejection keeps the field open;
    // an unverifiable result (offline, dev CORS) saves but says so.
    setChecking(true);
    let check: Awaited<ReturnType<typeof validateProviderKey>> = 'unverifiable';
    try {
      check = await validateProviderKey(id, key, workspace);
    } finally {
      setChecking(false);
    }
    if (check === 'invalid') {
      showToast(`That ${name} API key was rejected. Check it and try again.`);
      return;
    }
    if (check === 'needs-workspace') {
      // Most keys carry their workspace; an identity-linked key needs its id.
      showToast(
        workspace.trim()
          ? 'Claude did not accept that workspace id. Check it in the Console.'
          : 'This Claude key needs its workspace id. Paste it from the Console, then save.',
      );
      return;
    }
    setEditing(undefined);
    setValue('');
    await connectProvider(id, key, id === 'anthropic' ? workspace : undefined);
    showToast(
      check === 'valid'
        ? `${name} connected. Its models are on your bench.`
        : `${name} API key saved. We could not verify it right now.`,
    );
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
        <button
          className="btn ghost press-fb"
          style={{ width: '100%', marginBottom: 12 }}
          onClick={() => void startGuideChat('connect-cloud-key')}
        >
          Walk me through it
        </button>

        {PROVIDERS.map((p) => {
          const on = Boolean(connectedProviders[p.id]);
          return (
            <div className="card" key={p.id} id={`provider-${p.id}`}>
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
                      setWorkspace(settings.anthropicWorkspaceId ?? '');
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
                    <label htmlFor="connections-api-key">{p.name} API key</label>
                    <input
                      id="connections-api-key"
                      autoFocus
                      type="password"
                      placeholder={p.keyHint}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void save(p.id, p.name)}
                    />
                  </div>
                  {p.id === 'anthropic' ? (
                    <>
                      <div className="field">
                        <label htmlFor="connections-workspace-id">
                          Workspace id (only if Claude asks)
                        </label>
                        <input
                          id="connections-workspace-id"
                          placeholder="wrkspc_..."
                          autoCapitalize="none"
                          autoCorrect="off"
                          value={workspace}
                          onChange={(e) => setWorkspace(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && void save(p.id, p.name)}
                        />
                      </div>
                      <p className="hint" style={{ marginBottom: 10 }}>
                        Most keys need nothing here. A key tied to your login rather than a
                        workspace needs its id: in the Console, open Settings, then Workspaces, and
                        copy it (it starts with wrkspc_). The id saved here is filled in for you
                        next time.
                      </p>
                    </>
                  ) : null}
                  <button
                    className="btn primary"
                    style={{ width: '100%' }}
                    disabled={checking}
                    onClick={() => void save(p.id, p.name)}
                  >
                    {checking ? 'Checking...' : 'Save'}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}

        <p className="hint">
          Place a connected model in{' '}
          <button className="linklike" onClick={() => setView('stack')}>
            your stack
          </button>{' '}
          to make it your Reasoning LLM or a specialist. You choose which model each kind of task
          goes to.
        </p>
      </div>
    </div>
  );
}
