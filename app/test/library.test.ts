// The model library in the app (founder, 2026-10-12): the store front's words
// and the reads that depend on the device in hand. The structure and the cap
// are pinned in os-code/test/library.test.ts; these hold the app to them: the
// categories carry the Stack's own names, the request door reaches support,
// and the store never offers the biggest pick on a guess.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LIBRARY_CATEGORIES,
  SUPPORT_EMAIL,
  libraryCategory,
  shelfPicks,
  type Catalog,
} from 'os-code/protocol';
import { STACK_CATEGORIES } from '../src/lib/stack.js';
import {
  LIBRARY_LEAD,
  REQUEST_TITLE,
  bestHereLabel,
  categoryPickCount,
  isBestHere,
  libraryDevice,
  modelRequestMailto,
  runtimeLine,
  slotLine,
  systemMemoryGB,
} from '../src/lib/library.js';
import bundled from 'os-code/catalog.sample.json';

const SRC = resolve(fileURLToPath(import.meta.url), '../../src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const catalog = bundled as unknown as Catalog;

describe('the categories are the Stack', () => {
  it("names every specialist category the way the Stack's own row names it", () => {
    // The Stack's categories use the engine's capability ids; the library's
    // use its slot ids. Map the shared ones and hold the names together.
    const stackId: Record<string, string> = {
      coding: 'coding',
      writing: 'writing',
      analysis: 'analysis',
      vision: 'vision',
      imageGen: 'image-gen',
      embedding: 'embedding',
      fast: 'fast',
    };
    for (const [libraryId, stack] of Object.entries(stackId)) {
      const plain = STACK_CATEGORIES.find((c) => c.id === stack)?.plain;
      expect(libraryCategory(libraryId as never).name, libraryId).toBe(plain);
    }
  });

  it('says where a pick goes: the Reasoning model, a slot, or one job of a media slot', () => {
    expect(slotLine(libraryCategory('overall'))).toMatch(/Reasoning model/);
    expect(slotLine(libraryCategory('coding'))).toBe('A pick here fills Coding in your Stack.');
    expect(slotLine(libraryCategory('imageEdit'))).toMatch(/one job in your Stack's Photo editing/);
  });

  it('says a media category runs on a computer or server, never on the device in hand', () => {
    expect(runtimeLine(libraryCategory('coding'))).toBeUndefined();
    expect(runtimeLine(libraryCategory('listen'))).toMatch(
      /^Runs in a speech server on your computer or server, never on/,
    );
    expect(runtimeLine(libraryCategory('audio'))).toMatch(
      /ComfyUI, audio-separator or DeepFilterNet/,
    );
  });
});

describe('the device in hand', () => {
  it("reads a computer's whole memory from the bridge summary", () => {
    expect(systemMemoryGB('Apple M2, 32 GB system RAM')).toBe(32);
    expect(systemMemoryGB('NVIDIA RTX 4090 (24 GB), 64 GB system RAM')).toBe(64);
    expect(systemMemoryGB(undefined)).toBeUndefined();
  });

  it('marks the biggest pick that fits, and a computer it has not read as a laptop', () => {
    const picks = shelfPicks(catalog, 'overall.everyday');
    const unread = libraryDevice({ phone: false });
    const best = picks.filter((p) => isBestHere(p, picks, unread));
    expect(best.map((p) => p.size)).toEqual(['laptop']);
    const big = libraryDevice({ phone: false, memoryGB: 128 });
    expect(picks.filter((p) => isBestHere(p, picks, big)).map((p) => p.size)).toEqual(['server']);
  });

  it('names the device in the badge', () => {
    expect(bestHereLabel({ phone: false })).toBe('Best for this computer');
    expect(bestHereLabel({ phone: true })).toMatch(/^Best for this (phone|iPad)$/);
  });
});

describe('the store front', () => {
  it('counts a category by its picks', () => {
    expect(categoryPickCount(catalog, 'overall')).toBeGreaterThan(0);
  });

  it('leads with the promise every pick keeps', () => {
    expect(LIBRARY_LEAD).toMatch(/one for each size of machine/);
    expect(LIBRARY_LEAD).toMatch(/Every license allows commercial use/);
  });

  it('offers the door for a model the library does not carry on every view', () => {
    const views = read('components/LibraryViews.tsx');
    expect(REQUEST_TITLE).toBe("Don't see your preferred model?");
    for (const view of [
      'LibraryFront',
      'LibraryCategoryPage',
      'LibraryCollectionPage',
      'LibrarySearchResults',
    ]) {
      const body = new RegExp(`export function ${view}[\\s\\S]*?\\n}\\n`).exec(views)?.[0] ?? '';
      expect(body, view).toMatch(/<LibraryRequestRow onRequest=\{onRequest\} \/>/);
    }
  });

  it('asks support by a mail the person sends, with the request ready to fill in', () => {
    const mailto = modelRequestMailto();
    expect(mailto.startsWith(`mailto:${SUPPORT_EMAIL}?subject=`)).toBe(true);
    expect(decodeURIComponent(mailto)).toMatch(/Model:\nWhere it lives \(a link\):/);
    const views = read('components/LibraryViews.tsx');
    expect(views).toMatch(/nothing is sent until you\s+send\s+it/);
  });

  it('shows bring-your-own the way each device has it: Install by name on the desktop, Connect a model elsewhere', () => {
    const views = read('components/LibraryViews.tsx');
    expect(views).toMatch(/<InstallByName localOnly \/>/);
    expect(views).toMatch(/tap Connect a\s+model\s+under\s+Bench/);
  });

  it('keeps every library category on the shared list', () => {
    expect(LIBRARY_CATEGORIES.length).toBe(14);
  });
});

describe('the badge and the fit pill agree', () => {
  it('never marks a chat model the fit check calls too big', () => {
    const picks = shelfPicks(catalog, 'overall.everyday');
    // A 16 GB computer whose fit check allows about 4 GB models (CPU-only).
    const device = libraryDevice({ phone: false, memoryGB: 16, fitsHere: (gb) => gb <= 4 });
    const best = picks.filter((p) => isBestHere(p, picks, device));
    expect(best.map((p) => p.model.id)).toEqual(['qwen3.5-4b']);
  });
});
