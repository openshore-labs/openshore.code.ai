// What the Vault says about itself, in one map (0.19). Every line a person
// reads about where their notes live, whether Obsidian opens them, and whether
// their agent reads them comes from here, keyed by platform and by the storage
// that holds the vault: the room's lead, the empty-vault ramp, the storage
// sheet, the welcome note, and Harbor Lite's Vault card. A line is here only
// when it is true today, so the claims live in one place a test can read
// (test/vaultCopy.test.ts fails on a false agent or Obsidian line).
//
// What is true today, and why the map reads the way it does:
// - The agent's vault is a folder on the computer (vault.dir, ~/OSCode/Vault).
//   Only "This folder" on the desktop IS that folder, so only there does the
//   agent read these notes and write beside you (always asking first), and
//   only there do routines leave their notes.
// - Everywhere else the notes on screen are not the agent's. A phone paired
//   to its own computer says where the agent's vault is instead; an unpaired
//   phone gets one pointer in the empty-vault ramp only (where the agent
//   would be, never a claim about these notes); and a member on someone
//   else's computer gets no vault in their sessions (0.13), so nothing is
//   promised there.
// - Obsidian opens a plain folder. Only This folder claims it today. The
//   iCloud folder says nothing about Obsidian until a Mac opens it on a real
//   device (8.1) and iCloud writes are safe for a second writer (2.1, 2.9).
//   Local is a sealed store, Google Drive is held back, and the team vault is
//   a server, so none of them claims Obsidian.
import type { Platform } from './platform.js';
import { noteTitle } from './vault.js';

/** The storage a vault can live on, as far as copy is concerned. `org` is the
 *  team vault. Dropbox and Proton are not wired, so they have no lines. */
export type VaultCopyProvider = 'local' | 'files' | 'icloud' | 'gdrive' | 'org';

export const VAULT_COPY_PLATFORMS: readonly Platform[] = ['ios', 'electron', 'web'];
export const VAULT_COPY_PROVIDERS: readonly VaultCopyProvider[] = [
  'local',
  'files',
  'icloud',
  'gdrive',
  'org',
];

export interface VaultCopy {
  /** Where these notes are kept, in one or two short sentences. */
  storage: string;
  /** Obsidian opens these very notes. Only a folder Obsidian can open. */
  obsidian?: string;
  /** The agent reads these very notes and writes beside you. Only This folder
   *  on the desktop, the one folder the agent's vault is. */
  agent?: string;
  /** Routines leave their notes here. The same folder, so the same rule. */
  routines?: string;
  /** Where the agent's vault is when it is not these notes. A pointer, never
   *  a claim about the notes on screen. */
  agentElsewhere?: string;
  /** The ramp's pointer on a device with no computer paired: where the agent
   *  would be, never a claim about these notes. */
  agentPair?: string;
}

/** Who holds the device, as far as the agent lines are concerned. */
export interface VaultCopyOpts {
  /** A phone paired to someone else's computer as a member, whose sessions
   *  have no vault. */
  hubMember?: boolean;
  /** This device is paired to a computer. Off the desktop, only then is
   *  there an agent whose vault the copy can point at. */
  paired?: boolean;
}

/** A paired phone's line about the agent: its vault is the computer's folder. */
export const PHONE_AGENT_LINE = 'Your agent uses the vault on your computer.';
/** An unpaired phone's (or the web's) one pointer, in the empty-vault ramp
 *  only: where the agent works, and that its vault is its own. */
export const PHONE_PAIR_LINE = 'Your agent works on a computer you pair, with its own vault there.';
/** The desktop's line when the vault is not the agent's folder. */
export const DESKTOP_AGENT_LINE =
  'Your agent uses a folder on this computer, not these notes. Move the vault to This folder to share it.';
/** Where a routine's result note lands, whatever the Vault room shows. */
export const ROUTINE_NOTES_PLACE = 'the vault folder on your computer';

const STORAGE: Record<VaultCopyProvider, string> = {
  local: 'Sealed on this device. Not a folder other apps can open.',
  files: 'Plain .md files in a folder on this computer.',
  icloud: 'Plain .md files in your iCloud Drive, synced by iOS across your devices.',
  gdrive:
    'Your Google Drive. Held back for now while its sync is made safe, and files added outside OpenShore may not show up here.',
  org: 'Shared with your team and saved to your organization. It is not an Obsidian folder.',
};

const OBSIDIAN: Partial<Record<VaultCopyProvider, string>> = {
  files: 'Obsidian opens this folder as a vault.',
};

/** The lines for one platform and one storage, on this device. */
export function vaultCopy(
  platform: Platform,
  provider: VaultCopyProvider,
  opts: VaultCopyOpts = {},
): VaultCopy {
  const desktop = platform === 'electron';
  const copy: VaultCopy = {
    storage:
      provider === 'files' && !desktop
        ? 'Plain .md files in a folder on your computer.'
        : STORAGE[provider],
  };
  const obsidian = OBSIDIAN[provider];
  if (obsidian) copy.obsidian = obsidian;
  // The team vault is not in any agent's context yet, on any platform.
  if (provider === 'org') return copy;
  if (desktop && provider === 'files') {
    copy.agent = 'Your agent can read these notes and write here too, asking first.';
    copy.routines = 'Routines leave their notes here.';
  } else if (desktop) {
    copy.agentElsewhere = DESKTOP_AGENT_LINE;
  } else if (opts.paired && !opts.hubMember) {
    copy.agentElsewhere = PHONE_AGENT_LINE;
  } else if (!opts.hubMember) {
    // Off the desktop with no computer paired (the team vault returned
    // above): the ramp's one pointer. The lead and the sheet never read it.
    copy.agentPair = PHONE_PAIR_LINE;
  }
  return copy;
}

/** Whether the storage sheet offers a provider on this platform at all. This
 *  folder exists only in OpenShore on a computer and iCloud Drive only on the
 *  iPhone, so neither shows as "Arriving" where it never arrives. */
export function vaultOffersProvider(platform: Platform, provider: string): boolean {
  if (provider === 'files') return platform === 'electron';
  if (provider === 'icloud') return platform === 'ios';
  return provider === 'local' || provider === 'gdrive';
}

/** The copy key for a storage id, or undefined for one with no lines (not
 *  wired: Dropbox, Proton). */
export function copyProviderOf(id: string): VaultCopyProvider | undefined {
  return (VAULT_COPY_PROVIDERS as readonly string[]).includes(id)
    ? (id as VaultCopyProvider)
    : undefined;
}

/** The storage sheet row's line: where it lives, and what opens it. */
export function vaultSheetLine(c: VaultCopy): string {
  return [c.storage, c.obsidian, c.agent].filter(Boolean).join(' ');
}

/** The desktop storage sheet's way out: a move to This folder, in This
 *  folder's own words (never the words of the vault it leaves). */
export function vaultFolderRowLine(platform: Platform): string {
  const f = vaultCopy(platform, 'files');
  return ['Moves your vault to This folder.', f.storage, f.obsidian].filter(Boolean).join(' ');
}

/** The line under the room's title. */
export function vaultLead(c: VaultCopy): string {
  return [c.storage, c.agent ?? c.agentElsewhere].filter(Boolean).join(' ');
}

export interface VaultOnboard {
  title: string;
  lead: string;
  points: Array<{ glyph: 'doc' | 'agent' | 'link'; title: string; sub: string }>;
}

/** The empty personal vault's ramp: what it is, where it lives, and how the
 *  agent fits, with no promise the storage cannot keep. */
export function vaultOnboard(
  platform: Platform,
  provider: VaultCopyProvider,
  opts: VaultCopyOpts = {},
): VaultOnboard {
  const c = vaultCopy(platform, provider, opts);
  const wayOut =
    platform === 'ios'
      ? 'Export writes your notes out as plain .md files in Files whenever you like.'
      : platform === 'electron' && provider !== 'files'
        ? 'Move the vault to This folder whenever you like, for plain .md files.'
        : provider === 'files'
          ? 'Each note is a file you can open, copy, or back up.'
          : 'Copy any note out whenever you like.';
  const points: VaultOnboard['points'] = [
    { glyph: 'doc', title: 'Plain markdown, yours', sub: `${wayOut} Nothing is locked in.` },
  ];
  const agentLine = c.agent
    ? [c.agent, c.routines].filter(Boolean).join(' ')
    : (c.agentElsewhere ?? c.agentPair);
  if (agentLine) {
    points.push({
      glyph: 'agent',
      title: c.agent ? 'You and your agent both write here' : 'Where your agent keeps notes',
      sub: agentLine,
    });
  }
  points.push({
    glyph: 'link',
    title: 'Link ideas with [[wikilinks]]',
    sub: 'Type two square brackets to connect notes. Linked mentions show which notes point back.',
  });
  return {
    title: c.agent ? 'A home for what you and your agent know' : 'A home for what you know',
    lead: [c.storage, c.obsidian].filter(Boolean).join(' '),
    points,
  };
}

/** The welcome note a fresh vault can start on, the way a new Obsidian vault
 *  opens on one. It is written into the vault and travels with it (a move to
 *  This folder, an export, the agent's read), so it says only what holds
 *  wherever it goes: no storage, Obsidian, or agent line, which the room's
 *  lead and ramp say per storage and re-render when the vault moves. */
export function vaultWelcomeNote(): string {
  return [
    '# Welcome to your Vault',
    '',
    'This is a note, written in plain markdown. Write anything you want here.',
    '',
    '## Where it lives',
    '',
    'In OpenShore, tap Where it lives, under the Vault title, to see where these notes are',
    'kept or to move them.',
    '',
    '## Link your notes',
    '',
    'Type two square brackets to link to another note, like [[Ideas]]. Linked mentions at the',
    'bottom of a note show which notes point back to it.',
    '',
    '## Try it',
    '',
    'Tap the plus at the top to write your own note. Delete this one whenever',
    'you like.',
    '',
  ].join('\n');
}

/** Harbor Lite's Vault card: every storage's lines, where each applies. */
export function vaultGuideText(): string {
  const desk = vaultCopy('electron', 'files');
  const icloud = vaultCopy('ios', 'icloud');
  return [
    'Plain markdown notes with [[wikilinks]] and linked mentions. Where it lives picks the storage for your own vault.',
    `This device: ${vaultCopy('ios', 'local').storage}`,
    `This folder, in OpenShore on your computer: ${desk.storage} ${desk.obsidian} ${desk.agent} ${desk.routines}`,
    `iCloud Drive, on the iPhone: ${icloud.storage}`,
    `Google Drive: ${vaultCopy('ios', 'gdrive').storage} A vault already there is read-only, and its card moves it off.`,
    'On the iPhone, Export writes the notes out as plain .md files in Files.',
    `On a phone paired with a computer, ${lowerFirst(PHONE_AGENT_LINE)}`,
    "A member using someone else's computer has no vault in their sessions yet.",
    `The team vault: ${vaultCopy('ios', 'org').storage}`,
  ].join(' ');
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** What a vault move did, said plainly. A clean move says where the vault
 *  is, never a count. A note whose name the target already held with other
 *  text landed beside it under a conflict name, and that name now opens the
 *  other text, so the line names it (copy-2). A refused move takes back the
 *  copies it wrote, so "nothing moved" is true, except for the copies the
 *  target would not let go of (`left`), which the line names instead. */
export function vaultMoveLine(
  result:
    | {
        ok: boolean;
        skipped: string[];
        reason?: string;
        forked?: Array<{ from: string; to: string }>;
        left?: string[];
      }
    | undefined,
  label: string,
  obsidian?: string,
): string {
  if (result?.ok) {
    return [`Your vault moved to ${label}.`, forkedLine(result.forked ?? []), obsidian]
      .filter(Boolean)
      .join(' ');
  }
  const left = result?.left ?? [];
  switch (result?.reason) {
    case 'unreadable': {
      const n = result.skipped.length;
      return n
        ? `${n === 1 ? 'A note is' : `${n} notes are`} still downloading or could not be read, so nothing moved. Try again once they are here.`
        : 'Could not read your vault to move it, so nothing moved. Try again in a moment.';
    }
    case 'copy-failed':
      return left.length
        ? `Could not copy your notes to ${label}, so your vault stayed where it was. ${leftLine(left)}`
        : `Could not copy your notes to ${label}, so nothing moved. Try again in a moment.`;
    case 'unverified':
      return [
        `${label} did not show every copied note, so your vault stayed where it was.`,
        left.length ? leftLine(left) : undefined,
      ]
        .filter(Boolean)
        .join(' ');
    case 'unavailable':
      return `${label} is not available right now, so your vault stayed where it was.`;
    default:
      return `Could not move to ${label}. Try again in a moment.`;
  }
}

// The notes a move put beside a same-named note at the target.
function forkedLine(forked: Array<{ from: string; to: string }>): string | undefined {
  if (!forked.length) return undefined;
  if (forked.length === 1) {
    const [f] = forked;
    return `"${noteTitle(f!.from)}" was already there with different text, so the one you moved is beside it as "${noteTitle(f!.to)}".`;
  }
  return `${forked.length} notes were already there with different text, so the ones you moved sit beside them, each with "conflict" and the date in its name.`;
}

// The copies a refused move could not take back from the target.
function leftLine(left: string[]): string {
  const copies =
    left.length === 1
      ? `One copy already written there could not be removed: "${noteTitle(left[0]!)}".`
      : `${left.length} copies already written there could not be removed.`;
  return `${copies} Your vault still holds every note.`;
}

// ---- Not saved (0.4) --------------------------------------------------------

/** What one held entry can be promised, when it is less than the Not saved
 *  card's general line: text this device kept no sealed copy of lasts only
 *  until the app closes, and team text leaves with its account at sign-out
 *  (R-19). Undefined for text kept until the person discards it. */
export function vaultHeldKeep(h: { providerId: string; durable: boolean }): string | undefined {
  if (!h.durable)
    return 'Kept only until the app closes, since this device could not keep a copy. Copy it now.';
  if (h.providerId === 'org')
    return 'Team text leaves this device when you sign out. Copy it before then.';
  return undefined;
}

/** The Not saved card's line. It promises "until you discard it" only when
 *  every entry keeps that long; otherwise each entry says its own limit. */
export function vaultHeldHint(held: Array<{ providerId: string; durable: boolean }>): string {
  return held.every((h) => !vaultHeldKeep(h))
    ? 'Text your vault did not take. It stays here until you copy it somewhere safe and discard it.'
    : 'Text your vault did not take. Copy it somewhere safe, then discard it here.';
}

/** The standing line once text was held, beside the toast that said so.
 *  `shownHere` is whether the Not saved list holding it is on screen; when it
 *  is not (a note view showing only its own), the line says where it is. */
export function vaultHeldLine(
  held: Array<{ durable: boolean }>,
  shownHere: boolean,
): string | undefined {
  if (!held.length) return undefined;
  const where = shownHere ? 'under Not saved' : 'under Not saved in All notes';
  return held.some((h) => !h.durable)
    ? `Some text could not be saved, and this device could not keep a copy. It is ${where} only until the app closes, so copy it now.`
    : `Some text could not be saved. It is kept ${where}.`;
}

// ---- The read-only Drive card (0.18) ----------------------------------------

/** Whether this device can still reach the Google account behind a Drive
 *  vault: connected, signed out of it (a sign-out or an expired grant takes
 *  the tokens), or a build that cannot connect to Google at all. */
export type VaultDriveLink = 'connected' | 'disconnected' | 'unconfigured';

/** The toast when a move off Drive could not read it for want of the account. */
export const DRIVE_NOT_CONNECTED_MOVE_LINE =
  'Your Google account is not connected on this device, so the vault could not be read and nothing moved. Reconnect Google Drive to move it.';

/** The toast when the reconnect before a move off Drive did not complete. */
export const DRIVE_RECONNECT_FAILED_LINE =
  'Google Drive did not reconnect, so nothing moved. Try again when you are ready.';

/** Google Drive on the web, where a Drive vault's notes can still be opened
 *  on a build that cannot connect to Google. A plain link, so no sign-in. */
export const DRIVE_WEB_URL = 'https://drive.google.com/drive/my-drive';

/** The toast for a move off Drive refused as unreadable, when the account is
 *  the reason: a retry cannot help, so it says what can. Undefined while the
 *  account is connected (the move's own line applies). */
export function vaultDriveMoveRefusal(link: VaultDriveLink): string | undefined {
  if (link === 'disconnected') return DRIVE_NOT_CONNECTED_MOVE_LINE;
  if (link === 'unconfigured') {
    return 'This version of OpenShore cannot connect to Google Drive, so nothing moved. Your notes are still in your Google Drive, in the folder vault.personal.';
  }
  return undefined;
}

/** What the read-only Drive card adds under the store's reason, and its one
 *  button. The move needs the account, so with it gone the button reconnects
 *  first; a build that cannot connect cannot move or reconnect, so its one
 *  button opens Google Drive, where the notes still are (the folder is named
 *  for the vault's resource id, at the top of My Drive). */
export function vaultDriveCard(
  link: VaultDriveLink | undefined,
  exit: string,
): { line?: string; action?: { kind: 'move' | 'reconnect' | 'open'; label: string } } {
  if (link === 'disconnected') {
    return {
      line: `Your Google account is not connected on this device, so these notes cannot be read to move them. Reconnect it, and they move to ${exit}.`,
      action: { kind: 'reconnect', label: 'Reconnect Google Drive to move it' },
    };
  }
  if (link === 'unconfigured') {
    return {
      line: 'This version of OpenShore cannot connect to Google Drive, so it cannot read or move these notes. They are still in your Google Drive, in the folder vault.personal, as plain text files you can open or download there.',
      action: { kind: 'open', label: 'Open Google Drive' },
    };
  }
  return { action: { kind: 'move', label: `Move to ${exit}` } };
}
