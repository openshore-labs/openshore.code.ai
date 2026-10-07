// The status blurbs say only what is true before and after a computer is
// connected (CMO, 2026-10-07): with none connected, Offshore never speaks of
// a computer out of reach, and Docked names the condition. Its row is
// disabled before pairing, so it never reads as the Connect your computer door.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROFILES, profileBlurb, reachPillShown } from '../src/lib/profiles.js';

describe('profileBlurb', () => {
  it('speaks of no computer out of reach before one is connected', () => {
    expect(profileBlurb('offshore', false)).not.toMatch(/out of reach/);
  });

  it('names what Docked needs before a computer is connected, not a door', () => {
    expect(profileBlurb('docked', false)).toBe("Your computer's models, once you connect it.");
    expect(profileBlurb('docked', false)).not.toMatch(/Connect your computer/);
  });

  it('reads the status blurb once a computer is connected', () => {
    expect(profileBlurb('offshore', true)).toBe(PROFILES.offshore.blurb);
  });
});

// D1 (founder, 2026-10-07, built as recommended, B): the reach pill shows once
// it can mean something. This narrows CX's "Reach is always visible" on the
// founder's word: before a computer is connected, only a lone Offline shows.
describe('reachPillShown', () => {
  it('waits while online until a computer is connected', () => {
    expect(reachPillShown('offshore', false)).toBe(false);
  });

  it('shows a lone Offline before any computer, the door back from a chosen Offline', () => {
    expect(reachPillShown('offline', false)).toBe(true);
  });

  it('shows every status once a computer is connected', () => {
    for (const id of ['docked', 'offshore', 'offline'] as const) {
      expect(reachPillShown(id, true)).toBe(true);
    }
  });

  it('is the one condition the pill reads, from settings.daemon alone', () => {
    // The desktop app is the computer: its own engine is not a reach the pill
    // measures, so it follows the same rule until it is pointed elsewhere.
    const src = readFileSync(join(process.cwd(), 'src', 'components', 'ProfileStatus.tsx'), 'utf8');
    expect(src).toMatch(/reachPillShown\(active, Boolean\(settings\.daemon\)\)/);
    expect(src).toMatch(/useExitPresence\(shown\)/);
  });
});
