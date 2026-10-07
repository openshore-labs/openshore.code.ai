// What the first screen of Settings says (founder, D16, 2026-10-07): Privacy
// and Ethical boundaries sit straight after Account, so the lead's promise
// ("What this app keeps, and where.") is kept on the first screen, and first
// of all on a build with no account backend, where Account is left out. No
// row or copy moved with them, the profile's link still lands on This device,
// and Harbor Lite's Settings card names every group in the screen's order.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GUIDE_CARDS } from '../src/lib/guideCards.js';

const SCREEN = readFileSync(new URL('../src/screens/SettingsScreen.tsx', import.meta.url), 'utf8');

/** Every SettingsGroup on the screen, in source order, by its title, or by
 *  its first row's label for an untitled group (Ethical boundaries, Clear
 *  chats). */
function screenGroups(): string[] {
  const out: string[] = [];
  const re = /<SettingsGroup\b([^>]*)>/g;
  for (let m = re.exec(SCREEN); m; m = re.exec(SCREEN)) {
    const title = /title="([^"]+)"/.exec(m[1]!)?.[1];
    if (title) {
      out.push(title);
      continue;
    }
    const label = /label="([^"]+)"/.exec(SCREEN.slice(m.index))?.[1];
    out.push(label ?? '(unnamed)');
  }
  return out;
}

describe('Settings, in the order the first screen reads', () => {
  it('puts Privacy and Ethical boundaries straight after Account', () => {
    const groups = screenGroups();
    expect(groups.slice(0, 4)).toEqual(['Account', 'Privacy', 'Ethical boundaries', 'This device']);
    // Account is left out on a build with no backend, and leaves no gap in
    // the stagger, so Privacy is then the first group.
    expect(SCREEN).toMatch(
      /<SettingsGroup title="Account" index=\{configured \? group\+\+ : group\} hidden=\{!configured\}>/,
    );
    expect(SCREEN).toMatch(/<SettingsGroup title="Privacy" index=\{group\+\+\}>/);
    // The profile's link still lands on This device.
    expect(SCREEN).toMatch(/<SettingsGroup id=\{FOLLOWS_GROUP_ID\} title="This device"/);
    // The sheets' cross-references still point the right way.
    const privacy = SCREEN.slice(SCREEN.indexOf('<SettingsGroup title="Privacy"'));
    expect(privacy.indexOf('<WhatLeavesSheet />')).toBeLessThan(
      privacy.indexOf('listed under What leaves this device, above'),
    );
    expect(privacy.indexOf('see Ethical boundaries below')).toBeLessThan(
      privacy.indexOf('title="Ethical boundaries"'),
    );
  });

  it("names every group in Harbor Lite's Settings card, in the screen's order", () => {
    const card = GUIDE_CARDS.find((c) => c.id === 'settings')!;
    const listed = /^Groups: (.*?)\. Set up steps/.exec(card.text)![1]!;
    const names = listed
      .replace(/, and /, ', ')
      .split(', ')
      .map((n) => n.replace(/ \(iPhone\)$/, ''));
    // The suite runs at tier 4, so the later tiers' groups are listed too.
    expect(names).toEqual(screenGroups());
  });
});
