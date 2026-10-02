// What leaves this device is code, not memory (v1 Phase 2). Every host that
// appears in the app, the desktop shell, or the engine must be on the list
// Settings shows, or marked as a link the person opens themselves, with a
// reason. A new call to a new service fails here until someone writes down,
// in plain words, what it sends and when. The phone half of the review's
// egress test is exactly this: a static manifest over every host.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  EGRESS,
  LINK_ONLY_HOSTS,
  RECIPIENT_ORDER,
  ROUTINES_SEARCH_LINE,
  STAYS_ON_DEVICE,
  egressByRecipient,
} from '../src/lib/egressManifest.js';
import { GUIDE_CARDS } from '../src/lib/guideCards.js';
import { HARBOR_MINI_PERSONA } from '../src/lib/harborMini.js';
import { APP_KNOWLEDGE } from '../src/lib/guideKnowledge.js';

const ROOTS = [
  join(process.cwd(), 'src'),
  join(process.cwd(), 'electron'),
  join(process.cwd(), '..', 'os-code', 'src'),
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules') walk(full, out);
    } else if (/\.(ts|tsx|cjs|mjs)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function hostsInSource(): Map<string, string> {
  const found = new Map<string, string>();
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/https?:\/\/([a-zA-Z0-9.-]+\.[a-z]{2,})/g)) {
        const host = m[1]!.toLowerCase();
        if (!found.has(host)) found.set(host, relative(join(process.cwd(), '..'), file));
      }
    }
  }
  return found;
}

describe('what leaves this device', () => {
  const listed = new Set(EGRESS.flatMap((e) => e.hosts));

  it('lists every host the code can reach, or says why it is only a link', () => {
    const unlisted: string[] = [];
    for (const [host, file] of hostsInSource()) {
      if (listed.has(host) || host in LINK_ONLY_HOSTS) continue;
      unlisted.push(`${host} (first seen in ${file})`);
    }
    expect(unlisted, 'add each to src/lib/egressManifest.ts with what it sends and when').toEqual(
      [],
    );
  });

  it('never lists a host as both something sent and a mere link', () => {
    for (const host of listed) expect(host in LINK_ONLY_HOSTS, host).toBe(false);
  });

  it('says for every entry who gets what, and when, starting with OpenShore', () => {
    for (const e of EGRESS) {
      expect(RECIPIENT_ORDER as readonly string[]).toContain(e.recipient);
      expect(e.what.length).toBeGreaterThan(20);
      expect(e.when.length).toBeGreaterThan(10);
    }
    expect(egressByRecipient()[0]!.recipient).toBe('OpenShore (us)');
    expect(STAYS_ON_DEVICE.length).toBeGreaterThan(2);
  });

  it('says what the four privacy calls changed, and still names what leaves', () => {
    const by = (id: string) => EGRESS.find((e) => e.id === id)!;
    // Web search asks once (founder, 2026-10-02), and the list says so.
    expect(by('search').when).toMatch(/after you allow it once/);
    expect(by('search').when).not.toMatch(/on by default/);
    expect(by('search').start).toBe('off');
    expect(by('guardrail').what).toMatch(/never the name of a person/);
    expect(by('updates').what).toMatch(/Nothing downloads until you click Update/);
    expect(by('repo-signin').what).toMatch(/passes through our server/);
    expect(by('repo-signin').what).toMatch(/keeps no copy/);
  });

  // Founder, 2026-10-01: a routine follows the one web search switch and only
  // searches, so the search entry and the Settings row say so in one sentence,
  // and claim no per-routine switch that is not built.
  it('says Crew routines follow the search switch, in the list and under the Settings row', () => {
    const search = EGRESS.find((e) => e.id === 'search')!;
    expect(ROUTINES_SEARCH_LINE).toMatch(/follow this switch.*only search.*never open pages/);
    expect(search.when).toContain(ROUTINES_SEARCH_LINE);
    expect(search.when).not.toMatch(/turn it on for that routine/i);
    const settings = readFileSync(
      join(process.cwd(), 'src', 'screens', 'SettingsScreen.tsx'),
      'utf8',
    );
    const row = settings.slice(settings.indexOf('label="Let models search the web"'));
    expect(row.slice(0, row.indexOf('trailing='))).toContain('${ROUTINES_SEARCH_LINE}');
  });

  it('is the list Settings shows, first under Privacy', () => {
    const settings = readFileSync(
      join(process.cwd(), 'src', 'screens', 'SettingsScreen.tsx'),
      'utf8',
    );
    const privacy = settings.slice(settings.indexOf('<SettingsGroup title="Privacy"'));
    expect(privacy.indexOf('<WhatLeavesSheet />')).toBeGreaterThan(-1);
    expect(privacy.indexOf('<WhatLeavesSheet />')).toBeLessThan(privacy.indexOf('<InfoSheet'));
    // The old claim was false (search words, update checks and the catalog
    // all leave); it is gone.
    expect(settings).not.toMatch(/nothing leaves it|no IP address, ever\. There is one/);
  });
});

// Copy never claims more privacy than the list shows (finding 10). The guides
// answer "does anything leave my phone?" in their own words, so their words
// are held to the list too: no "only X sends anything", no "nothing leaves",
// no "everything stays", and no promise that building needs no account.
describe('the guides claim no more than the list', () => {
  const OVERCLAIMS = [
    /\bonly\b[^.]*\bsends? anything\b/i,
    /nothing (?:ever )?leaves (?:the|this|your) (?:device|phone|computer)/i,
    /keeps? everything on (?:the|this|your) device/i,
    /nothing routes through us/i,
    /building (?:need|needs|works?)[^.]*(?:no account|signed out)/i,
    /chatting and building/i,
  ];
  const sources: Array<[string, string]> = [
    ...GUIDE_CARDS.map((c): [string, string] => [`guide card ${c.id}`, c.text]),
    ['Harbor Lite persona', HARBOR_MINI_PERSONA],
    ['app knowledge', APP_KNOWLEDGE],
    ['Paywall', readFileSync(join(process.cwd(), 'src', 'components', 'Paywall.tsx'), 'utf8')],
  ];

  it('says nothing about leaving the device that the list does not back', () => {
    const found: string[] = [];
    for (const [where, text] of sources) {
      for (const claim of OVERCLAIMS) {
        const hit = text.match(claim);
        if (hit) found.push(`${where}: ${hit[0]}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('sends the privacy question to the list itself', () => {
    const privacy = GUIDE_CARDS.find((c) => c.id === 'privacy')!;
    expect(privacy.text).toMatch(/What leaves this device/);
    // The entries it names are on the list.
    const ids = EGRESS.map((e) => e.id);
    for (const id of ['cloud-models', 'search', 'updates', 'catalog', 'account'])
      expect(ids).toContain(id);
  });
});

describe('what leaves, by release tier', () => {
  it('a Personal build lists only what it can do', () => {
    const personal = egressByRecipient(1).flatMap((g) => g.entries.map((e) => e.id));
    for (const later of ['team', 'decisions', 'codemagic', 'agents']) {
      expect(personal, later).not.toContain(later);
    }
    for (const v1 of ['account', 'guardrail', 'catalog', 'updates', 'search', 'cloud-models']) {
      expect(personal, v1).toContain(v1);
    }
    const all = egressByRecipient(4).flatMap((g) => g.entries.map((e) => e.id));
    expect(all).toEqual(expect.arrayContaining(['team', 'decisions', 'codemagic', 'agents']));
  });
});
