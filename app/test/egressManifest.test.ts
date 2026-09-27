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
  STAYS_ON_DEVICE,
  egressByRecipient,
} from '../src/lib/egressManifest.js';

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

  it('keeps the uncomfortable entries honest rather than pretending they are fixed', () => {
    const by = (id: string) => EGRESS.find((e) => e.id === id)!;
    expect(by('search').when).toMatch(/does not ask first/);
    expect(by('guardrail').what).toMatch(/that person.s name/);
    expect(by('updates').what).toMatch(
      /downloads it in the background|downloads in the background/,
    );
    expect(by('repo-signin').what).toMatch(/passes through our server/);
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
