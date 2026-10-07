// Cloud Connections: add the big cloud LLM providers on your own key. Each
// provider you connect puts its models on your Bench, ready to place in your
// stack (as the Reasoning LLM or a specialist). Keys live in this device's
// Keychain, scoped to the provider, and are spent only with your approval.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store.js';
import { PROVIDERS, providerBenchModels, validateProviderKey } from '../lib/providers.js';
import { BackBar } from '../components/BackBar.js';
import { Sheet } from '../components/Sheet.js';
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
  // The workspace field shows only once Claude has asked for it (or one is
  // already saved), so most keys are one paste.
  const [askWorkspace, setAskWorkspace] = useState(false);
  const [checking, setChecking] = useState(false);
  // The provider being disconnected, while its confirm is open.
  const [removing, setRemoving] = useState<{ id: string; name: string } | undefined>();
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // Arrived from a Connect tap elsewhere (the Marketplace's frontier shelf):
    // open that provider's form and bring its card into view, so the person
    // lands on the paste field, not at the top of a list to hunt through.
    if (!connectionsFocus) return;
    if (!connectedProviders[connectionsFocus]) {
      setEditing(connectionsFocus);
      setValue('');
      setWorkspace(settings.anthropicWorkspaceId ?? '');
      setAskWorkspace(false);
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
      setAskWorkspace(true);
      showToast(
        workspace.trim()
          ? 'Claude did not accept that workspace ID. Check it in the Console.'
          : 'This Claude key needs its workspace ID. Paste it below, then save.',
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
      <BackBar title="Cloud Connections" titleHiddenUntil={titleRef} />
      <div className="screen-inner">
        <h1 ref={titleRef}>Cloud Connections</h1>
        <p className="lead">
          Connect a provider with your own API key. Its models wait on your bench until you place
          them. Keys stay on this device, and a cloud model runs only when you choose it.{' '}
          <button
            type="button"
            className="linklike press-fb"
            onClick={() => void startGuideChat('connect-cloud-key')}
          >
            Walk me through it
          </button>
        </p>

        {PROVIDERS.map((p) => {
          const on = Boolean(connectedProviders[p.id]);
          const n = providerBenchModels(p).length;
          return (
            <div className="card" key={p.id} id={`provider-${p.id}`}>
              <div className="card-row">
                <div className="grow">
                  <h3>{p.name}</h3>
                  <div className="sub">
                    {on ? 'Its models are on your bench.' : `${n} ${n === 1 ? 'model' : 'models'}`}
                  </div>
                </div>
                {on ? <span className="pill ok">Connected</span> : null}
                {on ? (
                  <button
                    type="button"
                    className="btn ghost sm press-fb"
                    onClick={() => setRemoving({ id: p.id, name: p.name })}
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    className="btn ghost sm"
                    onClick={() => {
                      setEditing(p.id);
                      setValue('');
                      setWorkspace(settings.anthropicWorkspaceId ?? '');
                      setAskWorkspace(false);
                    }}
                  >
                    Connect
                  </button>
                )}
              </div>
              {editing === p.id ? (
                // The key, its workspace, and Save rise above the keyboard
                // together (lib/revealField.ts).
                <div style={{ marginTop: 12 }} data-reveal-with="">
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
                      enterKeyHint="go"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void save(p.id, p.name)}
                    />
                  </div>
                  {p.id === 'anthropic' && (askWorkspace || workspace.trim()) ? (
                    <>
                      <div className="field">
                        <label htmlFor="connections-workspace-id">Workspace ID</label>
                        <input
                          id="connections-workspace-id"
                          placeholder="wrkspc_..."
                          enterKeyHint="go"
                          autoCapitalize="none"
                          autoCorrect="off"
                          value={workspace}
                          onChange={(e) => setWorkspace(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && void save(p.id, p.name)}
                        />
                      </div>
                      <p className="hint" style={{ marginBottom: 10 }}>
                        In the Console, open Settings, then Workspaces, and copy the ID that starts
                        with wrkspc_.
                      </p>
                    </>
                  ) : null}
                  <button
                    className="btn primary block"
                    data-reveal-primary=""
                    disabled={checking}
                    onClick={() => void save(p.id, p.name)}
                  >
                    {checking ? 'Checking...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className="btn quiet block press-fb"
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      setEditing(undefined);
                      setValue('');
                    }}
                  >
                    Cancel
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

        <Sheet open={Boolean(removing)} onClose={() => setRemoving(undefined)} variant="confirm">
          <h3>Disconnect {removing?.name}?</h3>
          <p>Its API key is removed from this device. You can connect it again any time.</p>
          <div className="confirm-row">
            <button
              type="button"
              className="btn ghost press-fb"
              onClick={() => setRemoving(undefined)}
            >
              Keep
            </button>
            <button
              type="button"
              className="btn danger press-fb"
              onClick={async () => {
                const target = removing;
                setRemoving(undefined);
                if (!target) return;
                await disconnectProvider(target.id);
                showToast(`${target.name} disconnected.`);
              }}
            >
              Disconnect
            </button>
          </div>
        </Sheet>
      </div>
    </div>
  );
}
