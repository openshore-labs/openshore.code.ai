// Get for a pick whose license sets conditions opens the terms first, and
// the download starts only from the accept button (founder, 2026-10-13).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const store = readFileSync(join(process.cwd(), 'src', 'screens', 'LocalLibraryScreen.tsx'), 'utf8');

describe('the terms at Get', () => {
  it('every Get button goes through the terms gate', () => {
    const clicks = [...store.matchAll(/onClick=\{[^}]*\}/gs)].map((m) => m[0]);
    for (const click of clicks) {
      expect(click).not.toMatch(/pullToDevice|pullToDesktop/);
    }
    expect(store).toMatch(/if \(needsTermsAccepted\(model\)\) setTerms\(\{ model, shelfId \}\);/);
  });

  it('starts the download only from the accept button', () => {
    expect(store).toMatch(/onClick=\{acceptTerms\}>\s*\{TERMS_ACCEPT\}/);
    expect(store).toMatch(
      /<Sheet\s+open=\{terms !== undefined\}\s+onClose=\{\(\) => setTerms\(undefined\)\}\s+variant="confirm"/,
    );
  });
});
