// The advisor team preset must be a complete, valid crew: every member named,
// with a real persona and a when-called line, on a level the Crew screen
// understands, and the org's shape preserved (one standing build reviewer,
// the auto-engaging trio, the rest by request).
import { readFileSync } from 'node:fs';
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

  it('keeps the shape: one standing reviewer, an auto-engaging trio, the rest by request', () => {
    const level = (n: string) => ADVISOR_TEAM.find((a) => a.name === n)?.activityLevel;
    expect(level('Technical Advisor')).toBe('review');
    expect(level('Marketing Advisor')).toBe('auto');
    expect(level('Finance Advisor')).toBe('auto');
    expect(level('Creative Studio')).toBe('auto');
    for (const n of ['Research Advisor', 'Coordinator', 'Sounding Board', 'Strategy Advisor']) {
      expect(level(n), n).toBe('request');
    }
  });

  it('reads as project-agnostic advisors, not a startup C-suite', () => {
    const names = ADVISOR_TEAM.map((a) => a.name);
    for (const oldTitle of ['CTO', 'CMO', 'CFO', 'CX', 'Board', 'Corporate Strategist']) {
      expect(names, oldTitle).not.toContain(oldTitle);
    }
    // The business abilities stay, in agnostic clothing.
    expect(names).toContain('Technical Advisor');
    expect(names).toContain('Marketing Advisor');
    expect(names).toContain('Finance Advisor');
  });

  // The Crew room counts the team in words (copy review, 2026-10-07), so the words
  // follow the preset: eight in all, one reviewer, three that step in, and
  // four that wait to be asked.
  it("matches the Crew room's offer, member for member", () => {
    expect(ADVISOR_TEAM).toHaveLength(8);
    const count = (level: string) => ADVISOR_TEAM.filter((a) => a.activityLevel === level).length;
    expect([count('review'), count('auto'), count('request')]).toEqual([1, 3, 4]);
    const room = readFileSync(
      new URL('../src/screens/CrewScreen.tsx', import.meta.url),
      'utf8',
    ).replace(/\s+/g, ' ');
    expect(room).toContain('Eight general advisors for whatever you are building.');
    expect(room).toContain(
      'One reviews the work, three step in when a decision needs them, and four answer when asked.',
    );
  });

  it('every persona says it is advisory and the person decides', () => {
    for (const a of ADVISOR_TEAM) {
      expect(a.persona.toLowerCase(), a.name).toMatch(/advisory|the person (decides|chooses)/);
    }
  });
});
