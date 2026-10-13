// The Marketplace: the model library (founder, 2026-10-12), laid out like an
// app store by the Stack it fills. The front shows "Made for" collections and
// the categories; a category holds shelves, one per job; a shelf offers at most
// one pick per size of machine, the best fit for the device in hand marked
// (os-code/src/market/library.ts, the views in components/LibraryViews.tsx).
// A model the library does not carry is one door away: bring your own, or
// ask us to add it. Pocket models pull straight onto this device with a live
// progress bar; desktop models pull through Ollama on the desktop.
// Licenses shown before anything downloads; weights come from the source, never
// OpenShore. There are two rating axes, and the store keeps them apart on
// purpose: "OpenShore fit" is computed from benchmarks by the server-side
// builder and is NEVER crowd-sourced; the community score IS crowd-sourced and
// is always shown with its count (the tell), so the two never blur. Popularity
// is labelled as popularity, never quality.
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type {
  Catalog,
  CatalogModel,
  CapabilityCategory,
  CategoryId,
  LibraryPick,
} from 'os-code/protocol';
import {
  CAPABILITIES,
  RUNTIME_INFO,
  categoryPicks,
  libraryCategory,
  libraryCollection,
  picksForModel,
  runtimeOf,
  searchLibrary,
  shelfPicks,
  SIZE_CLASS_INFO,
} from 'os-code/protocol';
import { useApp } from '../state/store.js';
import { loadAppCatalog } from '../lib/catalog.js';
import { daemonInstallModel, daemonInstallProgress } from '../drivers/remoteDriver.js';
import { pollInstall } from '../drivers/installPoll.js';
import {
  HOSTED_SHELF,
  contextLabel,
  filterHosted,
  hostedIsNew,
  hostedModels,
  sortHostedNewest,
  type HostedModel,
} from '../lib/hosted.js';
import { Llama, type DeviceCapacity, type StorageTarget } from '../lib/llamaPlugin.js';
import { isIcloudAvailable } from '../lib/gitos/icloud.js';
import { gdriveStorageQuota, type CloudQuota } from '../lib/gitos/gdrive.js';
import { isGdriveConnected } from '../lib/gitos/gdriveAuth.js';
import {
  availableTargets,
  defaultTarget,
  deviceRunsComfortably,
  estimatedRamGB,
  formatBytes,
  gbToBytes,
  recommendMachine,
  runsWellOnDevice,
  storageFit,
  type StorageFit,
} from '../lib/modelStorage.js';
import { bridge } from '../lib/electronBridge.js';
import { isDesktop, isPhone } from '../lib/platform.js';
import { hapticSuccess } from '../lib/haptics.js';
import { logEvent } from '../lib/insights.js';
import { durationMs } from '../lib/motion.js';
import { recallScroll } from '../lib/scrollMemory.js';
import { BackBar } from '../components/BackBar.js';
import { LibraryIntro } from '../components/LibraryIntro.js';
import { Stars, CapabilityLane, NotRated, CommunityStars } from '../components/Stars.js';
import { ReviewsSection } from '../components/ReviewsSection.js';
import { fetchSummaries, reviewsAvailable } from '../lib/reviews.js';
import { communityScore, type CommunityScore } from '../lib/reviewsMath.js';
import { CapIcon, ModelTile } from '../components/MarketIcon.js';
import {
  fitFor,
  installLabel,
  licenseLabel,
  popularityLabel,
  runsOn,
  type FitLabel,
} from '../components/marketplace.js';
import {
  LibraryCategoryPage,
  LibraryCollectionPage,
  LibraryFront,
  LibrarySearchResults,
  ModelRequestSheet,
} from '../components/LibraryViews.js';
import { LIBRARY_LEAD, libraryDevice, systemMemoryGB } from '../lib/library.js';
import {
  DEVICE_PACKS,
  packDownload,
  packState,
  resolvePack,
  type ResolvedPack,
} from '../lib/packs.js';
import { PROFILES, type ProfileId } from '../lib/profiles.js';
import { stackForProfile } from '../lib/stack.js';
import { Sheet } from '../components/Sheet.js';
import { askForNotices, downloadNoticeCopy } from '../lib/notices.js';
import { Icon } from '../components/Icon.js';

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

const FIT_PILL: Record<FitLabel, { cls: string; text: string }> = {
  fits: { cls: 'fits', text: 'Runs here' },
  tight: { cls: 'tight', text: 'Tight fit' },
  'too-big': { cls: 'big', text: 'Too big' },
};

const CAP_ORDER = Object.keys(CAPABILITIES) as CapabilityCategory[];

/** Where a model's weights come from, as the detail panel says it. */
const SOURCE_NAME: Record<CatalogModel['source']['kind'], string> = {
  ollama: 'the Ollama library',
  huggingface: 'Hugging Face',
  github: "the publisher's GitHub releases",
  civitai: 'Civitai',
  publisher: "the publisher's own site",
};

// The hosted product page that was open when the store was left for another
// room (Cloud Connections, the Stack), so a Connect tap comes back to the page
// it left rather than the store front. Honored on a back navigation only; a
// fresh open from the panel starts at the front, the way a tab does.
let hostedPageMemory: string | undefined;

/** Where a tile was tapped (a hosted row, or a library pick), so the way back
 *  flies to the same tile. */
type TileHome = { id: string; where: 'row' | 'pick' };

/** The library page a product page was opened from, so it goes back there. */
type LibReturn = { kind: 'category' | 'collection'; id: string };

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

export function MarketplaceScreen() {
  const {
    settings,
    addDeviceModel,
    addCloudModel,
    showToast,
    libraryIntro,
    endLibraryIntro,
    harborMiniDownload,
    harborDownload,
    connectedProviders,
    setView,
    openConnections,
    authSession,
  } = useApp();
  const [catalog, setCatalog] = useState<Catalog | undefined>();
  // A library category's page or a collection's: each its own focus, like a
  // product page, and a product page opened from one remembers the way back
  // (`libReturn`).
  const [focusedCategory, setFocusedCategory] = useState<CategoryId | undefined>();
  const [focusedCollection, setFocusedCollection] = useState<string | undefined>();
  const [libReturn, setLibReturn] = useState<LibReturn | undefined>();
  // The search, and the sheet for a model the library does not carry.
  const [query, setQuery] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);
  // The phone pack being installed (one at a time), so its card shows progress
  // and the others wait.
  const [packBusy, setPackBusy] = useState<ProfileId | undefined>();
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
  // Install-by-name state (the logic lives further down, but the hooks must sit
  // above every early return).
  const [note, setNote] = useState<string | undefined>();
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  // One live poll per model for a phone-to-hub install (UI-3). A re-tap
  // replaces the earlier loop, and leaving the screen ends them all.
  const installPolls = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const polls = installPolls.current;
    return () => {
      for (const ac of polls.values()) ac.abort();
      polls.clear();
    };
  }, []);
  const [detailOpen, setDetailOpen] = useState<string | undefined>();
  const [provOpen, setProvOpen] = useState<Record<string, boolean>>({});
  const [memoryGB, setMemoryGB] = useState<number>(16);
  // This computer's whole memory, for the library's size classes; unread on a
  // phone and until the desktop bridge answers.
  const [systemGB, setSystemGB] = useState<number | undefined>();
  // A single model opened as a product page: an exact id, not a name search, so
  // a sibling whose name happens to fuzzy-match never rides along.
  const [focusedId, setFocusedId] = useState<string | undefined>();
  // Desktop models already pulled onto the paired machine (by source ref), so a
  // model that is installed shows as installed rather than an endless Get.
  const [installedRefs, setInstalledRefs] = useState<Set<string>>(() => new Set());
  // Library media models placed in this computer's Stack, by catalog id.
  const [mediaPlaced, setMediaPlaced] = useState<Set<string>>(() => new Set());
  // This device's live storage and memory, for the capacity monitor and the fit
  // math. Undefined until the native read returns (or on web, the mock).
  const [capacity, setCapacity] = useState<DeviceCapacity | undefined>();
  // Whether iCloud Drive is signed in on this device, so a large model can be
  // downloaded there instead of the phone. Probed once at mount.
  const [icloudReady, setIcloudReady] = useState(false);
  // A connected Google Drive's real quota, for the capacity meter. Undefined
  // when Drive is not connected or the quota read failed. Unlike iCloud, Drive
  // reports free of total, so this is an honest availability number.
  const [driveQuota, setDriveQuota] = useState<CloudQuota | undefined>();
  // A per-model override of where a download should land, when the user picks a
  // target on the product page. Absent means "use the sensible default."
  const [targetChoice, setTargetChoice] = useState<Record<string, StorageTarget>>({});
  // The storage readout is ambient (a chip); its full detail opens in a sheet,
  // so status is one tap away without a card sitting over the store front.
  const [storageSheetOpen, setStorageSheetOpen] = useState(false);
  // Community review counts+averages for the models currently in view, fetched
  // in one batched call so a browse row can carry a crowd star without one
  // request per row. Empty until reviews land; rows fall back to benchmark only.
  const [reviewSummaries, setReviewSummaries] = useState<
    Map<string, { count: number; average: number }>
  >(new Map());

  useEffect(() => {
    // Snap the machine tier to detected hardware on the desktop, so fit badges
    // start honest. The user can still pick a different tier in the rail.
    const b = bridge();
    if (!b) return;
    void b
      .status()
      .then((s) => {
        setMemoryGB(nearestTier(parseMemoryGB(s.hardwareSummary)));
        setSystemGB(systemMemoryGB(s.hardwareSummary));
        setInstalledRefs(new Set(s.ollama.models));
        setMediaPlaced(
          new Set(
            (s.stack.media ?? []).map((m) => m.catalogId).filter((id): id is string => Boolean(id)),
          ),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    void loadAppCatalog(settings.daemon).then(({ catalog, note }) => {
      setCatalog(catalog);
      setNote(note);
    });
  }, [settings.daemon]);

  // The scale path: when the builder baked a review snapshot into the catalog
  // (it stamped reviewsSnapshotAt), every model's community aggregate is already
  // here, so seed the browse stars from the catalog with ZERO network, and the
  // live per-view browse RPC below stands down entirely. Absence of the stamp
  // means an older or unconfigured build, and the live effect fills in instead,
  // exactly as before. The product page always fetches the live number when a
  // reader taps in, so a daily snapshot on browse costs no freshness that
  // matters.
  const snapshotComplete = Boolean(catalog?.reviewsSnapshotAt);
  useEffect(() => {
    if (!catalog?.reviewsSnapshotAt) return;
    const seeded = new Map<string, { count: number; average: number }>();
    for (const m of catalog.models) {
      if (m.community) seeded.set(m.id, { count: m.community.count, average: m.community.average });
    }
    setReviewSummaries(seeded);
  }, [catalog]);

  useEffect(() => {
    // Read this device's storage, memory, and whether iCloud is signed in, for
    // the capacity monitor and the download-target math. Both are best-effort:
    // a failure leaves the monitor hidden rather than showing a wrong number.
    let cancelled = false;
    void Llama.deviceCapacity()
      .then((c) => {
        if (!cancelled) setCapacity(c);
      })
      .catch(() => {});
    void isIcloudAvailable()
      .then((ok) => {
        if (!cancelled) setIcloudReady(ok);
      })
      .catch(() => {});
    // Google Drive reports a real quota, so include it when connected. The read
    // is best-effort: a failure leaves the Drive row hidden, never a guess.
    void isGdriveConnected()
      .then((connected) => (connected ? gdriveStorageQuota() : undefined))
      .then((quota) => {
        if (!cancelled) setDriveQuota(quota);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Whether Get pulls this model onto the device in hand. A library pick can
  // carry both a phone file and an Ollama tag (Qwen3.5 4B runs on a phone and
  // on a computer), so a phone takes its phone file and a computer pulls it
  // through Ollama; a phone-only build is the phone file everywhere.
  const toDevice = (model: CatalogModel): boolean =>
    Boolean(model.onDevice) && (isPhone() || model.source.kind !== 'ollama');

  const clearDownload = (id: string) =>
    setDownloads((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });

  // Where a download for this model should land: the user's explicit pick on
  // the product page, or the sensible default (this phone when it fits with
  // headroom, iCloud when it does not and iCloud is signed in). Never blocked.
  const targetFor = (model: CatalogModel): StorageTarget => {
    const chosen = targetChoice[model.id];
    if (chosen) return chosen;
    const neededBytes = gbToBytes(model.onDevice?.sizeGB ?? model.sizeGB);
    return defaultTarget({
      neededBytes,
      deviceFreeBytes: capacity?.freeBytes ?? Number.POSITIVE_INFINITY,
      icloudAvailable: icloudReady,
    });
  };

  const pullToDevice = async (model: CatalogModel, target: StorageTarget = targetFor(model)) => {
    if (!model.onDevice) return;
    const toCloud = target === 'icloud';
    setDownloads((d) => ({
      ...d,
      [model.id]: {
        percent: 0,
        label: toCloud ? 'Connecting to iCloud' : 'Connecting',
        indeterminate: true,
      },
    }));
    try {
      void askForNotices();
      await Llama.downloadModel({
        id: model.id,
        url: model.onDevice.url,
        target,
        notice: downloadNoticeCopy(model.name),
      });
      setDownloads((d) => ({
        ...d,
        [model.id]: { percent: 100, label: 'Verifying', indeterminate: true },
      }));
      if (toCloud) await addCloudModel(model.id, model.name);
      else await addDeviceModel(model.id, model.name);
      hapticSuccess();
      logEvent('model_downloaded', { id: model.id, target });
      showToast(
        toCloud
          ? `${model.name} is in your iCloud. Place it in your stack. Loads when you are online.`
          : `${model.name} is on your bench. Place it in your stack.`,
      );
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

  const pullToDesktop = async (model: CatalogModel, shelfId?: string) => {
    const b = bridge();
    if (!b) {
      // No desktop app here. If a daemon is paired, install onto that machine
      // over the tailnet (MP-F2); otherwise this phone can only browse.
      if (settings.daemon) {
        void installViaDaemon(model, shelfId);
        return;
      }
      showToast(
        'Computer models install from OpenShore on your computer. This phone can browse them.',
      );
      return;
    }
    setDownloads((d) => ({
      ...d,
      [model.id]: { percent: 0, label: 'Connecting', indeterminate: true },
    }));
    try {
      const result = await b.installModel(model.id, shelfId);
      clearDownload(model.id);
      if (result.ok) hapticSuccess();
      if (result.ok && runtimeOf(model) !== 'ollama') {
        setMediaPlaced((placed) => new Set(placed).add(model.id));
      }
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
  const installViaDaemon = async (model: CatalogModel, shelfId?: string) => {
    const daemon = settings.daemon;
    if (!daemon) return;
    installPolls.current.get(model.id)?.abort();
    const ac = new AbortController();
    installPolls.current.set(model.id, ac);
    setDownloads((d) => ({
      ...d,
      [model.id]: { percent: 0, label: 'Connecting', indeterminate: true },
    }));
    try {
      await daemonInstallModel(daemon, model.id, shelfId);
    } catch (err) {
      if (ac.signal.aborted) return;
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
    // Poll until the desktop reports the install done, the screen leaves, or
    // the hub stops answering.
    const outcome = await pollInstall(
      () => daemonInstallProgress(daemon, model.id),
      (p) =>
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
        })),
      (ms) => new Promise((r) => setTimeout(r, ms)),
      ac.signal,
    );
    if (installPolls.current.get(model.id) === ac) installPolls.current.delete(model.id);
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind === 'unreachable') {
      setDownloads((d) => ({
        ...d,
        [model.id]: {
          percent: d[model.id]?.percent ?? 0,
          label: 'Your computer stopped answering. Check the install there.',
          failed: true,
        },
      }));
      return;
    }
    if (outcome.kind === 'untracked') {
      clearDownload(model.id);
      return;
    }
    clearDownload(model.id);
    if (outcome.ok) {
      hapticSuccess();
      setInstalledRefs((s) => new Set(s).add(model.source.ref));
    }
    showToast(outcome.detail ?? (outcome.ok ? 'Installed on your computer.' : 'Install failed.'));
  };

  // Hosted models that answer the search. A cloud model is part of the
  // store, not of the library's shelves, so it shows beside the picks.
  const hostedMatches = useMemo(
    () => (query.trim() ? sortHostedNewest(filterHosted(hosted, query, undefined)) : []),
    [hosted, query],
  );
  const hostedShelf = useMemo(() => sortHostedNewest(hosted), [hosted]);

  // The store front (the App Store's front page) shows when nothing is being
  // searched and no page is open: the "Made for" row and the categories.
  const browsing =
    !focusedId && !focusedHostedId && !focusedCategory && !focusedCollection && !query.trim();
  const focusedModel = focusedId ? catalog?.models.find((m) => m.id === focusedId) : undefined;
  const focusedHosted = focusedHostedId ? hosted.find((m) => m.id === focusedHostedId) : undefined;
  const category = focusedCategory ? libraryCategory(focusedCategory) : undefined;
  const collection = focusedCollection ? libraryCollection(focusedCollection) : undefined;
  // The phone packs, resolved against whatever catalog is loaded.
  const packs = useMemo(
    () => (catalog ? DEVICE_PACKS.map((p) => resolvePack(p, catalog.models)) : []),
    [catalog],
  );
  // The device the library chooses for: this phone, or this computer by its
  // memory once the desktop bridge has read it (a laptop until then, never
  // the biggest on a guess).
  const device = useMemo(
    () =>
      libraryDevice({
        phone: isPhone(),
        ...(systemGB ? { memoryGB: systemGB } : {}),
        // The same fit the product page's pill reads, so the two agree.
        ...(systemGB
          ? { fitsHere: (sizeGB: number) => fitFor(sizeGB, memoryGB) !== 'too-big' }
          : {}),
      }),
    [systemGB, memoryGB],
  );
  const results = useMemo(
    () => (catalog && query.trim() ? searchLibrary(catalog, query) : []),
    [catalog, query],
  );

  // The catalog model ids on screen, for the community summaries: the open
  // page's picks, the search results, or the one focused model.
  const onScreenModelIds = useMemo(() => {
    if (!catalog) return [];
    if (focusedId) return [focusedId];
    if (category) return categoryPicks(catalog, category.id).map((p) => p.model.id);
    if (collection) {
      return collection.shelves.flatMap((id) => shelfPicks(catalog, id).map((p) => p.model.id));
    }
    return results.map((p) => p.model.id);
  }, [catalog, focusedId, category, collection, results]);

  // Fetch community summaries for whatever is on screen, in ONE batched call, so
  // community-guided browsing costs a single request per view rather than one
  // per row (the tech review's per-browse-egress guard). Degrades to nothing off a
  // configured build or when the read fails.
  useEffect(() => {
    // When the catalog carries a complete review snapshot, browse is driven from
    // the baked aggregates alone (seeded above) and this live per-view call is
    // exactly the egress the scale path removes, so stand it down.
    if (snapshotComplete) return;
    if (!reviewsAvailable() || onScreenModelIds.length === 0) return;
    const missing = onScreenModelIds.filter((id) => !reviewSummaries.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    void fetchSummaries(missing, authSession).then((map) => {
      if (cancelled || map.size === 0) return;
      setReviewSummaries((prev) => {
        const next = new Map(prev);
        for (const [k, v] of map) next.set(k, v);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onScreenModelIds, authSession]);

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

  // ---- where it runs: the three homes, on the product page --------------
  // Phone / laptop / workstation, filled when the model fits there. The one
  // row that answers "can I run this here" before anything else on the page.
  const renderRunsOn = (model: CatalogModel) => {
    const homes = runsOn(model);
    // The phone verdict is not just "does the catalog ship an on-device build"
    // but "will it run WELL on the memory THIS phone has": storage is not the
    // limit on a phone, memory is, so a big pocket model on a low memory phone
    // reads "better on your computer", not a green "runs here". Unknown device
    // memory (no capacity read) leaves the catalog answer as is.
    const deviceRamGB = capacity?.ramBytes ? Math.round(capacity.ramBytes / 1e9) : 0;
    const phoneOverMemory =
      Boolean(model.onDevice) && !runsWellOnDevice(estimatedRamGB(model), deviceRamGB);
    const phone: { state: 'yes' | 'over' | 'no'; note: string } = !model.onDevice
      ? { state: 'no', note: 'No on-device build.' }
      : phoneOverMemory
        ? {
            state: 'over',
            note: 'Better on your computer. This one wants more memory than an iPhone keeps free. It shines on a computer or home server.',
          }
        : {
            state: 'yes',
            note: 'Runs on this iPhone. Sized to stay smooth, even on a busy day.',
          };
    const items: { key: string; label: string; state: 'yes' | 'over' | 'no'; note: string }[] = [
      { key: 'phone', label: isPhone() ? 'This iPhone' : 'iPhone and iPad', ...phone },
      {
        key: 'laptop',
        label: 'A laptop',
        state: homes.laptop ? 'yes' : 'no',
        note: homes.laptop ? 'Fits a 16 GB computer.' : 'Needs more than a laptop has.',
      },
      {
        key: 'workstation',
        label: 'A home server',
        state: homes.workstation ? 'yes' : 'no',
        note: homes.workstation ? 'Fits a 48 GB workstation.' : 'Needs a very large computer.',
      },
    ];
    return (
      <div className="runs-on">
        <div className="runs-on-label">Where it runs</div>
        <div className="runs-on-row" role="list">
          {items.map((it) => (
            <span
              key={it.key}
              role="listitem"
              className={`runs-on-pill ${it.state}`}
              title={it.note}
              aria-label={`${it.label}: ${it.note}`}
            >
              <i className={`runs-on-dot ${it.state}`} aria-hidden="true" />
              {it.label}
            </span>
          ))}
        </div>
        {phone.state === 'over' ? <p className="runs-on-note">{phone.note}</p> : null}
      </div>
    );
  };

  // ---- phone packs: one tap per connection status ------------------------
  // Offline and Offshore download the phone's pocket models and place them in
  // that status's stack; Docked is a pairing step. Each pack resolves against
  // the loaded catalog, so it always installs something the feed can deliver.
  const ownedId = (id: string) => {
    const m = catalog?.models.find((x) => x.id === id);
    return m ? isOwned(m) : false;
  };

  const packNextStepDone = (p: ResolvedPack) =>
    p.pack.nextStep?.view === 'connections'
      ? Object.values(connectedProviders).some(Boolean)
      : p.pack.nextStep?.view === 'pair'
        ? Boolean(settings.daemon)
        : true;

  const packReasoningId = (profile: ProfileId) => {
    const r = stackForProfile(settings.stacks, profile).reasoning;
    return r?.kind === 'device' ? r.modelId : undefined;
  };

  const installPack = async (p: ResolvedPack) => {
    if (packBusy || !p.anchor) return;
    setPackBusy(p.pack.id);
    try {
      for (const m of p.models) {
        if (!isOwned(m)) await pullToDevice(m);
      }
      const store = useApp.getState();
      await store.setReasoning(
        { kind: 'device', modelId: p.anchor.id, modelName: p.anchor.name },
        p.pack.id,
      );
      for (const h of p.helpers) {
        await store.placeSpecialist(
          { kind: 'device', modelId: h.model.id, modelName: h.model.name },
          { category: h.category },
          p.pack.id,
        );
      }
      hapticSuccess();
      logEvent('pack_installed', { id: p.pack.id, anchor: p.anchor.id });
      const step = p.pack.nextStep;
      showToast(
        step
          ? `${p.pack.name} is set up on this iPhone. Next: ${step.label.toLowerCase()}.`
          : `${p.pack.name} is set up. This iPhone answers with no signal.`,
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not set up that pack.');
    } finally {
      setPackBusy(undefined);
    }
  };

  const goToStep = (view: 'connections' | 'pair') => {
    if (view === 'connections') setView('connections');
    else setView('pair');
  };

  const renderPackCard = (p: ResolvedPack) => {
    const { pack } = p;
    const info = PROFILES[pack.id];
    const { totalGB, ownedGB } = packDownload(p, ownedId);
    const stepDone = packNextStepDone(p);
    const state = packState(p, {
      owned: ownedId,
      reasoningDeviceId: packReasoningId(pack.id),
      nextStepDone: stepDone,
    });
    const busy = packBusy === pack.id;
    const progressLine = busy
      ? p.models.map((m) => downloads[m.id]?.label).find(Boolean)
      : undefined;
    const wantsDownload = pack.anchor.length > 0;
    const names = p.models.map((m) => m.name).join(' · ');
    const hubName = settings.daemon?.name ?? 'your computer';
    return (
      <div
        className={`pack-card pack-${pack.id}${state === 'ready' ? ' ready' : ''}`}
        key={pack.id}
      >
        <div className="pack-head">
          <span className="pack-status">
            <i className="profile-dot" style={{ background: info.dot }} aria-hidden="true" />
            {pack.name}
          </span>
          {state === 'ready' ? (
            <span className="pill ok">Ready</span>
          ) : state === 'partial' ? (
            <span className="pill muted">Partly set up</span>
          ) : null}
        </div>
        <div className="pack-headline">{pack.headline}</div>
        <div className="pack-tagline">{pack.tagline}</div>
        {wantsDownload ? (
          p.anchorMissing ? (
            <p className="hint pack-meta">
              The catalog has no phone model for this yet. Reconnect to refresh it.
            </p>
          ) : (
            <p className="hint pack-meta">
              {names} · {totalGB} GB
              {ownedGB > 0 ? ` (${ownedGB} GB already here)` : ''}
            </p>
          )
        ) : (
          <p className="hint pack-meta">
            {settings.daemon
              ? `Paired with ${hubName}. Its models are yours when you are home.`
              : 'No download. Pair once over Tailscale and the phone drives your computer.'}
          </p>
        )}
        <div className="pack-actions">
          {wantsDownload && !p.anchorMissing && state !== 'ready' ? (
            <button
              className="btn primary press-fb"
              disabled={Boolean(packBusy)}
              onClick={() => void installPack(p)}
            >
              {busy
                ? (progressLine ?? 'Setting up...')
                : state === 'partial'
                  ? `Finish ${pack.name}`
                  : `Set up ${pack.name}`}
            </button>
          ) : null}
          {pack.nextStep ? (
            <button
              className={`btn ${wantsDownload && state !== 'ready' ? 'ghost' : 'primary'} press-fb`}
              onClick={() => goToStep(pack.nextStep!.view)}
            >
              {stepDone
                ? pack.nextStep.view === 'pair'
                  ? 'Manage computers'
                  : 'Cloud Connections'
                : pack.nextStep.label}
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  const renderPackShelf = () => {
    if (!isPhone() || !packs.length) return null;
    return (
      <section className="shelf pack-shelf" key="packs">
        <div className="shelf-head static">
          <span className="shelf-head-text">
            <span className="shelf-title">Set up this iPhone</span>
            <span className="shelf-sub">
              One tap per connection status. The header pill tells you which one you are in.
            </span>
          </span>
        </div>
        <div className="shelf-scroll pack-scroll">{packs.map(renderPackCard)}</div>
      </section>
    );
  };

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

  // Every search change lands here. Typing leaves any open page; crossing
  // between the store front and the results crossfades, never per keystroke.
  const applyQuery = (next: string) => {
    const toFront = !next.trim();
    const crossing =
      Boolean(focusedId || focusedHostedId || focusedCategory || focusedCollection) ||
      toFront !== browsing;
    const update = () => {
      setFocusedId(undefined);
      setFocusedHostedId(undefined);
      setFocusedCategory(undefined);
      setFocusedCollection(undefined);
      setLibReturn(undefined);
      setQuery(next);
    };
    if (crossing) fade(update);
    else update();
  };

  // A category's page and a collection's are pages inside the room, like a
  // product page: the top bar carries the name and a chevron back to the
  // Marketplace. Each crossfades in (no tile to carry it) and is the way back
  // from any model opened inside it.
  const openCategory = (id: CategoryId) => {
    fade(() => {
      setQuery('');
      setFocusedId(undefined);
      setFocusedHostedId(undefined);
      setFocusedCollection(undefined);
      setLibReturn(undefined);
      setFocusedCategory(id);
    });
    scrollToTop();
  };

  const openCollection = (id: string) => {
    fade(() => {
      setQuery('');
      setFocusedId(undefined);
      setFocusedHostedId(undefined);
      setFocusedCategory(undefined);
      setLibReturn(undefined);
      setFocusedCollection(id);
    });
    scrollToTop();
  };

  const closeLibraryPage = () => {
    fade(() => {
      setFocusedCategory(undefined);
      setFocusedCollection(undefined);
      setLibReturn(undefined);
    });
  };

  // ---- where it sits in the library, on the product page -----------------
  // Every shelf and size the model is picked for, each with its reason; where
  // it runs when that is not Ollama; and the condition its license sets on
  // commercial use, said once and plainly.
  const renderLibraryFacts = (model: CatalogModel) => {
    if (!catalog) return null;
    const picks = picksForModel(catalog, model.id);
    const runtime = runtimeOf(model);
    if (!picks.length && runtime === 'ollama' && !model.license.conditions) return null;
    return (
      <div className="lib-facts">
        {picks.map((p) => (
          <p className="lib-fact" key={`${p.shelf.id}-${p.size}`}>
            <strong>
              {libraryCategory(p.shelf.category).name}: {p.shelf.name},{' '}
              {SIZE_CLASS_INFO[p.size].name}.
            </strong>{' '}
            {p.why}
          </p>
        ))}
        {runtime !== 'ollama' ? <p className="hint">{RUNTIME_INFO[runtime].line}</p> : null}
        {model.license.conditions ? (
          <p className="hint">License: {model.license.conditions}</p>
        ) : null}
      </div>
    );
  };

  // `focused`: the card is the model's own product page, so it carries the
  // tile the hero or row flew in on (and the shared name for the way back).
  const renderCard = (model: CatalogModel, index: number, focused = false) => {
    const dl = downloads[model.id];
    const target: 'device' | 'desktop' = toDevice(model) ? 'device' : 'desktop';
    const owned = isOwned(model);
    const fit = fitFor(model.sizeGB, memoryGB);
    const pill = FIT_PILL[fit];
    const isRecommended = model.recommended?.isRecommended;
    const rated = model.ratings;
    const lanes = CAP_ORDER.filter(
      (c) => model.categories.includes(c) && rated?.perCapability?.[c] !== undefined,
    );
    const detail = detailOpen === model.id;
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
            <span className="pill local">{ownedLabel(model)}</span>
          ) : dl && !dl.failed ? null : (
            <button
              className={`btn ghost market-get${labelFor(model, dl?.failed).kind === 'desktop-only' ? ' desktop-only' : ''}`}
              onClick={() =>
                target === 'device' ? void pullToDevice(model) : void pullToDesktop(model)
              }
            >
              {labelFor(model, dl?.failed).text}
            </button>
          )}
        </div>

        {focused ? renderRunsOn(model) : null}
        {focused ? renderLibraryFacts(model) : null}

        <div className="badge-row">
          {isRecommended ? (
            <span className="pick-badge">
              <Icon size={11} variant="fill">
                <path
                  d="M2 17c3-1 4-4 5-7s3-5 5-6c-1 3 0 5 1 7s3 3 6 3c-2 2-5 2-8 2s-6 0-9 1z"
                  fill="currentColor"
                />
              </Icon>
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

        {/* The community line: a single warm star and a count, kept apart from
            the benchmark stars above. On a browse card only when it has reports;
            the focused page carries the full room below. */}
        {!focused && reviewsAvailable()
          ? (() => {
              const cScore = reviewScoreFor(model);
              return cScore.count > 0 ? (
                <div className="market-community">
                  <CommunityStars score={cScore} />
                </div>
              ) : null;
            })()
          : null}

        <div className="market-meta">
          {runtimeOf(model) === 'ollama'
            ? `${model.sizeGB} GB · ${model.quantization} · ${model.contextTokens.toLocaleString()} ctx`
            : `${model.sizeGB} GB · runs in ${RUNTIME_INFO[runtimeOf(model)].name}`}
        </div>
        <div className="license-line">{licenseLabel(model)}</div>

        {focused ? renderDownloadOptions(model) : null}

        {focused && reviewsAvailable() ? (
          <ReviewsSection
            model={model}
            benchmarkStars={model.ratings?.osCodeFit}
            session={authSession}
            deviceRamGB={deviceRamGB}
            hardwarePrefill={hardwarePrefill}
            showToast={showToast}
            onNeedSignIn={() => {
              showToast('Sign in under Settings to write a run report.');
              setView('settings');
            }}
          />
        ) : null}

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
              <Icon size={15}>
                <path d="M9 6l6 6-6 6" />
              </Icon>
            </span>
            {detail ? 'Hide details' : 'Details and license'}
          </button>
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
              {SOURCE_NAME[model.source.kind]}, never from OpenShore.
            </p>
            {model.license.attribution ? (
              <p className="detail-license">{model.license.attribution}</p>
            ) : null}
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

  // Open one model as its own product page. From a library pick (anything
  // with a tile) the tile hops into the page; the way back flies it home.
  // Defined below with the hosted hop, which it shares. A model opened from a
  // category or a collection goes back there; one opened from the search
  // results goes back to them, since the search stays as it was.
  const openModel = (
    model: CatalogModel,
    origin: Element | null = null,
    where?: TileHome['where'],
  ) => {
    if (where) setTileHome({ id: model.id, where });
    hop(() => {
      setFocusedHostedId(undefined);
      if (focusedCategory) setLibReturn({ kind: 'category', id: focusedCategory });
      else if (focusedCollection) setLibReturn({ kind: 'collection', id: focusedCollection });
      setFocusedCategory(undefined);
      setFocusedCollection(undefined);
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
        if (libReturn) {
          if (libReturn.kind === 'category') setFocusedCategory(libReturn.id as CategoryId);
          else setFocusedCollection(libReturn.id);
          setLibReturn(undefined);
        }
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
      setFocusedId(undefined);
      setDetailOpen(undefined);
      setFocusedCategory(undefined);
      setFocusedCollection(undefined);
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
                Also on Ollama&apos;s cloud. With an Ollama account signed in on this computer, pull
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

  // A model already present: on-device by the device-models record, in iCloud
  // by the cloud-models record, a desktop model by whether its source ref is in
  // the paired machine's Ollama list.
  const inCloud = (model: CatalogModel): boolean => Boolean(settings.cloudModels?.[model.id]);
  const isOwned = (model: CatalogModel): boolean =>
    toDevice(model)
      ? Boolean(settings.deviceModels[model.id]) || inCloud(model)
      : runtimeOf(model) === 'ollama'
        ? installedRefs.has(model.source.ref)
        : mediaPlaced.has(model.id);

  // The plain label for an owned model's home, so the pill reads where it is.
  // A media model reads as in the Stack, since Get also placed it.
  const ownedLabel = (model: CatalogModel): string =>
    inCloud(model)
      ? 'in iCloud'
      : toDevice(model)
        ? 'on device'
        : runtimeOf(model) === 'ollama'
          ? 'installed'
          : 'in your Stack';

  // The footprint of the models already on this device, summed from the live
  // catalog, so the monitor can say what the downloads are spending, not only
  // what the OS reports free. iCloud-stored models are not on the phone, so
  // they are not counted here. A plain computation, not a hook: this runs below
  // the loading early-return, where catalog is always present.
  const deviceModelsBytes = (): number => {
    let sum = 0;
    for (const id of Object.keys(settings.deviceModels)) {
      const m = catalog?.models.find((mm) => mm.id === id);
      if (m) sum += gbToBytes(m.onDevice?.sizeGB ?? m.sizeGB);
    }
    return sum;
  };

  // The footprint of the models kept in iCloud, summed from the live catalog.
  // iOS gives apps no way to read iCloud's own free space, so this usage figure
  // is the honest thing the meter can show for iCloud.
  const cloudModelsBytes = (): number => {
    let sum = 0;
    for (const id of Object.keys(settings.cloudModels ?? {})) {
      const m = catalog?.models.find((mm) => mm.id === id);
      if (m) sum += gbToBytes(m.onDevice?.sizeGB ?? m.sizeGB);
    }
    return sum;
  };

  // The community score for a model, from the batched summaries and the model's
  // own benchmark fit as the prior a sparse average shrinks toward.
  const reviewScoreFor = (model: CatalogModel): CommunityScore => {
    const s = reviewSummaries.get(model.id);
    const summary = s
      ? { count: s.count, average: s.average, dist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }
      : undefined;
    return communityScore(summary, model.ratings?.osCodeFit);
  };

  // This device, for the review hardware prefill and the "machines like yours"
  // read. The reviewer confirms and edits it; nothing is auto-collected.
  const deviceRamGB = capacity?.ramBytes ? Math.round(capacity.ramBytes / 1e9) : undefined;
  const hardwarePrefill = isPhone()
    ? `iPhone${deviceRamGB ? `, ~${deviceRamGB} GB` : ''}`
    : deviceRamGB
      ? `${deviceRamGB} GB`
      : '';

  // The used fraction and low-space flag for a device, clamped for the bar.
  const usedFractionOf = (c: DeviceCapacity) =>
    Math.min(1, Math.max(0, (c.totalBytes - c.freeBytes) / c.totalBytes));
  const isLowSpace = (c: DeviceCapacity) => c.freeBytes < gbToBytes(8);

  // The ambient capacity chip: a glance at free space, right where the eye
  // starts, that opens the full readout in a sheet. Status stays out of the
  // way of the store front instead of a card competing with the hero rail.
  const renderCapacityChip = () => {
    if (!isPhone() || !capacity || capacity.totalBytes <= 0) return null;
    const used = usedFractionOf(capacity);
    const low = isLowSpace(capacity);
    return (
      <div className="cap-chip-row">
        <button
          className="cap-chip press-fb"
          onClick={() => setStorageSheetOpen(true)}
          aria-label={`Storage, ${formatBytes(capacity.freeBytes)} free. Open details.`}
        >
          <span className="cap-chip-meter" aria-hidden="true">
            <span
              className={`cap-chip-fill${low ? ' low' : ''}`}
              style={{ transform: `scaleX(${used})` }}
            />
          </span>
          <span className="cap-chip-text">{formatBytes(capacity.freeBytes)} free</span>
          {icloudReady || driveQuota ? (
            <span className="cap-chip-dot" title="Cloud storage connected" />
          ) : null}
        </button>
      </div>
    );
  };

  // The full storage readout, opened from the chip. Same honest numbers as
  // before, now in a sheet that animates in and out, never a persistent card.
  const renderStorageSheetBody = () => {
    if (!capacity || capacity.totalBytes <= 0) return null;
    const { freeBytes, totalBytes } = capacity;
    const used = usedFractionOf(capacity);
    const low = isLowSpace(capacity);
    const modelsBytes = deviceModelsBytes();
    return (
      <>
        <h2>Storage</h2>
        <div className="sheet-sub">
          {formatBytes(freeBytes)} free of {formatBytes(totalBytes)} on this iPhone
        </div>
        <div className="cap-track" role="img" aria-label={`${formatBytes(freeBytes)} free`}>
          <div
            className={`cap-fill${low ? ' low' : ''}`}
            style={{ transform: `scaleX(${used})` }}
          />
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          {modelsBytes > 0 ? `Your models use about ${formatBytes(modelsBytes)}. ` : ''}
          {icloudReady
            ? 'A model too big for the phone can download to your iCloud and load when you are online.'
            : 'Sign in to iCloud on this iPhone to keep large models in the cloud instead.'}
        </p>

        {(icloudReady || driveQuota) && (
          <div className="cap-clouds">
            <div className="cap-clouds-title">Connected cloud storage</div>

            {icloudReady ? (
              <div className="cap-cloud-row">
                <div className="cap-cloud-head">
                  <span className="cap-cloud-name">iCloud Drive</span>
                  <span className="cap-cloud-used">
                    {cloudModelsBytes() > 0
                      ? `${formatBytes(cloudModelsBytes())} in models`
                      : 'connected'}
                  </span>
                </div>
                <p className="cap-cloud-note">
                  iCloud does not report its free space to apps, so only what your models use here
                  is shown.
                </p>
              </div>
            ) : null}

            {driveQuota ? (
              <div className="cap-cloud-row">
                <div className="cap-cloud-head">
                  <span className="cap-cloud-name">Google Drive</span>
                  <span className="cap-cloud-used">
                    {driveQuota.unlimited
                      ? `${formatBytes(driveQuota.usedBytes)} used`
                      : `${formatBytes(driveQuota.freeBytes)} free of ${formatBytes(driveQuota.totalBytes)}`}
                  </span>
                </div>
                {!driveQuota.unlimited && driveQuota.totalBytes > 0 ? (
                  <div
                    className="cap-track"
                    role="img"
                    aria-label={`${formatBytes(driveQuota.freeBytes)} free on Google Drive`}
                  >
                    <div
                      className={`cap-fill${driveQuota.freeBytes < gbToBytes(1) ? ' low' : ''}`}
                      style={{
                        transform: `scaleX(${Math.min(1, Math.max(0, driveQuota.usedBytes / driveQuota.totalBytes))})`,
                      }}
                    />
                  </div>
                ) : (
                  <p className="cap-cloud-note">
                    This Drive account reports no storage limit, so only what is used is shown.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        )}
      </>
    );
  };

  // The download options for an on-device model: where the bytes land, whether
  // they fit, and the machine that runs it full speed. The load-bearing rule
  // lives here: nothing in this block disables the download. A model too big for
  // the phone gets iCloud as its home and an aspirational machine note, never a
  // locked button. Phone only; off a phone these numbers would be a mock.
  const renderDownloadOptions = (model: CatalogModel) => {
    if (!model.onDevice || isOwned(model) || !isPhone()) return null;
    const neededBytes = gbToBytes(model.onDevice.sizeGB);
    const target = targetFor(model);
    const toCloud = target === 'icloud';
    const targets = availableTargets(icloudReady);
    const fit: StorageFit | undefined = capacity
      ? storageFit(neededBytes, capacity.freeBytes)
      : undefined;
    const freeAfter = capacity ? capacity.freeBytes - neededBytes : undefined;
    const requiredRam = estimatedRamGB(model);
    const deviceRamGB = capacity?.ramBytes ? Math.round(capacity.ramBytes / 1e9) : 0;
    // Only speak to the machine when we actually read this device's memory and
    // it is short. With no reading, stay silent rather than guess.
    const comfortable = deviceRamGB === 0 || deviceRunsComfortably(requiredRam, deviceRamGB);
    const rec = comfortable ? undefined : recommendMachine(requiredRam);

    // The footprint block: the model's bytes as a fraction of the whole disk,
    // starting at the used edge. On iCloud it lifts off (see .cap-ghost). Its
    // width is capped at the free space so a too-big model reaches the edge
    // rather than overflowing the track; the copy carries the honest overflow.
    const used = capacity ? usedFractionOf(capacity) : 0;
    const low = capacity ? isLowSpace(capacity) : false;
    const footprint = capacity ? neededBytes / capacity.totalBytes : 0;
    const shownFootprint = Math.min(footprint, Math.max(0, 1 - used));
    const ghostTransform = `translateX(${used * 100}%) translateY(${toCloud ? '-8px' : '0'}) scaleX(${
      toCloud ? 0 : shownFootprint
    })`;

    // The fit line: calm on iCloud (it need not fit), amber on the phone when it
    // would not. Never red; a large model is a nudge to move it, not a failure.
    const storageLine =
      fit === undefined
        ? undefined
        : toCloud
          ? `Kept in your iCloud, so it does not have to fit on this iPhone.`
          : fit === 'plenty'
            ? `Fits with room to spare. About ${formatBytes(freeAfter ?? 0)} free after.`
            : fit === 'tight'
              ? `Fits, but it fills most of your free space. About ${formatBytes(Math.max(0, freeAfter ?? 0))} free after.`
              : `Larger than the ${formatBytes(capacity?.freeBytes ?? 0)} free on this iPhone.`;
    const storageTail =
      !toCloud && fit === 'wont-fit'
        ? icloudReady
          ? ' Switch to iCloud Drive to keep it without freeing up space.'
          : ' Sign in to iCloud to keep it in the cloud, or free up space first. You can still download it.'
        : '';

    return (
      <div className="dl-options">
        {capacity ? (
          <div className="dl-meter">
            <div className="cap-track" aria-hidden="true">
              <div
                className={`cap-fill${low ? ' low' : ''}`}
                style={{ transform: `scaleX(${used})` }}
              />
              <div
                className={`cap-ghost${toCloud ? ' lifted' : ''}`}
                style={{ transform: ghostTransform, opacity: toCloud ? 0 : 1 }}
              />
            </div>
            <div className="dl-meter-legend">
              {formatBytes(capacity.freeBytes)} free · this model {formatBytes(neededBytes)}
            </div>
          </div>
        ) : null}

        {targets.length > 1 ? (
          <div className="dl-target">
            <div className="dl-target-label">Where it goes</div>
            <div className="segmented" role="tablist" aria-label="Download location">
              {targets.map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={target === t}
                  className={`seg press-fb${target === t ? ' active' : ''}`}
                  onClick={() => setTargetChoice((c) => ({ ...c, [model.id]: t }))}
                >
                  {t === 'icloud' ? (
                    <span className="seg-cloud" aria-hidden="true">
                      <Icon size={13}>
                        <path d="M7 16a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.3A3.5 3.5 0 0 1 18 16" />
                        <path d="M12 12v6m0 0l-2.2-2.2M12 18l2.2-2.2" />
                      </Icon>
                    </span>
                  ) : null}
                  {t === 'device' ? 'This iPhone' : 'iCloud Drive'}
                </button>
              ))}
            </div>
            <p className="dl-consequence" key={target}>
              {toCloud
                ? 'Kept in your iCloud. Loads when you are online, and uses your iCloud storage.'
                : 'Lives on your phone. Works with no signal.'}
            </p>
          </div>
        ) : null}

        {storageLine ? (
          <p className={`dl-fit${!toCloud && fit === 'wont-fit' ? ' warn' : ''}`} key={target}>
            {storageLine}
            {storageTail}
          </p>
        ) : null}

        {rec ? (
          <div className="dl-machine">
            <p className="dl-machine-lead">
              This one wants about {requiredRam} GB of memory, more than this iPhone keeps free.
              Storage is not the limit here, memory is, so it runs better on a bigger computer.
            </p>
            <p className="dl-machine-path">
              Keep it in your iCloud and draw from it whenever you are online.
            </p>
            <p className="dl-machine-path">
              Or pair a computer with about {rec.ramGB} GB of memory over Tailscale and run it full
              speed.
            </p>
          </div>
        ) : null}
      </div>
    );
  };

  // The compact download control shared by hero cards and shelf rows: a Get
  // button, its in-flight percent, a Retry on failure, or the owned state.
  // What the install control says for this model, here: Get only when this
  // device can actually take it (an on-device build, or a desktop with its own
  // engine); the hub's name when a paired computer will take it; a quiet
  // "Desktop" when this phone can only browse it. Honest states, never a Get
  // that ends in a toast.
  const labelFor = (model: CatalogModel, failed?: boolean) =>
    installLabel({
      onDevice: toDevice(model),
      hasBridge: Boolean(bridge()),
      hubName: settings.daemon ? (settings.daemon.name ?? 'your computer') : undefined,
      failed,
    });

  /** A pick's Get carries its shelf, so a media model fills that job. */
  const getControl = (model: CatalogModel, shelfId?: string) => {
    const dl = downloads[model.id];
    const target: 'device' | 'desktop' = toDevice(model) ? 'device' : 'desktop';
    const owned = isOwned(model);
    if (owned) {
      return <span className="pill local">{ownedLabel(model)}</span>;
    }
    if (dl && !dl.failed) {
      return (
        <span className="get-progress" aria-live="polite">
          {dl.indeterminate ? 'Getting' : `${Math.round(dl.percent)}%`}
        </span>
      );
    }
    const label = labelFor(model, dl?.failed);
    return (
      <button
        className={`store-get${label.kind === 'desktop-only' ? ' desktop-only' : ''}`}
        aria-label={
          label.kind === 'desktop-only'
            ? `${model.name} installs from OpenShore on your computer`
            : label.kind === 'hub'
              ? `Install ${model.name} on ${settings.daemon?.name ?? 'your computer'}`
              : undefined
        }
        onClick={(e) => {
          e.stopPropagation();
          if (target === 'device') void pullToDevice(model);
          else void pullToDesktop(model, shelfId);
        }}
      >
        {label.text}
      </button>
    );
  };

  // A page inside the room shows its own name in the top bar and a chevron
  // back where it came from (founder, 2026-09-03, from the Kimi page): a
  // product page goes back to the category or collection it was opened from,
  // or to the Marketplace; a category or collection page to the Marketplace.
  const returnName = libReturn
    ? libReturn.kind === 'category'
      ? libraryCategory(libReturn.id as CategoryId).name
      : libraryCollection(libReturn.id)?.name
    : undefined;
  const page = focusedHosted
    ? { title: focusedHosted.name, back: { to: 'Marketplace', onBack: closeHosted } }
    : focusedModel
      ? {
          title: focusedModel.name,
          back: { to: returnName ?? 'Marketplace', onBack: closeModel },
        }
      : category
        ? { title: category.name, back: { to: 'Marketplace', onBack: closeLibraryPage } }
        : collection
          ? { title: collection.name, back: { to: 'Marketplace', onBack: closeLibraryPage } }
          : undefined;

  // What every library view needs to show a pick.
  const pickProps = {
    device,
    control: (model: CatalogModel, pick?: LibraryPick) => getControl(model, pick?.shelf.id),
    onOpen: (model: CatalogModel, origin: Element | null) => openModel(model, origin, 'pick'),
    tileName: (id: string) => tileName(id, 'pick'),
  };

  return (
    <>
      <div className="screen" ref={screenRef}>
        <BackBar title={page?.title ?? 'Marketplace'} back={page?.back} />
        <div className="screen-inner">
          {browsing || query.trim() ? (
            <>
              <h1>Models for every job</h1>
              <p className="lead">
                {LIBRARY_LEAD} {note ?? ''}
              </p>

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
                        Harbor Lite <span className="sub">(smaller guide)</span>
                      </h3>
                      <div className="sub">
                        The first model in your stack. Built to be replaced.
                      </div>
                    </div>
                    {settings.harborMiniReady ? (
                      <span className="pill local">on device</span>
                    ) : null}
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
                placeholder="Search models and jobs"
                value={query}
                onChange={(e) => applyQuery(e.target.value)}
                aria-label="Search models and jobs"
              />
            </>
          ) : null}

          {renderCapacityChip()}

          {browsing ? (
            <>
              <LibraryFront
                key="store"
                catalog={catalog}
                onCategory={(c) => openCategory(c.id)}
                onCollection={(c) => openCollection(c.id)}
                onRequest={() => setRequestOpen(true)}
                hosted={renderHostedShelf()}
              />
              {renderPackShelf()}
            </>
          ) : focusedHosted ? (
            <div className="focused-view">
              <div className="market-list">{renderHostedPage(focusedHosted)}</div>
            </div>
          ) : focusedModel ? (
            <div className="focused-view">
              <div className="market-list">{renderCard(focusedModel, 0, true)}</div>
            </div>
          ) : category ? (
            <div className="focused-view" key={`category-${category.id}`}>
              <LibraryCategoryPage
                catalog={catalog}
                category={category}
                onRequest={() => setRequestOpen(true)}
                {...pickProps}
              />
            </div>
          ) : collection ? (
            <div className="focused-view" key={`collection-${collection.id}`}>
              <LibraryCollectionPage
                catalog={catalog}
                collection={collection}
                onRequest={() => setRequestOpen(true)}
                {...pickProps}
              />
            </div>
          ) : (
            <div className="focused-view" key="results">
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
              <LibrarySearchResults
                results={results}
                onRequest={() => setRequestOpen(true)}
                {...pickProps}
              />
            </div>
          )}
        </div>
      </div>

      <Sheet open={storageSheetOpen} onClose={() => setStorageSheetOpen(false)}>
        {storageSheetOpen ? renderStorageSheetBody() : null}
      </Sheet>

      <ModelRequestSheet
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        onOpenStack={() => setView('stack')}
        desktop={isDesktop()}
      />

      {libraryIntro ? <LibraryIntro onDone={endLibraryIntro} /> : null}
    </>
  );
}
