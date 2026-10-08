// Cloud Connections: add the big cloud model providers on your own key. Each
// provider you connect puts its models on your Bench, ready to place in your
// stack (as the Reasoning model or a specialist). Keys live in this device's
// Keychain, scoped to the provider, and are spent only with your approval.
// The room is the Settings ledger (D14, founder 2026-10-07): one row per
// provider, a tap opens its key sheet, and a connected row asks before it
// disconnects.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store.js';
import { PROVIDERS, providerBenchModels, validateProviderKey } from '../lib/providers.js';
import { BackBar } from '../components/BackBar.js';
import { Sheet } from '../components/Sheet.js';
import { SheetHead } from '../components/SheetHead.js';
import { ExternalGlyph } from '../components/SheetGlyphs.js';
import { SettingsGroup, SettingsRow } from '../components/SettingsRow.js';
import { openInAppBrowser } from '../lib/platform.js';
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
  // The provider being disconnected, while its confirm is open.
  const [removing, setRemoving] = useState<{ id: string; name: string } | undefined>();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const provider = PROVIDERS.find((p) => p.id === editing);

  const openSheet = (id: string) => {
    setEditing(id);
    setValue('');
    setWorkspace(settings.anthropicWorkspaceId ?? '');
    setAskWorkspace(false);
  };
  const closeSheet = () => {
    setEditing(undefined);
    setValue('');
  };

  useEffect(() => {
    // Arrived from a Connect tap elsewhere (the Marketplace's frontier shelf):
    // open that provider's key sheet, so the person lands on the paste field,
    // not at the top of a list to hunt through.
    if (!connectionsFocus) return;
    if (!connectedProviders[connectionsFocus]) openSheet(connectionsFocus);
    clearConnectionsFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionsFocus]);

  const save = async (id: string, name: string) => {
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
        : `${name} API key saved. We could not verify it right now.`,
    );
  };

  return (
    <div className="screen">
      <BackBar title="Cloud Connections" titleHiddenUntil={titleRef} />
      <div className="screen-inner settings">
        <h1 ref={titleRef}>Cloud Connections</h1>
        <p className="lead">
          Connect a provider with your own API key. Its models wait on your bench until you place
          them, and a cloud model runs only when you choose it, with one exception: while nothing in
          your Stack reads images, a plan&apos;s image step goes to one without asking. Keys are
          stored only on this device and sent only to their provider.{' '}
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
        <SettingsGroup index={0}>
          {PROVIDERS.map((p) => {
            const on = Boolean(connectedProviders[p.id]);
            const n = providerBenchModels(p).length;
            return (
              <SettingsRow
                key={p.id}
                label={p.name}
                sub={
                  on
                    ? `Its ${n} ${n === 1 ? 'model is' : 'models are'} on your bench.`
                    : `${n} ${n === 1 ? 'model' : 'models'}`
                }
                value={on ? <span className="pill ok">Connected</span> : undefined}
                asks={on}
                onClick={() => (on ? setRemoving({ id: p.id, name: p.name }) : openSheet(p.id))}
              />
            );
          })}
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
            <SheetHead title={`Connect ${provider.name}`} onClose={closeSheet} />
            <div data-reveal-with="">
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
              </div>
              {provider.id === 'anthropic' && (askWorkspace || workspace.trim()) ? (
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
                  disabled={checking || networkDown || !value.trim()}
                  onClick={() => void save(provider.id, provider.name)}
                >
                  {checking ? 'Checking...' : 'Save'}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </Sheet>

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
  );
}
