// Phone packs: one tap sets this iPhone up for a connection status. The phone
// has few choices (a handful of models actually run on it), so instead of a
// shelf of near-identical small models it gets three packages, one per status
// the header pill can show: Offline (no signal, everything on the phone),
// Offshore (online, home out of reach: pocket models plus a frontier model on
// your key), and Docked (at home: your computer does the heavy work, the phone
// is the remote). Each pack names its models as PREFERENCE LISTS of catalog
// ids, so it resolves against whatever catalog is loaded: when the newest pick
// has not cleared the catalog gate yet, the next one down installs, and a pack
// never dead-ends on a model the feed does not carry. Pure, unit-tested; the
// Marketplace screen does the installing and the placing.
import type { CatalogModel } from 'os-code/protocol';
import type { ProfileId } from './profiles.js';
import type { StackCategory } from './stack.js';

export type PackHelperCategory = Extract<StackCategory, 'coding' | 'fast' | 'vision'>;

export interface DevicePack {
  /** The status this pack sets up. One pack per status, keyed the same. */
  id: ProfileId;
  name: string;
  /** The status in one breath, as the header pill would explain it. */
  headline: string;
  /** One honest line: what this pack gives you. */
  tagline: string;
  /** Catalog ids for the Reasoning anchor, best first. The first one the
   *  loaded catalog carries is the one installed. Empty when the status
   *  needs no on-device anchor from this pack. */
  anchor: string[];
  /** Specialists placed on the phone, each a preference list by category. */
  helpers: Partial<Record<PackHelperCategory, string[]>>;
  /** After the downloads, the one step this status still needs. */
  nextStep?: { label: string; view: 'connections' | 'pair' };
}

// The on-device roster the packs draw from, best first. Qwen3 4B is the
// current phone-class pick (a 2025 4B beats the 2024 7B class on the phone at
// half the memory); Qwen 2.5 1.5B stays as the fallback so a catalog that has
// not yet rated the 4B still installs something coherent.
const POCKET_ANCHORS = ['qwen3-4b-phone', 'qwen2.5-1.5b-phone'];
const POCKET_CODERS = ['qwen2.5-coder-1.5b-phone'];

export const DEVICE_PACKS: DevicePack[] = [
  {
    id: 'offline',
    name: 'Offline',
    headline: 'No signal, no problem.',
    tagline: 'A reasoning model and a coder, both on this iPhone. Private by construction.',
    anchor: POCKET_ANCHORS,
    helpers: { coding: POCKET_CODERS },
  },
  {
    id: 'offshore',
    name: 'Offshore',
    headline: 'Online, away from home.',
    tagline:
      'The same pocket models answer anywhere, and a frontier model on your key takes the heavy lifting.',
    anchor: POCKET_ANCHORS,
    helpers: { coding: POCKET_CODERS },
    nextStep: { label: 'Connect a key', view: 'connections' },
  },
  {
    id: 'docked',
    name: 'Docked',
    headline: 'At home, full stack.',
    tagline:
      'Your computer runs the big models. This phone is the remote, and it still has its own.',
    anchor: [],
    helpers: {},
    nextStep: { label: 'Pair your computer', view: 'pair' },
  },
];

export function packFor(id: ProfileId): DevicePack {
  return DEVICE_PACKS.find((p) => p.id === id)!;
}

export interface ResolvedPack {
  pack: DevicePack;
  /** The anchor the loaded catalog can deliver, if the pack wants one. */
  anchor?: CatalogModel;
  /** Helpers the catalog can deliver, in pack order. */
  helpers: { category: PackHelperCategory; model: CatalogModel }[];
  /** Every model this pack will install, anchor first. */
  models: CatalogModel[];
  /** True when the pack asked for an anchor and the catalog has none of them. */
  anchorMissing: boolean;
}

function firstPresent(ids: string[], byId: Map<string, CatalogModel>): CatalogModel | undefined {
  for (const id of ids) {
    const m = byId.get(id);
    if (m?.onDevice) return m;
  }
  return undefined;
}

/** Resolve a pack against the loaded catalog. Only on-device builds count: a
 *  desktop twin with the same id can never be handed to the phone. */
export function resolvePack(pack: DevicePack, models: CatalogModel[]): ResolvedPack {
  const byId = new Map(models.map((m) => [m.id, m]));
  const anchor = firstPresent(pack.anchor, byId);
  const helpers: ResolvedPack['helpers'] = [];
  for (const [category, ids] of Object.entries(pack.helpers) as [PackHelperCategory, string[]][]) {
    const model = firstPresent(ids, byId);
    if (model && model.id !== anchor?.id) helpers.push({ category, model });
  }
  const out = [anchor, ...helpers.map((h) => h.model)].filter((m): m is CatalogModel => Boolean(m));
  return {
    pack,
    anchor,
    helpers,
    models: out,
    anchorMissing: pack.anchor.length > 0 && !anchor,
  };
}

/** The pack's total download in GB, and how much of it is already on the
 *  phone, so the card can say "2.5 GB, 1.1 GB already here". */
export function packDownload(
  resolved: ResolvedPack,
  owned: (id: string) => boolean,
): { totalGB: number; ownedGB: number } {
  let totalGB = 0;
  let ownedGB = 0;
  for (const m of resolved.models) {
    const gb = m.onDevice?.sizeGB ?? m.sizeGB;
    totalGB += gb;
    if (owned(m.id)) ownedGB += gb;
  }
  return { totalGB: Math.round(totalGB * 10) / 10, ownedGB: Math.round(ownedGB * 10) / 10 };
}

export type PackState = 'ready' | 'partial' | 'not-set-up';

/** Where this status stands: ready when the anchor is on the phone and is the
 *  status's Reasoning anchor (or the pack needs none and its next step is
 *  done), partial when some of it is here, otherwise not set up. */
export function packState(
  resolved: ResolvedPack,
  signals: {
    owned: (id: string) => boolean;
    /** The device model id anchoring this status's stack, if any. */
    reasoningDeviceId?: string;
    /** The pack's next step is already done (a key connected, a hub paired). */
    nextStepDone: boolean;
  },
): PackState {
  const { pack, anchor, models } = resolved;
  const wantsAnchor = pack.anchor.length > 0;
  if (!wantsAnchor) {
    return signals.nextStepDone ? 'ready' : 'not-set-up';
  }
  const anchored = Boolean(anchor && signals.reasoningDeviceId === anchor.id);
  const allHere = models.length > 0 && models.every((m) => signals.owned(m.id));
  const anyHere = models.some((m) => signals.owned(m.id));
  if (anchored && allHere && (!pack.nextStep || signals.nextStepDone)) return 'ready';
  if (anchored || anyHere) return 'partial';
  return 'not-set-up';
}
