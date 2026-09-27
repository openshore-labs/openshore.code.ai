// Copy says only what is true today (0.19). The Vault's lines come from one
// map keyed by platform and storage (lib/vaultCopy.ts). This renders every
// pair, on an unpaired device, a paired one, and a member's, through every
// surface that reads the map (the room's lead, the storage sheet, the
// empty-vault ramp, the welcome note, the move toast) and fails on a false
// claim:
// - the agent reads and writes these notes only in This folder on the
//   desktop, the one folder the agent's vault is; everywhere else the only
//   agent line is the platform's own pointer to where its vault really is
//   (on an unpaired phone, one pointer in the empty-vault ramp only), and a
//   member on someone else's computer is promised nothing;
// - Obsidian is named only in the exact sentences each storage may say:
//   only This folder says Obsidian opens it; the team vault says it is not
//   an Obsidian folder; Local, iCloud, and Google Drive say nothing about
//   Obsidian at all;
// - the welcome note, which travels with the vault, says nothing that only
//   holds for the storage it was written on.
// It also scans the app, guide cards included, for the retired false lines,
// so none creeps back outside the map, and it pins what the move toast, the
// Not saved card, and the read-only Drive card may promise.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  VAULT_GONE_REASON,
  VAULT_NO_COPY_NAME_REASON,
  VAULT_RESOLVE_AGAIN,
  VAULT_RESOLVE_FAILED,
  VAULT_RESOLVE_SAME,
  VAULT_UPDATED_SUFFIX,
  vaultConflictCard,
  vaultGoneToast,
  vaultLeaveToast,
  vaultReplayCopiesLine,
  vaultResolveCopy,
  vaultResolveToast,
  vaultResolveWhen,
  DESKTOP_AGENT_LINE,
  DRIVE_NOT_CONNECTED_MOVE_LINE,
  DRIVE_RECONNECT_FAILED_LINE,
  DRIVE_WEB_URL,
  PHONE_AGENT_LINE,
  PHONE_PAIR_LINE,
  ROUTINE_NOTES_PLACE,
  VAULT_COPY_PLATFORMS,
  VAULT_COPY_PROVIDERS,
  vaultCopy,
  vaultDriveCard,
  vaultDriveMoveRefusal,
  VAULT_FOLDER_MISSING_LINE,
  VAULT_GUIDE_PICKER_LINE,
  VAULT_OBSIDIAN_HOWTO,
  VAULT_OPEN_CHATS_LINE,
  vaultCloudLine,
  vaultEarlierFolderHeld,
  vaultFolderFacts,
  vaultFolderOffer,
  vaultFolderQuestion,
  vaultIcloudCasOnPhone,
  vaultMoveResolveCopy,
  vaultPickRefusal,
  vaultPickResultCopy,
  vaultPickerRow,
  vaultRepointToast,
  vaultRevealLabel,
  vaultWarningLine,
  vaultGuideText,
  vaultHeldHint,
  vaultHeldKeep,
  vaultHeldLine,
  vaultLead,
  vaultMoveLine,
  vaultOffersProvider,
  vaultOnboard,
  vaultSheetLine,
  vaultWelcomeNote,
  type VaultCopyOpts,
  type VaultCopyProvider,
} from '../src/lib/vaultCopy.js';
import { GUIDE_CARDS } from '../src/lib/guideCards.js';
import { PROVIDER_ROSTER } from '../src/lib/gitos/providers.js';
import { WAYFINDING } from '../src/lib/currents.js';
import type { Platform } from '../src/lib/platform.js';

// Who holds the device: nobody else's computer and none paired, a computer
// of their own paired, or a member's seat on someone else's computer.
type Device = 'unpaired' | 'paired' | 'member';
const DEVICES: Record<Device, VaultCopyOpts> = {
  unpaired: {},
  paired: { paired: true },
  member: { paired: true, hubMember: true },
};
type Pair = { on: Platform; id: VaultCopyProvider; device: Device };
const PAIRS: Pair[] = VAULT_COPY_PLATFORMS.flatMap((on) =>
  VAULT_COPY_PROVIDERS.flatMap((id) =>
    (Object.keys(DEVICES) as Device[]).map((device) => ({ on, id, device })),
  ),
);
const optsOf = (p: Pair) => DEVICES[p.device];
const nameOf = (p: Pair) => `${p.on}/${p.id} (${p.device})`;

/** Everything a person could read about this pair, surface by surface. */
function rendered(p: Pair): string[] {
  const c = vaultCopy(p.on, p.id, optsOf(p));
  const ramp = vaultOnboard(p.on, p.id, optsOf(p));
  return [
    vaultLead(c),
    vaultSheetLine(c),
    ramp.title,
    ramp.lead,
    ...ramp.points.flatMap((pt) => [pt.title, pt.sub]),
    vaultWelcomeNote(),
    // The toast after a move onto this storage carries its Obsidian clause.
    vaultMoveLine({ ok: true, skipped: [], forked: [] }, 'There', c.obsidian),
  ];
}

// The one pair where the agent's folder IS the vault on screen.
const agentsFolder = (p: Pair) => p.on === 'electron' && p.id === 'files';
// Neutral headings that name the agent without claiming anything about it.
const NEUTRAL_AGENT_TITLES = ['Where your agent keeps notes'];

// A heading is a sentence of its own, so a claim in one is read like any
// other (a heading never hides from the check).
const sentences = (text: string) =>
  text
    .replace(/^(#+ .*)$/gm, '\n$1.\n')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

// Every sentence that may name Obsidian, per storage, exactly.
const OBSIDIAN_SAID: Record<VaultCopyProvider, string[]> = {
  files: ['Obsidian opens this folder as a vault.'],
  icloud: [],
  local: [],
  gdrive: [],
  org: ['It is not an Obsidian folder.'],
};

describe('the Vault copy map (0.19)', () => {
  it('covers every platform, storage, and device', () => {
    expect(PAIRS).toHaveLength(3 * 5 * 3);
    for (const p of PAIRS) {
      const c = vaultCopy(p.on, p.id, optsOf(p));
      expect(c.storage.length, nameOf(p)).toBeGreaterThan(10);
    }
  });

  it('claims the agent reads and writes these notes only for This folder on the desktop', () => {
    for (const p of PAIRS) {
      const c = vaultCopy(p.on, p.id, optsOf(p));
      const where = nameOf(p);
      if (agentsFolder(p)) {
        expect(c.agent, where).toMatch(/write here too/);
        expect(c.routines, where).toBe('Routines leave their notes here.');
        continue;
      }
      expect(c.agent, where).toBeUndefined();
      expect(c.routines, where).toBeUndefined();
      // The one pointer this platform may carry: the desktop's own, or the
      // phone's (paired, or the ramp's pairing pointer), never the other's.
      const pointer = p.on === 'electron' ? DESKTOP_AGENT_LINE : PHONE_AGENT_LINE;
      const pointers = p.on === 'electron' ? [pointer] : [pointer, PHONE_PAIR_LINE];
      if (c.agentElsewhere) expect(c.agentElsewhere, where).toBe(pointer);
      for (const text of rendered(p)) {
        let rest = text.replace(/\s+/g, ' ');
        for (const allowed of [...pointers, ...NEUTRAL_AGENT_TITLES]) {
          rest = rest.split(allowed.replace(/\s+/g, ' ')).join(' ');
        }
        expect(rest, `${where}: ${text}`).not.toMatch(/\bagents?\b/i);
      }
    }
  });

  it('points at the computer from the phone only when one is paired and is its own', () => {
    for (const p of PAIRS) {
      if (p.on === 'electron') continue;
      const c = vaultCopy(p.on, p.id, optsOf(p));
      const where = nameOf(p);
      const says = p.device === 'paired' && p.id !== 'org';
      expect(c.agentElsewhere, where).toBe(says ? PHONE_AGENT_LINE : undefined);
      // An unpaired phone or the web gets one pointer, in the empty-vault ramp
      // only: never in the lead or the storage sheet.
      const pairs = p.device === 'unpaired' && p.id !== 'org';
      expect(c.agentPair, where).toBe(pairs ? PHONE_PAIR_LINE : undefined);
      if (pairs) {
        expect(vaultLead(c), where).not.toMatch(/agent/i);
        expect(vaultSheetLine(c), where).not.toMatch(/agent/i);
        const ramp = vaultOnboard(p.on, p.id, optsOf(p));
        expect(
          ramp.points.find((pt) => pt.glyph === 'agent'),
          where,
        ).toEqual({
          glyph: 'agent',
          title: 'Where your agent keeps notes',
          sub: PHONE_PAIR_LINE,
        });
        continue;
      }
      // A member, or the team vault: no agent word anywhere.
      if (!says) for (const text of rendered(p)) expect(text).not.toMatch(/\bagents?\b/i);
    }
  });

  it('has no agent line at all for the team vault', () => {
    for (const p of PAIRS.filter((x) => x.id === 'org')) {
      const c = vaultCopy(p.on, p.id, optsOf(p));
      expect(c.agent).toBeUndefined();
      expect(c.agentElsewhere, nameOf(p)).toBeUndefined();
      for (const text of rendered(p)) expect(text).not.toMatch(/\bagents?\b/i);
    }
  });

  it('a paired phone says where the agent is, in exactly those words', () => {
    expect(PHONE_AGENT_LINE).toBe('Your agent uses the vault on your computer.');
    for (const id of ['local', 'icloud', 'gdrive'] as const) {
      const c = vaultCopy('ios', id, { paired: true });
      expect(c.agentElsewhere).toBe(PHONE_AGENT_LINE);
      expect(vaultLead(c)).toContain(PHONE_AGENT_LINE);
      // With no computer paired there is no agent to point at.
      expect(vaultLead(vaultCopy('ios', id))).not.toMatch(/agent/i);
    }
  });

  it('names Obsidian only in the exact sentences each storage may say', () => {
    for (const p of PAIRS) {
      const c = vaultCopy(p.on, p.id, optsOf(p));
      const where = nameOf(p);
      if (p.id === 'files')
        expect(c.obsidian, where).toBe('Obsidian opens this folder as a vault.');
      else expect(c.obsidian, where).toBeUndefined();
      for (const text of rendered(p)) {
        for (const s of sentences(text)) {
          if (/obsidian/i.test(s)) expect(OBSIDIAN_SAID[p.id], `${where}: ${s}`).toContain(s);
        }
      }
    }
  });

  it('reads a heading as a sentence, so a claim there is caught too', () => {
    const s = sentences('# Title\n\n## Obsidian opens this vault as is\n\nBody text. More.');
    expect(s).toContain('## Obsidian opens this vault as is.');
    expect(OBSIDIAN_SAID.local).not.toContain('## Obsidian opens this vault as is.');
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

  it('the welcome note travels with the vault, so it carries no storage or agent line', () => {
    const note = vaultWelcomeNote();
    for (const p of PAIRS) {
      const c = vaultCopy(p.on, p.id, optsOf(p));
      for (const line of [c.storage, c.obsidian, c.agent, c.routines, c.agentElsewhere]) {
        if (line) expect(note, nameOf(p)).not.toContain(line);
      }
    }
    expect(note).not.toMatch(/\bagents?\b|Obsidian|sealed|this device|iCloud|Drive/i);
    // It says where to look instead, which stays true wherever it goes.
    expect(note).toMatch(/Where it lives/);
    expect(note).toMatch(/\[\[Ideas\]\]/);
  });

  // Creative Studio 3c: the desktop's Keep as plain files row is retired as a
  // duplicate of This folder, so the 0.11 way out is This folder itself,
  // offered on the desktop whichever storage holds the vault.
  it('on the desktop the storage sheet always offers This folder, the one way out', () => {
    for (const current of ['local', 'files', 'gdrive']) {
      expect(vaultOffersProvider('electron', 'files'), current).toBe(true);
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

  it('iCloud switched off on the iPhone is not "Arriving": its pill names the state', () => {
    const icloud = PROVIDER_ROSTER.find((p) => p.id === 'icloud')!;
    expect(icloud.offPill).toBe('Turned off');
    expect(icloud.offPill ?? 'Arriving').not.toBe('Arriving');
    expect(icloud.pending).toBe(
      'Sign in to iCloud and turn on iCloud Drive in Settings on this iPhone to use it.',
    );
    // Google Drive is held back, so it still arrives.
    expect(PROVIDER_ROSTER.find((p) => p.id === 'gdrive')!.offPill).toBeUndefined();
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
    // The phone's pointer is said only of a phone paired with a computer.
    expect(text).toContain(`paired with a computer, ${PHONE_AGENT_LINE.charAt(0).toLowerCase()}`);
    // iCloud names no Obsidian until a Mac opens it on a real device (8.1),
    // and no line it drops leaves a hole behind.
    expect(text).not.toMatch(/undefined|Obsidian on a Mac/);
    expect(text).toContain(`iCloud Drive, on the iPhone: ${vaultCopy('ios', 'icloud').storage}`);
  });

  it("puts the Wayfinding Memory notes where they are: the project's repository", () => {
    expect(WAYFINDING.memory.sub).toMatch(/repository/);
    expect(WAYFINDING.memory.sub).not.toMatch(/vault/i);
    const card = GUIDE_CARDS.find((c) => c.id === 'wayfinding');
    expect(card?.text).toMatch(/repository/);
    expect(card?.text).not.toMatch(/Memory keeps what it has learned in your Vault/);
  });
});

// What the move toast may say (0.5, copy-1, copy-2). A clean move says where
// the vault is; a note whose name was already taken there with other text is
// named, since the name now opens that text; a refused move says "nothing
// moved" only when it took back every copy it wrote.
describe('the move toast', () => {
  const clean = { ok: true, skipped: [], forked: [] };

  it('a clean move never reports a count', () => {
    const line = vaultMoveLine(clean, 'This folder', vaultCopy('electron', 'files').obsidian);
    expect(line).toBe('Your vault moved to This folder. Obsidian opens this folder as a vault.');
    expect(line).not.toMatch(/\d/);
    expect(
      vaultMoveLine(
        { ok: false, skipped: ['a.md', 'b.md'], forked: [], reason: 'unreadable' },
        'x',
      ),
    ).toMatch(/^2 notes are still downloading/);
  });

  it('names a note that landed beside one already there, never a plain success', () => {
    const one = vaultMoveLine(
      {
        ok: true,
        skipped: [],
        forked: [{ from: 'ideas/Ideas.md', to: 'ideas/Ideas (conflict 2026-09-27 1405).md' }],
      },
      'This folder',
    );
    expect(one).toBe(
      'Your vault moved to This folder. "Ideas" was already there with different text, so the one you moved is beside it as "Ideas (conflict 2026-09-27 1405)".',
    );
    const three = vaultMoveLine(
      {
        ok: true,
        skipped: [],
        forked: ['a', 'b', 'c'].map((n) => ({ from: `${n}.md`, to: `${n} (conflict x).md` })),
      },
      'This device',
    );
    expect(three).toMatch(/^Your vault moved to This device\. 3 notes were already there/);
    // The room has no search yet, so the line says how to find the copies.
    expect(three).toMatch(
      /the ones you moved sit beside them, each with "conflict" and the date in its name\.$/,
    );
  });

  it('says "nothing moved" only when the refused move took its copies back', () => {
    const failed = { ok: false, skipped: [], forked: [], reason: 'copy-failed' };
    expect(vaultMoveLine(failed, 'This folder')).toBe(
      'Could not copy your notes to This folder, so nothing moved. Try again in a moment.',
    );
    const leftOne = vaultMoveLine({ ...failed, left: ['ideas/Ideas.md'] }, 'This folder');
    expect(leftOne).not.toMatch(/nothing moved/);
    expect(leftOne).toBe(
      'Could not copy your notes to This folder, so your vault stayed where it was. One copy already written there could not be removed: "Ideas". Your vault still holds every note.',
    );
    const leftTwo = vaultMoveLine(
      { ok: false, skipped: ['b.md'], forked: [], reason: 'unverified', left: ['a.md', 'b.md'] },
      'iCloud Drive',
    );
    expect(leftTwo).not.toMatch(/nothing moved/);
    expect(leftTwo).toMatch(/^iCloud Drive did not show every copied note, so your vault stayed/);
    expect(leftTwo).toMatch(/2 copies already written there could not be removed\./);
    expect(
      vaultMoveLine({ ok: false, skipped: ['a.md'], forked: [], reason: 'unverified' }, 'X'),
    ).toBe('X did not show every copied note, so your vault stayed where it was.');
  });
});

// What "Not saved" may promise (0.4). Only text this device keeps a sealed
// copy of stays until it is discarded: a memory-only hold lasts until the app
// closes, and team text leaves with its account at sign-out, so neither gets
// the card's general promise.
describe('the Not saved card and its standing line', () => {
  const personal = { providerId: 'local', durable: true };
  const team = { providerId: 'org', durable: true };
  const memoryOnly = { providerId: 'org', durable: false };

  it('promises "until you discard it" only when every entry keeps that long', () => {
    expect(vaultHeldKeep(personal)).toBeUndefined();
    expect(vaultHeldHint([personal])).toBe(
      'Text your vault did not take. It stays here until you copy it somewhere safe and discard it.',
    );
    for (const list of [[memoryOnly], [personal, team]]) {
      expect(vaultHeldHint(list)).not.toMatch(/stays here until/);
    }
  });

  it('says a memory-only entry lasts until the app closes, and to copy it now', () => {
    expect(vaultHeldKeep(memoryOnly)).toMatch(/until the app closes/);
    expect(vaultHeldKeep(memoryOnly)).toMatch(/Copy it now/);
    expect(vaultHeldKeep({ providerId: 'local', durable: false })).toMatch(/until the app closes/);
    expect(vaultHeldKeep(team)).toMatch(/sign out/);
  });

  it('the standing line tells the same truth, and says where the list is', () => {
    expect(vaultHeldLine([], true)).toBeUndefined();
    expect(vaultHeldLine([personal], true)).toBe(
      'Some text could not be saved. It is kept under Not saved.',
    );
    expect(vaultHeldLine([personal], false)).toBe(
      'Some text could not be saved. It is kept under Not saved in All notes.',
    );
    const brief = vaultHeldLine([personal, memoryOnly], true)!;
    expect(brief).toMatch(/only until the app closes/);
    expect(brief).toMatch(/copy it now/);
    expect(brief).not.toMatch(/kept under Not saved\.$/);
  });
});

// The read-only Drive card (0.18): its one-tap way off needs the Google
// account, which a sign-out or an expired grant takes away. Then the card
// says so and reconnects before it moves; a build that cannot connect says
// where the notes still are and offers nothing that cannot work.
describe('the read-only Drive card', () => {
  it('moves in one tap while the account is connected (or not yet known)', () => {
    for (const link of ['connected', undefined] as const) {
      expect(vaultDriveCard(link, 'This device')).toEqual({
        action: { kind: 'move', label: 'Move to This device' },
      });
    }
  });

  it('with the account gone, says so and reconnects first, never "try again"', () => {
    const card = vaultDriveCard('disconnected', 'This folder');
    expect(card.action).toEqual({ kind: 'reconnect', label: 'Reconnect Google Drive to move it' });
    expect(card.line).toMatch(/not connected on this device/);
    expect(card.line).toMatch(/This folder/);
    expect(DRIVE_NOT_CONNECTED_MOVE_LINE).toMatch(/nothing moved/);
    expect(DRIVE_NOT_CONNECTED_MOVE_LINE).toMatch(/Reconnect Google Drive/);
    expect(DRIVE_NOT_CONNECTED_MOVE_LINE).not.toMatch(/in a moment/);
  });

  it('on a build that cannot connect, names the folder and opens Google Drive, never a move', () => {
    const card = vaultDriveCard('unconfigured', 'This device');
    expect(card.action).toEqual({ kind: 'open', label: 'Open Google Drive' });
    expect(card.action?.kind).not.toBe('move');
    expect(card.action?.kind).not.toBe('reconnect');
    expect(card.line).toMatch(/still in your Google Drive/);
    expect(card.line).toMatch(/vault\.personal/);
    expect(DRIVE_WEB_URL).toBe('https://drive.google.com/drive/my-drive');
  });

  it('a move refused for want of the account says what will work, not "try again in a moment"', () => {
    expect(vaultDriveMoveRefusal('disconnected')).toBe(DRIVE_NOT_CONNECTED_MOVE_LINE);
    expect(vaultDriveMoveRefusal('unconfigured')).toMatch(/still in your Google Drive/);
    expect(vaultDriveMoveRefusal('unconfigured')).toMatch(/vault\.personal/);
    expect(vaultDriveMoveRefusal('unconfigured')).not.toMatch(/Reconnect/);
    // Connected, the move's own line applies.
    expect(vaultDriveMoveRefusal('connected')).toBeUndefined();
    expect(DRIVE_RECONNECT_FAILED_LINE).toMatch(/nothing moved/);
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
  /Its results stay in your vault/,
  // The claim itself, in any wording: something a run or a save leaves in
  // "the Vault" or "your vault". A routine's note lands in the vault folder
  // on the computer (ROUTINE_NOTES_PLACE), which the Vault room shows only
  // for This folder on the desktop.
  /\b(?:leaves?|lands?|saved|stays?|kept)\b[^.;\n]*\b(?:in|to|into) (?:your|the) vault\b(?! folder on your computer)/i,
];

describe('retired Vault claims', () => {
  it('catches the retired wordings, and the dated-note line that slipped past them', () => {
    const claim = RETIRED[RETIRED.length - 1]!;
    for (const said of [
      'and leaves a dated note in the Vault.',
      'Each run leaves a note in your vault.',
      'Saved in your vault: Crew/x.md',
      'It lands in your vault.',
    ]) {
      expect(said).toMatch(claim);
    }
    expect(`Each run leaves a note in ${ROUTINE_NOTES_PLACE}.`).not.toMatch(claim);
  });

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

  it('no guide card places a routine note in the Vault room', () => {
    for (const card of GUIDE_CARDS) {
      for (const re of RETIRED) expect(card.text, card.id).not.toMatch(re);
      if (/routine/i.test(card.text) && /\bnote\b/i.test(card.text) && card.id !== 'vault') {
        expect(card.text, card.id).toContain(ROUTINE_NOTES_PLACE);
      }
    }
  });

  it('routine notes are placed on the computer, where the scheduler writes them', () => {
    expect(ROUTINE_NOTES_PLACE).toBe('the vault folder on your computer');
    const crew = readFileSync(join(SRC, 'screens/CrewCommandScreen.tsx'), 'utf8');
    expect(crew).toContain('ROUTINE_NOTES_PLACE');
  });
});

// The room shows held text only to the account that typed it (R-19,
// orgvault-15): raw vaultHeld also holds team text of accounts not signed in
// now, so the screen reads the visible list (vaultHeldFor) at every spot.
describe('the Vault screen shows only the held text of the account signed in now', () => {
  const screen = stripComments(readFileSync(join(SRC, 'screens/VaultScreen.tsx'), 'utf8'));

  it('filters through vaultHeldFor, and never renders or counts raw vaultHeld', () => {
    expect(screen).toMatch(/vaultHeldFor\(vaultHeld, /);
    expect(screen).not.toMatch(/held=\{vaultHeld\}/);
    expect(screen).not.toMatch(/\bvaultHeld\.(?:filter|length|map|some|every)\b/);
  });
});

// The resolve sheet (Vault M1, 1.1; Creative Studio 1a): the two sides are
// "yours" and "the other version", and no resolve line names a writer it
// cannot prove, calls a version newer or older, or says "disk".
describe('the resolve sheet says only what it knows (1.1)', () => {
  const BANNED = /\b(agent|obsidian|device|icloud|drive|sync|disk|newer|older|theirs)\b/i;

  // Every resolve line, in every mode and variant.
  function everyResolveLine(): string[] {
    const lines: string[] = [];
    for (const mode of ['edit', 'missing'] as const) {
      for (const when of [undefined, 'at 2:14 PM', 'on Sep 27, 2:14 PM']) {
        const c = vaultResolveCopy(mode, { title: 'Ideas', when });
        lines.push(c.title, c.sub, c.failure);
        if (c.tabs) lines.push(...Object.values(c.tabs));
        if (c.legend) lines.push(...Object.values(c.legend));
        if (c.srPrefix) lines.push(...Object.values(c.srPrefix));
        for (const r of c.rows) lines.push(r.label, r.sub, ...(r.armed ? [r.armed] : []));
      }
      const card = vaultConflictCard(mode);
      lines.push(card.title, card.sub, card.action);
      lines.push(vaultLeaveToast(mode, { title: 'Ideas', copyTitle: 'Ideas (conflict)' }));
    }
    for (const choice of ['both', 'mine', 'theirs', 'discard'] as const) {
      for (const missing of [false, true]) {
        lines.push(vaultResolveToast(choice, { title: 'Ideas', copyTitle: 'X', missing }));
      }
    }
    // Move mode (1d), one pair and several.
    for (const n of [1, 3]) {
      const m = vaultMoveResolveCopy({ title: 'Ideas', copyTitle: 'Ideas (conflict)', i: 1, n });
      lines.push(
        m.title,
        m.sub,
        m.failure,
        m.partial,
        m.closeLine,
        ...(m.counter ? [m.counter] : []),
      );
      lines.push(...Object.values(m.tabs!), ...Object.values(m.legend!));
      lines.push(...Object.values(m.srPrefix!));
      for (const r of m.rows) lines.push(r.label, r.sub, ...(r.armed ? [r.armed] : []));
    }
    lines.push(
      VAULT_RESOLVE_AGAIN,
      VAULT_RESOLVE_SAME,
      VAULT_RESOLVE_FAILED,
      VAULT_GONE_REASON,
      VAULT_NO_COPY_NAME_REASON,
      VAULT_UPDATED_SUFFIX,
      vaultGoneToast('Ideas'),
      vaultReplayCopiesLine(['Ideas (conflict 2026-09-27 1405).md']),
      vaultReplayCopiesLine(['a (conflict 2026-09-27 1405).md', 'b (conflict 2026-09-27 1405).md']),
    );
    return lines;
  }

  it('no resolve line, in any mode or variant, names a writer or a disk', () => {
    const offenders = everyResolveLine().filter((l) => BANNED.test(l));
    expect(offenders).toEqual([]);
  });

  it('the rows read as one question, what do you keep, with Keep both first', () => {
    const edit = vaultResolveCopy('edit', { title: 'Ideas' });
    expect(edit.rows.map((r) => r.label)).toEqual([
      'Keep both',
      'Keep yours',
      'Keep the other version',
    ]);
    expect(edit.rows.map((r) => Boolean(r.primary))).toEqual([true, false, false]);
    // The two that drop a side take a second tap; Keep both never does.
    expect(edit.rows.map((r) => Boolean(r.armed))).toEqual([false, true, true]);
    const gone = vaultResolveCopy('missing', { title: 'Ideas' });
    expect(gone.rows.map((r) => r.label)).toEqual(['Save it again', 'Discard your edits']);
    expect(gone.rows.map((r) => Boolean(r.armed))).toEqual([false, true]);
    expect(gone.tabs).toBeUndefined();
  });

  it('the sub carries the time only when there is one', () => {
    expect(vaultResolveCopy('edit', { title: 'Ideas', when: 'at 2:14 PM' }).sub).toBe(
      '"Ideas" was changed somewhere else at 2:14 PM while you had unsaved edits. Nothing is lost until you choose.',
    );
    expect(vaultResolveCopy('edit', { title: 'Ideas' }).sub).toBe(
      '"Ideas" was changed somewhere else while you had unsaved edits. Nothing is lost until you choose.',
    );
  });

  it("the other version's time shows only when it is after the load and not in the future", () => {
    const loadedAt = Date.parse('2026-09-27T10:00:00Z');
    const now = Date.parse('2026-09-27T10:05:00Z');
    expect(vaultResolveWhen('2026-09-27T09:59:00Z', loadedAt, now)).toBeUndefined();
    expect(vaultResolveWhen('2026-09-27T10:00:00Z', loadedAt, now)).toBeUndefined();
    expect(vaultResolveWhen('2026-09-27T11:00:00Z', loadedAt, now)).toBeUndefined();
    expect(vaultResolveWhen('not a date', loadedAt, now)).toBeUndefined();
    expect(vaultResolveWhen('2026-09-27T10:03:00Z', loadedAt, now)).toMatch(/^(at|on) /);
  });

  it('the replay toast never says offline, and names the note and the copy', () => {
    const one = vaultReplayCopiesLine(['notes/Ideas (conflict 2026-09-27 1405).md']);
    expect(one).toBe(
      'Text you had not saved in "Ideas" is kept as "Ideas (conflict 2026-09-27 1405)", since the note changed elsewhere.',
    );
    expect(one).not.toMatch(/offline/i);
  });
});

describe('the desktop move card and the folder picker (1.3, 1.4)', () => {
  it('the card says the plural and the singular, and the folder notes it keeps', () => {
    const three = vaultFolderOffer(3, 2);
    expect(three.title).toBe('One folder for you and your agent');
    expect(three.body).toBe(
      'Your 3 notes are sealed on this device, where your agent, routines, and Obsidian cannot open them. Move them into the folder your agent already uses, and you all work from the same plain .md files.',
    );
    expect(three.hint).toBe(
      'The sealed copy stays on this device. The 2 notes already in the folder stay as they are.',
    );
    expect(vaultFolderOffer(1, 1).body).toMatch(/^Your note is sealed on this device/);
    expect(vaultFolderOffer(1, 1).hint).toBe(
      'The sealed copy stays on this device. The note already in the folder stays as it is.',
    );
    // An empty folder, or one that could not be counted, says only what holds.
    expect(vaultFolderOffer(2, 0).hint).toBe('The sealed copy stays on this device.');
    expect(vaultFolderOffer(2, undefined).hint).toBe('The sealed copy stays on this device.');
    expect(three.primary).toBe('Move to This folder');
    expect(three.busy).toBe('Moving your notes…');
    expect(three.decline).toBe('Keep it on this device');
    expect(three.link).toBe('Use a different folder…');
    expect(three.declineToast).toBe(
      'Your vault stays on this device. Where it lives can move it any time.',
    );
    // Its quiet button is a decision, never a "not now" that promises a return.
    expect(three.decline).not.toMatch(/not now/i);
    expect(three.lead).toBeUndefined();
  });

  it('the one return says what changed since the decline', () => {
    expect(vaultFolderOffer(3, 9, { display: '~/OSCode/Vault', newSince: 4 }).lead).toBe(
      '~/OSCode/Vault has 4 new notes since you kept your vault on this device.',
    );
    expect(vaultFolderOffer(3, 9, { display: '~/OSCode/Vault', newSince: 1 }).lead).toBe(
      '~/OSCode/Vault has a new note since you kept your vault on this device.',
    );
  });

  it('the card is offered only where the vault is sealed on the desktop', () => {
    // The card's own sentence is about a Local vault the agent cannot open:
    // only the desktop's Local copy points elsewhere for the agent.
    expect(vaultCopy('electron', 'local').agentElsewhere).toBe(DESKTOP_AGENT_LINE);
    for (const on of ['ios', 'web'] as const) {
      expect(vaultCopy(on, 'local').agentElsewhere).not.toBe(DESKTOP_AGENT_LINE);
    }
    expect(vaultCopy('electron', 'files').agentElsewhere).toBeUndefined();
    // While it shows, the lead drops its own pointer to This folder.
    const c = vaultCopy('electron', 'local');
    expect(vaultLead(c)).toContain(DESKTOP_AGENT_LINE);
    expect(vaultLead(c, { offerShown: true })).not.toContain(DESKTOP_AGENT_LINE);
    expect(vaultLead(c, { offerShown: true })).toBe(c.storage);
  });

  it('an empty Local vault that repoints says where it is now', () => {
    expect(vaultRepointToast('~/OSCode/Vault')).toBe(
      'Your vault now uses ~/OSCode/Vault, the same folder as your agent and routines.',
    );
  });

  it("the picker row's words never render off the desktop (the phone case)", () => {
    expect(vaultPickerRow('ios')).toBeUndefined();
    expect(vaultPickerRow('web')).toBeUndefined();
    expect(vaultPickerRow('electron')).toEqual({
      label: 'Use a folder…',
      sub: 'Pick another folder, an existing Obsidian vault included. Notes are not copied.',
      busy: 'Opening',
    });
    // And This folder itself is not offered on the phone at all.
    expect(vaultOffersProvider('ios', 'files')).toBe(false);
  });

  it("the open-folder button uses each platform's own words", () => {
    expect(vaultRevealLabel('darwin')).toBe('Open in Finder');
    expect(vaultRevealLabel('win32')).toBe('Open in File Explorer');
    expect(vaultRevealLabel('linux')).toBe('Open folder');
    expect(VAULT_OBSIDIAN_HOWTO).toBe(
      'To open it in Obsidian, choose Open folder as vault there and pick this folder.',
    );
    expect(VAULT_FOLDER_MISSING_LINE).toBe(
      'This folder is not there right now. If it is on a drive, connect the drive, or use another folder.',
    );
    expect(VAULT_OPEN_CHATS_LINE).toBe(
      'New chats use this folder. Chats already open finish in the old one.',
    );
  });

  it('every refusal has one plain sentence, on each platform', () => {
    const reasons = [
      'root',
      'home',
      'home-ancestor',
      'osc-home',
      'managed-holds',
      'managed-inside',
      'not-writable',
      'denied',
      'unreadable',
      'save-failed',
    ];
    for (const os of ['darwin', 'win32', 'linux']) {
      for (const r of reasons) {
        const line = vaultPickRefusal(r, os);
        expect(line, `${os}/${r}`).toMatch(/^[A-Za-z].*\.$/);
        expect(line, `${os}/${r}`).not.toMatch(/undefined/);
      }
    }
    expect(vaultPickRefusal('denied', 'darwin')).toBe(
      'macOS did not let OpenShore open that folder. Allow it in System Settings, Privacy & Security, Files and Folders, then pick it again.',
    );
    expect(vaultPickRefusal('denied', 'linux')).not.toMatch(/macOS/);
    expect(vaultPickRefusal('save-failed', 'linux')).toBe(
      'Could not save your folder choice, so nothing changed.',
    );
  });

  it("the relative-path warning is the engine's own words, then the fix here", () => {
    expect(vaultWarningLine('vault.dir "notes" is not an absolute path.')).toBe(
      'vault.dir "notes" is not an absolute path. Or use a folder below, which saves a full path.',
    );
  });

  it('text typed in an earlier folder names that folder', () => {
    expect(vaultEarlierFolderHeld('~/Notes')).toEqual({
      place: 'Personal vault, earlier folder ~/Notes',
      reason:
        'Typed in ~/Notes before your vault moved to another folder, so it was not saved there.',
    });
  });

  it('the facts say what the folder holds, and an empty one why other files do not show', () => {
    const base = { notes: 0, capped: false, otherFiles: 0, obsidian: false };
    expect(vaultFolderFacts(base)).toBe('No notes here yet.');
    expect(vaultFolderFacts({ ...base, otherFiles: 3 })).toBe(
      'No notes here yet. The 3 other files here stay as they are, since the Vault shows only .md notes.',
    );
    expect(vaultFolderFacts({ ...base, notes: 1 })).toBe('A folder with 1 note.');
    expect(vaultFolderFacts({ ...base, notes: 12, obsidian: true })).toBe(
      "An Obsidian vault with 12 notes. Obsidian's own settings are left alone.",
    );
    expect(vaultFolderFacts({ ...base, notes: 10_000, capped: true, obsidian: true })).toMatch(
      /more than 10,000 notes/,
    );
  });

  it('a folder in or around Obsidian vaults asks one question, recommended first', () => {
    const inside = vaultFolderQuestion('Projects', { obsidian: false, inside: { name: 'Brain' } });
    expect(inside?.line).toBe('"Projects" is a folder inside your Obsidian vault "Brain".');
    expect(inside?.choices.map((c) => [c.label, c.tone])).toEqual([
      ['Use all of "Brain"', 'primary'],
      ['Keep just "Projects"', 'quiet'],
    ]);
    const one = vaultFolderQuestion('Obsidian', { obsidian: false, holds: ['Brain'] });
    expect(one?.choices[0]).toMatchObject({ label: 'Use "Brain"', choice: { to: 'child' } });
    const many = vaultFolderQuestion('Obsidian', {
      obsidian: false,
      holds: ['A', 'B'],
      holdsMore: 11,
    });
    expect(many?.line).toBe('This folder holds 13 Obsidian vaults. Which one is your vault?');
    expect(many?.hint).toBe(
      '11 more are inside. Use Choose a folder to pick one of them directly.',
    );
    // A vault is a vault, even inside another one: no question.
    expect(vaultFolderQuestion('Brain', { obsidian: true, inside: { name: 'X' } })).toBeUndefined();
    expect(
      vaultFolderQuestion('Documents', { obsidian: false, icloudRoot: true })?.choices[0]?.label,
    ).toBe('Use vault.personal');
  });

  it('a synced folder gets one neutral line that never names Obsidian', () => {
    for (const kind of ['icloud', 'dropbox', 'onedrive', 'gdrive', 'box', 'other']) {
      const line = vaultCloudLine(kind)!;
      expect(line).toMatch(/keeps this folder in sync/);
      expect(line).not.toMatch(/obsidian/i);
    }
    expect(vaultCloudLine('other')).toMatch(/^A sync service keeps/);
    expect(vaultCloudLine(undefined)).toBeUndefined();
    // OpenShore's own iCloud vault carries its caveat until 2.1 ships.
    expect(vaultIcloudCasOnPhone).toBe(false);
    expect(vaultCloudLine('icloud-openshore')).toMatch(/one device at a time/);
    expect(vaultCloudLine('icloud-openshore')).not.toMatch(/obsidian/i);
  });

  it('the result block offers Go back and, from This device, the move', () => {
    const r = vaultPickResultCopy({
      display: '~/Brain',
      previous: { display: '~/OSCode/Vault' },
      fromLocal: { notes: 3 },
      large: true,
    });
    expect(r.heading).toBe('Your vault is now ~/Brain.');
    expect(r.back).toEqual({
      label: 'Go back to ~/OSCode/Vault',
      toast: 'Your vault is back in ~/OSCode/Vault.',
    });
    expect(r.move?.label).toBe('Move 3 notes here');
    expect(r.large).toBe('In a vault this size, Linked mentions load when you ask for them.');
    expect(vaultPickResultCopy({ display: '~/B', large: false }).back).toBeUndefined();
  });

  it("Harbor Lite's guide says where the picker is", () => {
    expect(vaultGuideText()).toContain(VAULT_GUIDE_PICKER_LINE);
    expect(VAULT_GUIDE_PICKER_LINE).toBe(
      'On your computer, Use a folder… in Where it lives points the vault at any folder, an existing Obsidian vault included.',
    );
  });
});
