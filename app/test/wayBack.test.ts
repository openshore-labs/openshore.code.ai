import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Every step into a page has a step back in the top bar (founder,
// 2026-09-03, from the Kimi product page in the store, which still showed
// the menu). Room-to-room is the store's viewTrail; a page inside a room
// hands BackBar an in-room `back`. This pins the rooms that carry one, so a
// new inner page cannot ship with the menu where the chevron belongs.

const src = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');

describe('the way back', () => {
  it('BackBar takes an in-room back that wins over the room trail', () => {
    const bar = src('components', 'BackBar.tsx');
    expect(bar).toMatch(/export interface InRoomBack/);
    expect(bar).toMatch(/back\?: InRoomBack/);
    expect(bar).toMatch(
      /const way = back \?\? \(from \? \{ to: ROOM_NAMES\[from\], onBack: goBack \} : undefined\)/,
    );
    expect(bar).toMatch(/aria-label=\{`Back to \$\{way\.to\}`\}/);
  });

  it('the store product pages go back to the Marketplace, and take the model name as title', () => {
    const store = src('screens', 'MarketplaceScreen.tsx');
    expect(store).toMatch(
      /\{ title: focusedHosted\.name, back: \{ to: 'Marketplace', onBack: closeHosted \} \}/,
    );
    expect(store).toMatch(
      /\{ title: focusedModel\.name, back: \{ to: 'Marketplace', onBack: closeModel \} \}/,
    );
    expect(store).toMatch(
      /<BackBar title=\{page\?\.title \?\? 'Marketplace'\} back=\{page\?\.back\} \/>/,
    );
  });

  it('an open note goes back to the Vault, saving first', () => {
    const vault = src('screens', 'VaultScreen.tsx');
    expect(vault).toMatch(/const backToNotes = \(\) => \{\s*flushSave\(\);/);
    expect(vault).toMatch(
      /<BackBar title="Vault" back=\{\{ to: 'Vault', onBack: backToNotes \}\} \/>/,
    );
  });

  it('sheets that had only the scrim tap as a way out carry the house header with a close', () => {
    // The audit of 2026-09-03: these eight had no Cancel, Done, or close of
    // their own. SheetHead is the round close over a hairline (RepoPicker's
    // shape). A sheet whose body ends in Cancel or Done is exempt.
    const uses: Array<[string[], number]> = [
      [['screens', 'SettingsScreen.tsx'], 4], // account, log, search, paths
      [['screens', 'StackScreen.tsx'], 1], // pick a model for a role
      [['screens', 'VaultScreen.tsx'], 2], // note options, where the vault lives
      [['components', 'SourcePicker.tsx'], 1],
      [['components', 'InfoSheet.tsx'], 1],
      [['components', 'ProfileStatus.tsx'], 1],
    ];
    for (const [path, n] of uses) {
      const count = (src(...path).match(/<SheetHead\b/g) ?? []).length;
      expect(count, path.join('/')).toBe(n);
    }
  });

  it('the embedded site goes back to Launch', () => {
    const launch = src('screens', 'LaunchScreen.tsx');
    expect(launch).toMatch(
      /<BackBar title="Codemagic" back=\{\{ to: 'Launch', onBack: \(\) => setEmbedded\(false\) \}\} \/>/,
    );
  });
});
