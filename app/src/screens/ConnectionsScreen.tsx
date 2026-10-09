// Cloud Connections: your server, and the big cloud model providers on your
// own key. A server you rent docks here the same way it does in Computer
// (connect-anywhere, 2026-10-07), and then reads Your server in Computer and
// the model menu. Each provider you connect puts its models on your Bench,
// ready to place in your stack (as the Reasoning model or a specialist). Keys live in this device's
// Keychain, scoped to the provider, and are spent only with your approval.
// The room is the Settings ledger (D14, founder 2026-10-07): one row per
// provider, a tap opens its key sheet, and a connected row asks before it
// disconnects. The familiar seven stay at the top; the named providers on
// your key (2026-10-09) join them once connected, and until then wait under
// one More providers row, a searchable sheet.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store.js';
import {
  PROVIDERS,
  fetchLiveModels,
  pickLiveModels,
  providerBenchModels,
  providerSecretKey,
  validateProviderKey,
  type LiveModel,
} from '../lib/providers.js';
import { BackBar } from '../components/BackBar.js';
import { Sheet } from '../components/Sheet.js';
import { SheetHead } from '../components/SheetHead.js';
import { ExternalGlyph } from '../components/SheetGlyphs.js';
import { SettingsGroup, SettingsRow } from '../components/SettingsRow.js';
import { isDesktop, openInAppBrowser, secretGet } from '../lib/platform.js';
import { sheetExitMs } from '../lib/motion.js';
import { ServerSetup } from '../components/ServerSetup.js';
import { DockForm, hostOf } from '../components/DockForm.js';
import {
  connectionsOfflineLine,
  keyCheckWaits,
  networkUp,
  offlineChosen,
  offlineNow,
} from '../state/offlineOps.js';

export function ConnectionsScreen() {
  const {
    connectedProviders,
    connectProvider,
    setAnthropicWorkspace,
    disconnectProvider,
    showToast,
    setView,
    startGuideChat,
    settings,
    connectionsFocus,
    clearConnectionsFocus,
    connectivity,
  } = useApp();
  // Desktop Offline (founder, 2026-10-07): offline, these models wait for a
  // connection, said once at the top. Keys stay saved, and disconnecting
  // stays one tap (it removes a key from this device, no request). A new key
  // is checked with its provider before it is kept, so with the network down
  // Save waits, and says why; with Offline only chosen, the check still runs.
  const offline = offlineNow(connectivity, settings.profileOverride);
  const chosen = offlineChosen(connectivity, settings.profileOverride);
  const networkDown = !networkUp(connectivity);
  // The provider whose key sheet is open.
  const [editing, setEditing] = useState<string | undefined>();
  const [value, setValue] = useState('');
  // Anthropic: the workspace the key acts in. Required, and preset to the id
  // last saved on this device so a reconnect is one paste, not two.
  const [workspace, setWorkspace] = useState('');
  // The workspace field shows only once Claude has asked for it (or one is
  // already saved), so most keys are one paste.
  const [askWorkspace, setAskWorkspace] = useState(false);
  const [checking, setChecking] = useState(false);
  // Claude is connected and only its workspace is being set: the sheet asks
  // for the ID alone and keeps the saved key (2026-10-08: a connected row
  // used to offer only Disconnect, so a chat asking for the workspace sent
  // the person to a room with nowhere to put it).
  const [workspaceOnly, setWorkspaceOnly] = useState(false);
  // The provider being disconnected, while its confirm is open.
  const [removing, setRemoving] = useState<{ id: string; name: string } | undefined>();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const provider = PROVIDERS.find((p) => p.id === editing);
  // The provider whose live model list is open for choosing, if any.
  const [choosing, setChoosing] = useState<{ id: string; name: string } | undefined>();
  // Setting up a server, while its sheet is open.
  const [settingUpServer, setSettingUpServer] = useState(false);
  // The More providers sheet, and what its search holds.
  const [browsing, setBrowsing] = useState(false);
  const [query, setQuery] = useState('');
  // The familiar seven, then each named provider once its key is in; the
  // rest wait under More providers.
  const listed = PROVIDERS.filter((p) => !p.more || connectedProviders[p.id]);
  const more = PROVIDERS.filter((p) => p.more && !connectedProviders[p.id]);
  const q = query.trim().toLowerCase();
  const found = more.filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.id.includes(q.replace(/\s+/g, '')) ||
      Boolean(p.searchTerms?.some((t) => t.includes(q))),
  );
  // The docked servers (the saved hubs, read the way the store's hubList
  // reads them, kept here so this room reads settings alone).
  const servers = (settings.daemons ?? (settings.daemon ? [settings.daemon] : [])).filter(
    (h) => h.kind === 'server',
  );

  const openSheet = (id: string) => {
    setEditing(id);
    setValue('');
    setWorkspace(settings.anthropicWorkspaceId ?? '');
    setAskWorkspace(false);
    setWorkspaceOnly(false);
  };
  const openWorkspace = () => {
    setEditing('anthropic');
    setValue('');
    setWorkspace(settings.anthropicWorkspaceId ?? '');
    setAskWorkspace(true);
    setWorkspaceOnly(true);
  };
  const closeSheet = () => {
    setEditing(undefined);
    setValue('');
    setWorkspaceOnly(false);
  };
  const openMore = () => {
    setQuery('');
    setBrowsing(true);
  };
  // Sheets never stack: the list leaves before the key sheet rises.
  const pickMore = (id: string) => {
    setBrowsing(false);
    setTimeout(() => openSheet(id), sheetExitMs());
  };
  // A new key for a connected provider, from its Disconnect question: the
  // key sheet saves over the old key and nothing else changes, so rotating a
  // key keeps its models where the person placed them (2026-10-09).
  const replaceKey = (id: string) => {
    setRemoving(undefined);
    setTimeout(() => openSheet(id), sheetExitMs());
  };

  useEffect(() => {
    // Arrived from a Connect tap elsewhere (the Marketplace's frontier shelf):
    // open that provider's key sheet, so the person lands on the paste field,
    // not at the top of a list to hunt through.
    // A chat that stopped for Claude's workspace lands on the workspace field.
    if (!connectionsFocus) return;
    if (!connectedProviders[connectionsFocus]) openSheet(connectionsFocus);
    else if (connectionsFocus === 'anthropic') openWorkspace();
    clearConnectionsFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionsFocus]);

  const saveWorkspace = async () => {
    if (checking || networkDown || !workspace.trim()) return;
    setChecking(true);
    let check: Awaited<ReturnType<typeof setAnthropicWorkspace>> = 'unverifiable';
    try {
      check = await setAnthropicWorkspace(workspace);
    } finally {
      setChecking(false);
    }
    if (check === 'invalid' || check === 'needs-workspace') {
      showToast('Claude did not accept that workspace ID. Check it in the Console.');
      return;
    }
    closeSheet();
    showToast(
      check === 'valid'
        ? 'Claude workspace saved. Claude can answer now.'
        : 'Claude workspace saved. We could not check it right now.',
    );
  };

  const save = async (id: string, name: string) => {
    if (workspaceOnly) return saveWorkspace();
    const key = value.trim();
    // Enter in a field is a second door to Save, so it waits while a check
    // runs, and while the network is down (the check needs it).
    if (!key || checking || networkDown) return;
    // Verify the key actually works before claiming "connected", so a typo is
    // caught here, not later mid-chat. A hard rejection keeps the sheet open;
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
    closeSheet();
    await connectProvider(id, key, id === 'anthropic' ? workspace : undefined);
    showToast(
      check === 'valid'
        ? `${name} connected. Its models are on your bench.`
        : check === 'unchecked'
          ? `${name} API key saved. ${name} lists its models for any key, so your first chat checks it.`
          : `${name} API key saved. We could not verify it right now.`,
    );
  };

  return (
    <div className="screen">
      <BackBar title="Cloud Connections" titleHiddenUntil={titleRef} />
      <div className="screen-inner settings">
        <h1 ref={titleRef}>Cloud Connections</h1>
        <p className="lead">
          Set up your own server; it docks like your computer. Connect a provider with your own API
          key. Its models wait on your bench until you place them, and a cloud model runs only when
          you pick it or place it. Keys are stored only on this device and sent only to their
          provider.{' '}
          <button
            type="button"
            className="linklike press-fb"
            onClick={() => void startGuideChat('connect-cloud-key')}
          >
            Walk me through it
          </button>
        </p>
        {offline ? (
          <p className="hint connections-offline" role="status">
            {connectionsOfflineLine(chosen)}
          </p>
        ) : null}

        {/* One row per provider: its model count, and a Connected pill once
            its key is saved. A tap opens the key sheet, or, once connected,
            asks before it disconnects, so a connected row carries no
            chevron (it opens a question, not a place). */}
        {/* A Linux server you rent (or keep at home), docked over Tailscale
            the way a computer is (connect-anywhere, 2026-10-07). A docked one
            opens Computer, where it is managed. */}
        <SettingsGroup title="Your server" index={0}>
          {servers.map((h) => (
            <SettingsRow
              key={h.baseUrl}
              label={h.name?.trim() || hostOf(h.baseUrl)}
              sub="Docked. It is in Computer and in the model menu."
              value={<span className="pill ok">Docked</span>}
              onClick={() => setView('pair')}
            />
          ))}
          <SettingsRow
            label={servers.length ? 'Dock another server' : 'Set up a server'}
            sub="A Linux server runs OpenShore and its models while this device sleeps."
            onClick={() => setSettingUpServer(true)}
          />
        </SettingsGroup>

        <SettingsGroup title="Cloud providers" index={1}>
          {listed.map((p) => {
            const on = Boolean(connectedProviders[p.id]);
            const n = providerBenchModels(p).length;
            const ws = settings.anthropicWorkspaceId;
            return [
              <SettingsRow
                key={p.id}
                label={p.name}
                sub={
                  on
                    ? `Its ${n} ${n === 1 ? 'model is' : 'models are'} on your bench.`
                    : p.liveModels
                      ? `Its models load from ${p.name} once your key is in.`
                      : `${n} ${n === 1 ? 'model' : 'models'}`
                }
                value={on ? <span className="pill ok">Connected</span> : undefined}
                asks={on}
                onClick={() => (on ? setRemoving({ id: p.id, name: p.name }) : openSheet(p.id))}
              />,
              p.id === 'anthropic' && on ? (
                <SettingsRow
                  key="anthropic-workspace"
                  label="Claude workspace"
                  sub={ws ? ws : 'Needed when your key is linked to you, not a workspace.'}
                  subTruncate={Boolean(ws)}
                  onClick={openWorkspace}
                />
              ) : null,
              p.liveModels && on ? (
                <SettingsRow
                  key={`${p.id}-models`}
                  label={`Choose ${p.name} models`}
                  sub="Pick which of its models sit on your bench."
                  onClick={() => setChoosing({ id: p.id, name: p.name })}
                />
              ) : null,
            ];
          })}
          {more.length ? (
            <SettingsRow label="More providers" sub={moreLine(more)} onClick={openMore} />
          ) : null}
          {/* Away from the desktop (a phone, an iPad, the web), anything
              else connects by its address in the Stack (Connect a model);
              the desktop's Stack has no such form, so it says nothing it
              cannot do. */}
          {isDesktop() ? null : (
            <SettingsRow
              label="Any other provider"
              sub="Connect any OpenAI-compatible provider by its address in the Stack, under Connect a model."
              onClick={() => setView('stack')}
            />
          )}
        </SettingsGroup>

        <p className="hint connections-foot">
          Place a connected model in{' '}
          <button className="linklike press-fb" onClick={() => setView('stack')}>
            your stack
          </button>{' '}
          to make it your Reasoning model or a specialist. You choose which model each kind of task
          goes to.
        </p>
      </div>

      {/* A provider's key: where to get one, the field, and Save, which rise
          above the keyboard together (lib/revealField.ts). A form sheet has
          one way out, the round close, which stays in view above the
          keyboard (2026-10-07, the same exit as New project). */}
      <Sheet open={Boolean(provider)} onClose={closeSheet}>
        {provider ? (
          <>
            <SheetHead
              title={workspaceOnly ? 'Claude workspace' : `Connect ${provider.name}`}
              onClose={closeSheet}
            />
            <div data-reveal-with="">
              {workspaceOnly ? null : (
                <div className="field">
                  <div className="field-label-row">
                    <label htmlFor="connections-api-key">{provider.name} API key</label>
                    <button
                      type="button"
                      className="linklike press-fb"
                      onClick={() => openInAppBrowser(provider.apiKeyUrl)}
                    >
                      Get a key <ExternalGlyph />
                    </button>
                  </div>
                  <input
                    id="connections-api-key"
                    autoFocus
                    type="password"
                    placeholder={provider.keyHint}
                    enterKeyHint="go"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void save(provider.id, provider.name)}
                  />
                  {provider.keyNote ? (
                    <p className="hint" style={{ marginTop: 4 }}>
                      {provider.keyNote}
                    </p>
                  ) : null}
                </div>
              )}
              {provider.id === 'anthropic' && (askWorkspace || workspace.trim()) ? (
                <div className="field">
                  <label htmlFor="connections-workspace-id">Workspace ID</label>
                  <input
                    id="connections-workspace-id"
                    autoFocus={workspaceOnly}
                    placeholder="wrkspc_..."
                    enterKeyHint="go"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={workspace}
                    onChange={(e) => setWorkspace(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void save(provider.id, provider.name)}
                  />
                  <p className="hint" style={{ marginTop: 4 }}>
                    In the Console, open Settings, then Workspaces, and copy the ID that starts with
                    wrkspc_.
                  </p>
                </div>
              ) : null}
              {networkDown ? (
                <p className="hint" role="status">
                  {keyCheckWaits(provider.name)}
                </p>
              ) : null}
              <div className="sheet-actions">
                <button
                  type="button"
                  className="btn primary press-fb"
                  data-reveal-primary=""
                  disabled={checking || networkDown || !(workspaceOnly ? workspace : value).trim()}
                  onClick={() => void save(provider.id, provider.name)}
                >
                  {checking ? 'Checking...' : 'Save'}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </Sheet>

      {/* The named providers not yet connected, searchable. A tap closes
          this list and opens that provider's key sheet, the same one the
          familiar seven use. */}
      <Sheet open={browsing} onClose={() => setBrowsing(false)}>
        {browsing ? (
          <>
            <SheetHead title="More providers" onClose={() => setBrowsing(false)} />
            <p className="sheet-sub">
              Each runs on your own API key. Its models load from it once your key is in.
            </p>
            <div className="field">
              <label htmlFor="more-providers-search">Search {more.length} providers</label>
              <input
                id="more-providers-search"
                value={query}
                placeholder="Groq, Mistral, DeepSeek..."
                autoCapitalize="none"
                autoCorrect="off"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {found.length ? (
              <div className="settings">
                <SettingsGroup index={0}>
                  {found.map((p) => (
                    <SettingsRow
                      key={p.id}
                      label={p.name}
                      sub={`Its models load from ${p.name} once your key is in.`}
                      onClick={() => pickMore(p.id)}
                    />
                  ))}
                </SettingsGroup>
              </div>
            ) : (
              <p className="hint" role="status">
                {isDesktop()
                  ? 'No provider here by that name.'
                  : 'No provider here by that name. Any OpenAI-compatible one connects by its address in the Stack.'}
              </p>
            )}
          </>
        ) : null}
      </Sheet>

      <Sheet open={settingUpServer} onClose={() => setSettingUpServer(false)}>
        {settingUpServer ? (
          <>
            <SheetHead title="Set up a server" onClose={() => setSettingUpServer(false)} />
            <ServerSetup />
            <DockForm expect="server" onDocked={() => setSettingUpServer(false)} />
          </>
        ) : null}
      </Sheet>

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

      <Sheet open={Boolean(removing)} onClose={() => setRemoving(undefined)} variant="confirm">
        <h3>Disconnect {removing?.name}?</h3>
        {/* Disconnecting sweeps its models off every stack (providerOps), so
            the question says so, and offers the one way to keep them. */}
        <p>
          Its API key is removed from this device, and its models leave your bench and every stack.
          To keep them,{' '}
          <button
            type="button"
            className="linklike press-fb"
            onClick={() => removing && replaceKey(removing.id)}
          >
            replace its key
          </button>{' '}
          instead.
        </p>
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
  );
}

/** The More providers row's line: the first few names it holds, plainly. */
function moreLine(more: Array<{ name: string }>): string {
  const names = more.map((p) => p.name);
  if (names.length === 1) return `${names[0]}, on your own key.`;
  if (names.length <= 3) {
    return `${names.slice(0, -1).join(', ')}${names.length > 2 ? ',' : ''} and ${names.at(-1)}, each on your own key.`;
  }
  return `${names.slice(0, 3).join(', ')}, and ${names.length - 3} more, each on your own key.`;
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
                    {/* Only a list that says so: a plain list claims neither. */}
                    {m.tools || m.toolsUnknown ? '' : ' · chat only, no tools'}
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
