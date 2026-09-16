// The First Seat surface, pinned by text: it owns the empty chat's center when
// no brain is ready, arrives on the tokens ("The Seat Fills"), animates out
// through the presence pattern, ticks once when the card seats, honors reduced
// motion, and never names a frontier model on the card. The harness has no
// room and no name, so no codename reaches copy either.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const SEAT = read('src/components/FirstSeat.tsx');
const CHAT = read('src/screens/ChatScreen.tsx');
const THEME = read('src/theme.css');
const PATHS = read('src/components/StartingPaths.tsx');

describe('First Seat in the chat empty state', () => {
  it('mounts in ChatScreen with the greeting as its fallback', () => {
    expect(CHAT).toContain("import { FirstSeat } from '../components/FirstSeat.js'");
    expect(CHAT).toMatch(/<FirstSeat\s+fallback=\{/);
    // The Harbor Light First Moves stay for that case.
    expect(CHAT).toContain('<MiniFirstMoves');
  });

  it('reads readiness from the store, not from a guess', () => {
    expect(SEAT).toContain("sourceReady({ kind: 'stack' })");
    expect(SEAT).toContain('desktopStatus');
    expect(SEAT).toContain('firstSeatNeeded(');
  });

  it('animates out through the presence pattern', () => {
    expect(SEAT).toContain('useExitPresence(');
    expect(SEAT).toMatch(/closing \? ' closing' : ''/);
  });

  it('ticks exactly once, when the card seats, never in an onClick', () => {
    const ticks = SEAT.match(/hapticTick\(\)/g) ?? [];
    expect(ticks).toHaveLength(1);
    expect(SEAT).toMatch(/onAnimationEnd=\{[\s\S]*?seat-card-in[\s\S]*?hapticTick\(\)/);
    expect(SEAT).not.toMatch(/onClick=\{[^}]*hapticTick/);
  });

  it('one primary teal install control, More ways to start beneath', () => {
    expect(SEAT).toContain('btn primary press-fb');
    expect(SEAT).toContain('More ways to start');
    for (const row of ['Connect your computer', 'Connect a key', 'Browse the Marketplace']) {
      expect(SEAT).toContain(row);
    }
  });

  it('never names a frontier model, a codename, or "always on" on the card', () => {
    for (const banned of ['Sonnet', 'Claude', 'Keel', 'always on', 'Always on', 'quarterback']) {
      expect(SEAT, banned).not.toContain(banned);
    }
  });

  it('shows the size in GB and the class line from the engine', () => {
    expect(SEAT).toContain('classLineFor(');
    expect(SEAT).toMatch(/GB download/);
  });
});

describe('the arrival rides the tokens (The Seat Fills)', () => {
  it('stages the mark, the line, and the card on --stagger', () => {
    expect(THEME).toMatch(/\.first-seat > \* \{[^}]*calc\(var\(--i, 0\) \* var\(--stagger\)\)/);
  });
  it('seats the card on the glide over the door clock with a teal bloom', () => {
    expect(THEME).toMatch(
      /\.first-seat-card \{[^}]*animation:\s*seat-card-in var\(--dur-7\) var\(--ease-glide\)/,
    );
    expect(THEME).toMatch(/@keyframes seat-bloom \{[^}]*var\(--local-soft\)/);
  });
  it('settles the mark on the arrive curve', () => {
    expect(THEME).toMatch(
      /\.first-seat-mark \{[^}]*seat-mark-in var\(--dur-6\) var\(--ease-arrive\)/,
    );
  });
  it('leaves on its own exit and is killed under reduced motion', () => {
    expect(THEME).toMatch(/\.first-seat\.closing \{[^}]*animation:\s*seat-out var\(--dur-5\)/);
    const reduced = THEME.match(
      /@media \(prefers-reduced-motion: reduce\) \{[^{}]*\.first-seat-card[^{}]*\{[^}]*animation: none/,
    );
    expect(reduced, 'reduced-motion kill for the seat').toBeTruthy();
  });
});

describe('the Harbor Light hero is honest about its states', () => {
  it('has download, progress, and failure states, not only "already here"', () => {
    expect(PATHS).toContain('Harbor Light is already here');
    expect(PATHS).toContain('harborMiniDownload');
    expect(PATHS).toMatch(/harborMiniDownload\?\.failed/);
    expect(PATHS).toContain('Get Harbor Light');
  });
  it('drops the "part of Personal" claim while gates are off', () => {
    expect(PATHS).not.toContain('part of Personal');
  });
  it('exports StartingPaths for the Settings "Get started" group', () => {
    expect(PATHS).toMatch(/export function StartingPaths\(/);
    expect(PATHS).toContain("variant === 'rows'");
  });
});
