// Search first is the harness's gold standard (founder, 2026-10-27): outside
// coding, a local model answers from current sources it was handed, never
// from what it half remembers. This guard keeps the standard from drifting:
// every driver that speaks the SEARCH: protocol also searches first, and the
// shipped store turns it on.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DRIVERS = join(__dirname, '..', 'src', 'drivers');
const read = (file: string) => readFileSync(file, 'utf8');

describe('search first, the gold standard', () => {
  const speakers = readdirSync(DRIVERS)
    .filter((f) => f.endsWith('.ts') && f !== 'searchTurn.ts')
    .filter((f) => read(join(DRIVERS, f)).includes('new SearchTurn()'));

  it('finds the drivers that speak the search protocol', () => {
    expect(speakers.sort()).toEqual(
      ['desktopChatDriver.ts', 'onDeviceDriver.ts', 'stackDriver.ts'].sort(),
    );
  });

  it.each(speakers)('%s searches first before its model answers', (file) => {
    expect(read(join(DRIVERS, file))).toMatch(/this\.search\.first\(/);
  });

  it('the store turns it on, so a shipped build searches first', () => {
    const store = read(join(__dirname, '..', 'src', 'state', 'store.ts'));
    expect(store).toMatch(/searchFirst: \(\) => true/);
  });
});
