import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { easing, prefersReducedMotion } from '../src/lib/motion.js';

const src = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');
const THEME = src('theme.css');

// The project detail room's polish lives in tokens and CSS, not memory: a
// shared-element title, section cards that assemble, and a team-access roster
// whose rows animate in and out. Pinned here so the next session keeps it.

describe('motion helpers', () => {
  it('easing falls back without a document', () => {
    expect(easing('--ease-arrive', 'cubic-bezier(0.22,1,0.36,1)')).toBe(
      'cubic-bezier(0.22,1,0.36,1)',
    );
  });
  it('prefersReducedMotion is false with no matchMedia', () => {
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('project detail polish', () => {
  it('the shared-element title is captured on tap and played on the room', () => {
    expect(src('screens/ProjectsScreen.tsx')).toContain('captureTitleHero(');
    const detail = src('screens/ProjectDetailScreen.tsx');
    expect(detail).toContain('useTitleHero(titleRef)');
    expect(detail).toContain('project-hero-title');
  });

  it('the hero reads its curve and clock from the tokens, and honors reduced motion', () => {
    const hero = src('lib/heroTitle.ts');
    expect(hero).toMatch(/durationMs\('--dur-6'/);
    expect(hero).toMatch(/easing\('--ease-arrive'/);
    expect(hero).toMatch(/prefersReducedMotion\(\)/);
  });

  it('section cards assemble on a stagger', () => {
    expect(THEME).toMatch(
      /\.project-section \{[^}]*animation:\s*msg-in var\(--dur-4\) var\(--ease-arrive\) backwards/,
    );
    expect(THEME).toMatch(
      /\.project-section \{[^}]*animation-delay:\s*calc\(var\(--i, 0\) \* var\(--stagger\)\)/,
    );
    // Each detail section is numbered so the stagger has an order.
    const detail = src('screens/ProjectDetailScreen.tsx');
    expect((detail.match(/project-section/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('team-access rows animate in and play a removed one out on tokens', () => {
    expect(THEME).toMatch(
      /\.access-row \{[^}]*animation:\s*chat-row-in var\(--dur-5\) var\(--ease-arrive\) backwards/,
    );
    expect(THEME).toMatch(
      /\.access-row\.leaving \{[^}]*animation:\s*access-row-out var\(--dur-3\) var\(--ease-accel\) forwards/,
    );
    expect(THEME).toMatch(/@keyframes access-row-out/);
  });

  it('kills the room and roster motion under reduced motion', () => {
    expect(THEME).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.project-section,\s*\.access-row,\s*\.access-row\.leaving \{\s*animation: none;/,
    );
  });

  it('the instructions Save earns its emphasis only when the draft differs', () => {
    const detail = src('screens/ProjectDetailScreen.tsx');
    expect(detail).toContain('detailsDirty');
    expect(detail).toMatch(/className=\{detailsDirty \? 'btn primary' : 'btn quiet'\}/);
  });
});
