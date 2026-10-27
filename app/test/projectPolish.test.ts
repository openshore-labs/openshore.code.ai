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
    expect((detail.match(/project-section/g) ?? []).length).toBeGreaterThanOrEqual(3);
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

  it("Project Wayfinder's Save earns its emphasis only when the draft differs", () => {
    const wayfinder = src('components/ProjectWayfinder.tsx');
    expect(wayfinder).toMatch(/className=\{dirty \? 'btn primary' : 'btn quiet'\}/);
    expect(wayfinder).toMatch(/disabled=\{!dirty\}/);
  });
});

// The project room's repositories sheet keeps the chips and the way to the
// project memory from the 2026-09-15 workspace design.
describe('project room repositories', () => {
  const detail = src('screens/ProjectDetailScreen.tsx');

  it('renders repositories as chips and links out to the project memory', () => {
    expect(detail).toContain('repo-chip');
    expect(detail).toContain('project-memory-link');
    expect(detail).toContain('openProjectMemory(project.id)');
    expect(THEME).toContain('.repo-chip');
  });
});

// The Projects list, in the shape of the Claude app's (2026-10-02):
// flat rows with a quiet line that keeps "when" whole while "what" truncates,
// and a floating dock (search, New project) that cross-fades, never snaps.
describe('projects list', () => {
  it('the quiet line says what the project is for, else how many chats it holds', async () => {
    const { projectLine } = await import('../src/screens/ProjectsScreen.js');
    const base = { id: 'p', name: 'P', repoIds: [], createdAt: new Date().toISOString() };
    expect(projectLine(base, base.createdAt, 0)).toEqual({
      what: 'No chats yet',
      when: 'Just now',
    });
    expect(projectLine(base, base.createdAt, 1).what).toBe('1 chat');
    expect(projectLine(base, base.createdAt, 3).what).toBe('3 chats');
    expect(projectLine({ ...base, shared: true }, base.createdAt, 2).what).toBe(
      'Shared with your team',
    );
    expect(projectLine({ ...base, instructions: '  Essays.\nMore.' }, base.createdAt, 3).what).toBe(
      'Essays.',
    );
  });

  it('the dock layers cross-fade on transform and opacity, and the time never truncates', () => {
    expect(THEME).toMatch(
      /\.projects-dock-idle,\s*\.projects-dock-search \{[^}]*grid-area: 1 \/ 1/,
    );
    expect(THEME).toMatch(/\.project-row-when \{[^}]*flex-shrink: 0/);
    expect(src('screens/ProjectsScreen.tsx')).toContain('<Sheet open={creating}');
  });
});

// The project room, in the shape of the Claude app's (2026-10-02):
// the pill doors, the room's own components at the top, then the chats as one
// flat list, and the project's own actions behind the "..." menu.
describe('project room', () => {
  const detail = src('screens/ProjectDetailScreen.tsx');
  it('leads with Runs on under the title, then the three doors, then the chats', () => {
    // Founder, 2026-10-27: Runs on sits where Active was, the doors are
    // Repositories, Project Wayfinder and Agents, and no notes are pinned.
    const runsOn = detail.indexOf('<RunsOnPill');
    const pills = detail.indexOf('className="project-pills');
    const wayfinder = detail.indexOf('Project Wayfinder</span>');
    const agents = detail.indexOf('onClick={() => setAgentsOpen(true)}');
    const chats = detail.indexOf('className="project-chats');
    expect(runsOn).toBeGreaterThan(-1);
    expect(runsOn).toBeLessThan(pills);
    expect(pills).toBeLessThan(wayfinder);
    expect(wayfinder).toBeLessThan(agents);
    expect(agents).toBeLessThan(chats);
    expect(detail).not.toContain('ProjectVaultPins');
  });

  it('keeps make active, rename and delete in the menu, and a long title truncates', () => {
    const menu = detail.slice(detail.indexOf('<Sheet open={menu}'));
    expect(menu.slice(0, menu.indexOf('</Sheet>'))).toMatch(
      /Make active[\s\S]*Rename[\s\S]*Delete project/,
    );
    expect(THEME).toMatch(
      /\.project-chat-title \{[^}]*display: block;[^}]*text-overflow: ellipsis/,
    );
  });
});

// Advisor rulings, 2026-10-02: the reach dot stays on a project's chat rows
// (UX review), and the bar's title tucks away while the room's large title shows
// (design review), so the name never reads twice.
describe('project room rulings', () => {
  const detail = src('screens/ProjectDetailScreen.tsx');
  it('says no Active, and Runs on wears the ink pill: teal stays for local', () => {
    expect(detail).not.toContain('>Active<');
    expect(src('components/ProjectRunsOn.tsx')).toContain('className="pill ink runs-on-pill');
  });
  it('marks each chat row with where it ran', () => {
    expect(detail).toMatch(
      /project-chat-sub[\s\S]{0,200}<ReachDot reach=\{chatReach\(conv\)\} \/>/,
    );
  });
  it('tucks the bar title until the large title scrolls under it', () => {
    expect(detail).toContain('titleHiddenUntil={titleRef}');
    expect(src('components/BackBar.tsx')).toContain('IntersectionObserver');
    expect(THEME).toMatch(/\.topbar-title\.is-tucked \{[^}]*animation: none;[^}]*opacity: 0;/);
  });
});
