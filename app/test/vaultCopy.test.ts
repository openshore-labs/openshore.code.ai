// Copy says only what is true today (0.19). The Vault's lines come from one
// map keyed by platform and storage (lib/vaultCopy.ts). This renders every
// pair, on an unpaired device, a paired one, and a member's, through every
// surface that reads the map (the room's lead, the storage sheet, the
// empty-vault ramp, the welcome note, the move toast) and fails on a false
// claim:
// - the agent reads and writes these notes only in This folder on the
//   desktop, the one folder the agent's vault is; everywhere else the only
//   agent line is the platform's own pointer to where its vault really is,
//   said on a phone only once a computer is paired (an unpaired phone or the
//   web says instead, in the empty-vault ramp only, how its own chats use
//   the notes; maintainer, D20, 2026-10-07), and a member on someone else's
//   computer is promised nothing;
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
import { filesAppPath, thisDeviceNoun } from '../src/lib/deviceNoun.js';
import {
  VAULT_GONE_REASON,
  VAULT_UNSEEN_DRAFT_REASON,
  VAULT_NO_COPY_NAME_REASON,
  VAULT_RESOLVE_AGAIN,
  VAULT_RESOLVE_FAILED,
  VAULT_RESOLVE_SAME,
  VAULT_UPDATED_SUFFIX,
  vaultConflictCard,
  vaultGoneManyLine,
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
  ROUTINE_NOTES_PLACE,
  VAULT_MODELS_LINE,
  VAULT_MODELS_TITLE,
  VAULT_PRIVATE_OFF_CLOUD,
  VAULT_PRIVATE_OFF_MARKED,
  VAULT_CARRY_CAVEAT,
  VAULT_COMMAND_CAVEAT,
  VAULT_EXCLUDE_SUB,
  VAULT_LOCAL_ONLY_SUB,
  VAULT_SETTINGS_FIELD_LABELS,
  VAULT_SETTINGS_ROWS,
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
  vaultBringLine,
  vaultPickerRow,
  vaultRepointToast,
  vaultRevealLabel,
  vaultWarningLine,
  vaultGuideText,
  vaultHeldHint,
  vaultHeldKeep,
  vaultHeldLine,
  vaultLead,
  vaultLoadFailed,
  vaultMoveLine,
  vaultOffersProvider,
  vaultOnboard,
  vaultSheetLine,
  vaultWelcomeNote,
  HUB_AGENT_LINE,
  HUB_AWAY_LINE,
  HUB_AWAY_NOT_KEPT,
  HUB_AWAY_READ_ONLY,
  HUB_PAIR_LINE,
  HUB_PAIRING_REFUSED,
  HUB_REPOINT_TOAST,
  HUB_UPDATE_LINE,
  hubMoveOffer,
  hubTooLargeLine,
  VAULT_EVAL_CLAIMS_UNLOCKED,
  VAULT_TRASH_TEAM_LINE,
  vaultCapLine,
  vaultTrashLead,
  VAULT_TEAM_FREE_MIB,
  VAULT_TEAM_FULL,
  VAULT_TEAM_TRASH_DAYS,
  vaultFolderMoveRefused,
  vaultRefusedLine,
  vaultGoneLine,
  vaultLinksGoneLine,
  vaultRenameToast,
  vaultRestorePartial,
  type VaultCopyOpts,
  type VaultCopyProvider,
} from '../src/lib/vaultCopy.js';
import { GUIDE_CARDS } from '../src/lib/guideCards.js';
import { FREE_SPACE_REFUSAL } from './fixtures/fakeOrgVaultServer.js';
import { PROVIDER_ROSTER } from '../src/lib/gitos/providers.js';
import { WAYFINDING } from '../src/lib/currents.js';

// An en or an em dash, built from char codes so this file holds neither.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
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

// The pairs where the agent's folder IS the vault on screen: This folder on
// the desktop, and Your computer on a phone paired to its own computer (the
// hub serves the owner the same folder; Vault M5, tech review J9).
const agentsFolder = (p: Pair) =>
  (p.on === 'electron' && p.id === 'files') ||
  (p.on !== 'electron' && p.id === 'hub' && p.device === 'paired');
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
  hub: [],
};

describe('the Vault copy map (0.19)', () => {
  it('covers every platform, storage, and device', () => {
    expect(PAIRS).toHaveLength(3 * 6 * 3);
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
      // phone's once a computer is paired, never the other's.
      const pointer = p.on === 'electron' ? DESKTOP_AGENT_LINE : PHONE_AGENT_LINE;
      if (c.agentElsewhere) expect(c.agentElsewhere, where).toBe(pointer);
      for (const text of rendered(p)) {
        let rest = text.replace(/\s+/g, ' ');
        for (const allowed of [pointer, ...NEUTRAL_AGENT_TITLES]) {
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
      // Your computer, paired, says the agent line itself, not a pointer.
      const says = p.device === 'paired' && p.id !== 'org' && p.id !== 'hub';
      expect(c.agentElsewhere, where).toBe(says ? PHONE_AGENT_LINE : undefined);
      // An unpaired phone or the web points at no computer (D20, 2026-10-07,
      // which moved the pointer to the paired state only). It says how its
      // own chats use the notes instead, in the empty-vault ramp only: never
      // in the lead or the storage sheet, and never with the agent's name.
      // Your computer unpaired cannot be read, so it says neither.
      const unpaired = p.device === 'unpaired' && p.id !== 'org' && p.id !== 'hub';
      if (agentsFolder(p)) continue;
      expect(c.models, where).toBe(unpaired ? VAULT_MODELS_LINE : undefined);
      const ramp = vaultOnboard(p.on, p.id, optsOf(p));
      if (unpaired) {
        expect(vaultLead(c), where).not.toMatch(/agent|pin/i);
        expect(vaultSheetLine(c), where).not.toMatch(/agent|pin/i);
        expect(
          ramp.points.find((pt) => pt.glyph === 'agent'),
          where,
        ).toEqual({ glyph: 'agent', title: VAULT_MODELS_TITLE, sub: VAULT_MODELS_LINE });
        for (const text of rendered(p)) expect(text, where).not.toMatch(/\bagents?\b|\bpair/i);
        continue;
      }
      // Paired or a member: the models point is the unpaired ramp's alone.
      expect(
        ramp.points.some((pt) => pt.title === VAULT_MODELS_TITLE),
        where,
      ).toBe(false);
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

  it('Local says it is sealed here and not a folder, except on the phone, where it is the OpenShore folder; the team vault says it is shared, not Obsidian', () => {
    for (const on of VAULT_COPY_PLATFORMS) {
      // On the iPhone and the iPad, This device is plain files in the app's
      // OpenShore folder (folder and sync plan, M2), and says where Files
      // shows them; it never claims Obsidian or a seal there.
      if (on === 'ios') {
        const line = vaultCopy(on, 'local').storage;
        expect(line).toBe(
          `Plain .md files in the OpenShore folder on ${thisDeviceNoun()}, kept out of iCloud Backup unless you include them in Settings, Chats. The Files app shows them under ${filesAppPath('Vault')}.`,
        );
        expect(line).toMatch(/On My (iPhone|iPad) > OpenShore > Vault\.$/);
        expect(line).not.toMatch(/sealed|not a folder|Obsidian/i);
      } else {
        expect(vaultCopy(on, 'local').storage).toBe(
          'Sealed on this device. Not a folder other apps can open.',
        );
      }
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

  // design review 3c: the desktop's Keep as plain files row is retired as a
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
    // The device in hand is named through thisDeviceNoun (2026-10-07), so an
    // iPad reads its own name; the suite runs as a phone.
    expect(icloud.pending).toBe(
      'Sign in to iCloud and turn on iCloud Drive in Settings on this phone to use it.',
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

  // The empty ramp says where the notes live and how the agent fits, so the
  // lead above it steps aside rather than say a sentence twice (Creative
  // Studio and copy review, 2026-10-07). Nothing it drops goes unsaid.
  it('steps the lead aside while the ramp says it, and loses no sentence', () => {
    for (const p of PAIRS.filter((x) => x.id !== 'org')) {
      const c = vaultCopy(p.on, p.id, optsOf(p));
      const where = nameOf(p);
      expect(vaultLead(c, { ramp: true }), where).toBe('');
      const ramp = vaultOnboard(p.on, p.id, optsOf(p));
      const said = [ramp.lead, ...ramp.points.map((pt) => pt.sub)];
      for (const s of sentences(vaultLead(c))) {
        expect(
          said.some((text) => text.includes(s)),
          `${where}: ${s}`,
        ).toBe(true);
      }
    }
  });

  // A vault on this device, or on the person's own computer, did not fail
  // for want of a connection, so only a network storage is told to check one
  // (copy review, 2026-10-07).
  it('tells only a network storage to check its connection when the vault does not load', () => {
    for (const id of ['local', 'files', 'hub'] as const) {
      const { title, sub } = vaultLoadFailed(id);
      expect(title.length, id).toBeGreaterThan(10);
      expect(sub, id).not.toMatch(/connection/i);
      expect(sub, id).toMatch(/Try again/);
    }
    for (const id of ['icloud', 'gdrive', 'org', undefined] as const) {
      expect(vaultLoadFailed(id).sub, String(id)).toMatch(/Check your connection/);
    }
  });
});

// Your computer (Vault M5, tech review J8, J9): the paired computer's vault. Every
// line says it holds only while the computer is on, a member is told whose
// computer holds their notes and nothing more, and the desktop, where the
// same folder is This folder, is never offered it.
describe('Your computer (the hub vault)', () => {
  const allHubLines = () => [
    ...PAIRS.filter((p) => p.id === 'hub').flatMap(rendered),
    HUB_AWAY_LINE,
    HUB_AWAY_READ_ONLY,
    HUB_AWAY_NOT_KEPT,
    HUB_PAIR_LINE,
    HUB_PAIRING_REFUSED,
    HUB_REPOINT_TOAST,
    HUB_UPDATE_LINE,
    hubMoveOffer(1),
    hubMoveOffer(12),
    hubTooLargeLine(5 * 1024 * 1024),
  ];

  it('says "while it is on" wherever it says where the notes are', () => {
    for (const on of ['ios', 'web'] as const) {
      for (const opts of [{}, { paired: true }]) {
        expect(vaultCopy(on, 'hub', opts).storage).toBe(
          'Your computer, while it is on. Plain .md files in the vault folder there.',
        );
      }
    }
    expect(HUB_REPOINT_TOAST).toMatch(/while it is on/);
    expect(hubMoveOffer(3)).toMatch(/while your computer is on/);
  });

  it('never promises the computer is always there', () => {
    for (const line of allHubLines()) expect(line).not.toMatch(/always on|always available|24\/7/i);
  });

  it('the owner on a paired phone gets the agent line This folder says on the desktop', () => {
    const c = vaultCopy('ios', 'hub', { paired: true });
    expect(c.agent).toBe(HUB_AGENT_LINE);
    expect(HUB_AGENT_LINE).toBe(vaultCopy('electron', 'files').agent);
    expect(c.routines).toBe('Routines leave their notes here.');
    expect(c.agentElsewhere).toBeUndefined();
  });

  it('a member reads one line naming the computer, and nothing more', () => {
    const named = vaultCopy('ios', 'hub', { paired: true, hubMember: true, hubName: 'Studio Mac' });
    expect(named).toEqual({ storage: 'Your notes on Studio Mac.' });
    const unnamed = vaultCopy('ios', 'hub', { paired: true, hubMember: true });
    expect(unnamed).toEqual({ storage: 'Your notes on the computer you paired.' });
  });

  it('is offered on the phone and never on the desktop, and says nothing of Obsidian', () => {
    expect(vaultOffersProvider('ios', 'hub')).toBe(true);
    expect(vaultOffersProvider('electron', 'hub')).toBe(false);
    for (const line of allHubLines()) expect(line).not.toMatch(/Obsidian/);
  });

  it('the away line is the one the memo fixed, and the roster row agrees on pairing', () => {
    expect(HUB_AWAY_LINE).toBe('Your computer is off. Changes wait here and save when it is back.');
    const row = PROVIDER_ROSTER.find((p) => p.id === 'hub')!;
    expect(row.label).toBe('Your computer');
    expect(row.pending).toBe(HUB_PAIR_LINE);
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

// The one private-notes promise (D5) says what the code does (the privacy
// review, sp-vaultws, 2026-10-08). The pack, the vault tools and the
// workspace's own tools keep a private note off a cloud model; a command can
// read any file, so every line that makes the promise names the one way
// around it: a command the person runs (the terminal, the chat's command
// lane, whose output a model may read) or allows the agent to run. The
// engine's card for a command near the vault says so too.
describe('the private-notes promise', () => {
  it('names the one way a private note can reach a cloud model', () => {
    expect(VAULT_COMMAND_CAVEAT).toBe('unless a command you run or allow reads them');
    // OpenShore is the subject, and the person's own reach is a plain second
    // sentence, never an "unless" inside the promise (UX and copy review, 2026-10-08,
    // A). "Allow", not "approve": Accept edits lets a change land unasked.
    expect(VAULT_CARRY_CAVEAT).toBe(
      'A command you run or allow, or a change you allow, can still carry their words to a cloud model.',
    );
    expect(VAULT_PRIVATE_OFF_CLOUD).toBe(
      'OpenShore never sends private notes to a cloud model. A command you run or allow, or a change you allow, can still carry their words to one.',
    );
    // Said of a model at an address marked as passing requests on (bring
    // your own keys, 2026-10-09), the caveat after it as its own sentence.
    expect(VAULT_PRIVATE_OFF_MARKED).toBe(
      'OpenShore never sends it private notes. A command you run or allow, or a change you allow, can still carry their words to a cloud model.',
    );
    expect(VAULT_MODELS_LINE).toBe(
      'Pin a note to a project and every chat there starts with it. OpenShore never sends private notes to a cloud model. A command you run or allow, or a change you allow, can still carry their words to one.',
    );
    expect(VAULT_LOCAL_ONLY_SUB).toBe(
      'A local model may read these, and OpenShore never sends them to a cloud model. A command you run or allow, or a change you allow, can still carry their words to one.',
    );
    // One noun for the setting and its conflict line: "Private notes".
    expect(VAULT_SETTINGS_ROWS.localOnly).toBe('Private notes');
    expect(VAULT_SETTINGS_FIELD_LABELS['localOnly.paths']).toBe('Private notes');
    expect(VAULT_SETTINGS_FIELD_LABELS['localOnly.tags']).toBe('Private notes');
    expect(VAULT_EXCLUDE_SUB).toBe(
      'Models never see these, in any chat, unless a command you run or allow reads them.',
    );
    const loop = readFileSync(resolve(ROOT, '../os-code/src/core/agent/loop.ts'), 'utf8');
    expect(loop).toContain(
      'This command can read notes in your vault that stay on this computer, and what it prints goes to a cloud model.',
    );
  });

  it('the unscoped wording survives nowhere in the app', () => {
    const retired = [
      /never reach a cloud model\./i,
      /unless a command you allow reads/i,
      /Nothing here goes to a cloud model\./i,
      /Models never see these, in any chat\./i,
      /\(never a private note\)/i,
      /A private note goes only to one on your own network\./i,
      // The "unless" promise and the setting's old name (UX and copy review,
      // 2026-10-08, A).
      /run or allow a command or change that carries them/i,
      /A cloud model never does/i,
      /Notes that stay on this computer/,
    ];
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const line of retired) if (line.test(text)) hits.push(`${relative(ROOT, file)} ${line}`);
    }
    expect(hits).toEqual([]);
  });
});

// Vault M6 retired lines (UX review X8, X14): with Trash real, a delete no longer
// reads "Note deleted." and never asks the old two-tap question; a permanent
// delete says "for good". The reader shows embeds, so "not supported" goes.
const M6_RETIRED = [
  /Note deleted\./,
  /Really delete\? Tap to confirm\./,
  /embed not supported yet/,
];

describe('retired Vault M6 lines', () => {
  it('none survives anywhere in the app', () => {
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const re of M6_RETIRED) {
        if (re.test(text)) hits.push(`${relative(ROOT, file)}: ${re}`);
      }
    }
    expect(hits).toEqual([]);
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

// The resolve sheet (Vault M1, 1.1; design review 1a): the two sides are
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
      vaultGoneManyLine(3),
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

  it('Bring offers the notes of the folder before, in the UX review words', () => {
    const three = vaultPickResultCopy({
      display: '~/Brain',
      previous: { display: '~/OSCode/Vault', notes: 3 },
      large: false,
    });
    expect(three.bring).toEqual({
      label: 'Bring 3 notes from ~/OSCode/Vault',
      sub: 'Copies them here. Nothing here is replaced, and the originals stay where they are.',
      busy: 'Bringing your notes',
    });
    expect(
      vaultPickResultCopy({
        display: '~/Brain',
        previous: { display: '~/OSCode/Vault', notes: 1 },
        large: false,
      }).bring?.label,
    ).toBe('Bring 1 note from ~/OSCode/Vault');
    for (const notes of [0, undefined]) {
      expect(
        vaultPickResultCopy({
          display: '~/Brain',
          previous: { display: '~/OSCode/Vault', ...(notes === undefined ? {} : { notes }) },
          large: false,
        }).bring,
      ).toBeUndefined();
    }
  });

  it('what Bring did, said plainly', () => {
    const prev = '~/OSCode/Vault';
    const ok = { ok: true, moved: ['a.md'], skipped: [], forked: [] };
    expect(vaultBringLine(ok, prev)).toBe(
      'Your notes from ~/OSCode/Vault are here now. The originals stay there.',
    );
    expect(
      vaultBringLine(
        { ...ok, forked: [{ from: 'b.md', to: 'b (conflict 2026-09-27 1405).md' }] },
        prev,
      ),
    ).toBe(
      'Your notes from ~/OSCode/Vault are here now. The originals stay there. "b" was already there with different text, so the one you moved is beside it as "b (conflict 2026-09-27 1405)".',
    );
    expect(
      vaultBringLine(
        { ok: false, moved: ['a.md'], skipped: ['b.md'], forked: [], reason: 'copy-failed' },
        prev,
      ),
    ).toBe(
      'Your notes from ~/OSCode/Vault are here now, except one that could not be copied and is still only there. The originals stay there. Try again to bring it.',
    );
    expect(
      vaultBringLine(
        { ok: false, moved: [], skipped: ['a.md', 'b.md'], forked: [], reason: 'copy-failed' },
        prev,
      ),
    ).toBe(
      'Could not copy your notes from ~/OSCode/Vault, so nothing was brought. Try again in a moment.',
    );
    expect(
      vaultBringLine(
        {
          ok: false,
          moved: ['a.md', 'b.md'],
          skipped: [],
          forked: [],
          capped: true,
          reason: 'capped',
        },
        prev,
      ),
    ).toBe(
      'The first 2 notes from ~/OSCode/Vault are here now. The rest are still only there, since Bring stops at 10,000 notes. The originals stay there.',
    );
    expect(
      vaultBringLine({ ok: false, moved: [], skipped: [], forked: [], reason: 'nested' }, prev),
    ).toBe('One of these folders is inside the other, so nothing was brought.');
    expect(
      vaultBringLine({ ok: false, moved: [], skipped: [], forked: [], reason: 'same' }, prev),
    ).toBe('Your vault already uses ~/OSCode/Vault, so there is nothing to bring.');
    expect(
      vaultBringLine(
        { ok: false, moved: [], skipped: [], forked: [], reason: 'unavailable' },
        prev,
      ),
    ).toBe('~/OSCode/Vault or your vault folder is not there right now, so nothing was brought.');
    expect(vaultBringLine(undefined, prev)).toBe(
      'Could not bring your notes from ~/OSCode/Vault. Try again in a moment.',
    );
  });

  it("Harbor Lite's guide says where the picker is", () => {
    expect(vaultGuideText()).toContain(VAULT_GUIDE_PICKER_LINE);
    expect(VAULT_GUIDE_PICKER_LINE).toBe(
      'On your computer, Use a folder… in Where it lives points the vault at any folder, an existing Obsidian vault included.',
    );
  });
});

describe('the save chip and conflict badges (M2 2.2)', () => {
  it('says Saved, Saving, or kept on this device with a count and Try again', async () => {
    const { vaultSaveChip } = await import('../src/lib/vaultCopy.js');
    expect(vaultSaveChip('saved', 0)).toEqual({ label: 'Saved' });
    expect(vaultSaveChip('saving', 3)).toEqual({ label: 'Saving' });
    expect(vaultSaveChip('offline', 1)).toEqual({
      label: 'Offline, kept on this device',
      count: '1 note waiting',
      retry: 'Try again',
    });
    expect(vaultSaveChip('offline', 4).count).toBe('4 notes waiting');
    // No count it cannot back up.
    expect(vaultSaveChip('offline', 0)).not.toHaveProperty('count');
    // Refused for good and set aside: Not saved, with no count and no Try
    // again, since trying again meets the same refusal (E18).
    expect(vaultSaveChip('held', 0)).toEqual({ label: 'Not saved' });
    expect(vaultSaveChip('held', 2)).toEqual({ label: 'Not saved' });
  });

  it('says Offline only when the connection is why it waits (E42)', async () => {
    const { vaultSaveChip, vaultSaveWaitToast, vaultCreateWaitToast, VAULT_TEAM_NOT_READY } =
      await import('../src/lib/vaultCopy.js');
    expect(vaultSaveChip('offline', 1, 'offline').label).toBe('Offline, kept on this device');
    for (const kind of ['not-ready', 'server'] as const) {
      const chip = vaultSaveChip('offline', 1, kind);
      expect(chip.label).not.toMatch(/offline/i);
      expect(chip.label).toMatch(/kept on this device$/);
      expect(chip).toMatchObject({ count: '1 note waiting', retry: 'Try again' });
      for (const line of [vaultSaveWaitToast(kind), vaultCreateWaitToast(kind)]) {
        expect(line).not.toMatch(/offline|connection|try again/i);
        expect(line).not.toMatch(DASHES);
        expect(line).toMatch(/kept|saves when/);
      }
    }
    expect(vaultSaveWaitToast('not-ready')).toBe(VAULT_TEAM_NOT_READY);
    // The connection's own lines are what they always were.
    expect(vaultSaveWaitToast('offline')).toBe(
      'Could not save to your vault. Your text is kept and saves when the connection returns.',
    );
    expect(vaultCreateWaitToast('offline')).toBe(
      'Working offline. This note saves when your storage reconnects.',
    );
  });

  it('badges exactly the keep-both names the store and the server make', async () => {
    const { isConflictCopy: isVaultConflictCopy } = await import('../src/lib/vault.js');
    const { vaultConflictCopyPath } = await import('os-code/protocol');
    const at = new Date('2026-09-27T14:05:00Z');
    expect(isVaultConflictCopy(vaultConflictCopyPath('ideas/Plan.md', at))).toBe(true);
    expect(isVaultConflictCopy(vaultConflictCopyPath('Plan.md', at, 3))).toBe(true);
    expect(isVaultConflictCopy('Plan (conflict 2026-09-27 1405).md')).toBe(true);
    expect(isVaultConflictCopy('Plan.md')).toBe(false);
    expect(isVaultConflictCopy('Conflict resolution.md')).toBe(false);
    expect(isVaultConflictCopy('Plan (conflict).md')).toBe(false);
  });
});

// Vault M7 (UX review R2, Y7, Y8, Y17; D12, tenet 2): nothing in the M7 copy claims a
// speed, a quality, a memory, or "always", and the handoff never "picks up
// where you left off" until its eval passes. Swept over every string literal
// inside the M7 fences of vaultCopy.ts, so each stream's lines are covered the
// moment they land.
//
// Vault M8 (8.4, D12): the claims wait on the number. EVAL_CLAIMS are the
// words only a recorded eval may unlock (the 4.8 pack and 5.4 handoff
// results, gated by VAULT_EVAL_CLAIMS_UNLOCKED in the copy map); NEVER holds
// whatever the evals say ("always" is not a measurement). M7_BANNED is both.
const EVAL_CLAIMS = [
  /\b(faster|slower|quicker|cheaper|saves? (?:time|money)|better|smarter|remembers?|learns?)\b/i,
  /picks? up where (?:you|it) left off/i,
];
const NEVER = [/\balways\b/i];
const M7_BANNED = [...EVAL_CLAIMS, ...NEVER];
/** What the sweeps refuse today: everything until the eval flag is set, then
 *  only NEVER. */
const BANNED_NOW = VAULT_EVAL_CLAIMS_UNLOCKED ? NEVER : M7_BANNED;

function m7Sections(src: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /\/\/ ---- (M7 [^\n]*?) begin ----\n([\s\S]*?)\/\/ ---- \1 end ----/g;
  for (let m = re.exec(src); m; m = re.exec(src)) out.push({ name: m[1]!, body: m[2]! });
  return out;
}

function stringLiterals(code: string): string[] {
  const out: string[] = [];
  const re = /'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`/g;
  for (let m = re.exec(code); m; m = re.exec(code)) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

describe('Vault M7 copy (M7_BANNED)', () => {
  const src = readFileSync(join(SRC, 'lib/vaultCopy.ts'), 'utf8');
  const sections = m7Sections(src);

  it('keeps one fence per stream, each opened and closed once', () => {
    expect(sections.map((s) => s.name)).toEqual([
      'M7 stream E',
      'M7 stream F',
      'M7 stream G',
      'M7 wave 2',
    ]);
  });

  it('no M7 string claims a speed, a quality, a memory, or always', () => {
    const hits: string[] = [];
    for (const { name, body } of sections) {
      for (const s of stringLiterals(stripComments(body))) {
        for (const re of BANNED_NOW) if (re.test(s)) hits.push(`${name}: ${s}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the sweep can fail', () => {
    const fake =
      "// ---- M7 stream X begin ----\nconst A = 'Handoff picks up where you left off.';\n// ---- M7 stream X end ----";
    const found = m7Sections(fake).flatMap((s) => stringLiterals(s.body));
    expect(found.some((s) => M7_BANNED.some((re) => re.test(s)))).toBe(true);
  });
});

// Vault M8 (8.4): the same refusal over the WHOLE copy map, every section and
// not only the M7 fences, and over the literal strings of the Vault's own
// screens and components (attributes, JSX text, and any literal a component
// renders), so a claim cannot slip in beside the map either.
const VAULT_UI_FILES = (): string[] => [
  join(SRC, 'lib/vaultCopy.ts'),
  join(SRC, 'lib/vaultSettingsSheetCopy.ts'),
  join(SRC, 'screens/VaultScreen.tsx'),
  ...walk(join(SRC, 'components/vault')),
  ...readdirSync(join(SRC, 'components'))
    .filter((f) => /^(?:Vault|ProjectVault)\w*\.tsx$/.test(f))
    .map((f) => join(SRC, 'components', f)),
];

/** A literal a person could read: words (a space) or a capitalized word. A
 *  lowercase single token (`'always'` as a setting's value, a class name) is
 *  code, not copy. */
const readable = (s: string) => /[A-Za-z]/.test(s) && (/\s/.test(s.trim()) || /^[A-Z]/.test(s));

/** JSX text between tags, the copy a component writes inline. */
function jsxText(code: string): string[] {
  return [...code.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1]!.trim());
}

function uiCopyOf(file: string): string[] {
  const code = stripComments(readFileSync(file, 'utf8'));
  return [...stringLiterals(code), ...jsxText(code)].filter(readable);
}

describe('Vault copy waits on the eval (M8 8.4, D12)', () => {
  it('the flag lives in the copy map, off, naming the results it waits on', () => {
    const src = readFileSync(join(SRC, 'lib/vaultCopy.ts'), 'utf8');
    expect(src).toMatch(/^export const VAULT_EVAL_CLAIMS_UNLOCKED = (?:false|true);$/m);
    const doc = src.slice(0, src.indexOf('export const VAULT_EVAL_CLAIMS_UNLOCKED'));
    const comment = doc.slice(doc.lastIndexOf('/**'));
    expect(comment).toMatch(/4\.8/);
    expect(comment).toMatch(/5\.4/);
    // Off today: no 4.8 or 5.4 result is recorded yet. Flipping it is a
    // deliberate edit here too, made with the numbers in DECISIONS.
    expect(VAULT_EVAL_CLAIMS_UNLOCKED).toBe(false);
  });

  it('sweeps the whole map and every Vault screen and component', () => {
    const files = VAULT_UI_FILES().map((f) => relative(ROOT, f));
    for (const f of [
      'src/lib/vaultCopy.ts',
      'src/screens/VaultScreen.tsx',
      'src/components/vault/VaultSettingsSheet.tsx',
      'src/components/vault/VaultTrashView.tsx',
      'src/components/VaultMarkdown.tsx',
      'src/components/ProjectVaultPins.tsx',
    ]) {
      expect(files).toContain(f);
    }
    // The map alone holds hundreds of lines; a reader that finds few has
    // broken, and the sweep would pass on nothing.
    expect(uiCopyOf(join(SRC, 'lib/vaultCopy.ts')).length).toBeGreaterThan(300);
    expect(uiCopyOf(join(SRC, 'screens/VaultScreen.tsx')).length).toBeGreaterThan(20);
  });

  it('no Vault string claims a speed, a quality, a memory, or always, anywhere', () => {
    const hits: string[] = [];
    for (const file of VAULT_UI_FILES()) {
      for (const s of uiCopyOf(file)) {
        for (const re of BANNED_NOW) if (re.test(s)) hits.push(`${relative(ROOT, file)}: ${s}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('refuses "faster", "smarter" and "remembers" outside the M7 fences, and passes a code value', () => {
    const outside = [
      "export const X = 'Notes make each chat faster.';",
      '<p className="hint">A smarter vault</p>',
      'const y = `It remembers what you wrote.`;',
    ].join('\n');
    const found = [...stringLiterals(outside), ...jsxText(outside)].filter(readable);
    for (const word of [/faster/, /smarter/, /remembers/]) {
      expect(found.some((s) => word.test(s) && M7_BANNED.some((re) => re.test(s)))).toBe(true);
    }
    // A setting's value is not copy.
    expect(readable('always')).toBe(false);
    expect(readable('Always on')).toBe(true);
  });
});

// The team Trash says how long a deleted note can be restored, and that
// number is the server's own (review, 2026-09-30): org_vault_purge drops
// tombstones and revisions older than its default window, and pg_cron runs it
// weekly with no argument, so the default is the window (migration 0021). Read
// from the migrations themselves, so a later file that changes the window or
// the schedule fails here until the copy says the new number. The number is a
// lower bound (the purge runs weekly), which is how the copy says it.
describe('the team Trash says what the purge does (0021)', () => {
  const MIGRATIONS = resolve(ROOT, '../supabase/migrations');
  const files = readdirSync(MIGRATIONS)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  /** The last match of `re` across the migrations, in the order they apply. */
  function lastMatch(re: RegExp): { file: string; m: RegExpMatchArray } | undefined {
    let hit: { file: string; m: RegExpMatchArray } | undefined;
    for (const file of files) {
      for (const m of readFileSync(join(MIGRATIONS, file), 'utf8').matchAll(re)) hit = { file, m };
    }
    return hit;
  }
  const purgeWindow = lastMatch(
    /create or replace function public\.org_vault_purge\(\s*p_older_than interval default '(\d+) days'\s*\)/gi,
  );
  const job = lastMatch(
    /cron\.schedule\(\s*'oscode_vault_purge',\s*'([^']+)',\s*\$job\$\s*select public\.org_vault_purge\(\);\s*\$job\$\s*\)/gi,
  );
  const daysIn = (line: string) => Number(/\b(\d+) days\b/.exec(line)?.[1]);

  it('reads the window and the weekly job, with no argument, from the migrations', () => {
    expect(purgeWindow?.file).toBe('0021_org_vault_v1.sql');
    expect(Number(purgeWindow?.m[1])).toBeGreaterThan(0);
    expect(job?.file).toBe('0021_org_vault_v1.sql');
    expect(job?.m[1]).toBe('29 3 * * 0');
    // Once a week at a fixed minute: never sooner than the window says.
    expect(job?.m[1]).toMatch(/^\d+ \d+ \* \* [0-6]$/);
  });

  it("the lead, the line and the Empty Trash line say the purge's number, never forever", () => {
    const days = Number(purgeWindow?.m[1]);
    const lead = vaultTrashLead('team');
    const empty = vaultCapLine('org', 'emptyTrash');
    expect(lead).toBe(`Deleted team notes can be restored from here for ${days} days.`);
    expect(VAULT_TRASH_TEAM_LINE).toBe(
      "After that they are cleared from your organization's history.",
    );
    expect(empty).toBe(
      `Deleted team notes are cleared from your organization's history after ${days} days.`,
    );
    expect(daysIn(lead)).toBe(days);
    expect(daysIn(empty)).toBe(days);
    for (const line of [lead, VAULT_TRASH_TEAM_LINE, empty]) {
      expect(line).not.toMatch(/\b(kept|keeps|forever|always|permanently)\b/i);
    }
  });
});

// 0015's path rule (round 7 E43): the words the server raises are the ones
// the provider maps to the app's own line, the limit is 0015's, and the
// fake server checks the same rule first, as 0021, 0024 and 0025 do.
describe("the team's path rule says what 0015 says, in the app's words (E43)", () => {
  const read = (f: string) => readFileSync(resolve(ROOT, `../supabase/migrations/${f}`), 'utf8');
  it('reads the limit and the refusal from the migrations', async () => {
    const { orgVaultPathOk } = await import('./fixtures/fakeOrgVaultServer.js');
    const { TEAM_PATH_MAX } = await import('../src/lib/vault.js');
    const { VAULT_TEAM_PATH_TOO_LONG, VAULT_TEAM_PATH_NOT_ALLOWED } =
      await import('../src/lib/vaultCopy.js');
    const ok = read('0015_review_2026_09_05.sql');
    expect(/char_length\(p_path\) <= (\d+)/.exec(ok)?.[1]).toBe(String(TEAM_PATH_MAX));
    expect(VAULT_TEAM_PATH_TOO_LONG).toContain(`${TEAM_PATH_MAX} characters`);
    for (const f of [
      '0021_org_vault_v1.sql',
      '0024_org_vault_move.sql',
      '0025_org_vault_settings.sql',
    ]) {
      expect(read(f)).toContain("raise exception 'that note path is not allowed'");
    }
    for (const line of [VAULT_TEAM_PATH_TOO_LONG, VAULT_TEAM_PATH_NOT_ALLOWED]) {
      expect(line).not.toMatch(/try again/i);
      expect(line).not.toMatch(DASHES);
    }
    expect(orgVaultPathOk('a'.repeat(512))).toBe(true);
    expect(orgVaultPathOk('a'.repeat(513))).toBe(false);
  });
});

// The team's free space (the 2026-09-30 review, finding 1): the line a
// refused team write says is 0023's own, read from the migration, so a later
// file that changes the number or the words fails here until the copy says
// the new ones. The test fake raises the same text. No "try again" (a purge
// frees space about a month later, so a retry fails the same way) and no
// price or plan name (a business gate).
describe("the team's free space says what 0023 says (the review, finding 1)", () => {
  const sql = readFileSync(resolve(ROOT, '../supabase/migrations/0023_org_free_caps.sql'), 'utf8');
  const bytes = Number(
    /function public\.no_entitlement_max_org_bytes\(\)[\s\S]*?select (\d+)::bigint/.exec(sql)?.[1],
  );
  const raised =
    /raise exception '(this team has used[^']*)'\s+using errcode = 'check_violation'/.exec(
      sql,
    )?.[1];

  it('reads the cap and the refusal from the migration', () => {
    expect(bytes).toBe(26214400);
    expect(bytes).toBe(VAULT_TEAM_FREE_MIB * 1024 * 1024);
    expect(raised).toBeDefined();
    // The fake server the tests run against raises the migration's own words.
    expect(FREE_SPACE_REFUSAL).toBe(raised);
  });

  it("says 0023's number, words and month", () => {
    const [used, freed] = VAULT_TEAM_FULL.split('. ');
    expect(raised!.toLowerCase()).toContain(used!.toLowerCase());
    expect(raised).toContain(`${VAULT_TEAM_FREE_MIB} MiB of free space`);
    expect(raised).toContain(freed!.replace(/\.$/, ''));
    expect(sql).toContain('its history is cleared, about a month later');
    // "About a month" is the weekly purge's window, the Trash lines' number.
    expect(VAULT_TEAM_TRASH_DAYS).toBe(30);
    expect(VAULT_TEAM_FULL).not.toMatch(/try again|\$|price|tier|plan\b|start a plan/i);
  });

  it('puts the verb first, and says a whole line as it is', () => {
    expect(vaultRefusedLine('restore', { line: VAULT_TEAM_FULL })).toBe(
      `Not restored. ${VAULT_TEAM_FULL}`,
    );
    expect(vaultRefusedLine('rename', { line: VAULT_TEAM_FULL })).toBe(
      `Not renamed. ${VAULT_TEAM_FULL}`,
    );
    expect(vaultRefusedLine('today', { line: VAULT_TEAM_FULL })).toBe(
      `Not started. ${VAULT_TEAM_FULL}`,
    );
    expect(vaultRefusedLine('save', { line: 'not a member of this org' })).toBe(
      'Not saved. Not a member of this org.',
    );
    const whole = 'Not deleted. Only admins can delete team notes.';
    expect(vaultRefusedLine('delete', { line: whole, whole: true })).toBe(whole);
  });

  it('a rename names the linking notes moved or deleted while it ran, never as updated (E36)', () => {
    const base = { updated: 1, total: 1, skipped: [], notUpdated: [], stopped: false };
    expect(
      vaultRenameToast({ old: 'Ideas', next: 'Plans', rewrite: { ...base, gone: ['ref'] } }),
    ).toBe(
      'Renamed to "Plans". 1 link updated. "ref" was moved or deleted while this ran, so its links were not updated.',
    );
    expect(
      vaultRenameToast({
        old: 'Ideas',
        next: 'Plans',
        rewrite: { ...base, updated: 0, total: 0, gone: ['ref', 'b'] },
      }),
    ).toBe(
      'Renamed to "Plans". 2 notes were moved or deleted while this ran, so their links were not updated.',
    );
    // Without any, the line is what it always was.
    expect(vaultRenameToast({ old: 'Ideas', next: 'Plans', rewrite: { ...base, gone: [] } })).toBe(
      'Renamed to "Plans". 1 link updated.',
    );
    for (const line of [vaultLinksGoneLine(['a']), vaultLinksGoneLine(['a', 'b'])]) {
      expect(line).not.toMatch(/try again/i);
      expect(line).not.toMatch(DASHES);
    }
  });

  it('a tick, a mark or a link on a note gone elsewhere says so, verb first, never try again (E34)', () => {
    for (const verb of ['tick', 'mark', 'link'] as const) {
      const line = vaultGoneLine(verb, 'Plan');
      expect(line).toMatch(/^Not (ticked|marked|linked)\. "Plan" is no longer in your vault\./);
      expect(line).toContain('moved or deleted somewhere else');
      expect(line).not.toMatch(/try again|newer version/i);
      expect(line).not.toMatch(DASHES);
    }
  });

  it('a folder that came back in part says how many, names what stayed, and why', () => {
    expect(
      vaultRestorePartial({
        title: 'Work',
        restored: 2,
        left: ['Work/big.md'],
        reason: VAULT_TEAM_FULL,
      }),
    ).toBe(`Restored 2 of 3 notes from "Work". Still in Trash: "big". ${VAULT_TEAM_FULL}`);
    // Four or more stayed: three by name, and the count of the rest.
    expect(
      vaultRestorePartial({
        title: 'Work',
        restored: 1,
        left: ['Work/a.md', 'Work/b.md', 'Work/c.md', 'Work/d.md', 'Work/e.md'],
        reason: 'not a member of this org',
      }),
    ).toBe(
      'Restored 1 of 6 notes from "Work". Still in Trash: "a", "b", "c" and 2 more. Not a member of this org.',
    );
    // With no reason, the rest were not reached, so trying again is true.
    expect(vaultRestorePartial({ title: 'Work', restored: 1, left: ['Work/b.md'] })).toMatch(
      /Try again in a moment\.$/,
    );
    expect(vaultFolderMoveRefused('Work', 1, 3, VAULT_TEAM_FULL)).toBe(
      `Moved 1 of 3 notes from "Work". The rest were not moved, so they are still there. ${VAULT_TEAM_FULL}`,
    );
  });

  it('a replay that finds notes moved or deleted says so, and never "try again" (E9)', () => {
    expect(vaultGoneManyLine(3)).toBe(
      '3 notes with text you had not saved were moved or deleted somewhere else.',
    );
    expect(vaultGoneManyLine(3)).not.toMatch(/try again/i);
  });

  it('text no editor showed is named as typed earlier, with what to do (E10)', () => {
    expect(VAULT_UNSEEN_DRAFT_REASON).toMatch(/^Typed earlier on this device/);
    expect(VAULT_UNSEEN_DRAFT_REASON).toMatch(/Copy it into the note if you still need it\.$/);
    expect(VAULT_UNSEEN_DRAFT_REASON).not.toMatch(/try again/i);
  });

  it('a folder delete stopped part way says how many went, and why (E20)', async () => {
    const { vaultFolderTrashPartial, VAULT_TEAM_DELETE_ADMINS_ONLY } =
      await import('../src/lib/vaultCopy.js');
    expect(
      vaultFolderTrashPartial({
        title: 'Work',
        trashed: 1,
        left: 2,
        reason: VAULT_TEAM_DELETE_ADMINS_ONLY,
      }),
    ).toBe(
      'Moved 1 of 3 notes from "Work" to Trash. The rest are still there. Only admins can delete team notes here.',
    );
    // A refusal for good never says "try again"; a failure that may pass does.
    expect(
      vaultFolderTrashPartial({ title: 'Work', trashed: 1, left: 2, reason: 'x' }),
    ).not.toMatch(/try again/i);
    expect(vaultFolderTrashPartial({ title: 'Work', trashed: 2, left: 1 })).toBe(
      'Moved 2 of 3 notes from "Work" to Trash. The rest are still there. Try again in a moment.',
    );
    expect(vaultFolderTrashPartial({ title: 'Work', trashed: 1, left: 1 })).not.toMatch(
      /Not deleted/,
    );
  });

  it('a folder delete names the notes a teammate saved while it ran (E21)', async () => {
    const { vaultFolderTrashPartial, vaultFolderTrashChanged } =
      await import('../src/lib/vaultCopy.js');
    expect(
      vaultFolderTrashPartial({ title: 'Work', trashed: 1, left: 1, changed: ['Work/b.md'] }),
    ).toBe(
      'Moved 1 of 2 notes from "Work" to Trash. "b" changed while this ran, so it is still there.',
    );
    expect(
      vaultFolderTrashPartial({
        title: 'Work',
        trashed: 1,
        left: 2,
        changed: ['Work/b.md', 'Work/c.md'],
      }),
    ).toBe(
      'Moved 1 of 3 notes from "Work" to Trash. "b" and "c" changed while this ran, so they are still there.',
    );
    // A stop as well as a pass-over: the rest, and why.
    expect(
      vaultFolderTrashPartial({ title: 'Work', trashed: 1, left: 2, changed: ['Work/b.md'] }),
    ).toBe(
      'Moved 1 of 3 notes from "Work" to Trash. The rest are still there. Try again in a moment.',
    );
    expect(vaultFolderTrashChanged('Work', ['Work/b.md'])).toBe(
      'Not deleted. "b" changed while this ran, so nothing in "Work" went to Trash.',
    );
    expect(vaultFolderTrashChanged('Work', ['Work/a.md', 'Work/b.md', 'Work/c.md'])).toBe(
      'Not deleted. 3 notes changed while this ran, so nothing in "Work" went to Trash.',
    );
    for (const line of [
      vaultFolderTrashChanged('Work', ['Work/b.md']),
      vaultFolderTrashPartial({ title: 'Work', trashed: 1, left: 1, changed: ['Work/b.md'] }),
    ]) {
      expect(line).not.toMatch(/try again/i);
    }
  });

  it('a name in team Trash is said with what to do, never "try again" (E22)', async () => {
    const { vaultNameInTrash, vaultFolderMoveInTrash } = await import('../src/lib/vaultCopy.js');
    expect(vaultNameInTrash('Plan')).toBe(
      '"Plan" is in Trash. Restore it from Trash, or use another name.',
    );
    expect(vaultFolderMoveInTrash('Work', 'a')).toBe(
      '"Work" was not moved. "a" is in Trash. Restore it from Trash, or use another name.',
    );
    expect(vaultNameInTrash('Plan')).not.toMatch(/try again/i);
  });

  it('a member removed from the team is told so, never that its notes are gone (E26)', async () => {
    const { VAULT_TEAM_NOT_MEMBER, VAULT_TEAM_NOT_MEMBER_REASON, vaultRefusedLine } =
      await import('../src/lib/vaultCopy.js');
    expect(VAULT_TEAM_NOT_MEMBER).toBe(
      'You are no longer a member of this team, so its notes are not shown here.',
    );
    expect(VAULT_TEAM_NOT_MEMBER_REASON).toBe('You are no longer a member of this team.');
    expect(vaultRefusedLine('save', { line: VAULT_TEAM_NOT_MEMBER_REASON })).toBe(
      'Not saved. You are no longer a member of this team.',
    );
    for (const line of [VAULT_TEAM_NOT_MEMBER, VAULT_TEAM_NOT_MEMBER_REASON]) {
      // Nothing there was deleted, moved or emptied, and trying again cannot
      // make anyone a member; the server's own words never show.
      expect(line).not.toMatch(/deleted|empty|moved|try again|not a member of this org/i);
      // No en or em dash (code points 8211 and 8212).
      expect([...line].some((ch) => [8211, 8212].includes(ch.codePointAt(0)!))).toBe(false);
    }
  });

  it('a tick on text not saved yet says why the box was not ticked (E30)', async () => {
    const { vaultTickUnsaved } = await import('../src/lib/vaultCopy.js');
    expect(vaultTickUnsaved('t')).toBe(
      '"t" has text that is not saved yet, so that box was not ticked.',
    );
    expect(vaultTickUnsaved('t')).not.toMatch(/try again/i);
  });

  it('a full team\'s lead and refusals say what still works, never "try again" (E27)', async () => {
    const {
      VAULT_TEAM_FULL,
      VAULT_TEAM_FULL_LEAD,
      VAULT_TEAM_FULL_NOT_CREATED,
      VAULT_TEAM_FULL_NOT_RESTORED,
    } = await import('../src/lib/vaultCopy.js');
    expect(VAULT_TEAM_FULL_LEAD).toBe(
      `${VAULT_TEAM_FULL} Notes can still be read, shortened and deleted; text added now is kept under Not saved.`,
    );
    expect(VAULT_TEAM_FULL_NOT_CREATED).toBe(`Not created. ${VAULT_TEAM_FULL}`);
    expect(VAULT_TEAM_FULL_NOT_RESTORED).toBe(`Not restored. ${VAULT_TEAM_FULL}`);
    for (const line of [
      VAULT_TEAM_FULL_LEAD,
      VAULT_TEAM_FULL_NOT_CREATED,
      VAULT_TEAM_FULL_NOT_RESTORED,
    ]) {
      expect(line).not.toMatch(/try again|renamed|plan/i);
      expect([...line].some((ch) => [8211, 8212].includes(ch.codePointAt(0)!))).toBe(false);
    }
  });

  it('a folder move with nothing left to move says why, never "try again" (E25)', async () => {
    const { vaultFolderMoveGone } = await import('../src/lib/vaultCopy.js');
    const line = vaultFolderMoveGone('Work');
    expect(line).toBe(
      '"Work" has no notes left to move. They were moved or deleted somewhere else.',
    );
    expect(line).not.toMatch(/try again|renamed/i);
    expect([...line].some((ch) => [8211, 8212].includes(ch.codePointAt(0)!))).toBe(false);
  });

  it('a note brought back beside its name says why, and a folder says which (E23)', async () => {
    const { vaultRestoredBeside } = await import('../src/lib/vaultCopy.js');
    const inTrash = { from: 'Plan.md', to: 'Plan (restored).md', inTrash: true };
    const taken = { from: 'Work/Plan.md', to: 'Work/Plan (restored).md', inTrash: false };
    expect(vaultRestoredBeside({ title: 'Plan', folder: false, beside: [inTrash] })).toBe(
      '"Plan" came back as "Plan (restored)", since that name is in Trash from a later delete.',
    );
    // Beside a note in the vault, vaultRestoredToast already says it.
    expect(
      vaultRestoredBeside({
        title: 'Plan',
        folder: false,
        beside: [{ ...inTrash, inTrash: false }],
      }),
    ).toBeUndefined();
    expect(vaultRestoredBeside({ title: 'Work', folder: true, beside: [taken] })).toBe(
      'Restored "Work". "Plan" came back as "Plan (restored)", since a note of that name is there now.',
    );
    const two = vaultRestoredBeside({ title: 'Work', folder: true, beside: [taken, inTrash] })!;
    expect(two).toBe(
      'Restored "Work". 2 notes came back beside their names, as "(restored)", since those names are taken or in Trash.',
    );
    for (const line of [two]) {
      expect(line).not.toMatch(/try again/i);
      expect([...line].some((ch) => [8211, 8212].includes(ch.codePointAt(0)!))).toBe(false);
    }
  });
});

// Round 7, batch 6: what the team vault can do now, said truly.
describe('round 7, batch 6: the team lines say what is true now', () => {
  it('an export that never reached the team vault never blames this device (E46)', async () => {
    const { VAULT_TEAM_EXPORT_UNREACHABLE, vaultTeamExportRefused } =
      await import('../src/lib/vaultCopy.js');
    expect(VAULT_TEAM_EXPORT_UNREACHABLE).toBe(
      'Could not reach the team vault, so nothing was exported. Try again when it answers.',
    );
    expect(VAULT_TEAM_EXPORT_UNREACHABLE).not.toMatch(/storage|device/i);
    const refused = vaultTeamExportRefused('Sign in to your team to use the team vault.');
    expect(refused).toBe('Nothing was exported. Sign in to your team to use the team vault.');
    expect(refused).not.toMatch(/try again/i);
    for (const line of [VAULT_TEAM_EXPORT_UNREACHABLE, refused]) expect(line).not.toMatch(DASHES);
  });

  it("a lapsed plan's open note says why it is read-only, and promises no export (E45)", async () => {
    const { VAULT_TEAM_LAPSED_NOTE } = await import('../src/lib/vaultCopy.js');
    expect(VAULT_TEAM_LAPSED_NOTE).toBe(
      "Your organization's plan is not active, so this note is read-only.",
    );
    expect(VAULT_TEAM_LAPSED_NOTE).not.toMatch(/export|try again/i);
    expect(VAULT_TEAM_LAPSED_NOTE).not.toMatch(DASHES);
  });

  it('a note over the 1 MB cap never reads as the same size as the cap (E44)', async () => {
    const { vaultTeamTooLargeLine } = await import('../src/lib/vaultCopy.js');
    const sql = readFileSync(
      resolve(ROOT, '../supabase/migrations/0025_org_vault_settings.sql'),
      'utf8',
    );
    expect(sql).toContain('octet_length(v_body) > 1048576');
    const line = (bytes: number) => vaultTeamTooLargeLine(bytes);
    expect(line(1_048_577)).toBe('A team note is limited to 1 MB, and this one is 1.01 MB.');
    expect(line(1_101_004)).toBe('A team note is limited to 1 MB, and this one is 1.05 MB.');
    expect(line(1_101_005)).toBe('A team note is limited to 1 MB, and this one is 1.06 MB.');
    expect(line(2 * 1_048_576)).toBe('A team note is limited to 1 MB, and this one is 2 MB.');
    for (const bytes of [1_048_577, 1_050_000, 1_100_000, 1_101_004]) {
      const shown = Number(/this one is ([\d.]+) MB/.exec(line(bytes))?.[1]);
      expect(shown).toBeGreaterThan(1);
      expect(line(bytes)).not.toContain('1.0 MB');
      expect(line(bytes)).not.toMatch(/try again/i);
      expect(line(bytes)).not.toMatch(DASHES);
    }
  });

  it("a settings change by someone not an admin says 0025's reason, verb first (E55)", async () => {
    const { VAULT_TEAM_SETTINGS_ADMINS_ONLY, vaultRefusedLine } =
      await import('../src/lib/vaultCopy.js');
    const sql = readFileSync(
      resolve(ROOT, '../supabase/migrations/0025_org_vault_settings.sql'),
      'utf8',
    );
    expect(sql).toContain("raise exception 'only admins can change team vault settings'");
    const line = vaultRefusedLine('save', { line: VAULT_TEAM_SETTINGS_ADMINS_ONLY });
    expect(line).toBe('Not saved. Only admins can change team vault settings.');
    expect(line).not.toMatch(/try again/i);
    expect(line).not.toMatch(DASHES);
  });
});
