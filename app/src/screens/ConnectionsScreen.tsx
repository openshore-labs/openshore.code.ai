// Cloud Connections: your server and the big cloud LLM providers on your own
// key. A server you rent docks here the same way it does in Computer
// (connect-anywhere, 2026-10-07): it then shows in Computer and in the model
// menu as Your server. Each provider you connect puts its models on your
// Bench, ready to place in your stack (as the Reasoning LLM or a specialist).
// Keys live in this device's Keychain, scoped to the provider, and are spent
// only with your approval.
import { useEffect, useState } from 'react';
import { hubList, useApp } from '../state/store.js';
import {
  PROVIDERS,
  fetchLiveModels,
  pickLiveModels,
  providerSecretKey,
  validateProviderKey,
  type LiveModel,
} from '../lib/providers.js';
import { BackBar } from '../components/BackBar.js';
import { openInAppBrowser, secretGet } from '../lib/platform.js';
import { Sheet } from '../components/Sheet.js';
import { SheetHead } from '../components/SheetHead.js';
import { ServerSetup } from '../components/ServerSetup.js';
import { DockForm, hostOf } from '../components/DockForm.js';

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
  // The provider whose live model list is open for choosing, if any.
  const [choosing, setChoosing] = useState<{ id: string; name: string } | undefined>();

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
          Set up your own server, or add a provider on your own key. A server docks like your
          computer; a provider's models land on your Bench, ready to place. Keys stay on this
          device, and nothing cloud runs without your say.
        </p>
        <button
          className="btn ghost press-fb"
          style={{ width: '100%', marginBottom: 12 }}
          onClick={() => void startGuideChat('connect-cloud-key')}
        >
          Walk me through it
        </button>

        <YourServer />

        <h2 style={{ marginTop: 24 }}>Cloud providers</h2>
        {PROVIDERS.map((p) => {
          const on = Boolean(connectedProviders[p.id]);
          return (
            <div className="card" key={p.id} id={`provider-${p.id}`}>
              <div className="card-row">
                <div className="grow">
                  <h3>{p.name}</h3>
                  <div className="sub">
                    {p.liveModels
                      ? on
                        ? `${p.models.length} models on your Bench. Key looks like ${p.keyHint}`
                        : `Its models load from ${p.name} once your key is in.`
                      : `${p.models.length} models. Key looks like ${p.keyHint}`}
                  </div>
                  {p.liveModels && on ? (
                    <button
                      type="button"
                      className="linklike press-fb"
                      style={{ marginTop: 4 }}
                      onClick={() => setChoosing({ id: p.id, name: p.name })}
                    >
                      Choose models
                    </button>
                  ) : null}
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
                  {p.id === 'anthropic' ? (
                    <>
                      <div className="field">
                        <label htmlFor="connections-workspace-id">
                          Workspace id (only if Claude asks)
                        </label>
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
                        Only if Claude asks: in the Console, Settings, then Workspaces, copy the id
                        that starts with wrkspc_.
                      </p>
                    </>
                  ) : null}
                  <button
                    className="btn primary"
                    style={{ width: '100%' }}
                    data-reveal-primary=""
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

        <Sheet open={Boolean(choosing)} onClose={() => setChoosing(undefined)}>
          {choosing ? (
            <LiveModelPicker
              key={choosing.id}
              providerId={choosing.id}
              name={choosing.name}
              onDone={() => setChoosing(undefined)}
            />
          ) : null}
        </Sheet>

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

/** A server you rent (or keep at home), set up and docked from here. Once
 *  one is docked it is listed with a way to Computer, where it is managed. */
function YourServer() {
  const settings = useApp((s) => s.settings);
  const setView = useApp((s) => s.setView);
  const [adding, setAdding] = useState(false);
  const servers = hubList(settings).filter((h) => h.kind === 'server');
  return (
    <>
      <h2 style={{ marginTop: 8 }}>Your server</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        A Linux server runs OpenShore and its models while this device sleeps. It docks over your
        own Tailscale network, never the open internet.
      </p>
      {servers.map((h) => (
        <div className="card" key={h.baseUrl}>
          <div className="card-row" style={{ alignItems: 'center' }}>
            <div className="grow">
              <h3 style={{ margin: 0 }}>{h.name?.trim() || hostOf(h.baseUrl)}</h3>
              <div className="sub">Docked. It is in Computer and in the model menu.</div>
            </div>
            <span className="pill ok">docked</span>
          </div>
          <button
            className="btn ghost press-fb"
            style={{ width: '100%', marginTop: 12 }}
            onClick={() => setView('pair')}
          >
            Open Computer
          </button>
        </div>
      ))}
      {servers.length === 0 || adding ? (
        <>
          <ServerSetup />
          <DockForm expect="server" onDocked={() => setAdding(false)} />
        </>
      ) : (
        <button
          className="btn ghost press-fb"
          style={{ width: '100%', marginBottom: 12 }}
          onClick={() => setAdding(true)}
        >
          Dock another server
        </button>
      )}
    </>
  );
}

/** Choosing which of a live provider's models sit on the Bench. The whole
 *  list comes from the provider on the person's key when this opens; the
 *  current picks start ticked, and a search narrows a long list. */
function LiveModelPicker({
  providerId,
  name,
  onDone,
}: {
  providerId: string;
  name: string;
  onDone: () => void;
}) {
  const current = useApp((s) => s.settings.providerModels?.[providerId] ?? []);
  const setProviderModels = useApp((s) => s.setProviderModels);
  const showToast = useApp((s) => s.showToast);
  const [all, setAll] = useState<LiveModel[] | 'error' | undefined>();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(current.map((m) => m.id)));
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    void (async () => {
      const key = await secretGet(providerSecretKey(providerId));
      const models = key ? await fetchLiveModels(providerId, key) : undefined;
      if (!live) return;
      setAll(models ?? 'error');
      if (models && picked.size === 0) {
        setPicked(new Set(pickLiveModels(providerId, models).map((m) => m.id)));
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  const q = query.trim().toLowerCase();
  const shown =
    all && all !== 'error'
      ? all.filter((m) => !q || m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
      : [];

  return (
    <>
      <SheetHead title={`${name} models`} onClose={onDone} />
      {all === undefined ? (
        <p className="hint">Loading the models {name} offers on your key...</p>
      ) : all === 'error' ? (
        <p className="hint">
          {name} did not send its model list. Check your connection and the key, then try again.
        </p>
      ) : (
        <>
          <div className="field">
            <label htmlFor="live-models-search">Search {all.length} models</label>
            <input
              id="live-models-search"
              value={query}
              placeholder="qwen, claude, coder..."
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="live-model-list">
            {shown.slice(0, 200).map((m) => (
              <label key={m.id} className="live-model-row">
                <input
                  type="checkbox"
                  checked={picked.has(m.id)}
                  onChange={(e) =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(m.id);
                      else next.delete(m.id);
                      return next;
                    })
                  }
                />
                <span className="grow">
                  <span className="live-model-name">{m.label}</span>
                  <span className="sub">
                    {m.id}
                    {m.tools ? '' : ' · chat only, no tools'}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="sheet-actions">
            <button
              type="button"
              className="btn primary press-fb"
              onClick={async () => {
                const keep = all.filter((m) => picked.has(m.id));
                await setProviderModels(providerId, keep);
                showToast(`${keep.length} ${name} models on your Bench.`);
                onDone();
              }}
            >
              Keep {picked.size} on the Bench
            </button>
            <button type="button" className="btn quiet press-fb" onClick={onDone}>
              Cancel
            </button>
          </div>
        </>
      )}
    </>
  );
}
