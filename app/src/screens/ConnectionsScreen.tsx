// Cloud Connections: your server, and the big cloud model providers on your
// own key. A server you rent docks here the same way it does in Computer
// (connect-anywhere, 2026-10-07), and then reads Your server in Computer and
// the model menu. Each provider you connect puts its models on your Bench,
// ready to place in your stack (as the Reasoning model or a specialist). Keys live in this device's
// Keychain, scoped to the provider, and are spent only with your approval.
// The room is the Settings ledger (D14, 2026-10-07): one row per
// provider, a tap opens its key sheet, and a connected row asks before it
// disconnects. The familiar seven stay at the top; the named providers on
// your key (2026-10-09) join them once connected, and until then wait under
// one More providers row, a searchable sheet. A docked server that keeps
// keys, with this device as its admin, gains two rows under Your server:
// which keys it keeps, and which model it runs (keys on your server,
// 2026-10-09; components/ServerKeys.tsx). Every cloud model lives here and
// only here (founder, 2026-10-13): the Local Library lists what runs on your
// own machines. The Frontier models sheet and the Any other provider row
// left this room (founder, 2026-10-15): each provider's row is the one door.
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
import { ModelChecklist } from '../components/ModelChecklist.js';
import { ServerSetup } from '../components/ServerSetup.js';
import { DockForm, hostOf } from '../components/DockForm.js';
import {
  ServerKeysLeftSheet,
  ServerKeysSheet,
  ServerModelSheet,
  keysRowSub,
  modelRowSub,
  useServerKeys,
  type KeysLeft,
} from '../components/ServerKeys.js';
import { namesLine, serverWhere, whereStartsSentence } from '../lib/serverKeys.js';
import { putKeyOnServer } from '../state/serverKeysOps.js';
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
  // Desktop Offline (2026-10-07): offline, these models wait for a
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
  // What each server that keeps keys for this device keeps, read from it
  // (the source of truth) when this room opens, when a sheet opens, and
  // after each change.
  const { views: serverViews, offersNone, refresh: refreshServer } = useServerKeys(servers);
  // The server whose keys sheet, or model sheet, is open.
  const [keysFor, setKeysFor] = useState<string | undefined>();
  const [modelFor, setModelFor] = useState<string | undefined>();
  // A key that could not be deleted on a server, while its note is open.
  const [left, setLeft] = useState<KeysLeft | undefined>();
  // A key replaced here that servers keep their own of, while the offer to
  // send the new one is open.
  const [resend, setResend] = useState<{ id: string; name: string } | undefined>();
  const keysServer = servers.find((h) => h.baseUrl === keysFor);
  const modelServer = servers.find((h) => h.baseUrl === modelFor);
  const openKeys = (baseUrl: string) => {
    setKeysFor(baseUrl);
    void refreshServer(baseUrl);
  };
  const openModel = (baseUrl: string) => {
    setModelFor(baseUrl);
    void refreshServer(baseUrl);
  };
  // Sheets never stack: the keys sheet leaves before the model sheet rises.
  const chooseModel = (baseUrl: string) => {
    setKeysFor(undefined);
    setTimeout(() => openModel(baseUrl), sheetExitMs());
  };
  // The servers that keep a key for a provider, as they last said.
  const holdersOf = (id: string) =>
    servers.filter((h) => {
      const keys = serverViews[h.baseUrl]?.keys;
      return Array.isArray(keys) && keys.some((k) => k.id === id);
    });
  // The servers that keep the key of the provider being disconnected, so its
  // question can say so, and those whose model runs on it.
  const holders = removing ? holdersOf(removing.id) : [];
  const runsOn = removing
    ? holders.filter((h) => {
        const stack = serverViews[h.baseUrl]?.stack;
        return typeof stack === 'object' && stack.orchestrator?.provider === removing.id;
      })
    : [];
  const named = (hs: readonly { baseUrl: string; name?: string }[]) =>
    namesLine(hs.map((h) => serverWhere(h, servers.length)));
  // A new key saved here leaves a server's own key as it was: once the key
  // sheet has left, offer to send the new one where a server keeps one.
  const offerResend = (id: string, name: string) => {
    if (holdersOf(id).length) setTimeout(() => setResend({ id, name }), sheetExitMs());
  };
  const resendTo = resend ? holdersOf(resend.id) : [];
  const sendNewKey = async () => {
    const target = resend;
    setResend(undefined);
    const p = target && PROVIDERS.find((x) => x.id === target.id);
    if (!target || !p) return;
    const to = holdersOf(target.id);
    const sent = await Promise.all(
      to.map((h) =>
        putKeyOnServer(h, p, useApp.getState().settings.anthropicWorkspaceId).then(
          () => true,
          () => false,
        ),
      ),
    );
    const ok = to.filter((_, i) => sent[i]);
    const failed = to.filter((_, i) => !sent[i]);
    showToast(
      failed.length
        ? `${whereStartsSentence(named(failed))} did not take the new ${p.name} key, and still ${failed.length === 1 ? 'keeps its' : 'keep their'} own.`
        : `The new ${p.name} key is on ${named(ok)} now.`,
    );
    for (const h of to) void refreshServer(h.baseUrl);
  };

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
    // Arrived from a Connect tap elsewhere (a chat that stopped for a key):
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
    offerResend('anthropic', 'Claude');
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
    const replacing = Boolean(connectedProviders[id]);
    await connectProvider(id, key, id === 'anthropic' ? workspace : undefined);
    if (replacing) offerResend(id, name);
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
          provider, except a key you turn on for your server, which goes to it once and is kept
          there.{' '}
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
          {servers.map((h) => {
            const view = serverViews[h.baseUrl];
            const where = serverWhere(h, servers.length);
            return [
              <SettingsRow
                key={h.baseUrl}
                label={h.name?.trim() || hostOf(h.baseUrl)}
                sub="Docked. It is in Computer and in the model menu."
                value={<span className="pill ok">Docked</span>}
                onClick={() => setView('pair')}
              />,
              // These two arrive once the server has answered, after the
              // group did, so they step in on the shared stagger.
              view ? (
                <SettingsRow
                  key={`${h.baseUrl}-keys`}
                  label={`Keys on ${where}`}
                  sub={keysRowSub(view)}
                  arrive={0}
                  onClick={() => openKeys(h.baseUrl)}
                />
              ) : null,
              view ? (
                <SettingsRow
                  key={`${h.baseUrl}-model`}
                  label={`Model on ${where}`}
                  sub={modelRowSub(view, where)}
                  arrive={1}
                  onClick={() => openModel(h.baseUrl)}
                />
              ) : null,
            ];
          })}
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
                onClick={() => {
                  if (!on) return openSheet(p.id);
                  // Read every docked server first, so the question names each
                  // one that keeps this key before anything is deleted.
                  for (const h of servers) void refreshServer(h.baseUrl);
                  setRemoving({ id: p.id, name: p.name });
                }}
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
                {isDesktop() ? (
                  'No provider here by that name.'
                ) : asksForGateway(q) ? (
                  // Bedrock, Azure and Vertex do not connect by an address and
                  // a key: they come through a gateway the person runs, and
                  // this is where a person looks for them (2026-10-09).
                  <>
                    Bedrock, Azure and Vertex come through a gateway you run, connected in the
                    Stack.{' '}
                    <button
                      type="button"
                      className="linklike press-fb"
                      onClick={() => {
                        setBrowsing(false);
                        void startGuideChat('connect-own-gateway');
                      }}
                    >
                      Walk me through it
                    </button>
                  </>
                ) : (
                  'No provider here by that name. Any other one connects by its address in the Stack.'
                )}
              </p>
            )}
          </>
        ) : null}
      </Sheet>

      {/* Keys on your server (2026-10-09): what a docked server keeps, and
          its model, each read from it. */}
      <ServerKeysSheet
        server={keysServer}
        where={keysServer ? serverWhere(keysServer, servers.length) : ''}
        view={keysServer ? serverViews[keysServer.baseUrl] : undefined}
        onChanged={() => (keysServer ? refreshServer(keysServer.baseUrl) : Promise.resolve())}
        onChooseModel={() => keysServer && chooseModel(keysServer.baseUrl)}
        onClose={() => setKeysFor(undefined)}
      />
      <ServerModelSheet
        server={modelServer}
        where={modelServer ? serverWhere(modelServer, servers.length) : ''}
        view={modelServer ? serverViews[modelServer.baseUrl] : undefined}
        onChanged={() => (modelServer ? refreshServer(modelServer.baseUrl) : Promise.resolve())}
        onClose={() => setModelFor(undefined)}
      />
      <ServerKeysLeftSheet left={left} onClose={() => setLeft(undefined)} />
      <Sheet open={Boolean(resend)} onClose={() => setResend(undefined)} variant="confirm">
        <h3>Send the new {resend?.name} key?</h3>
        <p>
          {whereStartsSentence(named(resendTo))} {resendTo.length === 1 ? 'keeps' : 'keep'} a{' '}
          {resend?.name} key of {resendTo.length === 1 ? 'its' : 'their'} own, which a key saved
          here does not change. Send this one in its place, over your private Tailscale link?
        </p>
        <div className="confirm-row">
          <button type="button" className="btn ghost press-fb" onClick={() => setResend(undefined)}>
            Not now
          </button>
          <button type="button" className="btn primary press-fb" onClick={() => void sendNewKey()}>
            Send
          </button>
        </div>
      </Sheet>

      <Sheet open={settingUpServer} onClose={() => setSettingUpServer(false)}>
        {settingUpServer ? (
          <>
            <SheetHead title="Set up a server" onClose={() => setSettingUpServer(false)} />
            <ServerSetup />
            <DockForm expect="server" place="rented" onDocked={() => setSettingUpServer(false)} />
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
          To keep its models,{' '}
          <button
            type="button"
            className="linklike press-fb"
            onClick={() => removing && replaceKey(removing.id)}
          >
            replace its key
          </button>{' '}
          instead.
          {holders.length
            ? ` ${whereStartsSentence(named(holders))} ${holders.length === 1 ? 'keeps' : 'keep'} a ${removing?.name} key too, and it is deleted there as well.`
            : ''}
          {runsOn.length
            ? ` The model on ${named(runsOn)} runs on it, so it stops until you choose another.`
            : ''}
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
              // Only the servers the question named lose a key; one not read
              // yet is left alone and gets the note below.
              const namedHolders = holdersOf(target.id);
              const unread = servers.filter(
                (h) =>
                  !namedHolders.includes(h) &&
                  !offersNone[h.baseUrl] &&
                  !Array.isArray(serverViews[h.baseUrl]?.keys),
              );
              const onServers = await disconnectProvider(target.id, namedHolders);
              const gone = onServers.removedFrom.length
                ? `${target.name} disconnected, and its key was deleted from ${named(onServers.removedFrom)}.`
                : `${target.name} disconnected.`;
              showToast(
                onServers.modelClearedOn.length
                  ? `${gone} The model on ${named(onServers.modelClearedOn)} ran on it, so choose another.`
                  : gone,
              );
              for (const h of onServers.removedFrom) void refreshServer(h.baseUrl);
              // A server that did not answer, or would not delete it, may
              // still keep it: say so, and how to delete it there. One this
              // room last read as keeping no such key, or that offers this
              // device no keys at all, is not worth a word.
              const mayKeep = [
                ...onServers.notRemoved.filter((h) => {
                  if (offersNone[h.baseUrl]) return false;
                  const keys = serverViews[h.baseUrl]?.keys;
                  return !Array.isArray(keys) || keys.some((k) => k.id === target.id);
                }),
                ...unread,
              ];
              if (mayKeep.length) {
                setTimeout(
                  () =>
                    setLeft({
                      where: named(mayKeep),
                      provider: { id: target.id, name: target.name },
                    }),
                  sheetExitMs(),
                );
              }
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
/** The names a person may search for Bedrock, Azure or Vertex by, which
 *  come through the gateway guide rather than a key (2026-10-09). */
const GATEWAY_NAMES = ['amazon bedrock', 'bedrock', 'aws', 'azure', 'google vertex', 'vertex'];

/** Whether a More providers search is for one of the three that come
 *  through a gateway: three letters or more of one of their names. */
function asksForGateway(q: string): boolean {
  return q.length >= 3 && GATEWAY_NAMES.some((n) => n.startsWith(q) || q.includes(n));
}

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
 *  current picks start ticked, and a search narrows a long list (the shared
 *  ModelChecklist, which the Stack's Connect a model picks from too). */
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
          <ModelChecklist
            models={all}
            picked={picked}
            searchId="live-models-search"
            onToggle={(id, on) =>
              setPicked((prev) => {
                const next = new Set(prev);
                if (on) next.add(id);
                else next.delete(id);
                return next;
              })
            }
          />
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
