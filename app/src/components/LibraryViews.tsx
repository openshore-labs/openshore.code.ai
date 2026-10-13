// The model library's store front (founder, 2026-10-12): the Local Library laid
// out like an app store, by the Stack it fills. The front shows "Made for"
// collections and the categories in their sections; a category page shows its
// shelves; a shelf shows at most one pick per size of machine, the one that
// fits the device in hand marked. Every view ends on the door for a model the
// library does not carry.
//
// These views own no state and no installs: the Local Library screen hands each
// one the Get control and the way into a model's page, so a pick installs and
// opens exactly as every other model in the store does.
import type { CSSProperties, ReactNode } from 'react';
import {
  LIBRARY_SECTIONS,
  filledCategories,
  filledCollections,
  filledShelves,
  libraryCategory,
  libraryShelf,
  shelfPicks,
  type Catalog,
  type CatalogModel,
  type LibraryCategory,
  type LibraryCollection,
  type LibraryDevice,
  type LibraryPick,
  type LibraryShelf,
} from 'os-code/protocol';
import { CategoryIcon, ModelTile } from './MarketIcon.js';
import { ChevronGlyph } from './SheetGlyphs.js';
import { Sheet } from './Sheet.js';
import { InstallByName } from './InstallByName.js';
import {
  REQUEST_TITLE,
  bestHereLabel,
  categoryPickCount,
  isBestHere,
  modelRequestMailto,
  pickRuntimeLine,
  runtimeLine,
  sizeName,
  slotLine,
} from '../lib/library.js';
import { thisDeviceNoun } from '../lib/deviceNoun.js';
import { openExternal } from '../lib/platform.js';
import { SUPPORT_EMAIL } from 'os-code/protocol';

/** What every view needs to show a pick: the device it is choosing for, the
 *  screen's own Get control, and the way into a model's page. */
export interface PickProps {
  device: LibraryDevice;
  /** The Get control; a pick's shelf rides along, so a media model fills
   *  that shelf's job. */
  control: (model: CatalogModel, pick?: LibraryPick) => ReactNode;
  onOpen: (model: CatalogModel, origin: Element | null) => void;
  /** The shared-element name for a tile, on the one a page flew from. */
  tileName?: (modelId: string) => string | undefined;
}

const stagger = (i: number): CSSProperties => ({ '--i': Math.min(i, 8) }) as CSSProperties;

// ---------------------------------------------------------------------------
// One pick
// ---------------------------------------------------------------------------

export function LibraryPickRow({
  pick,
  best,
  label,
  index,
  device,
  control,
  onOpen,
  tileName,
}: PickProps & {
  pick: LibraryPick;
  /** True on the pick that fits the device in hand best. */
  best: boolean;
  /** A shelf name over the pick, where the row stands outside its shelf. */
  label?: string;
  index: number;
}) {
  const { model } = pick;
  const runtime = pickRuntimeLine(pick);
  const open = (origin: Element | null) => onOpen(model, origin);
  return (
    <div
      className="store-row lib-pick stagger-in"
      style={stagger(index)}
      role="button"
      tabIndex={0}
      onClick={(e) => open(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open(e.currentTarget);
        }
      }}
      aria-label={`${model.name}, ${sizeName(pick)}. ${pick.why}`}
    >
      <ModelTile
        name={model.name}
        onDevice={pick.size === 'phone' && Boolean(model.onDevice)}
        size={52}
        transitionName={tileName?.(model.id)}
      />
      <div className="store-row-body">
        <div className="lib-pick-top">
          <span className="lib-size">{label ?? sizeName(pick)}</span>
          {best ? <span className="pill ink lib-best">{bestHereLabel(device)}</span> : null}
        </div>
        <div className="store-row-name">{model.name}</div>
        <div className="lib-why">{pick.why}</div>
        <div className="store-row-meta">
          {label ? `${sizeName(pick)} · ` : ''}
          {model.sizeGB} GB · {model.license.name}
          {model.license.conditions ? ' · with conditions' : ''}
        </div>
        {runtime ? <div className="lib-runtime">{runtime}</div> : null}
      </div>
      <span className="store-row-get">{control(model, pick)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A shelf
// ---------------------------------------------------------------------------

export function LibraryShelfView({
  catalog,
  shelf,
  heading,
  ...pickProps
}: PickProps & { catalog: Catalog; shelf: LibraryShelf; heading?: string }) {
  const picks = shelfPicks(catalog, shelf.id);
  if (!picks.length) return null;
  return (
    <section className="shelf lib-shelf">
      <div className="shelf-head static">
        <span className="shelf-head-text">
          <span className="shelf-title">{heading ?? shelf.name}</span>
          <span className="lib-shelf-sub">{shelf.blurb}</span>
        </span>
      </div>
      <div className="lib-picks">
        {picks.map((pick, i) => (
          <LibraryPickRow
            key={`${pick.size}-${pick.model.id}`}
            pick={pick}
            best={isBestHere(pick, picks, pickProps.device)}
            index={i}
            {...pickProps}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The door for a model the library does not carry
// ---------------------------------------------------------------------------

export function LibraryRequestRow({ onRequest }: { onRequest: () => void }) {
  return (
    <button className="lib-request press-fb press-fb--row" onClick={onRequest}>
      <span className="lib-request-text">
        <span className="lib-request-title">{REQUEST_TITLE}</span>
        <span className="lib-request-sub">Bring your own model, or ask us to add one.</span>
      </span>
      <ChevronGlyph />
    </button>
  );
}

export function ModelRequestSheet({
  open,
  onClose,
  onOpenStack,
  desktop,
}: {
  open: boolean;
  onClose: () => void;
  /** Go to the Stack, where Connect a model lives (not on the desktop app). */
  onOpenStack: () => void;
  /** The desktop app: Install by name here, and no Connect a model. */
  desktop: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose}>
      {open ? (
        <>
          <h2>{REQUEST_TITLE}</h2>
          <div className="sheet-sub">
            The library keeps to one pick per size for each job. Anything else still works in
            OpenShore.
          </div>

          <div className="lib-request-part">
            <h3>Bring your own</h3>
            {desktop ? (
              <>
                <p className="hint">
                  Install any Ollama model by its name, or a GGUF file from Hugging Face as
                  hf.co/owner/repo. It joins your Bench, ready to place.
                </p>
                <InstallByName />
              </>
            ) : (
              <>
                <p className="hint">
                  A model on a server you run connects by its address. In Stack, tap Connect a model
                  under Bench and give its address in the OpenAI or the Anthropic format. OpenShore
                  reads that server&apos;s own list, and you tick the models you want.
                </p>
                <div className="sheet-actions">
                  <button
                    className="btn ghost"
                    onClick={() => {
                      onClose();
                      onOpenStack();
                    }}
                  >
                    Open Stack
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="lib-request-part">
            <h3>Ask us to add it</h3>
            <p className="hint">
              Email {SUPPORT_EMAIL} with the model&apos;s name and a link to it. We add a model when
              its license allows commercial use and it is the best we know for its size and job.
              Your mail app opens with the request ready to fill in; nothing is sent until you send
              it.
            </p>
            <div className="sheet-actions">
              <button className="btn primary" onClick={() => openExternal(modelRequestMailto())}>
                Email {SUPPORT_EMAIL}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// The front
// ---------------------------------------------------------------------------

export function LibraryFront({
  catalog,
  onCategory,
  onCollection,
  onRequest,
  hosted,
}: {
  catalog: Catalog;
  onCategory: (category: LibraryCategory) => void;
  onCollection: (collection: LibraryCollection) => void;
  onRequest: () => void;
  /** The frontier shelf (cloud models on your key), shown after the sections. */
  hosted?: ReactNode;
}) {
  const categories = new Set(filledCategories(catalog).map((c) => c.id));
  const collections = filledCollections(catalog);
  return (
    <div className="store-front lib-front">
      {collections.length ? (
        <section className="shelf">
          <div className="shelf-head static">
            <span className="shelf-head-text">
              <span className="shelf-title">Made for</span>
              <span className="lib-shelf-sub">A set of picks for the work you do.</span>
            </span>
          </div>
          <div className="lib-made-scroll">
            {collections.map((c, i) => (
              <button
                key={c.id}
                className="lib-made press-fb press-fb--tile stagger-in"
                style={stagger(i)}
                onClick={() => onCollection(c)}
              >
                <span className="lib-made-name">{c.name}</span>
                <span className="lib-made-blurb">{c.blurb}</span>
                <span className="lib-made-icons" aria-hidden="true">
                  {uniqueCategories(c).map((cat) => (
                    <CategoryIcon key={cat.id} id={cat.id} cap={cat.capability} size={16} />
                  ))}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {LIBRARY_SECTIONS.map((section) => {
        const cats = section.categories.filter((id) => categories.has(id)).map(libraryCategory);
        if (!cats.length) return null;
        return (
          <section className="lib-section" key={section.id}>
            <h2 className="lib-section-title">{section.name}</h2>
            <div className="lib-grid">
              {cats.map((cat, i) => {
                const count = categoryPickCount(catalog, cat.id);
                return (
                  <button
                    key={cat.id}
                    className="lib-tile press-fb press-fb--tile stagger-in"
                    style={stagger(i)}
                    onClick={() => onCategory(cat)}
                  >
                    <span className="lib-tile-icon">
                      <CategoryIcon id={cat.id} cap={cat.capability} />
                    </span>
                    <span className="lib-tile-name">{cat.name}</span>
                    <span className="lib-tile-blurb">{cat.blurb}</span>
                    <span className="lib-tile-count">
                      {count} {count === 1 ? 'pick' : 'picks'}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {hosted}

      <LibraryRequestRow onRequest={onRequest} />
    </div>
  );
}

/** The categories a collection draws on, in its order, each once. */
function uniqueCategories(collection: LibraryCollection): LibraryCategory[] {
  const seen = new Set<string>();
  const out: LibraryCategory[] = [];
  for (const id of collection.shelves) {
    const shelf = libraryShelf(id);
    if (!shelf || seen.has(shelf.category)) continue;
    seen.add(shelf.category);
    out.push(libraryCategory(shelf.category));
  }
  return out;
}

// ---------------------------------------------------------------------------
// A category's page, and a collection's
// ---------------------------------------------------------------------------

export function LibraryCategoryPage({
  catalog,
  category,
  onRequest,
  ...pickProps
}: PickProps & { catalog: Catalog; category: LibraryCategory; onRequest: () => void }) {
  const runtime = runtimeLine(category);
  return (
    <div className="lib-page">
      <header className="lib-head">
        <span className="lib-head-icon">
          <CategoryIcon id={category.id} cap={category.capability} size={26} />
        </span>
        <h2 className="lib-head-title">{category.name}</h2>
        <p className="lib-head-blurb">{category.blurb}</p>
        <p className="hint">{slotLine(category)}</p>
        {runtime ? <p className="hint">{runtime}</p> : null}
      </header>
      {filledShelves(catalog, category.id).map((shelf) => (
        <LibraryShelfView key={shelf.id} catalog={catalog} shelf={shelf} {...pickProps} />
      ))}
      <LibraryRequestRow onRequest={onRequest} />
    </div>
  );
}

export function LibraryCollectionPage({
  catalog,
  collection,
  onRequest,
  ...pickProps
}: PickProps & { catalog: Catalog; collection: LibraryCollection; onRequest: () => void }) {
  return (
    <div className="lib-page">
      <header className="lib-head">
        <h2 className="lib-head-title">{collection.name}</h2>
        <p className="lib-head-blurb">{collection.blurb}</p>
        <p className="hint">
          Each shelf below fills one part of your Stack. The pick marked for{' '}
          {pickProps.device.phone ? thisDeviceNoun() : 'this computer'} is the biggest that fits it.
        </p>
      </header>
      {collection.shelves.map((id) => {
        const shelf = libraryShelf(id);
        if (!shelf) return null;
        return (
          <LibraryShelfView
            key={id}
            catalog={catalog}
            shelf={shelf}
            heading={`${libraryCategory(shelf.category).name}: ${shelf.name}`}
            {...pickProps}
          />
        );
      })}
      <LibraryRequestRow onRequest={onRequest} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export function LibrarySearchResults({
  results,
  onRequest,
  ...pickProps
}: PickProps & { results: LibraryPick[]; onRequest: () => void }) {
  return (
    <div className="lib-page">
      {results.length ? (
        <div className="lib-picks">
          {results.map((pick, i) => (
            <LibraryPickRow
              key={`${pick.shelf.id}-${pick.model.id}`}
              pick={pick}
              best={false}
              label={`${libraryCategory(pick.shelf.category).name}: ${pick.shelf.name}`}
              index={i}
              {...pickProps}
            />
          ))}
        </div>
      ) : (
        <p className="hint lib-empty">Nothing in the library matches that yet.</p>
      )}
      <LibraryRequestRow onRequest={onRequest} />
    </div>
  );
}
