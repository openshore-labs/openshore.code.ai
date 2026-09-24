// The connect sheet for one Harness Current (Jev). It layers a cheap decision
// method into the harness, so the sheet is honest about what it does (the jobs)
// and what it costs (a small cloud spend per turn, only on a paid seat). The
// address is prefilled with the provider default; the person pastes a key. The
// save probes the connection and reports honestly: it answered or it did not.
import { useEffect, useState } from 'react';
import { useApp } from '../state/store.js';
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';
import {
  harnessCurrentInfo,
  harnessCurrentStateLine,
  type HarnessCurrentId,
} from '../lib/harnessCurrents.js';

export function HarnessCurrentConnectSheet({
  id,
  onClose,
  onForget,
}: {
  id: HarnessCurrentId | undefined;
  onClose: () => void;
  /** Forget was tapped: the parent asks to confirm, then disconnects. */
  onForget: (id: HarnessCurrentId, label: string) => void;
}) {
  const { settings, harnessCurrentProbes, connectHarnessCurrent, showToast, startGuideChat } =
    useApp();
  const info = id ? harnessCurrentInfo(id) : undefined;
  const saved = id ? settings.harnessCurrentConnections?.[id] : undefined;
  const [endpoint, setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id || !info) return;
    setEndpoint(saved?.endpoint ?? info.apiBase);
    setModel(saved?.model ?? '');
    setApiKey('');
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const valid = /^https?:\/\/\S+/.test(endpoint.trim());

  const save = async () => {
    if (!id || !info) return;
    setBusy(true);
    const answered = await connectHarnessCurrent(id, { endpoint, model, apiKey });
    setBusy(false);
    showToast(
      answered
        ? `${info.label} answered.`
        : `${info.label} saved. It has not answered yet, so the row reads Arriving.`,
    );
    onClose();
  };

  return (
    <Sheet open={Boolean(id)} onClose={onClose}>
      {id && info ? (
        <>
          <SheetHead title={info.label} onClose={onClose} />
          <p className="sheet-sub">{info.needs}</p>
          {saved ? (
            <p className="hint" style={{ marginTop: 0 }}>
              {harnessCurrentStateLine(id, settings, harnessCurrentProbes)}
            </p>
          ) : null}

          <ul className="hint" style={{ marginTop: 0 }}>
            {info.jobs.map((job) => (
              <li key={job}>{job}</li>
            ))}
          </ul>

          <div className="field">
            <label>Address</label>
            <input
              autoFocus
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder={info.apiBase}
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
            />
            <div className="hint" style={{ marginTop: 4 }}>
              The provider API base. The default is filled in for you.
            </div>
          </div>
          <div className="field">
            <label>Model id (optional)</label>
            <input
              autoCapitalize="none"
              autoCorrect="off"
              placeholder={info.defaultModel}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
          <div className="field">
            <label>API key</label>
            <input
              type="password"
              placeholder={saved ? 'Leave blank to keep the saved API key' : 'Paste your API key'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <div className="hint" style={{ marginTop: 4 }}>
              Stored in this device's secure store, scoped to this current, never synced. It only
              spends on a paid seat, never a free local model.
            </div>
          </div>

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
                  // Ask first: a forget turns the current off in every project.
                  onClose();
                  onForget(id, info.label);
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
