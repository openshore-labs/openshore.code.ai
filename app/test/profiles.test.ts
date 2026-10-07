// The status blurbs say only what is true before and after a computer is
// connected (CMO, 2026-10-07): with none connected, Offshore never speaks of
// a computer out of reach, and Docked says how to get there.
import { describe, expect, it } from 'vitest';
import { PROFILES, profileBlurb } from '../src/lib/profiles.js';

describe('profileBlurb', () => {
  it('speaks of no computer out of reach before one is connected', () => {
    expect(profileBlurb('offshore', false)).not.toMatch(/out of reach/);
  });

  it('tells Docked how to get there before a computer is connected', () => {
    expect(profileBlurb('docked', false)).toContain('Connect your computer');
  });

  it('reads the status blurb once a computer is connected', () => {
    expect(profileBlurb('offshore', true)).toBe(PROFILES.offshore.blurb);
  });
});
