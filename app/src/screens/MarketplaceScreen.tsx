// The marketplace: curated models in plain language, searchable and sortable,
// downloadable right here. Pocket models pull straight onto this device with a
// live progress bar; desktop models pull through Ollama on the desktop.
// Licenses shown before anything downloads; weights come from the source, never
// OpenShore. Ratings are computed from benchmarks by the server-side builder,
// never crowd-sourced, and popularity is labelled as popularity, never quality.
import { useEffect, useMemo, useState } from 'react';
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
import { Stars, CapabilityLane, NotRated } from '../components/Stars.js';
import { CompareSheet } from '../components/CompareSheet.js';
import { CapIcon, ModelTile } from '../components/MarketIcon.js';
import {
  EMPTY_FACETS,
  activeFacetCount,
  buildShelves,
  featuredModels,
  fitFor,
  filterModels,
  licenseLabel,
  popularityLabel,
  sortModels,
  usageTurns,
  type Facets,
  type FitLabel,
  type Shelf,
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

// The honest label near the sort control, one per axis that needs the
// disclosure. Editorial ('staff'), landscape ('popular'), and internal ('used')
// each say plainly what they are and are not. No em dashes (house rule).
const SORT_SUBHEAD: Partial<Record<SortKey, string>> = {
  staff: 'Our opinionated shortlist. Chosen, not counted.',
  popular:
    'Ranked by downloads and likes on Hugging Face and Ollama. A snapshot of what the world runs, not a measure of quality. The stars are quality.',
  used: 'Counted on your machine. Never sent anywhere.',
};

const FIT_PILL: Record<FitLabel, { cls: string; text: string }> = {
  fits: { cls: 'fits', text: 'Runs here' },
  tight: { cls: 'tight', text: 'Tight fit' },
  'too-big': { cls: 'big', text: 'Too big' },
};

const CAP_ORDER = Object.keys(CAPABILITIES) as CapabilityCategory[];

export function MarketplaceScreen() {
  const {
    settings,
    addDeviceModel,
    showToast,
    libraryIntro,
    endLibraryIntro,
    harborMiniDownload,
    harborDownload,
  } = useApp();
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
  const [usageByModel, setUsageByModel] = useState<Map<string, number> | undefined>();

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
    // The user's OWN local, lifetime usage, read through the desktop bridge and
    // folded from the session journals on THIS machine. No bridge (iOS/web)
    // means no usage axis. Private by construction: nothing here is cross-user
    // and nothing is ever sent anywhere.
    const b = bridge();
    if (!b) return;
    void b
      .stackHealth('all')
      .then((h) => {
        if (!h.modelUsage?.length) return;
        setUsageByModel(new Map(h.modelUsage.map((u) => [u.model, u.turns])));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // G4: register BOTH progress listeners in the effect and remove BOTH in
    // cleanup. No mount-once ref guard: under StrictMode the effect runs
    // cleanup then re-runs, and a ref guard would leave the bridge listener
    // unregistered (no install progress) while never removing the Llama one.
    const llamaHandle = Llama.addListener('downloadProgress', ({ id, completed, total }) => {
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
    return () => {
      void llamaHandle.then((h) => h.remove());
      off?.();
    };
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
      await addDeviceModel(model.id, model.name);
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

  // The internal axis only exists when the user has real local usage that maps
  // onto at least one catalog model. Otherwise it hides gracefully.
  const usageAxisAvailable = useMemo(
    () =>
      Boolean(
        usageByModel &&
        catalog &&
        catalog.models.some((m) => usageTurns(m, usageByModel) !== undefined),
      ),
    [usageByModel, catalog],
  );

  const sorts = useMemo(() => {
    const list: { key: SortKey; label: string }[] = [
      { key: 'recommended', label: 'Recommended' },
      { key: 'staff', label: 'Staff picks' },
      { key: 'popular', label: 'Popular' },
    ];
    if (usageAxisAvailable) list.push({ key: 'used', label: 'Your most-used' });
    list.push({ key: 'newest', label: 'Newest' }, { key: 'fit', label: 'Best fit' });
    return list;
  }, [usageAxisAvailable]);

  const visible = useMemo(() => {
    if (!catalog) return [];
    let models = filterModels(catalog.models, facets, memoryGB);
    // The editorial shelf: only the picks, kept in curated order.
    if (sort === 'staff') models = models.filter((m) => m.recommended?.isRecommended);
    return sortModels(models, sort, memoryGB, usageByModel);
  }, [catalog, facets, sort, memoryGB, usageByModel]);

  const compareModels = useMemo(
    () =>
      compareIds
        .map((id) => catalog?.models.find((m) => m.id === id))
        .filter((m): m is CatalogModel => Boolean(m)),
    [compareIds, catalog],
  );

  // The store front (App Store "Apps" tab) shows when nothing is being searched
  // or filtered: a featured row and themed shelves to browse. The moment a
  // search term or any facet is set, we fall back to the full sortable list.
  const browsing = !facets.query.trim() && activeFacetCount(facets) === 0;

  const featured = useMemo(() => (catalog ? featuredModels(catalog.models) : []), [catalog]);
  const shelves = useMemo(
    () => (catalog ? buildShelves(catalog.models, memoryGB) : []),
    [catalog, memoryGB],
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
    const popLabel = popularityLabel(model);
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
              <span className="osfit-label">OpenShore fit</span>
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
        ) : (
          // No ratings block yet (the broadened landscape roster). Show absence
          // as absence, never a fabricated or zero star row.
          <div className="not-rated-row">
            <NotRated />
          </div>
        )}

        {popLabel ? <div className="market-pop">{popLabel}</div> : null}

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
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
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

  // Open the full list scoped to one model, the store's stand-in for an App
  // Store product page: the list card carries the ratings, license, details, and
  // compare that a shelf tile deliberately leaves out.
  const openModel = (model: CatalogModel) => {
    setFacets({ ...EMPTY_FACETS, query: model.name });
    setSort('recommended');
  };

  // The compact download control shared by hero cards and shelf rows: a Get
  // button, its in-flight percent, a Retry on failure, or the owned state.
  const getControl = (model: CatalogModel) => {
    const dl = downloads[model.id];
    const target: 'device' | 'desktop' = model.onDevice ? 'device' : 'desktop';
    const owned = target === 'device' && Boolean(settings.deviceModels[model.id]);
    if (owned) return <span className="pill local">on device</span>;
    if (dl && !dl.failed) {
      return (
        <span className="get-progress" aria-live="polite">
          {dl.indeterminate ? 'Getting' : `${Math.round(dl.percent)}%`}
        </span>
      );
    }
    return (
      <button
        className="store-get"
        onClick={(e) => {
          e.stopPropagation();
          if (target === 'device') void pullToDevice(model);
          else void pullToDesktop(model);
        }}
      >
        {dl?.failed ? 'Retry' : 'Get'}
      </button>
    );
  };

  const renderHero = (model: CatalogModel, index: number) => {
    const fit = fitFor(model.sizeGB, memoryGB);
    const pill = FIT_PILL[fit];
    const eyebrow = model.recommended?.isRecommended ? 'OpenShore pick' : 'Featured';
    return (
      <button
        className={`hero-card${model.onDevice ? ' on-device' : ''}`}
        key={model.id}
        style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
        onClick={() => openModel(model)}
        aria-label={`${model.name}. ${model.tagline}`}
      >
        <div className="hero-eyebrow">{eyebrow}</div>
        <div className="hero-title">{model.name}</div>
        <div className="hero-tagline">{model.tagline}</div>
        <div className="hero-foot">
          <ModelTile name={model.name} onDevice={Boolean(model.onDevice)} size={48} />
          <div className="hero-foot-meta">
            <span className={`pill ${pill.cls}`}>{pill.text}</span>
            <span className="hero-size">{model.sizeGB} GB</span>
          </div>
          <span className="hero-get-wrap">{getControl(model)}</span>
        </div>
      </button>
    );
  };

  const renderRow = (model: CatalogModel) => {
    const primaryCap = model.categories[0];
    const meta = model.onDevice
      ? `On device · ${model.sizeGB} GB`
      : `${model.sizeGB} GB · ${model.quantization}`;
    return (
      <button className="store-row" key={model.id} onClick={() => openModel(model)}>
        <ModelTile name={model.name} onDevice={Boolean(model.onDevice)} size={52} />
        <div className="store-row-body">
          <div className="store-row-name">{model.name}</div>
          <div className="store-row-sub">{model.tagline}</div>
          <div className="store-row-meta">
            {primaryCap ? <CapIcon cap={primaryCap} size={12} /> : null}
            {meta}
          </div>
        </div>
        <span className="store-row-get">{getControl(model)}</span>
      </button>
    );
  };

  // Rows are chunked into columns of three so a shelf pages horizontally, three
  // models to a screen, exactly like the App Store's "Must-Have Apps" rail.
  const renderShelf = (shelf: Shelf) => {
    const columns: CatalogModel[][] = [];
    for (let i = 0; i < shelf.models.length; i += 3) {
      columns.push(shelf.models.slice(i, i + 3));
    }
    const openShelf = () => {
      if (shelf.capability) {
        setFacets({ ...EMPTY_FACETS, capability: shelf.capability });
      } else {
        setFacets({ ...EMPTY_FACETS });
        setSort(shelf.sort ?? 'recommended');
      }
    };
    return (
      <section className="shelf" key={shelf.key}>
        <button className="shelf-head" onClick={openShelf}>
          <span className="shelf-head-text">
            <span className="shelf-title">{shelf.title}</span>
            {shelf.subtitle ? <span className="shelf-sub">{shelf.subtitle}</span> : null}
          </span>
          <span className="shelf-more" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </button>
        <div className="shelf-scroll">
          {columns.map((col, i) => (
            <div className="shelf-col" key={i}>
              {col.map(renderRow)}
            </div>
          ))}
        </div>
      </section>
    );
  };

  const categoryRail = (
    <div className="cat-rail" role="tablist" aria-label="Browse by capability">
      <button
        role="tab"
        aria-selected={browsing}
        className={`cat-chip${browsing ? ' active' : ''}`}
        onClick={() => setFacets({ ...EMPTY_FACETS })}
      >
        <span className="cat-chip-glyph all" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </span>
        Discover
      </button>
      {CAP_ORDER.map((cap) => (
        <button
          key={cap}
          role="tab"
          aria-selected={facets.capability === cap}
          className={`cat-chip${facets.capability === cap ? ' active' : ''}`}
          onClick={() => setFacet('capability', facets.capability === cap ? undefined : cap)}
        >
          <span className="cat-chip-glyph" aria-hidden="true">
            <CapIcon cap={cap} size={16} />
          </span>
          {CAPABILITIES[cap].plain}
        </button>
      ))}
    </div>
  );

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
                    Harbor <span className="sub">(preferred guide)</span>
                  </h3>
                  <div className="sub">
                    Bigger, reasons better, searches the web when it needs to.
                  </div>
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

          {settings.harborMiniReady || harborMiniDownload ? (
            <div className="card">
              <div className="card-row">
                <div className="grow">
                  <h3>
                    Harbor Mini <span className="sub">(smaller guide)</span>
                  </h3>
                  <div className="sub">The first model in your stack. Built to be replaced.</div>
                </div>
                {settings.harborMiniReady ? <span className="pill local">on device</span> : null}
              </div>
              {harborMiniDownload && !harborMiniDownload.failed ? (
                <>
                  <div className="progress-track" style={{ marginTop: 10 }}>
                    <div
                      className={`progress-fill${harborMiniDownload.indeterminate ? ' indeterminate' : ''}`}
                      style={
                        harborMiniDownload.indeterminate
                          ? undefined
                          : { width: `${harborMiniDownload.percent}%` }
                      }
                    />
                  </div>
                  <div className="hint" style={{ marginTop: 6 }}>
                    {harborMiniDownload.label}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <input
            className="market-search"
            type="search"
            placeholder="Search models"
            value={facets.query}
            onChange={(e) => setFacet('query', e.target.value)}
            aria-label="Search models"
          />

          {categoryRail}

          {browsing ? (
            <div className="store-front" key="store">
              {featured.length ? (
                <div className="hero-scroll">{featured.map(renderHero)}</div>
              ) : null}

              {!isDesktop() ? (
                <p className="hint store-note">
                  Browse here; desktop models install from the OpenShore desktop app, and this phone
                  uses them over Tailscale.
                </p>
              ) : null}

              {shelves.map(renderShelf)}
            </div>
          ) : (
            <>
              <div className="segmented seg-scroll" role="tablist" aria-label="Sort">
                {sorts.map((s) => (
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

              {SORT_SUBHEAD[sort] ? <p className="sort-honesty">{SORT_SUBHEAD[sort]}</p> : null}

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
                      Browse here; desktop models install from the OpenShore desktop app, and this
                      phone uses them over Tailscale.
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
            </>
          )}
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
