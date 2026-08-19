// The marketplace: curated models in plain language, downloadable right
// here. Pocket models pull straight onto this device with a live progress
// bar; desktop models pull through Ollama on the desktop. Licenses shown
// before anything downloads; weights come from the source, never OpenShore.
import { useEffect, useRef, useState } from 'react';
import type { Catalog, CatalogModel } from 'os-code/protocol';
import { useApp } from '../state/store.js';
import { loadAppCatalog } from '../lib/catalog.js';
import { Llama } from '../lib/llamaPlugin.js';
import { bridge } from '../lib/electronBridge.js';
import { isDesktop, isPhone } from '../lib/platform.js';
import { hapticSuccess } from '../lib/haptics.js';
import { BackBar } from '../components/BackBar.js';

interface DownloadState {
  percent: number;
  label: string;
  /** No meaningful percent yet (connecting / verifying): show a shimmer. */
  indeterminate?: boolean;
  /** Terminal failure: hold the card so the user can retry. */
  failed?: boolean;
}

function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

export function MarketplaceScreen() {
  const { settings, saveSettings, showToast } = useApp();
  const [catalog, setCatalog] = useState<Catalog | undefined>();
  const [note, setNote] = useState<string | undefined>();
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [expanded, setExpanded] = useState<string | undefined>();
  const listenersOn = useRef(false);

  useEffect(() => {
    void loadAppCatalog(settings.daemon).then(({ catalog, note }) => {
      setCatalog(catalog);
      setNote(note);
    });
  }, [settings.daemon]);

  useEffect(() => {
    if (listenersOn.current) return;
    listenersOn.current = true;
    void Llama.addListener('downloadProgress', ({ id, completed, total }) => {
      setDownloads((d) => ({
        ...d,
        [id]: {
          percent: total ? (completed / total) * 100 : 0,
          label: total
            ? `${Math.round((completed / total) * 100)}% · ${gb(completed)} of ${gb(total)}`
            : 'Downloading',
          indeterminate: !total,
        },
      }));
    });
    const off = bridge()?.onInstallProgress((p) => {
      setDownloads((d) => ({
        ...d,
        [p.modelId]: {
          percent: p.percent ?? 0,
          label:
            p.total && p.completed !== undefined
              ? `${Math.round(p.percent ?? 0)}% · ${gb(p.completed)} of ${gb(p.total)}`
              : p.line,
          indeterminate: p.percent === undefined,
        },
      }));
    });
    return () => off?.();
  }, []);

  const clearDownload = (id: string) =>
    setDownloads((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });

  const pullToDevice = async (model: CatalogModel) => {
    if (!model.onDevice) return;
    setDownloads((d) => ({
      ...d,
      [model.id]: { percent: 0, label: 'Connecting', indeterminate: true },
    }));
    try {
      await Llama.downloadModel({ id: model.id, url: model.onDevice.url });
      // Bytes are down; the native side checks the file before it counts.
      setDownloads((d) => ({
        ...d,
        [model.id]: { percent: 100, label: 'Verifying', indeterminate: true },
      }));
      await saveSettings({
        deviceModels: { ...settings.deviceModels, [model.id]: model.name },
      });
      hapticSuccess();
      showToast(`${model.name} is on this device. Fully private.`);
      clearDownload(model.id);
    } catch (err) {
      // Hold the card in a failed state so the user can retry in place.
      setDownloads((d) => ({
        ...d,
        [model.id]: {
          percent: d[model.id]?.percent ?? 0,
          label: err instanceof Error ? err.message : 'Download failed.',
          failed: true,
        },
      }));
    }
  };

  const pullToDesktop = async (model: CatalogModel) => {
    const b = bridge();
    if (!b) {
      showToast('Desktop models install from the desktop app. This phone can browse them.');
      return;
    }
    setDownloads((d) => ({
      ...d,
      [model.id]: { percent: 0, label: 'Connecting', indeterminate: true },
    }));
    try {
      const result = await b.installModel(model.id);
      clearDownload(model.id);
      if (result.ok) hapticSuccess();
      showToast(result.detail);
    } catch (err) {
      setDownloads((d) => ({
        ...d,
        [model.id]: {
          percent: d[model.id]?.percent ?? 0,
          label: err instanceof Error ? err.message : 'Install failed.',
          failed: true,
        },
      }));
    }
  };

  if (!catalog) {
    return (
      <div className="screen">
        <BackBar title="Marketplace" />
        <div className="screen-inner">
          <p className="hint">Loading the catalog.</p>
        </div>
      </div>
    );
  }

  const pocket = catalog.models.filter((m) => m.onDevice);
  const desktop = catalog.models.filter((m) => !m.onDevice);

  const renderModel = (model: CatalogModel, target: 'device' | 'desktop', recommended = false) => {
    const dl = downloads[model.id];
    const owned = target === 'device' && Boolean(settings.deviceModels[model.id]);
    return (
      <div className="card" key={model.id}>
        <div className="card-row">
          <div className="grow">
            <h3>
              {model.name}
              {recommended && !owned ? (
                <span className="pill fits" style={{ marginLeft: 8, verticalAlign: 'middle' }}>
                  Start here
                </span>
              ) : null}
            </h3>
            <div className="sub">{model.tagline}</div>
          </div>
          {owned ? (
            <span className="pill local">on device</span>
          ) : dl && !dl.failed ? null : (
            <button
              className="btn ghost"
              style={{ padding: '8px 14px' }}
              onClick={() =>
                target === 'device' ? void pullToDevice(model) : void pullToDesktop(model)
              }
            >
              {dl?.failed ? 'Retry' : 'Get'}
            </button>
          )}
        </div>
        {dl && dl.failed ? (
          <div className="hint" style={{ marginTop: 8, color: 'var(--danger)' }}>
            {dl.label}
          </div>
        ) : dl ? (
          <>
            <div className="progress-track">
              <div
                className={`progress-fill${dl.indeterminate ? ' indeterminate' : ''}`}
                style={dl.indeterminate ? undefined : { width: `${dl.percent}%` }}
              />
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              {dl.label}
            </div>
          </>
        ) : null}
        <button
          className="hint"
          style={{ marginTop: 8, display: 'block' }}
          onClick={() => setExpanded(expanded === model.id ? undefined : model.id)}
        >
          {expanded === model.id ? 'Hide details' : 'Details, license, benchmarks'}
        </button>
        {expanded === model.id ? (
          <div className="sub" style={{ marginTop: 8 }}>
            <p>{model.curation.note}</p>
            <p style={{ marginTop: 6 }}>
              {model.sizeGB} GB · {model.quantization} · {model.contextTokens.toLocaleString()}{' '}
              token context
            </p>
            {model.benchmarks ? (
              <p style={{ marginTop: 6 }}>
                {Object.entries(model.benchmarks)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ')}
              </p>
            ) : null}
            <p style={{ marginTop: 6 }}>
              License: {model.license.name}
              {model.license.note ? `. ${model.license.note}` : ''} Weights download straight from{' '}
              {model.source.kind === 'ollama' ? 'the Ollama library' : 'Hugging Face'}, never from
              OpenShore.
            </p>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="screen">
      <BackBar title="Marketplace" />
      <div className="screen-inner">
        <h1>Models, in plain language</h1>
        <p className="lead">
          Curated for what they are actually good at. {note ?? ''}
        </p>

        {isPhone() || pocket.length ? (
          <>
            <h3 style={{ marginBottom: 10 }}>For this {isPhone() ? 'iPhone' : 'device'}</h3>
            {pocket.map((m, i) => renderModel(m, 'device', i === 0))}
            <div className="divider" />
          </>
        ) : null}

        <h3 style={{ marginBottom: 10 }}>For your desktop{isDesktop() ? '' : ' (via Ollama)'}</h3>
        {!isDesktop() ? (
          <p className="hint" style={{ marginBottom: 10 }}>
            Browse here; install from the OS Code desktop app, and this phone uses them over
            Tailscale.
          </p>
        ) : null}
        {desktop.map((m) => renderModel(m, 'desktop'))}
      </div>
    </div>
  );
}
