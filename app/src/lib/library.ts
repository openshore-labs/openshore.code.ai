// The app's half of the model library (founder, 2026-10-12): the store's own
// words and the few reads that depend on the device in hand. The structure
// itself (sections, categories, shelves, collections, the one-per-size cap)
// is os-code/src/market/library.ts, shared with the engine through
// os-code/protocol, so the store and the Stack agree by construction.
import {
  RUNTIME_INFO,
  SIZE_CLASS_INFO,
  SUPPORT_EMAIL,
  bestPickFor,
  filledShelves,
  isMediaSlot,
  runtimeOf,
  shelfPicks,
  type Catalog,
  type CatalogModel,
  type CategoryId,
  type LibraryCategory,
  type LibraryDevice,
  type LibraryPick,
} from 'os-code/protocol';
import { thisDeviceNoun } from './deviceNoun.js';

/** The store's lead, under its title. Says what the library is and the one
 *  promise every pick keeps; the conditions a license puts on commercial use
 *  are shown on the pick itself. */
export const LIBRARY_LEAD =
  'Our pick for each job, one for each size of machine. Every license allows commercial use; where it sets conditions, the pick says so.';

/** The door for a model the library does not carry. */
export const REQUEST_TITLE = "Don't see your preferred model?";

/** A computer's total memory, from the desktop bridge's hardware summary
 *  ("32 GB system RAM, ..."), or undefined when it does not say. */
export function systemMemoryGB(summary?: string): number | undefined {
  const m = summary ? /(\d+(?:\.\d+)?)\s*GB system RAM/.exec(summary) : null;
  return m ? Number(m[1]) : undefined;
}

/** The device the store is choosing for. On a computer, a chat model must
 *  also pass the store's own fit check (`fitsHere`, the engine's memory
 *  budget), so the badge never marks a model the fit pill calls too big. */
export function libraryDevice(opts: {
  phone: boolean;
  memoryGB?: number;
  fitsHere?: (sizeGB: number) => boolean;
}): LibraryDevice {
  if (opts.phone) return { phone: true };
  const fitsHere = opts.fitsHere;
  return {
    phone: false,
    ...(opts.memoryGB ? { memoryGB: opts.memoryGB } : {}),
    ...(fitsHere
      ? { fits: (m: CatalogModel) => runtimeOf(m) !== 'ollama' || fitsHere(m.sizeGB) }
      : {}),
  };
}

/** How many picks a category holds, for its tile. */
export function categoryPickCount(catalog: Catalog, id: CategoryId): number {
  return filledShelves(catalog, id).reduce((n, s) => n + shelfPicks(catalog, s.id).length, 0);
}

/** Where a category's picks go in the Stack, in one line. A chat category
 *  fills one seat; a media category holds one model per job. */
export function slotLine(category: LibraryCategory): string {
  if (category.slot === 'main')
    return 'A pick here can be the Reasoning model, the one that runs the show.';
  if (isMediaSlot(category.slot)) {
    return `Each shelf is one job in your Stack's ${category.name}, with its own model.`;
  }
  return `A pick here fills ${category.name} in your Stack.`;
}

/** Where a category's models run, for a media category; chat models run in
 *  Ollama on a computer and need no line. */
export function runtimeLine(category: LibraryCategory): string | undefined {
  if (!isMediaSlot(category.slot)) return undefined;
  const names = category.runtimes.map((r) => RUNTIME_INFO[r].name);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return `Runs in ${list} on your computer or server, never on ${thisDeviceNoun()} itself.`;
}

/** The pick's size label ("Laptop"). */
export function sizeName(pick: LibraryPick): string {
  return SIZE_CLASS_INFO[pick.size].name;
}

/** Whether this pick is the one a shelf offers this device. */
export function isBestHere(
  pick: LibraryPick,
  picks: LibraryPick[],
  device: LibraryDevice,
): boolean {
  const best = bestPickFor(picks, device);
  return best?.model.id === pick.model.id && best.size === pick.size;
}

/** The badge on the best fit, naming the device in hand. */
export function bestHereLabel(device: LibraryDevice): string {
  return device.phone ? `Best for ${thisDeviceNoun()}` : 'Best for this computer';
}

/** The pick's runtime line, for a model that does not run in Ollama. */
export function pickRuntimeLine(pick: LibraryPick): string | undefined {
  const runtime = runtimeOf(pick.model);
  return runtime === 'ollama' ? undefined : RUNTIME_INFO[runtime].line;
}

/** A mailto that opens the person's own mail app with a request ready to
 *  fill in. Nothing is sent by OpenShore: the person sends it, or does not. */
export function modelRequestMailto(): string {
  const subject = 'Model request for the OpenShore Marketplace';
  const body = [
    'Model:',
    'Where it lives (a link):',
    'What I would use it for:',
    'The machine I would run it on:',
    '',
  ].join('\n');
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
