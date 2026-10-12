// The model library (founder, 2026-10-12): the Marketplace as a store of
// recommended models organized by the Stack. These pin the structure (every
// category is a Stack slot, every shelf names a job, every collection draws on
// shelves already on the list), the cap (at most one pick per size class per
// shelf, by the data's own shape), the device rules (the biggest pick that
// fits, never the biggest on a guess), search, and the publish gate's reasons.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LIBRARY_CATEGORIES,
  LIBRARY_COLLECTIONS,
  LIBRARY_SECTIONS,
  LIBRARY_SHELVES,
  MEDIA_SLOTS,
  SIZE_CLASSES,
  SIZE_CLASS_INFO,
  bestPickFor,
  categoryShelves,
  collectionPicks,
  filledCategories,
  filledCollections,
  filledShelves,
  isMediaSlot,
  libraryModelIds,
  libraryProblems,
  picksForModel,
  runtimeOf,
  searchLibrary,
  shelfPicks,
  sizesFor,
  withLibrary,
} from '../src/market/library.js';
import { CATALOG_URL, CATALOG_URL_BEFORE_LIBRARY, ConfigSchema } from '../src/config/schema.js';
import { catalogUrl } from '../src/market/catalog.js';
import { CatalogSchema, type Catalog, type CatalogModel } from '../src/market/schema.js';
import { ALL_SPECIALIST_SLOTS } from '../src/router/roles.js';

function model(over: Partial<CatalogModel> & { id: string }): CatalogModel {
  return {
    name: over.id,
    tagline: 'A test model.',
    categories: ['reasoning'],
    orchestratorCapable: false,
    source: { kind: 'ollama', ref: `${over.id}:latest`, pullCommand: `ollama pull ${over.id}` },
    sizeGB: 4,
    quantization: 'Q4_K_M',
    contextTokens: 32768,
    license: { id: 'Apache-2.0', name: 'Apache License 2.0', commercial: 'ok' },
    curation: { rank: 1, note: 'test' },
    blessed: false,
    ...over,
  };
}

function catalog(models: CatalogModel[], picks: NonNullable<Catalog['library']>['picks']): Catalog {
  return { version: 1, updated: '2026-10-12', models, presets: [], library: { picks } };
}

const phoneFile = {
  url: 'https://huggingface.co/x/y/resolve/main/m.gguf',
  sizeGB: 1.2,
  minRamGB: 6,
};

const fixture = catalog(
  [
    model({ id: 'tiny', sizeGB: 1.2, onDevice: phoneFile }),
    model({ id: 'mid', sizeGB: 5 }),
    model({ id: 'big', sizeGB: 18 }),
    model({ id: 'huge', sizeGB: 60, name: 'Huge Thinker' }),
    model({
      id: 'lama',
      name: 'LaMa',
      tagline: 'Fills in what was behind.',
      categories: ['image-edit'],
      runtime: 'comfyui',
      runner: { graph: 'lama' },
      sizeGB: 0.2,
    }),
  ],
  {
    'overall.everyday': {
      phone: { model: 'tiny', why: 'Small and steady.' },
      laptop: { model: 'mid', why: 'Best at 8B.' },
      workstation: { model: 'big', why: 'Best at 32B.' },
      server: { model: 'huge', why: 'Best overall.' },
    },
    'imageEdit.remove': { laptop: { model: 'lama', why: 'Fast on a CPU.' } },
  },
);

describe('the taxonomy', () => {
  it('puts every category in exactly one section, in section order', () => {
    const listed = LIBRARY_SECTIONS.flatMap((s) => s.categories);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(LIBRARY_CATEGORIES.map((c) => c.id).sort());
    for (const c of LIBRARY_CATEGORIES) {
      const section = LIBRARY_SECTIONS.find((s) => s.categories.includes(c.id));
      expect(section?.id).toBe(c.section);
    }
  });

  it('keeps Overall and Reasoning as the main models, both filling the seat that runs the show', () => {
    const main = LIBRARY_SECTIONS.find((s) => s.id === 'main')!;
    expect(main.categories).toEqual(['overall', 'reasoning']);
    for (const id of main.categories) {
      expect(LIBRARY_CATEGORIES.find((c) => c.id === id)?.slot).toBe('main');
    }
  });

  it('maps every other category to a Stack specialist slot', () => {
    const roles = new Set<string>(ALL_SPECIALIST_SLOTS);
    for (const c of LIBRARY_CATEGORIES.filter((c) => c.slot !== 'main')) {
      expect(roles.has(c.slot), `${c.id} -> ${c.slot}`).toBe(true);
    }
  });

  it('gives each category at least one shelf, and each shelf a unique id under its category', () => {
    const ids = LIBRARY_SHELVES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const shelf of LIBRARY_SHELVES) {
      expect(shelf.id.startsWith(`${shelf.category}.`)).toBe(true);
    }
    for (const c of LIBRARY_CATEGORIES) expect(categoryShelves(c.id).length).toBeGreaterThan(0);
  });

  it('keeps every shelf small enough to scan: at most five shelves a category', () => {
    for (const c of LIBRARY_CATEGORIES) expect(categoryShelves(c.id).length).toBeLessThanOrEqual(5);
  });

  it('gives a chat category one job and a media category the jobs its runtime does', () => {
    for (const c of LIBRARY_CATEGORIES) {
      const jobs = new Set(categoryShelves(c.id).map((s) => s.job));
      if (isMediaSlot(c.slot)) expect(jobs.has('chat')).toBe(false);
      else expect([...jobs]).toEqual([c.id === 'embedding' ? 'embed' : 'chat']);
    }
    expect(MEDIA_SLOTS).toEqual(['imageGen', 'imageEdit', 'video', 'listen', 'voice', 'audio']);
  });

  it('builds every collection from shelves on the list, so a collection never adds a model', () => {
    const shelves = new Set(LIBRARY_SHELVES.map((s) => s.id));
    for (const c of LIBRARY_COLLECTIONS) {
      expect(c.shelves.length).toBeGreaterThan(0);
      for (const id of c.shelves) expect(shelves.has(id), `${c.id}: ${id}`).toBe(true);
    }
  });

  it('says plainly that the health shelf is not a diagnosis', () => {
    const health = LIBRARY_SHELVES.find((s) => s.id === 'overall.health')!;
    expect(health.blurb).toMatch(/Not a diagnosis\./);
    expect(LIBRARY_COLLECTIONS.find((c) => c.id === 'health')!.blurb).toMatch(/Not a diagnosis\./);
  });

  it('says plainly what the one shelf that copies a voice does, and asks for permission', () => {
    // No consent step or sample flow exists in OpenShore, so the shelf claims
    // none (security review, 2026-10-12): it says where the sample lives, that
    // everything is watermarked, and whose voice to copy.
    const own = LIBRARY_SHELVES.find((s) => s.id === 'voice.own')!;
    expect(own.job).toBe('clone');
    expect(own.blurb).toMatch(/a sample you set up on your speech server/);
    expect(own.blurb).toMatch(/watermark in everything it says/);
    expect(own.blurb).toMatch(/Copy only your own voice, or one you have permission to use\./);
    expect(own.blurb).not.toMatch(/with your yes/);
  });
});

describe('the cap: one pick per size class per shelf', () => {
  it('keys picks by size class, so the schema cannot hold two models in one class', () => {
    const doubled = {
      version: 1,
      updated: '2026-10-12',
      models: [],
      presets: [],
      library: {
        picks: {
          'overall.everyday': {
            laptop: [
              { model: 'a', why: 'x' },
              { model: 'b', why: 'y' },
            ],
          },
        },
      },
    };
    expect(CatalogSchema.safeParse(doubled).success).toBe(false);
  });

  it('shows a shelf smallest first, never more picks than there are size classes', () => {
    const picks = shelfPicks(fixture, 'overall.everyday');
    expect(picks.map((p) => p.size)).toEqual([...SIZE_CLASSES]);
    expect(picks.length).toBeLessThanOrEqual(SIZE_CLASSES.length);
  });

  it('skips a pick whose model is not in the catalog rather than showing it broken', () => {
    const broken = catalog(fixture.models, {
      'overall.everyday': {
        laptop: { model: 'gone', why: 'x' },
        workstation: { model: 'big', why: 'y' },
      },
    });
    expect(shelfPicks(broken, 'overall.everyday').map((p) => p.model.id)).toEqual(['big']);
  });

  it('hides empty shelves and categories', () => {
    expect(filledShelves(fixture, 'overall').map((s) => s.id)).toEqual(['overall.everyday']);
    expect(filledCategories(fixture).map((c) => c.id)).toEqual(['overall', 'imageEdit']);
    expect(filledCollections(fixture).map((c) => c.id)).toContain('design');
  });

  it('counts the store universe as the picked models only', () => {
    expect([...libraryModelIds(fixture)].sort()).toEqual(['big', 'huge', 'lama', 'mid', 'tiny']);
    expect(picksForModel(fixture, 'mid').map((p) => `${p.shelf.id} ${p.size}`)).toEqual([
      'overall.everyday laptop',
    ]);
  });
});

describe('the device in hand', () => {
  it('runs only the phone class on a phone', () => {
    expect(sizesFor({ phone: true })).toEqual(['phone']);
  });

  it('treats a computer whose memory is unread as a laptop, never the biggest on a guess', () => {
    expect(sizesFor({ phone: false })).toEqual(['phone', 'laptop']);
  });

  it('opens the workstation class at 48 GB and the server class above it', () => {
    expect(sizesFor({ phone: false, memoryGB: 32 })).toEqual(['phone', 'laptop']);
    expect(sizesFor({ phone: false, memoryGB: 48 })).toEqual(['phone', 'laptop', 'workstation']);
    expect(sizesFor({ phone: false, memoryGB: 128 })).toEqual([
      'phone',
      'laptop',
      'workstation',
      'server',
    ]);
  });

  it('offers the biggest pick that fits', () => {
    const picks = shelfPicks(fixture, 'overall.everyday');
    expect(bestPickFor(picks, { phone: true })?.model.id).toBe('tiny');
    expect(bestPickFor(picks, { phone: false, memoryGB: 16 })?.model.id).toBe('mid');
    expect(bestPickFor(picks, { phone: false, memoryGB: 64 })?.model.id).toBe('huge');
    expect(bestPickFor(shelfPicks(fixture, 'imageEdit.remove'), { phone: true })).toBeUndefined();
  });

  it("defers to the host's own fit check, so a pick it says will not fit is never marked best", () => {
    const picks = shelfPicks(fixture, 'overall.everyday');
    const tight = { phone: false, memoryGB: 16, fits: (m: CatalogModel) => m.sizeGB <= 4 };
    expect(bestPickFor(picks, tight)?.model.id).toBe('tiny');
  });

  it("draws a collection's picks one per shelf, skipping a shelf with nothing that fits", () => {
    const design = collectionPicks(fixture, 'design', { phone: false, memoryGB: 16 });
    expect(design.map((p) => p.model.id)).toEqual(['lama']);
    expect(collectionPicks(fixture, 'design', { phone: true })).toEqual([]);
  });
});

describe('search', () => {
  it('finds a model by what its shelf does, not only its name', () => {
    expect(searchLibrary(fixture, 'remove objects').map((p) => p.model.id)).toEqual(['lama']);
    expect(searchLibrary(fixture, 'photo editing').map((p) => p.model.id)).toEqual(['lama']);
    expect(searchLibrary(fixture, 'huge').map((p) => p.model.id)).toEqual(['huge']);
  });

  it('lists each model once and finds nothing for an empty query', () => {
    expect(searchLibrary(fixture, 'everyday').map((p) => p.model.id)).toEqual([
      'tiny',
      'mid',
      'big',
      'huge',
    ]);
    expect(searchLibrary(fixture, '  ')).toEqual([]);
  });
});

describe('the publish gate', () => {
  it('passes a sound library', () => {
    expect(libraryProblems(fixture)).toEqual([]);
  });

  it('refuses a pick that does not allow commercial use', () => {
    const nc = catalog(
      [
        model({
          id: 'nc',
          license: { id: 'CC-BY-NC-4.0', name: 'NC', commercial: 'non-commercial' },
        }),
      ],
      { 'overall.everyday': { laptop: { model: 'nc', why: 'x' } } },
    );
    expect(libraryProblems(nc)).toEqual([
      'overall.everyday laptop: nc does not allow commercial use',
    ]);
  });

  it('refuses a model in a runtime its category does not use', () => {
    const wrong = catalog([model({ id: 'chat' })], {
      'imageEdit.remove': { laptop: { model: 'chat', why: 'x' } },
    });
    expect(libraryProblems(wrong)[0]).toMatch(/runs in ollama, which Photo editing does not use/);
  });

  it('refuses a download too big for its size class, and a phone pick with no phone file', () => {
    const wrong = catalog([model({ id: 'fat', sizeGB: 40 }), model({ id: 'nofile', sizeGB: 1 })], {
      'overall.everyday': {
        phone: { model: 'nofile', why: 'x' },
        workstation: { model: 'fat', why: 'y' },
      },
    });
    expect(libraryProblems(wrong)).toEqual([
      'overall.everyday phone: nofile has no phone file',
      `overall.everyday workstation: fat is 40 GB, over the Workstation class's ${SIZE_CLASS_INFO.workstation.maxDownloadGB} GB`,
    ]);
  });

  it('refuses an unknown shelf, a missing model, and a pick with no reason', () => {
    const wrong = catalog([model({ id: 'm' })], {
      'overall.nope': { laptop: { model: 'm', why: 'x' } },
      'overall.everyday': {
        laptop: { model: 'm', why: ' ' },
        workstation: { model: 'ghost', why: 'y' },
      },
    });
    expect(libraryProblems(wrong)).toEqual([
      'overall.nope: not a shelf in the library',
      'overall.everyday laptop: the pick says no reason',
      'overall.everyday workstation: ghost is not in the catalog',
    ]);
  });
});

describe('the bundled seed', () => {
  const seed = CatalogSchema.parse(
    JSON.parse(readFileSync(join(__dirname, '..', 'catalog.sample.json'), 'utf8')),
  );

  it('carries a sound library, so an offline app shows the same picks', () => {
    expect(seed.library).toBeDefined();
    expect(libraryProblems(seed)).toEqual([]);
  });

  it('fills every category, so no aisle in the store is empty', () => {
    expect(
      filledCategories(seed)
        .map((c) => c.id)
        .sort(),
    ).toEqual(LIBRARY_CATEGORIES.map((c) => c.id).sort());
  });

  it('runs every picked model in Ollama unless it says otherwise', () => {
    for (const id of libraryModelIds(seed)) {
      const m = seed.models.find((x) => x.id === id)!;
      if (!m.runtime) expect(runtimeOf(m)).toBe('ollama');
    }
  });
});

describe('a catalog from before the library', () => {
  const seed = CatalogSchema.parse(
    JSON.parse(readFileSync(join(__dirname, '..', 'catalog.sample.json'), 'utf8')),
  );

  it('borrows the bundled library and the entries its picks name', () => {
    const old: Catalog = {
      version: 1,
      updated: '2026-09-01',
      models: [seed.models[0]!],
      presets: [],
    };
    const merged = withLibrary(old, seed);
    expect(merged.library).toBe(seed.library);
    expect(libraryProblems(merged)).toEqual([]);
    // The old catalog's own entry is kept as it was.
    expect(merged.models[0]).toBe(old.models[0]);
  });

  it('leaves a catalog that has its own library alone', () => {
    expect(withLibrary(fixture, seed)).toBe(fixture);
  });

  it('reads the old default address as the library file', () => {
    const before = ConfigSchema.parse({ catalog: { url: CATALOG_URL_BEFORE_LIBRARY } });
    expect(catalogUrl(before)).toBe(CATALOG_URL);
    const own = ConfigSchema.parse({ catalog: { url: 'https://mirror.example/catalog.json' } });
    expect(catalogUrl(own)).toBe('https://mirror.example/catalog.json');
  });
});
