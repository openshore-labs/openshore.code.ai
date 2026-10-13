// The frontier shelf's polish, pinned so it cannot drift: the tile hop rides
// the View Transitions API on the house tokens and dies under reduced motion;
// the connected pop is a keyframe on the spring with `backwards`; the store
// scrolls its own scroller (`.screen`), never the window, so scroll-to-top and
// scroll memory actually land; and a back navigation is the only way a room
// restores where the eye left.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(fileURLToPath(import.meta.url), '../../src');
const THEME = readFileSync(join(SRC, 'theme.css'), 'utf8');
const MARKET = readFileSync(join(SRC, 'screens/MarketplaceScreen.tsx'), 'utf8');
const LIBRARY = readFileSync(join(SRC, 'components/LibraryViews.tsx'), 'utf8');
const STORE = readFileSync(join(SRC, 'state/store.ts'), 'utf8');

describe('the tile hop (view transitions)', () => {
  it('names the product page tile as the shared element, hosted and catalog alike', () => {
    expect(THEME).toMatch(/\.product-page \.model-tile \{[^}]*view-transition-name: product-tile/);
    // Both product pages carry the class, and every tile origin (a hosted
    // row, a library pick) hands the page its tile.
    expect(MARKET).toMatch(/hosted-page product-page/);
    expect(MARKET).toMatch(/focused \? ' product-page' : ''/);
    expect(MARKET).toMatch(/e\.currentTarget, 'row'/);
    expect(MARKET).toMatch(/openModel\(model, origin, 'pick'\)/);
    expect(LIBRARY).toMatch(/transitionName=\{tileName\?\.\(model\.id\)\}/);
  });

  it('crossfades the front-to-results boundary only, with the field held still', () => {
    const apply = /const applyQuery[\s\S]*?\n  \};/.exec(MARKET)?.[0] ?? '';
    expect(apply).toMatch(/toFront !== browsing/);
    expect(apply).toMatch(/if \(crossing\) fade\(update\);\s*else update\(\);/);
    expect(THEME).toMatch(/\.market-search \{[^}]*view-transition-name: market-search/);
    // No search change bypasses the boundary logic.
    expect(MARKET).not.toMatch(/onChange=\{\(e\) => setQuery\(/);
  });

  it('shows real pull progress through Ollama on the hosted page', () => {
    const fn = /const pullHostedViaOllama[\s\S]*?\n  \};/.exec(MARKET)?.[0] ?? '';
    expect(fn).toMatch(/onInstallProgress/);
    expect(fn).toMatch(/finally \{\s*off\(\);/);
  });

  it('times the hop on the motion tokens, tile on the slow arrive lane', () => {
    const group = /::view-transition-group\(product-tile\) \{([^}]*)\}/.exec(THEME)?.[1] ?? '';
    expect(group).toContain('var(--dur-5)');
    expect(group).toContain('var(--ease-arrive)');
    const root = /::view-transition-old\(root\),\s*::view-transition-new\(root\) \{([^}]*)\}/.exec(
      THEME,
    )?.[1];
    expect(root).toContain('var(--dur-');
    expect(root).toContain('var(--ease-');
  });

  it('kills every view transition under reduced motion', () => {
    const idx = THEME.indexOf('::view-transition-group(*)');
    expect(idx).toBeGreaterThan(0);
    const block = THEME.slice(
      THEME.lastIndexOf('@media (prefers-reduced-motion: reduce)', idx),
      idx + 200,
    );
    expect(block).toMatch(/animation: none !important/);
  });

  it('guards the platform call and honors reduced motion in the screen', () => {
    expect(MARKET).toMatch(/startViewTransition/);
    expect(MARKET).toMatch(/prefers-reduced-motion: reduce/);
  });
});

describe('every store tappable answers the finger', () => {
  it('the details disclosure, the library tiles and the request row carry press-fb', () => {
    expect(MARKET).toMatch(/className="disclosure press-fb"/);
    expect(LIBRARY).toMatch(/className="lib-made press-fb press-fb--tile stagger-in"/);
    expect(LIBRARY).toMatch(/className="lib-tile press-fb press-fb--tile stagger-in"/);
    expect(LIBRARY).toMatch(/className="lib-request press-fb press-fb--row"/);
  });
});

describe('the connected pop', () => {
  it('is a spring keyframe with backwards fill, never both', () => {
    const rule = /\.pill-pop \{([^}]*)\}/.exec(THEME)?.[1] ?? '';
    expect(rule).toMatch(/animation: pill-pop var\(--dur-\d\) var\(--ease-spring\) backwards/);
    expect(THEME).toMatch(/@keyframes pill-pop/);
  });

  it('is armed by the store on connect and cleared by the room that shows it', () => {
    expect(STORE).toMatch(/justConnected: id/);
    expect(STORE).toMatch(/clearJustConnected\(\)/);
    expect(MARKET).toMatch(/clearJustConnected\(\)/);
    expect(MARKET).toMatch(/pill-pop/);
  });
});

describe('scrolling the right thing', () => {
  it('the store never scrolls the window (the room scroller is .screen)', () => {
    expect(MARKET).not.toMatch(/window\.scrollTo/);
  });

  it('a back navigation marks arrival, a forward one clears it', () => {
    expect(STORE).toMatch(/viewTrail\.slice\(0, -1\), drawerOpen: false, arrivedBack: true/);
    expect(STORE).toMatch(/viewTrail: trail, drawerOpen: false, arrivedBack: false/);
  });
});
