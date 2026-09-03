// The marketplace: curated models in plain language, searchable and sortable,
// downloadable right here. Pocket models pull straight onto this device with a
// live progress bar; desktop models pull through Ollama on the desktop.
// Licenses shown before anything downloads; weights come from the source, never
// OpenShore. Ratings are computed from benchmarks by the server-side builder,
// never crowd-sourced, and popularity is labelled as popularity, never quality.
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Catalog, CatalogModel, CapabilityCategory } from 'os-code/protocol';
import { CAPABILITIES } from 'os-code/protocol';
import { useApp } from '../state/store.js';
import { loadAppCatalog } from '../lib/catalog.js';
import { daemonInstallModel, daemonInstallProgress } from '../drivers/remoteDriver.js';
import { bundleModelIds, bundleTotalGB, bundlesFor, type StackBundle } from '../lib/bundles.js';
import {
  HOSTED_SHELF,
  contextLabel,
  filterHosted,
  hostedFacetsApply,
  hostedIsNew,
  hostedModels,
  newestHosted,
  sortHostedNewest,
  type HostedModel,
} from '../lib/hosted.js';
import { Llama } from '../lib/llamaPlugin.js';
import { bridge } from '../lib/electronBridge.js';
import { isPhone } from '../lib/platform.js';
import { hapticSuccess } from '../lib/haptics.js';
import { logEvent } from '../lib/insights.js';
import { durationMs } from '../lib/motion.js';
import { recallScroll } from '../lib/scrollMemory.js';
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
import { Sheet } from '../components/Sheet.js';

interface DownloadState {
  percent: number;
  label: string;
  indeterminate?: boolean;
  failed?: boolean;
}

function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

// Plain-language gloss for a quantization tag, so a spec like "Q4_K_M" reads as
// a tradeoff rather than jargon.
function quantGloss(q: string): string | undefined {
  const t = q.toUpperCase();
  if (/Q8|F16|FP16|BF16/.test(t)) return 'Near-full quality, the largest download.';
  if (/Q6/.test(t)) return 'High quality, a little larger.';
  if (/Q5/.test(t)) return 'A touch sharper than Q4, a little larger.';
  if (/Q4/.test(t)) return 'The balanced default: strong quality, runs on modest hardware.';
  if (/Q3|Q2/.test(t)) return 'Smallest and fastest, with some quality traded away.';
  return undefined;
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
    'Ranked by downloads and likes on Hugging Face. A snapshot of what the world runs, not a measure of quality. The stars are quality.',
  used: 'Counted on your machine. Never sent anywhere.',
};

const FIT_PILL: Record<FitLabel, { cls: string; text: string }> = {
  fits: { cls: 'fits', text: 'Runs here' },
  tight: { cls: 'tight', text: 'Tight fit' },
  'too-big': { cls: 'big', text: 'Too big' },
};

const CAP_ORDER = Object.keys(CAPABILITIES) as CapabilityCategory[];

// The hosted product page that was open when the store was left for another
// room (Cloud Connections, the Stack), so a Connect tap comes back to the page
// it left rather than the store front. Honored on a back navigation only; a
// fresh open from the panel starts at the front, the way a tab does.
let hostedPageMemory: string | undefined;

/** Where a hosted tile was tapped, so the way back flies to the same tile. */
type TileHome = { id: string; where: 'hero' | 'row' | 'preset' };

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

export function MarketplaceScreen() {
  const {
    settings,
    addDeviceModel,
    showToast,
    libraryIntro,
    endLibraryIntro,
    harborMiniDownload,
    harborDownload,
    connectedProviders,
    setView,
    openConnections,
  } = useApp();
  const [catalog, setCatalog] = useState<Catalog | undefined>();
  // The frontier shelf: cloud-hosted models derived from the BYOK providers.
  // Their product page is its own focus, distinct from a catalog model's.
  const hosted = useMemo(() => hostedModels(), []);
  const [focusedHostedId, setFocusedHostedId] = useState<string | undefined>(() =>
    useApp.getState().arrivedBack ? hostedPageMemory : undefined,
  );
  const focusedHostedRef = useRef(focusedHostedId);
  focusedHostedRef.current = focusedHostedId;
  // The tile the open page flew from, so the way back flies to it.
  const [tileHome, setTileHome] = useState<TileHome | undefined>();
  // A provider connected since the store was last on screen: its rows just
  // flipped from Connect to "on bench", and pop once to mark the commit.
  const [pop, setPop] = useState<string | undefined>(() => useApp.getState().justConnected);
  // The room's scroller. The window never scrolls here (.screen does), so
  // scroll-to-top and scroll memory address this element.
  const screenRef = useRef<HTMLDivElement>(null);
  // Which stack bundle is installing, if any (hooks stay above every early
  // return; the bundle logic itself lives further down with the other installs).
  const [bundleBusy, setBundleBusy] = useState<string | undefined>();
  // Install-by-name state (the logic lives further down, but the hooks must sit
  // above every early return).
  const [refInput, setRefInput] = useState('');
  const [refBusy, setRefBusy] = useState(false);
  const [refLine, setRefLine] = useState<string | undefined>();
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
  // A single model opened as a product page: an exact id, not a name search, so
  // a sibling whose name happens to fuzzy-match never rides along.
  const [focusedId, setFocusedId] = useState<string | undefined>();
  // Desktop models already pulled onto the paired machine (by source ref), so a
  // model that is installed shows as installed rather than an endless Get.
  const [installedRefs, setInstalledRefs] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    // Snap the machine tier to detected hardware on the desktop, so fit badges
    // start honest. The user can still pick a different tier in the rail.
    const b = bridge();
    if (!b) return;
    void b
      .status()
      .then((s) => {
        setMemoryGB(nearestTier(parseMemoryGB(s.hardwareSummary)));
        setInstalledRefs(new Set(s.ollama.models));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    void loadAppCatalog(settings.daemon).then(({ catalog, note }) => {
      setCatalog(catalog);
      setNote(note);
    });
  }, [settings.daemon]);

  useEffect(() => {
    // Remember the open hosted page for the way back, whatever room comes next.
    return () => {
      hostedPageMemory = focusedHostedRef.current;
    };
  }, []);

  useEffect(() => {
    // Back from another room: land where the eye left, once the catalog has
    // given the shelves their height (the app-level restore ran at mount,
    // against a skeleton that may have been too short to hold the offset).
    if (!catalog || !useApp.getState().arrivedBack) return;
    const top = recallScroll('marketplace');
    if (top && screenRef.current) screenRef.current.scrollTop = top;
  }, [catalog]);

  useEffect(() => {
    // The connected moment. A haptic marks the commit, the pill pops in on
    // the release spring, then the flag rests so nothing replays.
    if (!pop) return;
    hapticSuccess();
    useApp.getState().clearJustConnected();
    const t = setTimeout(() => setPop(undefined), durationMs('--dur-5', 600));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // MP-F4: adopt pocket models that finished downloading while the app was
    // closed. iOS completes a background transfer with no app UI, so a model can
    // be on disk yet untracked, which would show Get and re-download on tap.
    // Once the catalog is known (for real names), record any present-but-
    // untracked catalog model, and reseed the progress UI for one still running.
    if (!catalog || !isPhone()) return;
    let cancelled = false;
    void (async () => {
      try {
        const [{ models }, active] = await Promise.all([
          Llama.listModels(),
          Llama.activeDownloads().catch(() => ({ ids: [] as string[] })),
        ]);
        if (cancelled) return;
        const present = new Set(models.map((m) => m.id));
        for (const m of catalog.models) {
          if (m.onDevice && present.has(m.id) && !settings.deviceModels[m.id]) {
            void addDeviceModel(m.id, m.name);
          }
        }
        if (active.ids.length) {
          setDownloads((d) => {
            const next = { ...d };
            for (const id of active.ids) {
              if (!next[id] && catalog.models.some((m) => m.id === id)) {
                next[id] = { percent: 0, label: 'Resuming', indeterminate: true };
              }
            }
            return next;
          });
        }
      } catch {
        // Native side unreachable: leave state as is.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

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
      // No desktop app here. If a daemon is paired, install onto that machine
      // over the tailnet (MP-F2); otherwise this phone can only browse.
      if (settings.daemon) {
        void installViaDaemon(model);
        return;
      }
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

  // Install a desktop model onto a paired machine over the tailnet, polling the
  // daemon for progress so the same download UI animates as on the desktop.
  const installViaDaemon = async (model: CatalogModel) => {
    const daemon = settings.daemon;
    if (!daemon) return;
    setDownloads((d) => ({
      ...d,
      [model.id]: { percent: 0, label: 'Connecting', indeterminate: true },
    }));
    try {
      await daemonInstallModel(daemon, model.id);
    } catch (err) {
      setDownloads((d) => ({
        ...d,
        [model.id]: {
          percent: 0,
          label: err instanceof Error ? err.message : 'Install failed.',
          failed: true,
        },
      }));
      return;
    }
    // Poll until the desktop reports the install done.
    for (;;) {
      await new Promise((r) => setTimeout(r, 1200));
      let p;
      try {
        p = await daemonInstallProgress(daemon, model.id);
      } catch {
        continue; // a transient blip; keep polling
      }
      if (!p) break; // no longer tracked
      if (p.done) {
        clearDownload(model.id);
        if (p.ok) {
          hapticSuccess();
          setInstalledRefs((s) => new Set(s).add(model.source.ref));
        }
        showToast(p.detail ?? (p.ok ? 'Installed on your desktop.' : 'Install failed.'));
        break;
      }
      setDownloads((d) => ({
        ...d,
        [model.id]: {
          percent: p.percent ?? 0,
          label:
            p.total && p.completed !== undefined
              ? `${Math.round(p.percent ?? 0)}% · ${gb(p.completed)} of ${gb(p.total)}`
              : p.line,
          indeterminate: p.percent === undefined,
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

  // The staff axis lands on an empty state with a pick-less catalog (the bundled
  // starter carries none), so only offer it when the catalog actually has picks.
  const staffAxisAvailable = useMemo(
    () => Boolean(catalog?.models.some((m) => m.recommended?.isRecommended)),
    [catalog],
  );

  const sorts = useMemo(() => {
    const list: { key: SortKey; label: string }[] = [{ key: 'recommended', label: 'Recommended' }];
    if (staffAxisAvailable) list.push({ key: 'staff', label: 'Staff picks' });
    list.push({ key: 'popular', label: 'Popular' });
    if (usageAxisAvailable) list.push({ key: 'used', label: 'Your most-used' });
    list.push({ key: 'newest', label: 'Newest' }, { key: 'fit', label: 'Best fit' });
    return list;
  }, [usageAxisAvailable, staffAxisAvailable]);

  const visible = useMemo(() => {
    if (!catalog) return [];
    // A focused model is its own one-card product page.
    if (focusedId) return catalog.models.filter((m) => m.id === focusedId);
    let models = filterModels(catalog.models, facets, memoryGB);
    // The editorial shelf: only the picks, kept in curated order.
    if (sort === 'staff') models = models.filter((m) => m.recommended?.isRecommended);
    return sortModels(models, sort, memoryGB, usageByModel);
  }, [catalog, focusedId, facets, sort, memoryGB, usageByModel]);

  const compareModels = useMemo(
    () =>
      compareIds
        .map((id) => catalog?.models.find((m) => m.id === id))
        .filter((m): m is CatalogModel => Boolean(m)),
    [compareIds, catalog],
  );

  // Hosted models that answer the current search or capability. Hardware,
  // license, size, and source facets are about downloads, so any of those set
  // keeps hosted rows out of the list (hostedFacetsApply).
  const hostedMatches = useMemo(
    () =>
      hostedFacetsApply(facets)
        ? sortHostedNewest(filterHosted(hosted, facets.query, facets.capability))
        : [],
    [hosted, facets],
  );
  const hostedShelf = useMemo(() => sortHostedNewest(hosted), [hosted]);
  const hostedHero = useMemo(() => newestHosted(hosted), [hosted]);

  // The store front (App Store "Apps" tab) shows when nothing is being searched
  // or filtered: a featured row and themed shelves to browse. The moment a
  // search term or any facet is set, we fall back to the full sortable list.
  const browsing =
    !focusedId && !focusedHostedId && !facets.query.trim() && activeFacetCount(facets) === 0;
  const focusedModel = focusedId ? catalog?.models.find((m) => m.id === focusedId) : undefined;
  const focusedHosted = focusedHostedId ? hosted.find((m) => m.id === focusedHostedId) : undefined;

  const featured = useMemo(() => (catalog ? featuredModels(catalog.models) : []), [catalog]);
  const shelves = useMemo(
    () => (catalog ? buildShelves(catalog.models, memoryGB) : []),
    [catalog, memoryGB],
  );

  if (!catalog) {
    // A skeleton store front instead of a bare line: two hero placeholders and
    // two shelves of rows, using the existing shimmer, so the catalog fetch
    // (up to several seconds on a cold cellular tailnet) reads as loading, not
    // stalled. The shimmer is killed by the global reduced-motion reset.
    return (
      <div className="screen" ref={screenRef}>
        <BackBar title="Marketplace" />
        <div className="screen-inner">
          <h1>Models, in plain language</h1>
          <p className="lead">Curated for what they are actually good at.</p>
          <div className="hero-scroll" aria-hidden="true">
            <div className="hero-card skeleton build-shimmer" />
            <div className="hero-card skeleton build-shimmer" />
          </div>
          {[0, 1].map((s) => (
            <section className="shelf" key={s} aria-hidden="true">
              <div className="skeleton-line build-shimmer" style={{ width: '40%', height: 16 }} />
              <div className="shelf-scroll">
                <div className="shelf-col">
                  {[0, 1, 2].map((r) => (
                    <div className="store-row skeleton build-shimmer" key={r} />
                  ))}
                </div>
              </div>
            </section>
          ))}
          <span className="visually-hidden">Loading the catalog.</span>
        </div>
      </div>
    );
  }

  const toggleCompare = (id: string) =>
    setCompareIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= 3 ? ids : [...ids, id],
    );

  // ---- stack bundles ------------------------------------------------------
  // One tap fills the whole stack for a profile. Desktop: pull each model
  // through the engine (the same install channel and progress UI as a single
  // model), then set the orchestrator and specialists. Phone: the Pocket bundle
  // downloads its on-device model and makes it the Reasoning LLM. Sizes are
  // summed from the live catalog, never hardcoded.
  const sizeOf = (id: string) => catalog?.models.find((m) => m.id === id)?.sizeGB;
  const installBundle = async (bundle: StackBundle) => {
    if (!catalog || bundleBusy) return;
    const ids = bundleModelIds(bundle);
    const models = ids.map((id) => catalog.models.find((m) => m.id === id));
    if (models.some((m) => !m)) {
      showToast('This bundle names a model the catalog does not have yet.');
      return;
    }
    setBundleBusy(bundle.id);
    try {
      if (bundle.platform === 'phone') {
        const m = models[0]!;
        await pullToDevice(m);
        await useApp.getState().setReasoning({ kind: 'device', modelId: m.id, modelName: m.name });
        showToast(`${bundle.name} is your stack. Ready to chat, offline.`);
        return;
      }
      const b = bridge();
      if (!b) {
        showToast('Desktop bundles install from the OpenShore desktop app.');
        return;
      }
      for (const m of models) {
        const r = await b.installModel(m!.id);
        clearDownload(m!.id);
        if (!r.ok) {
          showToast(r.detail);
          return;
        }
      }
      const orch = models[0]!;
      const set = await b.setOrchestrator(orch.source.ref);
      if (!set.ok) {
        showToast(set.detail);
        return;
      }
      for (const [role, id] of Object.entries(bundle.specialists)) {
        const m = catalog.models.find((x) => x.id === id);
        if (m) await b.enableSpecialist(role, m.source.ref);
      }
      await useApp.getState().refreshDesktopStatus();
      hapticSuccess();
      logEvent('bundle_installed', { id: bundle.id });
      showToast(`${bundle.name} is your stack. Ready to chat and build.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not install the bundle.');
    } finally {
      setBundleBusy(undefined);
    }
  };

  // Install any Ollama model by name, so the marketplace is never limited to
  // the models we enumerated: whatever is on the Ollama library (the newest
  // SOTA releases the day they land) can be pulled and placed. Desktop only;
  // the pull runs on this machine's engine. A wrong name comes back as
  // Ollama's own error, never a fabricated success. (State is declared above,
  // over the early returns.)
  const installByRef = async () => {
    const ref = refInput.trim();
    const b = bridge();
    if (!ref || !b || refBusy) return;
    setRefBusy(true);
    setRefLine(`Pulling ${ref}...`);
    const off = b.onInstallProgress((p) => {
      if (p.modelId !== ref) return;
      setRefLine(p.percent != null ? `${p.line} ${Math.round(p.percent)}%` : p.line);
    });
    try {
      const r = await b.installOllamaRef(ref);
      showToast(r.detail);
      if (r.ok) {
        hapticSuccess();
        setRefInput('');
        await useApp.getState().refreshDesktopStatus();
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not pull that model.');
    } finally {
      off();
      setRefBusy(false);
      setRefLine(undefined);
    }
  };

  const renderInstallByName = () => {
    if (isPhone()) return null;
    return (
      <div className="card" key="install-by-name">
        <h3>Have a model in mind?</h3>
        <p className="hint" style={{ marginTop: 4 }}>
          Type any name from the Ollama library and install it, even brand new models not listed
          here yet. For example qwen3-coder:30b, deepseek-r1:14b, gemma3:12b. A :cloud tag
          (kimi-k3:cloud) runs on Ollama&apos;s cloud under your Ollama account.
        </p>
        <div className="field" style={{ marginTop: 8 }}>
          <input
            placeholder="model name, e.g. qwen3:8b"
            value={refInput}
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(e) => setRefInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void installByRef()}
          />
        </div>
        <button
          className="btn ghost press-fb"
          style={{ width: '100%' }}
          disabled={refBusy || !refInput.trim()}
          onClick={() => void installByRef()}
        >
          {refBusy ? (refLine ?? 'Installing...') : 'Install by name'}
        </button>
      </div>
    );
  };

  const renderBundleShelf = () => {
    const list = bundlesFor(isPhone() ? 'phone' : 'desktop');
    const other = bundlesFor(isPhone() ? 'desktop' : 'phone');
    return (
      <section className="shelf" key="bundles">
        <div className="shelf-head">
          <h2>Fill your stack in one tap</h2>
          <p className="hint">
            A bundle sets your Reasoning LLM and specialists for a profile. Each shows its total
            download. Weights come straight from their source.
          </p>
        </div>
        <div className="market-list">
          {list.map((bundle) => {
            const total = bundleTotalGB(bundle, sizeOf);
            const names = bundleModelIds(bundle)
              .map((id) => catalog?.models.find((m) => m.id === id)?.name ?? id)
              .join(' · ');
            const busy = bundleBusy === bundle.id;
            const progressLine = busy
              ? bundleModelIds(bundle)
                  .map((id) => downloads[id]?.label)
                  .find(Boolean)
              : undefined;
            return (
              <div className="card" key={bundle.id}>
                <div className="card-row">
                  <div className="grow">
                    <h3>{bundle.name}</h3>
                    <div className="sub">{bundle.tagline}</div>
                  </div>
                  <span className="pill local">
                    {total !== undefined ? `${total} GB` : 'size unknown'}
                  </span>
                </div>
                <p className="hint" style={{ marginTop: 6 }}>
                  {names}
                  {bundle.minVramGB ? ` · needs about ${bundle.minVramGB} GB of GPU memory` : ''}
                </p>
                <button
                  className="btn primary press-fb"
                  style={{ width: '100%', marginTop: 8 }}
                  disabled={Boolean(bundleBusy)}
                  onClick={() => void installBundle(bundle)}
                >
                  {busy ? (progressLine ?? 'Installing...') : `Install ${bundle.name}`}
                </button>
              </div>
            );
          })}
          {other.length ? (
            <p className="hint">
              {isPhone()
                ? 'Desktop bundles (Starter, Coding, Creative, Performance) install from the OpenShore desktop app.'
                : 'The Pocket bundle runs on your iPhone; get it there.'}
            </p>
          ) : null}
        </div>
      </section>
    );
  };

  const presetsFor = (id: string) =>
    catalog.presets.filter(
      (p) => p.stack.orchestrator === id || Object.values(p.stack.specialists).includes(id),
    );

  // A soft crossfade for a view that changes shape with no tile to carry it:
  // the store front giving way to the list on the first typed character or
  // the first facet, the list handing the front back when the last one
  // clears, and a product page dissolving into either. Only on that
  // boundary, never per keystroke: a transition per key would drag the caret
  // behind the finger. The search field and the category rail carry their own
  // view-transition names, so they hold still while the shelves below fade.
  const fade = (update: () => void) => {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (!doc.startViewTransition || window.matchMedia(REDUCED_MOTION).matches) {
      update();
      return;
    }
    doc.startViewTransition(() => flushSync(update));
  };

  // Every search or filter change lands here. Any of them leaves a product
  // page; crossing between the store front and the list crossfades.
  const applyFacets = (next: Facets) => {
    const toFront = !next.query.trim() && activeFacetCount(next) === 0;
    const crossing = Boolean(focusedId || focusedHostedId) || toFront !== browsing;
    const update = () => {
      setFocusedId(undefined);
      setFocusedHostedId(undefined);
      setFacets(next);
    };
    if (crossing) fade(update);
    else update();
  };

  const setFacet = <K extends keyof Facets>(key: K, value: Facets[K]) =>
    applyFacets({ ...facets, [key]: value });

  // `focused`: the card is the model's own product page, so it carries the
  // tile the hero or row flew in on (and the shared name for the way back).
  const renderCard = (model: CatalogModel, index: number, focused = false) => {
    const dl = downloads[model.id];
    const target: 'device' | 'desktop' = model.onDevice ? 'device' : 'desktop';
    const owned = isOwned(model);
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
        className={`card market-card${model.onDevice ? ' edge-local' : ''}${focused ? ' product-page' : ''}`}
        key={model.id}
        style={stagger}
      >
        <div className="card-row">
          {focused ? (
            <ModelTile name={model.name} onDevice={Boolean(model.onDevice)} size={56} />
          ) : null}
          <div className="grow">
            <h3>{model.name}</h3>
            <div className="sub">{model.tagline}</div>
          </div>
          {owned ? (
            <span className="pill local">{model.onDevice ? 'on device' : 'installed'}</span>
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
          {model.discovery ? (
            <span className="pill" title={`Found ${model.discovery.foundAt} on Hugging Face`}>
              New · unrated
            </span>
          ) : null}
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
                style={dl.indeterminate ? undefined : { transform: `scaleX(${dl.percent / 100})` }}
              />
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              {dl.label}
            </div>
          </>
        ) : null}

        <div className="card-foot">
          <button
            className="disclosure press-fb"
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
            {quantGloss(model.quantization) ? (
              <p className="detail-quant">
                <strong>{model.quantization}</strong> · {quantGloss(model.quantization)}
              </p>
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

  // Open one model as its own product page: an exact focus (not a name search),
  // its full card with ratings, license, and details expanded up front.
  const scrollToTop = () => {
    if (screenRef.current) screenRef.current.scrollTop = 0;
  };

  // Open one model as its own product page. From a hero, row, or preset
  // member (anything with a tile) the tile hops into the page; the way back
  // flies it home. Defined below with the hosted hop, which it shares.
  const openModel = (
    model: CatalogModel,
    origin: Element | null = null,
    where?: TileHome['where'],
  ) => {
    if (where) setTileHome({ id: model.id, where });
    hop(() => {
      setFacets(EMPTY_FACETS);
      setFocusedHostedId(undefined);
      setFocusedId(model.id);
      setDetailOpen(model.id);
    }, origin);
    scrollToTop();
  };

  const closeModel = () => {
    hop(
      () => {
        setFocusedId(undefined);
        setDetailOpen(undefined);
      },
      screenRef.current?.querySelector('.product-page') ?? null,
      () => setTileHome(undefined),
    );
  };

  // ---- hosted (cloud) models: the frontier shelf ---------------------------
  // Kimi K3, Claude Opus, GPT-5, Gemini Pro: too big to download, so the store
  // offers Connect instead of Get. A connected provider already has its models
  // on the Bench (the Stack derives them from the same providers), so the
  // control flips to "on bench" the moment the key is saved.

  // The tile hops. A hosted hero or row and its product page share one tile,
  // so the page arrives by that tile flying into place instead of the list
  // hard-cutting to a card. The View Transitions API where the platform has
  // it (iOS 18, Chromium); a plain swap elsewhere and under reduced motion.
  // The origin tile is handed the shared name for this one hop; the page
  // tile carries it in CSS. The DOM update is flushed inside the callback so
  // the new snapshot is taken from the finished render.
  const hop = (update: () => void, origin: Element | null, onDone?: () => void) => {
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<void> };
    };
    const tile = origin?.querySelector<HTMLElement>('.model-tile') ?? null;
    if (!doc.startViewTransition || !tile || window.matchMedia(REDUCED_MOTION).matches) {
      update();
      onDone?.();
      return;
    }
    tile.style.setProperty('view-transition-name', 'product-tile');
    const transition = doc.startViewTransition(() => flushSync(update));
    void transition.finished.finally(() => {
      tile.style.removeProperty('view-transition-name');
      onDone?.();
    });
  };

  const openHosted = (m: HostedModel, origin: Element | null, where: TileHome['where']) => {
    setTileHome({ id: m.id, where });
    hop(() => {
      setFacets(EMPTY_FACETS);
      setFocusedId(undefined);
      setDetailOpen(undefined);
      setFocusedHostedId(m.id);
    }, origin);
    scrollToTop();
  };

  const closeHosted = () => {
    hop(
      () => setFocusedHostedId(undefined),
      screenRef.current?.querySelector('.product-page') ?? null,
      () => setTileHome(undefined),
    );
  };

  /** The shared-element name for a browse tile, only on the one the open page
   *  flew from (a duplicate name would make the platform skip the hop). */
  const tileName = (id: string, where: TileHome['where']) =>
    tileHome && tileHome.id === id && tileHome.where === where ? 'product-tile' : undefined;

  const hostedConnected = (m: HostedModel) => Boolean(connectedProviders[m.providerId]);

  const hostedControl = (m: HostedModel) =>
    hostedConnected(m) ? (
      <span className={`pill cloud${pop === m.providerId ? ' pill-pop' : ''}`}>on bench</span>
    ) : (
      <button
        className="store-get"
        onClick={(e) => {
          e.stopPropagation();
          logEvent('hosted_connect_tap', { id: m.id });
          openConnections(m.providerId);
        }}
      >
        Connect
      </button>
    );

  const hostedMeta = (m: HostedModel) =>
    `${m.providerName} · ${m.contextTokens ? `${contextLabel(m.contextTokens)} context` : 'cloud'}${
      hostedIsNew(m) ? ' · New' : ''
    }`;

  const renderHostedHero = (m: HostedModel, index: number) => (
    <div
      className="hero-card cloud"
      key={m.id}
      role="button"
      tabIndex={0}
      data-cap={m.categories[0] ?? 'reasoning'}
      style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
      onClick={(e) => openHosted(m, e.currentTarget, 'hero')}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openHosted(m, e.currentTarget, 'hero');
        }
      }}
      aria-label={`${m.name}. ${m.tagline}`}
    >
      <div className="hero-eyebrow">
        {hostedIsNew(m) ? 'New from ' : ''}
        {m.providerName}
      </div>
      <div className="hero-title">{m.name}</div>
      <div className="hero-tagline">{m.tagline}</div>
      <div className="hero-foot">
        <ModelTile name={m.name} cloud size={48} transitionName={tileName(m.id, 'hero')} />
        <div className="hero-foot-meta">
          <span className="pill cloud">On your key</span>
          <span className="hero-size">
            {m.contextTokens ? `${contextLabel(m.contextTokens)} context` : 'Cloud'}
          </span>
        </div>
        <span className="hero-get-wrap">{hostedControl(m)}</span>
      </div>
    </div>
  );

  const renderHostedRow = (m: HostedModel) => {
    const primaryCap = m.categories[0];
    return (
      <div
        className="store-row"
        key={m.id}
        role="button"
        tabIndex={0}
        onClick={(e) => openHosted(m, e.currentTarget, 'row')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openHosted(m, e.currentTarget, 'row');
          }
        }}
      >
        <ModelTile name={m.name} cloud size={52} transitionName={tileName(m.id, 'row')} />
        <div className="store-row-body">
          <div className="store-row-name">{m.name}</div>
          <div className="store-row-sub">{m.tagline}</div>
          <div className="store-row-meta">
            {primaryCap ? <CapIcon cap={primaryCap} size={12} /> : null}
            {hostedMeta(m)}
          </div>
        </div>
        <span className="store-row-get">{hostedControl(m)}</span>
      </div>
    );
  };

  const renderHostedShelf = () => {
    const columns: HostedModel[][] = [];
    for (let i = 0; i < hostedShelf.length; i += 3) {
      columns.push(hostedShelf.slice(i, i + 3));
    }
    return (
      <section className="shelf" key={HOSTED_SHELF.key}>
        <div className="shelf-head static">
          <span className="shelf-head-text">
            <span className="shelf-title">{HOSTED_SHELF.title}</span>
            <span className="shelf-sub">{HOSTED_SHELF.subtitle}</span>
          </span>
        </div>
        <div className="shelf-scroll">
          {columns.map((col, i) => (
            <div className="shelf-col" key={i}>
              {col.map(renderHostedRow)}
            </div>
          ))}
        </div>
      </section>
    );
  };

  // Pull the same model through Ollama's cloud on this desktop (no provider
  // key; an Ollama account instead). The engine's install-by-ref seam does the
  // pull and returns Ollama's own result, never a fabricated success.
  const pullHostedViaOllama = async (m: HostedModel) => {
    const b = bridge();
    const ref = m.ollamaCloudRef;
    if (!b || !ref) return;
    setDownloads((d) => ({
      ...d,
      [m.id]: { percent: 0, label: `Pulling ${ref} through Ollama`, indeterminate: true },
    }));
    // Ollama reports bytes as it pulls, so the page shows the real bar and
    // percent the catalog rows get, not an endless shimmer.
    const off = b.onInstallProgress((p) => {
      if (p.modelId !== ref) return;
      setDownloads((d) => ({
        ...d,
        [m.id]: {
          percent: p.percent ?? 0,
          label:
            p.total && p.completed !== undefined
              ? `${Math.round(p.percent ?? 0)}% · ${gb(p.completed)} of ${gb(p.total)}`
              : p.line,
          indeterminate: p.percent === undefined,
        },
      }));
    });
    try {
      const r = await b.installOllamaRef(ref);
      clearDownload(m.id);
      if (r.ok) {
        hapticSuccess();
        setInstalledRefs((s) => new Set(s).add(ref));
        await useApp.getState().refreshDesktopStatus();
      }
      showToast(r.detail);
    } catch (err) {
      setDownloads((d) => ({
        ...d,
        [m.id]: {
          percent: 0,
          label: err instanceof Error ? err.message : 'Could not pull that model.',
          failed: true,
        },
      }));
    } finally {
      off();
    }
  };

  const renderHostedPage = (m: HostedModel) => {
    const connected = hostedConnected(m);
    const dl = downloads[m.id];
    const ollamaHere = Boolean(m.ollamaCloudRef) && !isPhone();
    const viaOllamaDone = m.ollamaCloudRef ? installedRefs.has(m.ollamaCloudRef) : false;
    return (
      <div className="card market-card hosted-page product-page" key={m.id}>
        <div className="card-row">
          <ModelTile name={m.name} cloud size={56} />
          <div className="grow">
            <h3>{m.name}</h3>
            <div className="sub">{m.tagline}</div>
          </div>
        </div>

        <div className="badge-row">
          {hostedIsNew(m) ? <span className="pill cloud">New</span> : null}
          <span className="pill cloud">Cloud, on your key</span>
          <span className="pill muted">{m.openWeights ? 'Open weights' : 'Closed weights'}</span>
          {connected ? (
            <span className={`pill ok${pop === m.providerId ? ' pill-pop' : ''}`}>connected</span>
          ) : null}
        </div>

        <div className="market-meta">
          {m.providerName}
          {m.contextTokens ? ` · ${m.contextTokens.toLocaleString()} ctx` : ''}
          {m.released ? ` · released ${m.released}` : ''}
        </div>

        <div className="detail-panel">
          <p>
            Runs on {m.providerName}&apos;s servers, on the key you connect under Cloud Connections.{' '}
            {m.providerName} bills your account directly. OpenShore asks before it spends.
          </p>
          <p>Good at: {m.categories.map((c) => CAPABILITIES[c].plain).join(', ')}.</p>
          {m.openWeights ? (
            <p>
              The weights are published, so this model also runs on other hosts. It is far too large
              for a laptop or a phone, which is why it is not a download here.
            </p>
          ) : null}
          {ollamaHere && m.ollamaCloudRef ? (
            <>
              <p>
                Also on Ollama&apos;s cloud. With an Ollama account signed in on this desktop, pull
                it like any library model and it runs there, no {m.providerName} key needed.
              </p>
              <div className="pull-cmd">
                <code>ollama pull {m.ollamaCloudRef}</code>
              </div>
            </>
          ) : null}
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
                style={dl.indeterminate ? undefined : { transform: `scaleX(${dl.percent / 100})` }}
              />
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              {dl.label}
            </div>
          </>
        ) : null}

        <div className="hosted-actions">
          <button
            className="btn primary press-fb"
            onClick={() => {
              if (connected) {
                setView('stack');
              } else {
                logEvent('hosted_connect_tap', { id: m.id });
                openConnections(m.providerId);
              }
            }}
          >
            {connected ? 'Place it in your stack' : `Connect ${m.providerName}`}
          </button>
          {ollamaHere && bridge() ? (
            <button
              className="btn ghost press-fb"
              disabled={Boolean(dl && !dl.failed) || viaOllamaDone}
              onClick={() => void pullHostedViaOllama(m)}
            >
              {viaOllamaDone ? 'Installed through Ollama' : 'Pull through Ollama instead'}
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  // A model already present: on-device by the device-models record, a desktop
  // model by whether its source ref is in the paired machine's Ollama list.
  const isOwned = (model: CatalogModel): boolean =>
    model.onDevice ? Boolean(settings.deviceModels[model.id]) : installedRefs.has(model.source.ref);

  // The compact download control shared by hero cards and shelf rows: a Get
  // button, its in-flight percent, a Retry on failure, or the owned state.
  const getControl = (model: CatalogModel) => {
    const dl = downloads[model.id];
    const target: 'device' | 'desktop' = model.onDevice ? 'device' : 'desktop';
    const owned = isOwned(model);
    if (owned) {
      return <span className="pill local">{model.onDevice ? 'on device' : 'installed'}</span>;
    }
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
      // A div, not a button: it contains the Get button, and a button inside a
      // button is invalid and fires unpredictably. role/tabIndex/onKeyDown keep
      // it keyboard reachable (MP-F10).
      <div
        className={`hero-card${model.onDevice ? ' on-device' : ''}`}
        key={model.id}
        role="button"
        tabIndex={0}
        data-cap={model.categories[0] ?? 'reasoning'}
        style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
        onClick={(e) => openModel(model, e.currentTarget, 'hero')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openModel(model, e.currentTarget, 'hero');
          }
        }}
        aria-label={`${model.name}. ${model.tagline}`}
      >
        <div className="hero-eyebrow">{eyebrow}</div>
        <div className="hero-title">{model.name}</div>
        <div className="hero-tagline">{model.tagline}</div>
        <div className="hero-foot">
          <ModelTile
            name={model.name}
            onDevice={Boolean(model.onDevice)}
            size={48}
            transitionName={tileName(model.id, 'hero')}
          />
          <div className="hero-foot-meta">
            <span className={`pill ${pill.cls}`}>{pill.text}</span>
            <span className="hero-size">{model.sizeGB} GB</span>
          </div>
          <span className="hero-get-wrap">{getControl(model)}</span>
        </div>
      </div>
    );
  };

  const renderRow = (model: CatalogModel) => {
    const primaryCap = model.categories[0];
    const meta = model.onDevice
      ? `On device · ${model.sizeGB} GB`
      : `${model.sizeGB} GB · ${model.quantization}`;
    return (
      <div
        className="store-row"
        key={model.id}
        role="button"
        tabIndex={0}
        onClick={(e) => openModel(model, e.currentTarget, 'row')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openModel(model, e.currentTarget, 'row');
          }
        }}
      >
        <ModelTile
          name={model.name}
          onDevice={Boolean(model.onDevice)}
          size={52}
          transitionName={tileName(model.id, 'row')}
        />
        <div className="store-row-body">
          <div className="store-row-name">{model.name}</div>
          <div className="store-row-sub">{model.tagline}</div>
          <div className="store-row-meta">
            {primaryCap ? <CapIcon cap={primaryCap} size={12} /> : null}
            {meta}
          </div>
        </div>
        <span className="store-row-get">{getControl(model)}</span>
      </div>
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
        applyFacets({ ...EMPTY_FACETS, capability: shelf.capability });
      } else {
        applyFacets({ ...EMPTY_FACETS });
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

  // Preset stacks as a browsable "Starter stacks" shelf: each card names the
  // stack, its member models (tap one to open its product page), the combined
  // size, and whether it fits this machine. The catalog ships these and the CLI
  // can apply them; here they are at least discoverable and drillable.
  const presetMembers = (preset: (typeof catalog.presets)[number]): CatalogModel[] => {
    const ids = [preset.stack.orchestrator, ...Object.values(preset.stack.specialists)].filter(
      (v): v is string => Boolean(v),
    );
    const seen = new Set<string>();
    const out: CatalogModel[] = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const m = catalog!.models.find((mm) => mm.id === id);
      if (m) out.push(m);
    }
    return out;
  };

  const renderPresetShelf = () => (
    <section className="shelf preset-shelf" key="starter-stacks">
      <div className="shelf-head static">
        <span className="shelf-head-text">
          <span className="shelf-title">Starter stacks</span>
          <span className="shelf-sub">Curated combinations to set up in one look.</span>
        </span>
      </div>
      <div className="shelf-scroll">
        {catalog!.presets.map((preset) => {
          const members = presetMembers(preset);
          const totalGB = members.reduce((sum, m) => sum + m.sizeGB, 0);
          const pill = FIT_PILL[fitFor(totalGB, memoryGB)];
          return (
            <div className="preset-card" key={preset.id}>
              <div className="preset-name">{preset.name}</div>
              <div className="preset-tagline">{preset.tagline}</div>
              <div className="preset-members">
                {members.map((m) => (
                  <button
                    key={m.id}
                    className="preset-member press-fb"
                    onClick={(e) => openModel(m, e.currentTarget, 'preset')}
                    aria-label={`${m.name} in ${preset.name}`}
                  >
                    <ModelTile
                      name={m.name}
                      onDevice={Boolean(m.onDevice)}
                      size={34}
                      transitionName={tileName(m.id, 'preset')}
                    />
                    <span className="preset-member-name">{m.name}</span>
                  </button>
                ))}
              </div>
              <div className="preset-foot">
                <span className={`pill ${pill.cls}`}>{pill.text}</span>
                <span className="preset-size">
                  {totalGB.toFixed(1)} GB
                  {preset.minVramGB > 0 ? ` · needs ${preset.minVramGB} GB VRAM` : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );

  const categoryRail = (
    <div className="cat-rail" role="tablist" aria-label="Browse by capability">
      <button
        role="tab"
        aria-selected={browsing}
        className={`cat-chip${browsing ? ' active' : ''}`}
        onClick={() => applyFacets({ ...EMPTY_FACETS })}
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
          onClick={() => applyFacets({ ...EMPTY_FACETS, query: facets.query })}
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );

  // A product page is a page inside the room, so the top bar shows its name
  // and a chevron back to the Marketplace (the same hop as "All models"),
  // not the menu. Founder, 2026-09-03, from the Kimi page.
  const page = focusedHosted
    ? { title: focusedHosted.name, back: { to: 'Marketplace', onBack: closeHosted } }
    : focusedModel
      ? { title: focusedModel.name, back: { to: 'Marketplace', onBack: closeModel } }
      : undefined;

  return (
    <>
      <div className="screen" ref={screenRef}>
        <BackBar title={page?.title ?? 'Marketplace'} back={page?.back} />
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
                          : { transform: `scaleX(${harborDownload.percent / 100})` }
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
                          : { transform: `scaleX(${harborMiniDownload.percent / 100})` }
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
              {featured.length || hostedHero ? (
                <div className="hero-scroll">
                  {hostedHero ? renderHostedHero(hostedHero, 0) : null}
                  {featured.map((m, i) => renderHero(m, hostedHero ? i + 1 : i))}
                </div>
              ) : null}

              {isPhone() ? (
                <p className="hint store-note">
                  Browse here; desktop models install from the OpenShore desktop app, and this phone
                  uses them over Tailscale.
                </p>
              ) : null}

              {renderHostedShelf()}

              {renderBundleShelf()}

              {renderInstallByName()}

              {shelves.map(renderShelf)}

              {catalog.presets.length ? renderPresetShelf() : null}
            </div>
          ) : focusedHosted ? (
            <div className="focused-view">
              <button className="btn quiet market-back" onClick={closeHosted}>
                All models
              </button>
              <div className="market-list">{renderHostedPage(focusedHosted)}</div>
            </div>
          ) : focusedModel ? (
            <div className="focused-view">
              <button className="btn quiet market-back" onClick={closeModel}>
                All models
              </button>
              <div className="market-list">{renderCard(focusedModel, 0, true)}</div>
            </div>
          ) : (
            <>
              <div className="segmented seg-scroll" role="tablist" aria-label="Sort">
                {sorts.map((s) => (
                  <button
                    key={s.key}
                    role="tab"
                    aria-selected={sort === s.key}
                    className={`seg press-fb${sort === s.key ? ' active' : ''}`}
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
                    <span className="result-count" key={visible.length + hostedMatches.length}>
                      {visible.length + hostedMatches.length} model
                      {visible.length + hostedMatches.length === 1 ? '' : 's'}
                    </span>
                    {isPhone() ? (
                      <button className="filter-open press-fb" onClick={() => setShowFilters(true)}>
                        Filters{activeFacetCount(facets) ? ` (${activeFacetCount(facets)})` : ''}
                      </button>
                    ) : null}
                  </div>

                  {isPhone() ? (
                    <p className="hint" style={{ marginBottom: 10 }}>
                      Browse here; desktop models install from the OpenShore desktop app, and this
                      phone uses them over Tailscale.
                    </p>
                  ) : null}

                  {hostedMatches.length ? (
                    <section className="shelf hosted-group" key="hosted-matches">
                      <div className="shelf-head static">
                        <span className="shelf-head-text">
                          <span className="shelf-title">{HOSTED_SHELF.title}</span>
                          <span className="shelf-sub">{HOSTED_SHELF.subtitle}</span>
                        </span>
                      </div>
                      {hostedMatches.map(renderHostedRow)}
                    </section>
                  ) : null}

                  <div className="market-list" key={sort}>
                    {visible.length ? (
                      visible.map((m, i) => renderCard(m, i))
                    ) : hostedMatches.length ? null : (
                      <div className="market-empty">
                        <p className="hint">No models match these filters yet.</p>
                        {activeFacetCount(facets) > 0 || facets.query.trim() ? (
                          <button className="btn quiet" onClick={() => applyFacets(EMPTY_FACETS)}>
                            Clear filters
                          </button>
                        ) : null}
                      </div>
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

      <Sheet open={Boolean(showFilters)} onClose={() => setShowFilters(false)}>
        {showFilters ? (
          <>
            <h2>Filters</h2>
            <div className="sheet-sub">
              <span className="count-tick" key={visible.length + hostedMatches.length}>
                {visible.length + hostedMatches.length}
              </span>{' '}
              models match.
            </div>
            {filterRail}
            <div className="sheet-actions">
              <button className="btn primary" onClick={() => setShowFilters(false)}>
                Show{' '}
                <span className="count-tick" key={visible.length + hostedMatches.length}>
                  {visible.length + hostedMatches.length}
                </span>{' '}
                models
              </button>
            </div>
          </>
        ) : null}
      </Sheet>

      {libraryIntro ? <LibraryIntro onDone={endLibraryIntro} /> : null}
    </>
  );
}
