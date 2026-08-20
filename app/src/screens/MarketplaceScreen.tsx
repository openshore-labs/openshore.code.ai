// The marketplace: curated models in plain language, searchable and sortable,
// downloadable right here. Pocket models pull straight onto this device with a
// live progress bar; desktop models pull through Ollama on the desktop.
// Licenses shown before anything downloads; weights come from the source, never
// OpenShore. Ratings are computed from benchmarks by the server-side builder,
// never crowd-sourced, and popularity is labelled as popularity, never quality.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Catalog, CatalogModel, CapabilityCategory } from 'os-code/protocol';
import { CAPABILITIES } from 'os-code/protocol';
import { useApp } from '../state/store.js';
import { loadAppCatalog } from '../lib/catalog.js';
import { Llama } from '../lib/llamaPlugin.js';
import { bridge } from '../lib/electronBridge.js';
import { isDesktop, isPhone } from '../lib/platform.js';
import { hapticSuccess } from '../lib/haptics.js';
import { logEvent } from '../lib/insights.js';
import { BackBar } from '../components/BackBar.js';
import { LibraryIntro } from '../components/LibraryIntro.js';
import { Stars, CapabilityLane } from '../components/Stars.js';
import { CompareSheet } from '../components/CompareSheet.js';
import {
  EMPTY_FACETS,
  activeFacetCount,
  fitFor,
  filterModels,
  licenseLabel,
  sortModels,
  type Facets,
  type FitLabel,
  type SortKey,
} from '../components/marketplace.js';

interface DownloadState {
  percent: number;
  label: string;
  indeterminate?: boolean;
  failed?: boolean;
}

function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

const MEMORY_TIERS = [8, 16, 24, 48];

function parseMemoryGB(summary?: string): number {
  if (!summary) return 16;
  const gpu = [...summary.matchAll(/\((\d+)\s*GB\)/g)].reduce((a, m) => a + Number(m[1]), 0);
  if (gpu > 0) return gpu;
  const sys = /(\d+)\s*GB system RAM/.exec(summary);
  if (sys) return Math.floor(Number(sys[1]) / 2);
  return 16;
}

function nearestTier(gbValue: number): number {
  return MEMORY_TIERS.reduce((best, t) =>
    Math.abs(t - gbValue) < Math.abs(best - gbValue) ? t : best,
  );
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recommended', label: 'Recommended' },
  { key: 'popular', label: 'Most popular' },
  { key: 'newest', label: 'Newest' },
  { key: 'fit', label: 'Best fit' },
];

const FIT_PILL: Record<FitLabel, { cls: string; text: string }> = {
  fits: { cls: 'fits', text: 'Runs here' },
  tight: { cls: 'tight', text: 'Tight fit' },
  'too-big': { cls: 'big', text: 'Too big' },
};

const CAP_ORDER = Object.keys(CAPABILITIES) as CapabilityCategory[];

export function MarketplaceScreen() {
  const { settings, saveSettings, showToast, libraryIntro, endLibraryIntro, harborDownload } =
    useApp();
  const [catalog, setCatalog] = useState<Catalog | undefined>();
  const [note, setNote] = useState<string | undefined>();
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [detailOpen, setDetailOpen] = useState<string | undefined>();
  const [provOpen, setProvOpen] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState<SortKey>('recommended');
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  const [showFilters, setShowFilters] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [memoryGB, setMemoryGB] = useState<number>(16);
  const listenersOn = useRef(false);

  useEffect(() => {
    // Snap the machine tier to detected hardware on the desktop, so fit badges
    // start honest. The user can still pick a different tier in the rail.
    const b = bridge();
    if (!b) return;
    void b
      .status()
      .then((s) => setMemoryGB(nearestTier(parseMemoryGB(s.hardwareSummary))))
      .catch(() => {});
  }, []);

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
      setDownloads((d) => ({
        ...d,
        [model.id]: { percent: 100, label: 'Verifying', indeterminate: true },
      }));
      await saveSettings({
        deviceModels: { ...settings.deviceModels, [model.id]: model.name },
      });
      hapticSuccess();
      logEvent('model_downloaded', { id: model.id, target: 'device' });
      showToast(`${model.name} is on your bench. Place it in your stack.`);
      clearDownload(model.id);
    } catch (err) {
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

  const visible = useMemo(() => {
    if (!catalog) return [];
    return sortModels(filterModels(catalog.models, facets, memoryGB), sort, memoryGB);
  }, [catalog, facets, sort, memoryGB]);

  const compareModels = useMemo(
    () =>
      compareIds
        .map((id) => catalog?.models.find((m) => m.id === id))
        .filter((m): m is CatalogModel => Boolean(m)),
    [compareIds, catalog],
  );

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

  const toggleCompare = (id: string) =>
    setCompareIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= 3 ? ids : [...ids, id],
    );

  const presetsFor = (id: string) =>
    catalog.presets.filter(
      (p) => p.stack.orchestrator === id || Object.values(p.stack.specialists).includes(id),
    );

  const setFacet = <K extends keyof Facets>(key: K, value: Facets[K]) =>
    setFacets((f) => ({ ...f, [key]: value }));

  const renderCard = (model: CatalogModel, index: number) => {
    const dl = downloads[model.id];
    const target: 'device' | 'desktop' = model.onDevice ? 'device' : 'desktop';
    const owned = target === 'device' && Boolean(settings.deviceModels[model.id]);
    const fit = fitFor(model.sizeGB, memoryGB);
    const pill = FIT_PILL[fit];
    const isRecommended = model.recommended?.isRecommended;
    const rated = model.ratings;
    const lanes = CAP_ORDER.filter(
      (c) => model.categories.includes(c) && rated?.perCapability?.[c] !== undefined,
    );
    const detail = detailOpen === model.id;
    const inCompare = compareIds.includes(model.id);
    const stagger = { animationDelay: `${Math.min(index, 7) * 35}ms` };

    return (
      <div
        className={`card market-card${model.onDevice ? ' edge-local' : ''}`}
        key={model.id}
        style={stagger}
      >
        <div className="card-row">
          <div className="grow">
            <h3>{model.name}</h3>
            <div className="sub">{model.tagline}</div>
          </div>
          {owned ? (
            <span className="pill local">on device</span>
          ) : dl && !dl.failed ? null : (
            <button
              className="btn ghost market-get"
              onClick={() =>
                target === 'device' ? void pullToDevice(model) : void pullToDesktop(model)
              }
            >
              {dl?.failed ? 'Retry' : 'Get'}
            </button>
          )}
        </div>

        <div className="badge-row">
          {isRecommended ? (
            <span className="pick-badge">
              <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M2 17c3-1 4-4 5-7s3-5 5-6c-1 3 0 5 1 7s3 3 6 3c-2 2-5 2-8 2s-6 0-9 1z"
                  fill="currentColor"
                />
              </svg>
              OpenShore pick
            </span>
          ) : null}
          <span className={`pill ${pill.cls}`}>{pill.text}</span>
          {model.onDevice ? (
            <span className="ondevice-tag">
              <i className="teal-dot" /> On device
            </span>
          ) : null}
        </div>

        {rated ? (
          <div className="ratings">
            <div className="osfit">
              <span className="osfit-label">OS Code fit</span>
              <Stars value={rated.osCodeFit} size={18} fill="var(--wave)" />
            </div>
            <div className="osfit-divider" />
            {lanes.map((cap) => (
              <CapabilityLane
                key={cap}
                label={CAPABILITIES[cap].plain}
                value={rated.perCapability![cap]!}
                provenance={rated.provenance?.[cap]}
                expanded={Boolean(provOpen[`${model.id}:${cap}`])}
                onToggle={() =>
                  setProvOpen((p) => ({
                    ...p,
                    [`${model.id}:${cap}`]: !p[`${model.id}:${cap}`],
                  }))
                }
              />
            ))}
          </div>
        ) : null}

        <div className="market-meta">
          {model.sizeGB} GB · {model.quantization} · {model.contextTokens.toLocaleString()} ctx
        </div>
        <div className="license-line">{licenseLabel(model)}</div>

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

        <div className="card-foot">
          <button
            className="disclosure"
            onClick={() => setDetailOpen(detail ? undefined : model.id)}
            aria-expanded={detail}
          >
            <span className={`chevron${detail ? ' open' : ''}`} aria-hidden="true">
              ›
            </span>
            {detail ? 'Hide details' : 'Details and license'}
          </button>
          <label className="compare-check">
            <input
              type="checkbox"
              checked={inCompare}
              onChange={() => toggleCompare(model.id)}
              disabled={!inCompare && compareIds.length >= 3}
            />
            Compare
          </label>
        </div>

        {detail ? (
          <div className="detail-panel">
            <p>{model.curation.note}</p>
            {model.recommended?.note ? (
              <p className="detail-pick">{model.recommended.note}</p>
            ) : null}
            <p className="detail-license">
              {model.license.name}
              {model.license.note ? `. ${model.license.note}` : '.'} Weights download straight from{' '}
              {model.source.kind === 'ollama' ? 'the Ollama library' : 'Hugging Face'}, never from
              OpenShore.
            </p>
            {model.benchmarks ? (
              <div className="detail-benches">
                {Object.entries(model.benchmarks).map(([k, v]) => (
                  <span key={k} className="bench-chip">
                    {k}: {v}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="pull-cmd">
              <code>{model.source.pullCommand}</code>
            </div>
            {presetsFor(model.id).length ? (
              <p className="detail-presets">
                In these stacks:{' '}
                {presetsFor(model.id)
                  .map((p) => p.name)
                  .join(', ')}
                .
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const capChip = (cap: CapabilityCategory) => (
    <button
      key={cap}
      className={`facet-chip${facets.capability === cap ? ' active' : ''}`}
      onClick={() => setFacet('capability', facets.capability === cap ? undefined : cap)}
    >
      {CAPABILITIES[cap].plain}
    </button>
  );

  const filterRail = (
    <div className="filter-rail">
      <div className="facet-group">
        <div className="facet-title">Your machine</div>
        <div className="facet-chips">
          {MEMORY_TIERS.map((t) => (
            <button
              key={t}
              className={`facet-chip${memoryGB === t ? ' active' : ''}`}
              onClick={() => setMemoryGB(t)}
            >
              {t} GB
            </button>
          ))}
        </div>
      </div>

      <div className="facet-group">
        <div className="facet-title">Good at</div>
        <div className="facet-chips">{CAP_ORDER.map(capChip)}</div>
      </div>

      {facets.capability ? (
        <div className="facet-group">
          <div className="facet-title">
            Minimum stars in {CAPABILITIES[facets.capability].plain}
          </div>
          <div className="facet-chips">
            {[3, 4, 4.5].map((s) => (
              <button
                key={s}
                className={`facet-chip${facets.minStar === s ? ' active' : ''}`}
                onClick={() => setFacet('minStar', facets.minStar === s ? undefined : s)}
              >
                {s}+
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="facet-group">
        <div className="facet-title">License</div>
        <div className="facet-chips">
          {(['commercial-ok', 'non-commercial', 'gated'] as const).map((p) => (
            <button
              key={p}
              className={`facet-chip${facets.posture === p ? ' active' : ''}`}
              onClick={() => setFacet('posture', facets.posture === p ? undefined : p)}
            >
              {p === 'commercial-ok'
                ? 'Commercial OK'
                : p === 'non-commercial'
                  ? 'Non-commercial'
                  : 'Gated'}
            </button>
          ))}
        </div>
      </div>

      <div className="facet-group">
        <div className="facet-title">Source</div>
        <div className="facet-chips">
          {(['ollama', 'huggingface'] as const).map((s) => (
            <button
              key={s}
              className={`facet-chip${facets.source === s ? ' active' : ''}`}
              onClick={() => setFacet('source', facets.source === s ? undefined : s)}
            >
              {s === 'ollama' ? 'Ollama' : 'Hugging Face'}
            </button>
          ))}
        </div>
      </div>

      <div className="facet-group">
        <div className="facet-chips">
          <button
            className={`facet-chip${facets.fits ? ' active' : ''}`}
            onClick={() => setFacet('fits', !facets.fits)}
          >
            Runs on my machine
          </button>
          <button
            className={`facet-chip${facets.onDeviceOnly ? ' active' : ''}`}
            onClick={() => setFacet('onDeviceOnly', !facets.onDeviceOnly)}
          >
            On my phone
          </button>
          <button
            className={`facet-chip${facets.orchestratorOnly ? ' active' : ''}`}
            onClick={() => setFacet('orchestratorOnly', !facets.orchestratorOnly)}
          >
            Can run the show
          </button>
        </div>
      </div>

      {activeFacetCount(facets) > 0 ? (
        <button
          className="btn quiet"
          onClick={() => setFacets({ ...EMPTY_FACETS, query: facets.query })}
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );

  return (
    <>
      <div className="screen">
        <BackBar title="Marketplace" />
        <div className="screen-inner">
          <h1>Models, in plain language</h1>
          <p className="lead">Curated for what they are actually good at. {note ?? ''}</p>

          {settings.harborReady || harborDownload ? (
            <div className="card">
              <div className="card-row">
                <div className="grow">
                  <h3>
                    Harbor <span className="sub">(your guide)</span>
                  </h3>
                  <div className="sub">The first model in your stack. Built to be replaced.</div>
                </div>
                {settings.harborReady ? <span className="pill local">on device</span> : null}
              </div>
              {harborDownload && !harborDownload.failed ? (
                <>
                  <div className="progress-track" style={{ marginTop: 10 }}>
                    <div
                      className={`progress-fill${harborDownload.indeterminate ? ' indeterminate' : ''}`}
                      style={
                        harborDownload.indeterminate
                          ? undefined
                          : { width: `${harborDownload.percent}%` }
                      }
                    />
                  </div>
                  <div className="hint" style={{ marginTop: 6 }}>
                    {harborDownload.label}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="market-controls">
            <input
              className="market-search"
              type="search"
              placeholder="Search models"
              value={facets.query}
              onChange={(e) => setFacet('query', e.target.value)}
              aria-label="Search models"
            />
            <div className="segmented" role="tablist" aria-label="Sort">
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  role="tab"
                  aria-selected={sort === s.key}
                  className={`seg${sort === s.key ? ' active' : ''}`}
                  onClick={() => setSort(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {sort === 'popular' ? (
            <p className="sort-honesty">
              Popularity counts downloads, not quality. Our stars come from benchmarks.
            </p>
          ) : null}

          <div className="market-body">
            {!isPhone() ? <aside className="rail-desktop">{filterRail}</aside> : null}

            <div className="market-main">
              <div className="result-bar">
                <span className="result-count" key={visible.length}>
                  {visible.length} model{visible.length === 1 ? '' : 's'}
                </span>
                {isPhone() ? (
                  <button className="filter-open" onClick={() => setShowFilters(true)}>
                    Filters{activeFacetCount(facets) ? ` (${activeFacetCount(facets)})` : ''}
                  </button>
                ) : null}
              </div>

              {!isDesktop() ? (
                <p className="hint" style={{ marginBottom: 10 }}>
                  Browse here; desktop models install from the OS Code desktop app, and this phone
                  uses them over Tailscale.
                </p>
              ) : null}

              <div className="market-list" key={sort}>
                {visible.length ? (
                  visible.map(renderCard)
                ) : (
                  <p className="hint">No models match these filters yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {compareIds.length >= 2 ? (
        <div className="compare-bar">
          <span>{compareIds.length} selected</span>
          <button className="btn primary" onClick={() => setCompareOpen(true)}>
            Compare
          </button>
          <button className="btn quiet" onClick={() => setCompareIds([])}>
            Clear
          </button>
        </div>
      ) : null}

      {compareOpen && compareModels.length >= 2 ? (
        <CompareSheet
          models={compareModels}
          memoryGB={memoryGB}
          onClose={() => setCompareOpen(false)}
        />
      ) : null}

      {showFilters ? (
        <div className="sheet-scrim" onClick={() => setShowFilters(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>Filters</h2>
            <div className="sheet-sub">{visible.length} models match.</div>
            {filterRail}
            <div className="sheet-actions">
              <button className="btn primary" onClick={() => setShowFilters(false)}>
                Show {visible.length} models
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {libraryIntro ? <LibraryIntro onDone={endLibraryIntro} /> : null}
    </>
  );
}
