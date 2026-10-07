// The device in hand is named once (UI/UX review follow-up, 2026-10-07): "this
// iPad" on an iPad, "this phone" everywhere else, through thisDeviceNoun in
// lib/deviceNoun.ts. No line a person reads writes "this phone" itself, so an
// iPad never reads a phone's words.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deviceNounFor, thisDeviceNoun } from '../src/lib/deviceNoun.js';
import { srcFiles, stripComments } from './support/uiGuards.js';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

describe('deviceNounFor', () => {
  it('says this phone on an iPhone', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
    expect(deviceNounFor({ userAgent: ua, maxTouchPoints: 5 })).toBe('this phone');
  });
  it('says this iPad on an iPad that names itself', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
    expect(deviceNounFor({ userAgent: ua, maxTouchPoints: 5 })).toBe('this iPad');
  });
  it('says this iPad on an iPad asking for the desktop site, which reports a Mac', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
    expect(deviceNounFor({ userAgent: ua, maxTouchPoints: 5 })).toBe('this iPad');
    // A Mac has no touch screen, so it stays out.
    expect(deviceNounFor({ userAgent: ua, maxTouchPoints: 0 })).toBe('this phone');
  });
  it('falls back to this phone when nothing can be told', () => {
    expect(deviceNounFor()).toBe('this phone');
  });
});

describe('thisDeviceNoun', () => {
  it('gives the sentence-start form on request', () => {
    const noun = thisDeviceNoun();
    expect(['this iPad', 'this phone']).toContain(noun);
    expect(thisDeviceNoun({ start: true })).toBe(noun[0]!.toUpperCase() + noun.slice(1));
  });
});

describe('copy names the device through the helper', () => {
  // The later tiers' rooms have no door in a Personal build; they keep their
  // own lines until a tier opens them (the review's follow-up says which).
  const LATER_TIER = new Set(['screens/MarketplaceScreen.tsx', 'screens/StackHealthScreen.tsx']);
  it('writes "this phone" in no line a person reads', () => {
    const offences: string[] = [];
    for (const file of srcFiles()) {
      if (LATER_TIER.has(file) || file === 'lib/deviceNoun.ts') continue;
      const code = stripComments(readFileSync(join(SRC, file), 'utf8'));
      code.split('\n').forEach((line, i) => {
        if (/\b[Tt]his phone\b/.test(line)) offences.push(`${file}:${i + 1} ${line.trim()}`);
      });
    }
    expect(offences).toEqual([]);
  });
});
