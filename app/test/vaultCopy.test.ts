// Copy says only what is true today (0.19). The Vault's lines come from one
// map keyed by platform and storage (lib/vaultCopy.ts). This renders every
// pair through every surface that reads the map (the room's lead, the storage
// sheet, the empty-vault ramp, the welcome note) and fails on a false claim:
// - the agent reads and writes these notes only in This folder on the
//   desktop, the one folder the agent's vault is; everywhere else the only
//   agent line is a pointer to where its vault really is, and a member on
//   someone else's computer is promised nothing;
// - Obsidian opens only This folder (and the iCloud folder, from a Mac);
//   Local, Google Drive, and the team vault never claim it.
// It also scans the app for the retired false lines, so none creeps back
// outside the map.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DESKTOP_AGENT_LINE,
  PHONE_AGENT_LINE,
  ROUTINE_NOTES_PLACE,
  VAULT_COPY_PLATFORMS,
  VAULT_COPY_PROVIDERS,
  vaultCopy,
  vaultGuideText,
  vaultLead,
  vaultMoveLine,
  vaultOffersProvider,
  vaultOnboard,
  vaultSheetLine,
  vaultWelcomeNote,
  type VaultCopyProvider,
} from '../src/lib/vaultCopy.js';
import { GUIDE_CARDS } from '../src/lib/guideCards.js';
import { WAYFINDING } from '../src/lib/currents.js';
import type { Platform } from '../src/lib/platform.js';

type Pair = { on: Platform; id: VaultCopyProvider; hubMember: boolean };
const PAIRS: Pair[] = VAULT_COPY_PLATFORMS.flatMap((on) =>
  VAULT_COPY_PROVIDERS.flatMap((id) => [false, true].map((hubMember) => ({ on, id, hubMember }))),
);

/** Everything a person could read about this pair, surface by surface. */
function rendered({ on, id, hubMember }: Pair): string[] {
  const c = vaultCopy(on, id, { hubMember });
  const ramp = vaultOnboard(on, id, { hubMember });
  return [
    vaultLead(c),
    vaultSheetLine(c),
    ramp.title,
    ramp.lead,
    ...ramp.points.flatMap((p) => [p.title, p.sub]),
    vaultWelcomeNote(on, id, { hubMember }),
  ];
}

// The one pair where the agent's folder IS the vault on screen.
const agentsFolder = (p: Pair) => p.on === 'electron' && p.id === 'files';
// Neutral headings that name the agent without claiming anything about it.
const NEUTRAL_AGENT_TITLES = ['Where your agent keeps notes', '## Your agent\n'];

const sentences = (text: string) =>
  text
    .replace(/^#+ .*$/gm, '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

describe('the Vault copy map (0.19)', () => {
  it('covers every platform and storage pair', () => {
    expect(PAIRS).toHaveLength(3 * 5 * 2);
    for (const p of PAIRS) {
      const c = vaultCopy(p.on, p.id, { hubMember: p.hubMember });
      expect(c.storage.length, `${p.on}/${p.id}`).toBeGreaterThan(10);
    }
  });

  it('claims the agent reads and writes these notes only for This folder on the desktop', () => {
    for (const p of PAIRS) {
      const c = vaultCopy(p.on, p.id, { hubMember: p.hubMember });
      const where = `${p.on}/${p.id}${p.hubMember ? ' (member)' : ''}`;
      if (agentsFolder(p)) {
        expect(c.agent, where).toMatch(/write here too/);
        expect(c.routines, where).toBe('Routines leave their notes here.');
        continue;
      }
      expect(c.agent, where).toBeUndefined();
      expect(c.routines, where).toBeUndefined();
      // Whatever else is said about the agent is a pointer to its real vault,
      // or a neutral heading; with those removed, no agent line is left.
      const pointers = [PHONE_AGENT_LINE, DESKTOP_AGENT_LINE];
      if (c.agentElsewhere) expect(pointers, where).toContain(c.agentElsewhere);
      for (const text of rendered(p)) {
        let rest = text.replace(/\s+/g, ' ');
        for (const allowed of [...pointers, ...NEUTRAL_AGENT_TITLES]) {
          rest = rest.split(allowed.replace(/\s+/g, ' ')).join(' ');
        }
        expect(rest, `${where}: ${text}`).not.toMatch(/\bagents?\b/i);
      }
    }
  });

  it('has no agent line at all for the team vault, or for a member on a shared computer', () => {
    for (const p of PAIRS) {
      const c = vaultCopy(p.on, p.id, { hubMember: p.hubMember });
      if (p.id === 'org' || (p.hubMember && p.on !== 'electron')) {
        expect(c.agent).toBeUndefined();
        expect(c.agentElsewhere, `${p.on}/${p.id}`).toBeUndefined();
        for (const text of rendered(p)) expect(text).not.toMatch(/\bagents?\b/i);
      }
    }
  });

  it('the phone says where the agent is, in exactly those words', () => {
    expect(PHONE_AGENT_LINE).toBe('Your agent uses the vault on your computer.');
    for (const id of ['local', 'icloud', 'gdrive'] as const) {
      expect(vaultCopy('ios', id).agentElsewhere).toBe(PHONE_AGENT_LINE);
      expect(vaultLead(vaultCopy('ios', id))).toContain(PHONE_AGENT_LINE);
    }
  });

  it('claims Obsidian only for This folder and, from a Mac, iCloud', () => {
    for (const p of PAIRS) {
      const c = vaultCopy(p.on, p.id, { hubMember: p.hubMember });
      const where = `${p.on}/${p.id}`;
      if (p.id === 'files')
        expect(c.obsidian, where).toBe('Obsidian opens this folder as a vault.');
      else if (p.id === 'icloud') expect(c.obsidian, where).toMatch(/Obsidian on a Mac/);
      else expect(c.obsidian, where).toBeUndefined();
      if (p.id === 'files' || p.id === 'icloud') continue;
      // Local, Drive, and the team vault: any Obsidian sentence is a "not".
      for (const text of rendered(p)) {
        for (const s of sentences(text)) {
          if (/Obsidian/.test(s)) expect(s, where).toMatch(/\bnot\b/);
        }
      }
    }
  });

  it('Local says it is sealed here and not a folder; the team vault says it is shared, not Obsidian', () => {
    for (const on of VAULT_COPY_PLATFORMS) {
      expect(vaultCopy(on, 'local').storage).toBe(
        'Sealed on this device. Not a folder other apps can open.',
      );
      expect(vaultCopy(on, 'org').storage).toMatch(/Shared with your team/);
      expect(vaultCopy(on, 'org').storage).toMatch(/not an Obsidian folder/);
    }
  });

  it('never shows This folder on the phone, or iCloud on the desktop, as a row that "arrives"', () => {
    expect(vaultOffersProvider('ios', 'files')).toBe(false);
    expect(vaultOffersProvider('web', 'files')).toBe(false);
    expect(vaultOffersProvider('electron', 'files')).toBe(true);
    expect(vaultOffersProvider('electron', 'icloud')).toBe(false);
    expect(vaultOffersProvider('ios', 'icloud')).toBe(true);
    expect(vaultOffersProvider('ios', 'org')).toBe(false);
  });

  it("feeds Harbor Lite's Vault card, which keeps each claim with its own storage", () => {
    const card = GUIDE_CARDS.find((c) => c.id === 'vault');
    expect(card?.text).toBe(vaultGuideText());
    const text = vaultGuideText();
    const folder = text.indexOf('This folder');
    expect(folder).toBeGreaterThan(-1);
    // The agent and routine lines sit in the This folder clause only.
    expect(text.indexOf('write here too')).toBeGreaterThan(folder);
    expect(text.indexOf('Routines leave their notes here')).toBeGreaterThan(folder);
    expect(text.indexOf('write here too')).toBeLessThan(text.indexOf('iCloud Drive'));
    expect(text).toContain(PHONE_AGENT_LINE.slice(1));
  });

  it("puts the Wayfinding Memory notes where they are: the project's repository", () => {
    expect(WAYFINDING.memory.sub).toMatch(/repository/);
    expect(WAYFINDING.memory.sub).not.toMatch(/vault/i);
    const card = GUIDE_CARDS.find((c) => c.id === 'wayfinding');
    expect(card?.text).toMatch(/repository/);
    expect(card?.text).not.toMatch(/Memory keeps what it has learned in your Vault/);
  });

  it('a move never reports a count', () => {
    const line = vaultMoveLine(
      { ok: true, skipped: [] },
      'This folder',
      vaultCopy('electron', 'files').obsidian,
    );
    expect(line).toBe('Your vault moved to This folder. Obsidian opens this folder as a vault.');
    expect(line).not.toMatch(/\d/);
    expect(
      vaultMoveLine({ ok: false, skipped: ['a.md', 'b.md'], reason: 'unreadable' }, 'x'),
    ).toMatch(/^2 notes are still downloading/);
  });
});

// The false lines the review found, retired from the app for good. Only the
// map may say anything about the agent or Obsidian, and it says it per pair.
const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const SRC = join(ROOT, 'src');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');

const RETIRED = [
  /Point Obsidian at/,
  /Obsidian opens that folder/,
  /and it just opens/,
  /so does your agent/,
  /you and your agent both write\./,
  /written by you and your agent/,
  /reads your notes back/,
  /follows? (?:the|those) links/,
  /project notes in your vault/,
  /Memory keeps what it has learned in your Vault/,
  /leaves a note in your vault/,
  /Saved in your vault/,
  /lands in your vault/,
  /Its results stay in your vault/,
];

describe('retired Vault claims', () => {
  it('none survives anywhere in the app', () => {
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const re of RETIRED) {
        if (re.test(text)) hits.push(`${relative(ROOT, file)}: ${re}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('routine notes are placed on the computer, where the scheduler writes them', () => {
    expect(ROUTINE_NOTES_PLACE).toBe('the vault folder on your computer');
    const crew = readFileSync(join(SRC, 'screens/CrewCommandScreen.tsx'), 'utf8');
    expect(crew).toContain('ROUTINE_NOTES_PLACE');
  });
});
