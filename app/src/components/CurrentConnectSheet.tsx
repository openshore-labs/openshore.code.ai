// The connect sheet for one Agentic Current: what it needs, and nothing
// else. Hermes takes an address ending in /v1, a model, and a key. A2A and an
// endpoint current take an address and a key. CLI Pairing takes a pick of the
// CLI. The save probes the connection and reports honestly: it either answered
// or it did not, and the row reads On or Arriving accordingly.
import { useEffect, useState } from 'react';
import { useApp } from '../state/store.js';
import { Sheet } from './Sheet.js';
import { currentInfo, currentStateLine, type AgenticCurrentId } from '../lib/currents.js';

export function CurrentConnectSheet({
  id,
  onClose,
}: {
  id: AgenticCurrentId | undefined;
  onClose: () => void;
}) {
  const {
    settings,
    currentProbes,
    currentsHost,
    connectCurrent,
    disconnectCurrent,
    showToast,
    startGuideChat,
  } = useApp();
  const info = id ? currentInfo(id) : undefined;
  const saved = id ? settings.currentConnections?.[id] : undefined;
  const [endpoint, setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [command, setCommand] = useState<'claude' | 'codex'>('claude');
  const [busy, setBusy] = useState(false);

  // Seed the form from what is saved each time the sheet opens on a current.
  useEffect(() => {
    if (!id) return;
    setEndpoint(saved?.endpoint ?? '');
    setModel(saved?.model ?? '');
    setApiKey('');
    setCommand(saved?.command ?? 'claude');
    setBusy(false);
    // The saved connection is read once per open; later edits are the form's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const valid = info?.kind === 'cli' ? Boolean(command) : /^https?:\/\/\S+/.test(endpoint.trim());

  const save = async () => {
    if (!id || !info) return;
    setBusy(true);
    const answered = await connectCurrent(id, {
      endpoint: info.kind === 'cli' ? undefined : endpoint,
      model: info.kind === 'hermes' || info.kind === 'endpoint' ? model : undefined,
      command: info.kind === 'cli' ? command : undefined,
      apiKey: info.kind === 'cli' ? undefined : apiKey,
    });
    setBusy(false);
    showToast(
      answered
        ? `${info.label} answered.`
        : `${info.label} saved. It has not answered yet, so the row reads Arriving.`,
    );
    onClose();
  };

  const hostHas = (c: 'claude' | 'codex') => currentsHost?.cli[c];

  return (
    <Sheet open={Boolean(id)} onClose={onClose}>
      {id && info ? (
        <>
          <h2>{info.label}</h2>
          <p className="sheet-sub">{info.needs}</p>
          {saved ? (
            <p className="hint" style={{ marginTop: 0 }}>
              {currentStateLine(id, settings, currentProbes)}
            </p>
          ) : null}

          {info.kind === 'cli' ? (
            <div className="field">
              <label>Which CLI</label>
              <div className="segmented" role="tablist" aria-label="Which CLI">
                {(['claude', 'codex'] as const).map((c) => (
                  <button
                    key={c}
                    role="tab"
                    aria-selected={command === c}
                    className={`seg press-fb${command === c ? ' active' : ''}`}
                    onClick={() => setCommand(c)}
                  >
                    {c === 'claude' ? 'Claude Code' : 'Codex'}
                    {hostHas(c) === true ? ' (found)' : ''}
                  </button>
                ))}
              </div>
              <div className="hint" style={{ marginTop: 4 }}>
                {currentsHost
                  ? hostHas(command)
                    ? 'Found on the paired computer.'
                    : 'Not found on the paired computer yet. Install it there, then save again.'
                  : 'Pair a computer to check what is installed there.'}
              </div>
            </div>
          ) : (
            <>
              <div className="field">
                <label>Address</label>
                <input
                  autoFocus
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  placeholder={
                    info.kind === 'hermes'
                      ? 'http://your-box.ts.net:8642/v1'
                      : 'http://your-agent.ts.net:port'
                  }
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                />
                <div className="hint" style={{ marginTop: 4 }}>
                  {info.kind === 'hermes'
                    ? 'The API server address, ending in /v1. Reach it over Tailscale, never the public internet.'
                    : info.kind === 'a2a'
                      ? 'The base address that publishes the agent card. Reach it over Tailscale, never the public internet.'
                      : 'OpenShore tries an A2A agent card at this address first, then an OpenAI-compatible /v1.'}
                </div>
              </div>
              {info.kind === 'hermes' || info.kind === 'endpoint' ? (
                <div className="field">
                  <label>Model id (optional)</label>
                  <input
                    autoCapitalize="none"
                    autoCorrect="off"
                    placeholder={info.kind === 'hermes' ? 'hermes' : 'default'}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                </div>
              ) : null}
              <div className="field">
                <label>API key (optional)</label>
                <input
                  type="password"
                  placeholder={
                    saved ? 'Leave blank to keep the saved key' : 'Leave blank for a keyless box'
                  }
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <div className="hint" style={{ marginTop: 4 }}>
                  Stored in this device's secure store, scoped to this current, never synced.
                </div>
              </div>
            </>
          )}

          <div className="sheet-actions">
            <button className="btn primary" disabled={!valid || busy} onClick={() => void save()}>
              {busy ? 'Checking' : saved ? 'Save and check' : 'Connect'}
            </button>
            <button
              className="btn quiet"
              onClick={() => {
                onClose();
                void startGuideChat(info.guide);
              }}
            >
              Walk me through it
            </button>
            {saved ? (
              <button
                className="btn quiet"
                onClick={() => {
                  void disconnectCurrent(id);
                  onClose();
                }}
              >
                Forget
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </Sheet>
  );
}
