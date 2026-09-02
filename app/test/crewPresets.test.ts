// The advisor team preset must be a complete, valid crew: every member named,
// with a real persona and a when-called line, on a level the Crew screen
// understands, and the org's shape preserved (one standing build reviewer,
// the auto-engaging trio, the rest by request).
import { describe, expect, it } from 'vitest';
import { ADVISOR_TEAM } from '../src/lib/crewPresets.js';

describe('advisor team crew preset', () => {
  it('has eight named members with personas and call rules', () => {
    expect(ADVISOR_TEAM).toHaveLength(8);
    const names = new Set(ADVISOR_TEAM.map((a) => a.name));
    expect(names.size).toBe(8);
    for (const a of ADVISOR_TEAM) {
      expect(a.persona.length, a.name).toBeGreaterThan(120);
      expect(a.whenCalled.length, a.name).toBeGreaterThan(20);
      expect(['review', 'auto', 'request']).toContain(a.activityLevel);
    }
  });

  it('keeps the org shape: CTO reviews builds, CMO/CFO/Creative Studio auto-engage', () => {
    const level = (n: string) => ADVISOR_TEAM.find((a) => a.name === n)?.activityLevel;
    expect(level('CTO')).toBe('review');
    expect(level('CMO')).toBe('auto');
    expect(level('CFO')).toBe('auto');
    expect(level('Creative Studio')).toBe('auto');
    for (const n of ['CX', 'Chief of Staff', 'Board', 'Corporate Strategist']) {
      expect(level(n), n).toBe('request');
    }
  });

  it('every persona says it is advisory and the person decides', () => {
    for (const a of ADVISOR_TEAM) {
      expect(a.persona.toLowerCase(), a.name).toMatch(/advisory|the person (decides|chooses)/);
    }
  });
});
