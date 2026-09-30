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
export type VaultCopyProvider = 'local' | 'files' | 'icloud' | 'gdrive' | 'org' | 'hub';

export const VAULT_COPY_PLATFORMS: readonly Platform[] = ['ios', 'electron', 'web'];
export const VAULT_COPY_PROVIDERS: readonly VaultCopyProvider[] = [
  'local',
  'files',
  'icloud',
  'gdrive',
  'org',
  'hub',
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
  /** The paired computer's friendly name (`DaemonTarget.name`), for a
   *  member's one line about a hub vault (Vault M5, CTO J8). */
  hubName?: string;
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
  hub: 'Your computer, while it is on. Plain .md files in the vault folder there.',
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
  if (provider === 'hub') return hubCopy(copy, desktop, opts);
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

// "Your computer" (Vault M5, CTO J8, J9): the paired computer's one vault,
// reached over the hub. For the person who owns the computer it IS the
// agent's folder, so the agent and routine lines hold there. A member on
// someone else's computer gets one line naming whose computer holds their
// notes and nothing more: a member's own approved shell can still read other
// roots, so no line says who else can or cannot see them (0.13). The desktop
// keeps its vault as This folder, so a hub vault there says only where it is.
function hubCopy(copy: VaultCopy, desktop: boolean, opts: VaultCopyOpts): VaultCopy {
  if (opts.hubMember) {
    return { storage: `Your notes on ${opts.hubName?.trim() || 'the computer you paired'}.` };
  }
  if (desktop) return copy;
  if (opts.paired) {
    copy.agent = HUB_AGENT_LINE;
    copy.routines = 'Routines leave their notes here.';
  } else {
    copy.agentPair = PHONE_PAIR_LINE;
  }
  return copy;
}

/** A paired phone's agent line for a vault on its own computer: the same
 *  sentence This folder says on the desktop, since it is the same folder. */
export const HUB_AGENT_LINE = 'Your agent can read these notes and write here too, asking first.';

// ---- Your computer, out of reach (Vault M5, CTO J9) -------------------------

/** The line while the paired computer does not answer: the list is the last
 *  one seen, and an open note's changes wait with the version they were typed
 *  against. */
export const HUB_AWAY_LINE = 'Your computer is off. Changes wait here and save when it is back.';
/** A create, rename, move, or delete tried while the computer is away. */
export const HUB_AWAY_READ_ONLY =
  'Your computer is off, so new notes, renames, and deletes wait until it is back.';
/** A note that was never opened on this device, asked for while away. */
export const HUB_AWAY_NOT_KEPT =
  'Your computer is off, and this note was not kept on this device. Open it again when your computer is back.';
/** The roster row's pending line, on a device with no computer paired. */
export const HUB_PAIR_LINE = 'Pair with your computer to keep one vault there.';
/** The computer answered but turned this device's pairing down. */
export const HUB_PAIRING_REFUSED =
  'Your computer turned down this device. Pair again from OpenShore on your computer.';
/** A computer running an OpenShore from before the hub vault. */
export const HUB_UPDATE_LINE =
  'Your computer needs the latest OpenShore to keep your vault there. Update it, then try again.';
/** A note over the wire's cap. */
export function hubTooLargeLine(bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return `A note on your computer is limited to 4 MB, and this one is ${mb} MB.`;
}
/** The one toast when an empty Local vault moves to the paired computer on
 *  pairing (D2). */
export const HUB_REPOINT_TOAST = 'Your vault now lives on your computer, while it is on.';
/** The one-time move card after pairing: its title and its two answers. The
 *  body is `hubMoveOffer(n)`. */
export const HUB_OFFER_COPY = {
  title: 'Keep one vault on your computer',
  move: 'Move my notes',
  later: 'Keep them here',
} as const;
/** The toast after unpairing returned the vault to where it was. */
export const HUB_UNPAIR_TOAST =
  'Your vault is back on this device. Notes saved on your computer stay there.';
/** The move card's line when a Local vault with notes could move there. */
export function hubMoveOffer(n: number): string {
  return n === 1
    ? 'Keep your note on your computer, with your agent? It saves there while your computer is on.'
    : `Keep your ${n.toLocaleString()} notes on your computer, with your agent? They save there while your computer is on.`;
}

/** Whether the storage sheet offers a provider on this platform at all. This
 *  folder exists only in OpenShore on a computer and iCloud Drive only on the
 *  iPhone, so neither shows as "Arriving" where it never arrives. */
export function vaultOffersProvider(platform: Platform, provider: string): boolean {
  if (provider === 'files') return platform === 'electron';
  if (provider === 'icloud') return platform === 'ios';
  // Your computer is reached from the phone; on the desktop the same folder
  // is This folder.
  if (provider === 'hub') return platform !== 'electron';
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

/** The line under the room's title. `offerShown` drops the pointer to This
 *  folder while the desktop move card says it better (Creative Studio 2). */
export function vaultLead(c: VaultCopy, opts: { offerShown?: boolean } = {}): string {
  return [c.storage, c.agent ?? (opts.offerShown ? undefined : c.agentElsewhere)]
    .filter(Boolean)
    .join(' ');
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
    VAULT_GUIDE_PICKER_LINE,
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

// ---- Resolve (1.1) ----------------------------------------------------------
// A note that changed somewhere else while the person had unsaved edits in it
// (Creative Studio 1a to 1f). The two sides are "yours" and "the other
// version"; the sheet never names a writer it cannot prove (not the agent,
// not Obsidian, not another device), never calls either version newer or
// older, and never says "disk". "Somewhere else" is the source phrase. The
// words it must never use are pinned in test/vaultCopy.test.ts.

/** Which question the resolve sheet asks: two versions of a note ('edit'), or
 *  a note that is gone while it held unsaved edits ('missing'). */
export type VaultResolveMode = 'edit' | 'missing';

/** One choice in the resolve sheet. `armed` is the label a destructive row
 *  wears after its first tap; a second tap commits. */
export interface VaultResolveRow {
  choice: 'both' | 'mine' | 'theirs' | 'discard';
  label: string;
  sub: string;
  armed?: string;
  primary?: boolean;
}

export interface VaultResolveCopy {
  title: string;
  sub: string;
  /** The compare tabs and legend, in edit mode only. */
  tabs?: { changes: string; mine: string; theirs: string };
  legend?: { mine: string; theirs: string };
  /** Screen-reader prefixes on a changed compare line. */
  srPrefix?: { mine: string; theirs: string };
  rows: VaultResolveRow[];
  failure: string;
}

/** The other version's own time, as the sheet may show it: only when it is
 *  later than the moment this note was loaded here, and not in the future (a
 *  sync app can stamp an older time). Today "at 2:14 PM", another day "on
 *  Sep 27, 2:14 PM"; undefined otherwise. */
export function vaultResolveWhen(
  updatedAt: string,
  loadedAt: number,
  now = Date.now(),
): string | undefined {
  const t = new Date(updatedAt);
  const ms = t.getTime();
  if (Number.isNaN(ms) || ms <= loadedAt || ms > now + 60_000) return undefined;
  const today = new Date(now).toDateString() === t.toDateString();
  return today
    ? `at ${t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : `on ${t.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

/** Every line of the resolve sheet for one note. `when` comes from
 *  vaultResolveWhen and is left out when it is undefined. */
export function vaultResolveCopy(
  mode: VaultResolveMode,
  opts: { title: string; when?: string },
): VaultResolveCopy {
  const { title, when } = opts;
  if (mode === 'missing') {
    return {
      title: 'This note is gone',
      sub: `"${title}" was moved or deleted somewhere else while you had unsaved edits. Your text is still here.`,
      rows: [
        {
          choice: 'mine',
          label: 'Save it again',
          sub: `Puts your text back as "${title}".`,
          primary: true,
        },
        {
          choice: 'discard',
          label: 'Discard your edits',
          sub: 'Closes the note without saving.',
          armed: 'Really discard your edits? Tap to confirm.',
        },
      ],
      failure: VAULT_RESOLVE_FAILED,
    };
  }
  return {
    title: 'Two versions of this note',
    sub: `"${title}" was changed somewhere else${when ? ` ${when}` : ''} while you had unsaved edits. Nothing is lost until you choose.`,
    tabs: { changes: 'Changes', mine: 'Yours', theirs: 'Other version' },
    legend: { mine: 'Only in yours', theirs: 'Only in the other version' },
    srPrefix: { mine: 'Yours: ', theirs: 'Other version: ' },
    rows: [
      {
        choice: 'both',
        label: 'Keep both',
        sub: 'Yours is saved beside it, with "conflict" and the time in its name.',
        primary: true,
      },
      {
        choice: 'mine',
        label: 'Keep yours',
        sub: 'Yours replaces the other version.',
        armed: 'Really replace it? Tap to confirm.',
      },
      {
        choice: 'theirs',
        label: 'Keep the other version',
        sub: 'Your unsaved edits are discarded.',
        armed: 'Really discard your edits? Tap to confirm.',
      },
    ],
    failure: VAULT_RESOLVE_FAILED,
  };
}

/** The sheet's line when a choice did not go through. */
export const VAULT_RESOLVE_FAILED =
  'Your vault storage did not take that, so nothing changed. Try again.';

/** Under the sub, when the other version changed again while the sheet was up. */
export const VAULT_RESOLVE_AGAIN = 'It changed again while this was open.';

/** The compare pane when the two versions differ only in whitespace. */
export const VAULT_RESOLVE_SAME = 'The two versions differ only in spacing or line endings.';

/** The toast after a choice lands. */
export function vaultResolveToast(
  choice: 'both' | 'mine' | 'theirs' | 'discard',
  opts: { title: string; copyTitle?: string; missing?: boolean },
): string {
  switch (choice) {
    case 'both':
      return `Kept both. Yours is "${opts.copyTitle ?? opts.title}".`;
    case 'mine':
      return opts.missing ? `Saved "${opts.title}" again.` : 'Kept yours.';
    case 'theirs':
      return 'Kept the other version.';
    case 'discard':
      return 'Edits discarded.';
  }
}

/** The standing card on the note while a choice waits (the sheet was closed). */
export function vaultConflictCard(mode: VaultResolveMode): {
  title: string;
  sub: string;
  action: string;
} {
  return mode === 'missing'
    ? {
        title: 'This note is gone',
        sub: 'Your text stays here, unsaved, until you choose.',
        action: 'Choose what to do',
      }
    : {
        title: 'Two versions of this note',
        sub: 'Your edits stay here, unsaved, until you choose.',
        action: 'Choose a version',
      };
}

/** The toast when the person leaves the note before choosing. */
export function vaultLeaveToast(
  mode: VaultResolveMode,
  opts: { title: string; copyTitle: string },
): string {
  return mode === 'missing'
    ? `"${opts.title}" was gone, so your text is kept under Not saved.`
    : `You left before choosing, so both are kept. Yours is "${opts.copyTitle}".`;
}

/** The Not saved reason for text whose note was moved or deleted. */
export const VAULT_GONE_REASON =
  'The note was moved or deleted somewhere else before this text was saved.';

/** A replay found several notes moved or deleted somewhere else before the
 *  text typed in them was saved: the text is held, the notes are not made
 *  again (round 7 E9). The held line follows. */
export function vaultGoneManyLine(count: number): string {
  return `${count} notes with text you had not saved were moved or deleted somewhere else.`;
}

/** The Not saved reason for text stashed on this device that no editor
 *  showed (the note was opened again, at the vault's version, before the
 *  text was saved), once newer text for the same note took its place in the
 *  stash (round 7 E10). */
export const VAULT_UNSEEN_DRAFT_REASON =
  'Typed earlier on this device and not saved before the note was opened and edited again. Copy it into the note if you still need it.';

/** The Not saved reason when no conflict-copy name was free after 20 tries. */
export const VAULT_NO_COPY_NAME_REASON =
  'No free name was left for your copy, so the text is kept here.';

/** The toast when a note with no unsaved edits is moved or deleted somewhere
 *  else: it closes back to its folder. */
export function vaultGoneToast(title: string): string {
  return `"${title}" is no longer in your vault. It was moved or deleted somewhere else.`;
}

/** The toast when a delete did not happen because the note is not the one
 *  this device loaded (Vault M2 wave 0). 'changed': it changed somewhere else
 *  since, so nothing was deleted; `reloaded` when the newer version is open
 *  now in place of a clean note (with unsaved edits, the resolve sheet opens
 *  instead and says the rest). 'downloading': its bytes are not on this
 *  device yet, so its version could not be checked. */
export function vaultStaleDeleteToast(
  kind: 'changed' | 'downloading',
  title: string,
  reloaded = false,
): string {
  if (kind === 'downloading') {
    return `Not deleted. "${title}" is still downloading to this device. Try again in a moment.`;
  }
  return `Not deleted. "${title}" changed somewhere else since you opened it.${reloaded ? ' The newer version is open now.' : ''}`;
}

/** The quiet suffix on a note's meta line after a clean reload in place. No
 *  toast: the person did nothing, and nothing failed. */
export const VAULT_UPDATED_SUFFIX = ' · Updated from elsewhere';

/** The toast after stashed text came back to a note that changed elsewhere
 *  and was kept beside it (the M0 replay, CX 1.1: never "offline", since the
 *  text may never have been offline). */
export function vaultReplayCopiesLine(copies: string[]): string {
  return copies.length === 1
    ? `Text you had not saved in "${noteTitle(copyOrigin(copies[0]!))}" is kept as "${noteTitle(copies[0]!)}", since the note changed elsewhere.`
    : `Text you had not saved in ${copies.length} notes is kept beside them, each marked (conflict), since those notes changed elsewhere.`;
}

// The note a conflict copy stands beside: "Ideas (conflict 2026-09-27 1405).md"
// comes from "Ideas.md".
function copyOrigin(copy: string): string {
  return copy.replace(/ \(conflict \d{4}-\d{2}-\d{2} \d{4}( \d+)?\)(\.md)$/i, '$2');
}

// ---- Save status and conflict copies (2.2) -----------------------------------
// A quiet chip in the note bar says where the text on screen stands: Saved,
// Saving, or kept on this device to save later, with how many notes wait and
// a way to try now. A conflict copy wears a badge in the tree, so the person
// can find the text that landed beside a note.

/** Where the open note's text stands. 'held': its last save was set aside
 *  under Not saved (refused for good, read-only), never "Saved" (E18). */
export type VaultSaveStatus = 'saved' | 'saving' | 'offline' | 'held';

/** The save chip's words: the label, how many notes wait (offline only), and
 *  the retry button's label (offline only; a refusal for good has no retry,
 *  since trying again meets the same refusal). */
export function vaultSaveChip(
  status: VaultSaveStatus,
  pending: number,
): { label: string; count?: string; retry?: string } {
  if (status === 'saved') return { label: 'Saved' };
  if (status === 'saving') return { label: 'Saving' };
  if (status === 'held') return { label: 'Not saved' };
  return {
    label: 'Offline, kept on this device',
    ...(pending > 0
      ? { count: pending === 1 ? '1 note waiting' : `${pending} notes waiting` }
      : {}),
    retry: 'Try again',
  };
}

/** A team note kept open after the sign-in expired (2.6): read-only, and
 *  what to do to save again. */
export const VAULT_TEAM_SIGN_IN_LINE = 'Sign in again to save to your team.';

/** A team step started under one account, refused because another account
 *  is signed in now: nothing more of it is sent under the new one (R-19). */
export const VAULT_TEAM_OTHER_ACCOUNT =
  'It was started under another account, so the rest was not sent.';

/** This account is no longer a member of the team (an admin removed it, or
 *  it left from another device): the reason a save, a new note or a move
 *  refused by the server gives, after its verb (round 7 E26). Nothing in the
 *  team vault was deleted, so no line says it was. */
export const VAULT_TEAM_NOT_MEMBER_REASON = 'You are no longer a member of this team.';

/** Said once, as the room takes the team vault away and shows the personal
 *  one: its notes are still there, only no longer shown to this account. */
export const VAULT_TEAM_NOT_MEMBER =
  'You are no longer a member of this team, so its notes are not shown here.';

// ---- The lease (2.5) ----------------------------------------------------------
// Advisory on a storage with compare-and-swap: one quiet line, never read-only.
// Enforced only on a storage without it, and honest that the storage itself
// does not stop two devices: OpenShore does, by keeping this one read-only.

/** The quiet line while another of the person's devices is editing too. */
export function vaultLeaseAlsoOpen(label: string | undefined): string {
  return label ? `Also open on your ${label}.` : 'Also open on another of your devices.';
}

/** The enforced lease's standing line, its button, and its toasts. */
export function vaultLeaseEnforced(label: string | undefined): {
  line: string;
  takeOver: string;
  tookOver: string;
  refused: string;
  displaced: string;
} {
  const other = label ? `your ${label}` : 'another of your devices';
  return {
    line: `Being edited on ${other}. This storage cannot stop two devices saving over each other, so this one stays read-only until the other stops.`,
    takeOver: 'Take over editing',
    tookOver: 'Editing here now. The other device stops saving within a minute.',
    refused: `Nothing changed, because ${other} is editing this vault. Take over editing to write here.`,
    displaced: `Editing moved to ${other}. What you typed here is kept on this device, and it never replaces a newer version.`,
  };
}

// ---- Who changed a team note (2.7) ---------------------------------------------
// The team vault says who last saved a note. Nothing shows for the person's
// own save; a teammate the vault cannot name is "a teammate", never a guess.

/** The meta line's suffix: " · Edited by sam, 2 min ago", or undefined when
 *  there is nothing to say (no editor known, or the person's own edit). */
export function vaultEditedByLine(
  editedBy: { id: string; label?: string } | undefined,
  updatedAt: string | undefined,
  uid: string | undefined,
  now = Date.now(),
): string | undefined {
  if (!editedBy || (uid !== undefined && editedBy.id === uid)) return undefined;
  const who = editedBy.label || 'a teammate';
  const at = updatedAt ? Date.parse(updatedAt) : NaN;
  if (!Number.isFinite(at) || at > now + 60_000) return ` · Edited by ${who}`;
  const s = Math.max(0, Math.round((now - at) / 1000));
  const hours = Math.floor(s / 3600);
  const ago =
    s < 60
      ? 'just now'
      : s < 3600
        ? `${Math.floor(s / 60)} min ago`
        : s < 86_400
          ? `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
          : `on ${new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  return ` · Edited by ${who}, ${ago}`;
}

/** The badge a conflict copy (lib/vault.ts isConflictCopy) wears in the tree. */
export const VAULT_CONFLICT_BADGE = 'Conflict';
/** What the badge means, for a screen reader. */
export const VAULT_CONFLICT_BADGE_LABEL = 'A copy kept beside a note when two versions met';

// ---- Resolve, move mode (1d) ------------------------------------------------
// A move whose notes landed beside same-named notes with different text: one
// sheet steps through the pairs. The sides are "the one you moved" and "the
// one already there", the nouns the forked move line already uses. Both files
// exist, so closing keeps both, and the sheet says so.

/** Every line of the move-mode sheet for one pair. `copyTitle` is the name the
 *  moved note has now; `i` of `n` steps through the pairs. */
export function vaultMoveResolveCopy(opts: {
  title: string;
  copyTitle: string;
  i: number;
  n: number;
}): VaultResolveCopy & { counter?: string; closeLine: string; partial: string } {
  const { title, copyTitle, i, n } = opts;
  return {
    title: 'Two versions of a note',
    ...(n > 1 ? { counter: `${i} of ${n}` } : {}),
    sub: `"${title}" was already in the folder with different text when your vault moved. Choose which one keeps the name.`,
    closeLine: 'Closing keeps both.',
    tabs: { changes: 'Changes', mine: 'You moved', theirs: 'Already there' },
    legend: { mine: 'Only in the one you moved', theirs: 'Only in the one already there' },
    srPrefix: { mine: 'You moved: ', theirs: 'Already there: ' },
    rows: [
      {
        choice: 'both',
        label: 'Keep both',
        sub: `They stay side by side, the one you moved as "${copyTitle}".`,
        primary: true,
      },
      {
        choice: 'mine',
        label: 'Keep the one you moved',
        sub: 'It takes the name, and the one that was there is deleted.',
        armed: 'Really delete the other? Tap to confirm.',
      },
      {
        choice: 'theirs',
        label: 'Keep the one already there',
        sub: 'The one you moved is deleted.',
        armed: 'Really delete it? Tap to confirm.',
      },
    ],
    failure: 'That did not go through, so both are still there. Try again.',
    partial: `Kept the one you moved, but its copy could not be removed: "${copyTitle}".`,
  };
}

// ---- The one-time desktop move card (1.3, D7) -------------------------------
// A desktop vault still sealed on This device by default, never by the
// person's choice, is offered one move into the folder the agent, routines,
// and Obsidian already use. Both buttons are decisions; the quiet one is
// phrased as a choice, not "Not now". The sealed copy stays (D7).

export interface VaultFolderOffer {
  title: string;
  body: string;
  hint: string;
  link: string;
  primary: string;
  busy: string;
  decline: string;
  declineToast: string;
  retry: string;
  /** Only on the one return (CX 1.3): what changed since the decline. */
  lead?: string;
}

/** The card's lines. `n` is the notes in the sealed vault, `k` the notes
 *  already in the folder (undefined when the folder could not be counted),
 *  and `newSince` the notes the folder gained since a decline, on a return. */
export function vaultFolderOffer(
  n: number,
  k: number | undefined,
  opts: { display?: string; newSince?: number } = {},
): VaultFolderOffer {
  const body =
    n === 1
      ? 'Your note is sealed on this device, where your agent, routines, and Obsidian cannot open it. Move it into the folder your agent already uses, and you all work from the same plain .md files.'
      : `Your ${n} notes are sealed on this device, where your agent, routines, and Obsidian cannot open them. Move them into the folder your agent already uses, and you all work from the same plain .md files.`;
  const kept =
    k === undefined || k === 0
      ? ''
      : k === 1
        ? ' The note already in the folder stays as it is.'
        : ` The ${k} notes already in the folder stay as they are.`;
  const offer: VaultFolderOffer = {
    title: 'One folder for you and your agent',
    body,
    hint: `The sealed copy stays on this device.${kept}`,
    link: 'Use a different folder…',
    primary: 'Move to This folder',
    busy: 'Moving your notes…',
    decline: 'Keep it on this device',
    declineToast: 'Your vault stays on this device. Where it lives can move it any time.',
    retry: 'Try again',
  };
  const m = opts.newSince ?? 0;
  if (m > 0 && opts.display) {
    offer.lead =
      m === 1
        ? `${opts.display} has a new note since you kept your vault on this device.`
        : `${opts.display} has ${m} new notes since you kept your vault on this device.`;
  }
  return offer;
}

/** The one toast when an empty Local vault repoints to the folder (CX 1.3 b). */
export function vaultRepointToast(display: string): string {
  return `Your vault now uses ${display}, the same folder as your agent and routines.`;
}

/** On a note opened while the vault is moving (CX 1.3). */
export function vaultMovingLine(display: string): string {
  return `Your vault is moving to ${display}. You can edit again when it is done.`;
}

// ---- The folder rows in the desktop storage sheet (1.4) ---------------------

/** The open-folder button, in the platform's own words. */
export function vaultRevealLabel(os: string): string {
  if (os === 'darwin') return 'Open in Finder';
  if (os === 'win32') return 'Open in File Explorer';
  return 'Open folder';
}

export const VAULT_OPEN_OBSIDIAN = 'Open in Obsidian';
/** Obsidian is installed but has not opened this folder yet. */
export const VAULT_OBSIDIAN_HOWTO =
  'To open it in Obsidian, choose Open folder as vault there and pick this folder.';
/** The vault folder is not there right now. */
export const VAULT_FOLDER_MISSING_LINE =
  'This folder is not there right now. If it is on a drive, connect the drive, or use another folder.';
export const VAULT_NOT_FOUND_PILL = 'Not found';
/** After a pick, only when a chat on this computer is open (CTO F7). */
export const VAULT_OPEN_CHATS_LINE =
  'New chats use this folder. Chats already open finish in the old one.';
/** Picking the folder already in use. */
export const VAULT_SAME_FOLDER_LINE = 'Your vault already uses this folder.';
/** The macOS privacy refusal's button. */
export const VAULT_PRIVACY_BUTTON = 'Open Privacy & Security';
/** Harbor Lite's line about the picker. */
export const VAULT_GUIDE_PICKER_LINE =
  'On your computer, Use a folder… in Where it lives points the vault at any folder, an existing Obsidian vault included.';

/** The picker row, on the desktop only: undefined anywhere else, so its words
 *  never render off the computer. */
export function vaultPickerRow(
  platform: Platform,
): { label: string; sub: string; busy: string } | undefined {
  if (platform !== 'electron') return undefined;
  return {
    label: 'Use a folder…',
    sub: 'Pick another folder, an existing Obsidian vault included. Notes are not copied.',
    busy: 'Opening',
  };
}

/** loadVaultDir's own warning, verbatim, with the fix on this sheet (CTO T3). */
export function vaultWarningLine(warning: string): string {
  return `${warning} Or use a folder below, which saves a full path.`;
}

/** Why main refused a folder, in one plain sentence each (Creative Studio 3b). */
export function vaultPickRefusal(reason: string, os: string): string {
  switch (reason) {
    case 'root':
      return 'That is the top of a drive. Pick a folder inside it.';
    case 'home':
      return 'That is your whole home folder. Pick a folder inside it.';
    case 'home-ancestor':
      return 'That folder holds your home folder. Pick a folder inside your home folder.';
    case 'osc-home':
      return 'OpenShore keeps its own settings there. Pick another folder.';
    case 'managed-holds':
      return "That folder holds OpenShore's workspaces. Pick another folder.";
    case 'managed-inside':
      return 'OpenShore keeps its workspaces there. Pick another folder.';
    case 'not-writable':
      return 'OpenShore cannot save notes in that folder. Pick one you can edit.';
    case 'denied':
      return os === 'darwin'
        ? 'macOS did not let OpenShore open that folder. Allow it in System Settings, Privacy & Security, Files and Folders, then pick it again.'
        : 'That folder could not be read. Pick another folder.';
    case 'save-failed':
      return 'Could not save your folder choice, so nothing changed.';
    default:
      return 'That folder could not be read. Pick another folder.';
  }
}

/** The Not saved place and reason for text typed against an earlier folder
 *  (CTO F7.6). */
export function vaultEarlierFolderHeld(display: string): { place: string; reason: string } {
  return {
    place: `Personal vault, earlier folder ${display}`,
    reason: `Typed in ${display} before your vault moved to another folder, so it was not saved there.`,
  };
}

/** Whether the iPhone checks before it saves to iCloud (plan 2.1). Until it
 *  does, OpenShore's own iCloud vault carries the caveat below. */
export const vaultIcloudCasOnPhone = false;

const CLOUD_NAMES: Record<string, string> = {
  icloud: 'iCloud Drive',
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
  gdrive: 'Google Drive',
  box: 'Box',
  other: 'A sync service',
};

/** The one line about a synced folder, or undefined for a folder no service
 *  can be told for (CX 1.4). Never names Obsidian. */
export function vaultCloudLine(kind: string | undefined): string | undefined {
  if (!kind) return undefined;
  if (kind === 'icloud-openshore') {
    return vaultIcloudCasOnPhone
      ? undefined
      : "This is your iPhone's iCloud vault, so notes reach your iPhone through iCloud. For now, change a note on one device at a time, since the iPhone can still save over a change it has not seen yet.";
  }
  const name = CLOUD_NAMES[kind] ?? CLOUD_NAMES.other!;
  return `${name} keeps this folder in sync. A note kept only online downloads when you open it, which needs a connection. If two devices change the same note before they sync, a second copy may appear beside it, and both show here. To work offline, set the folder to stay downloaded on this computer.`;
}

/** A vault this size reads Linked mentions on request (CX 1.4). */
export const VAULT_LARGE_NOTES = 1000;

/** The facts line under the result block's heading. */
export function vaultFolderFacts(s: {
  notes: number;
  capped: boolean;
  otherFiles: number;
  obsidian: boolean;
}): string {
  if (s.obsidian) {
    return s.capped
      ? "An Obsidian vault with more than 10,000 notes. Obsidian's own settings are left alone."
      : `An Obsidian vault with ${s.notes} ${s.notes === 1 ? 'note' : 'notes'}. Obsidian's own settings are left alone.`;
  }
  if (s.notes === 0) {
    if (!s.otherFiles) return 'No notes here yet.';
    return s.otherFiles === 1
      ? 'No notes here yet. The 1 other file here stays as it is, since the Vault shows only .md notes.'
      : `No notes here yet. The ${s.otherFiles} other files here stay as they are, since the Vault shows only .md notes.`;
  }
  if (s.capped) return 'A folder with more than 10,000 notes.';
  return s.notes === 1 ? 'A folder with 1 note.' : `A folder with ${s.notes} notes.`;
}

/** One question after a pick, when the folder sits in or around Obsidian
 *  vaults or is OpenShore's iCloud folder, in that priority (CX 1.4). */
export type VaultFolderQuestion = {
  line: string;
  hint?: string;
  choices: Array<{
    label: string;
    sub?: string;
    tone: 'primary' | 'ghost' | 'quiet';
    choice: { to: 'enclosing' } | { to: 'child'; name: string } | { to: 'stay' };
  }>;
};

export function vaultFolderQuestion(
  picked: string,
  s: {
    obsidian: boolean;
    inside?: { name: string };
    holds?: string[];
    holdsMore?: number;
    icloudRoot?: boolean;
  },
): VaultFolderQuestion | undefined {
  if (s.obsidian) return undefined;
  if (s.inside) {
    const vault = s.inside.name;
    return {
      line: `"${picked}" is a folder inside your Obsidian vault "${vault}".`,
      choices: [
        {
          label: `Use all of "${vault}"`,
          sub: 'Links work the way they do in Obsidian.',
          tone: 'primary',
          choice: { to: 'enclosing' },
        },
        {
          label: `Keep just "${picked}"`,
          sub: 'Your agent sees only this folder, and links to notes outside it will not open here.',
          tone: 'quiet',
          choice: { to: 'stay' },
        },
      ],
    };
  }
  const holds = s.holds ?? [];
  if (holds.length === 1 && !s.holdsMore) {
    const name = holds[0]!;
    return {
      line: `This folder holds an Obsidian vault, "${name}". Use it as your vault?`,
      choices: [
        { label: `Use "${name}"`, tone: 'primary', choice: { to: 'child', name } },
        { label: 'Use the whole folder', tone: 'quiet', choice: { to: 'stay' } },
      ],
    };
  }
  if (holds.length) {
    const total = holds.length + (s.holdsMore ?? 0);
    const q: VaultFolderQuestion = {
      line: `This folder holds ${total} Obsidian vaults. Which one is your vault?`,
      choices: [
        ...holds.map((name) => ({
          label: name,
          tone: 'ghost' as const,
          choice: { to: 'child' as const, name },
        })),
        { label: 'Use the whole folder', tone: 'quiet', choice: { to: 'stay' } },
      ],
    };
    if (s.holdsMore) {
      q.hint = `${s.holdsMore} more are inside. Use Choose a folder to pick one of them directly.`;
    }
    return q;
  }
  if (s.icloudRoot) {
    return {
      line: `This is OpenShore's iCloud folder. Your iPhone's vault is the folder "vault.personal" inside it.`,
      choices: [
        {
          label: 'Use vault.personal',
          tone: 'primary',
          choice: { to: 'child', name: 'vault.personal' },
        },
        { label: 'Keep this folder', tone: 'quiet', choice: { to: 'stay' } },
      ],
    };
  }
  return undefined;
}

/** The result block's other lines (CX 1.4). */
export function vaultPickResultCopy(opts: {
  display: string;
  previous?: { display: string; notes?: number };
  fromLocal?: { notes: number };
  large: boolean;
}): {
  heading: string;
  large?: string;
  back?: { label: string; toast: string };
  move?: { label: string; sub: string };
  bring?: { label: string; sub: string; busy: string };
} {
  const out: ReturnType<typeof vaultPickResultCopy> = {
    heading: `Your vault is now ${opts.display}.`,
  };
  if (opts.large) out.large = 'In a vault this size, Linked mentions load when you ask for them.';
  if (opts.previous) {
    out.back = {
      label: `Go back to ${opts.previous.display}`,
      toast: `Your vault is back in ${opts.previous.display}.`,
    };
    // Bring (CX 1.4, the CTO's ruling): only when the folder before held notes.
    const n = opts.previous.notes ?? 0;
    if (n > 0) {
      out.bring = {
        label: `Bring ${n === 1 ? '1 note' : `${n} notes`} from ${opts.previous.display}`,
        sub: 'Copies them here. Nothing here is replaced, and the originals stay where they are.',
        busy: 'Bringing your notes',
      };
    }
  }
  if (opts.fromLocal && opts.fromLocal.notes > 0) {
    const n = opts.fromLocal.notes;
    out.move = {
      label: n === 1 ? 'Move 1 note here' : `Move ${n} notes here`,
      sub: 'Copies your sealed notes into this folder. Nothing here is replaced, and a sealed copy stays in OpenShore on this computer.',
    };
  }
  return out;
}

/** What Bring did, said plainly (CX 1.4). A clean Bring says where the notes
 *  came from and that the originals stay; a note that landed beside one
 *  already here is named with the move's own forked line. Pass `forked: []`
 *  when the move-mode sheet shows the pairs instead. Nothing is claimed that
 *  did not happen: a partial Bring names what stayed behind. */
export function vaultBringLine(
  result:
    | {
        ok: boolean;
        moved: string[];
        skipped: string[];
        forked: Array<{ from: string; to: string }>;
        capped?: boolean;
        reason?: string;
      }
    | undefined,
  prevDisplay: string,
): string {
  const originals = 'The originals stay there.';
  const forks = result ? forkedLine(result.forked) : undefined;
  const join = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(' ');
  if (!result) return `Could not bring your notes from ${prevDisplay}. Try again in a moment.`;
  if (result.ok) {
    return join(`Your notes from ${prevDisplay} are here now.`, originals, forks);
  }
  const brought = result.moved.length + result.forked.length;
  switch (result.reason) {
    case 'same':
      return `Your vault already uses ${prevDisplay}, so there is nothing to bring.`;
    case 'nested':
      return 'One of these folders is inside the other, so nothing was brought.';
    case 'unavailable':
      return `${prevDisplay} or your vault folder is not there right now, so nothing was brought.`;
    case 'capped':
      return join(
        `The first ${brought} notes from ${prevDisplay} are here now. The rest are still only there, since Bring stops at 10,000 notes.`,
        originals,
        forks,
      );
    default: {
      const n = result.skipped.length;
      if (!brought) {
        return `Could not copy your notes from ${prevDisplay}, so nothing was brought. Try again in a moment.`;
      }
      return join(
        `Your notes from ${prevDisplay} are here now, except ${n === 1 ? 'one that could not be copied and is' : `${n} that could not be copied and are`} still only there.`,
        originals,
        forks,
        `Try again to bring ${n === 1 ? 'it' : 'them'}.`,
      );
    }
  }
}

/** The vault folder is missing (CX 1.4): the room says so and writes nothing. */
export function vaultMissingFolderCard(display: string): {
  title: string;
  line: string;
  retry: string;
  choose: string;
} {
  return {
    title: 'Your vault folder is missing',
    line: `OpenShore cannot find ${display}. It may have been moved or renamed, or it may be on a drive that is not connected.`,
    retry: 'Try again',
    choose: 'Choose a folder',
  };
}

/** While a newly pointed folder is still listing: never the empty ramp. */
export const VAULT_OPENING_LINE = 'Opening your vault.';

/** What the context-pack card needs to know (Vault M4, 4.4). */
export interface ContextPackCopyInput {
  seat: 'local' | 'cloud';
  sources: ReadonlyArray<{ layer: string; path: string; title: string }>;
  withheld: number;
  cold: boolean;
}

/** The context-pack card's lines. `notes` are the Vault notes to list;
 *  this project's Current State is read from the repo, not the Vault, so it
 *  is named in the headline and never counted as a Vault note. */
export interface ContextPackCopy {
  headline: string;
  seat: string;
  notes: Array<{ path: string; title: string }>;
  withheld?: string;
  cold?: string;
  /** On a device that is not the computer: where the notes are. */
  remote?: string;
}

const notesWord = (n: number) => `${n} ${n === 1 ? 'note' : 'notes'}`;

/** The pack layers that carry a Vault note (the engine's PackLayer). */
const PACK_NOTE_LAYERS: ReadonlySet<string> = new Set(['pin', 'search', 'link']);

/** The context-pack card, in words that match the event exactly. Undefined
 *  when the pack used nothing and held nothing back: no card then. `remote`
 *  is true on any device that is not the computer running the session (a
 *  phone driving it), where the notes cannot be opened yet. */
export function contextPackCopy(
  pack: ContextPackCopyInput,
  opts: { remote: boolean },
): ContextPackCopy | undefined {
  const currentState = pack.sources.some((s) => s.layer === 'current-state');
  // Only a real Vault note counts as one: a pin, a search hit, or a linked
  // note, each with its path. The Vault map (folders and newest titles) and
  // the handoff carry no path, and Current State is the repo's own file.
  const notes: Array<{ path: string; title: string }> = [];
  for (const s of pack.sources) {
    if (!PACK_NOTE_LAYERS.has(s.layer) || !s.path) continue;
    if (notes.some((n) => n.path === s.path)) continue;
    notes.push({ path: s.path, title: s.title });
  }
  const map = pack.sources.some((s) => s.layer === 'map');
  const withheld = Math.max(0, Math.floor(pack.withheld));
  if (!currentState && !notes.length && !map && !withheld) return undefined;
  const headline =
    currentState && notes.length
      ? `Used this project's Current State and ${notesWord(notes.length)} from your Vault`
      : currentState
        ? "Used this project's Current State"
        : notes.length
          ? `Used ${notesWord(notes.length)} from your Vault`
          : map
            ? 'Used an outline of your Vault, no notes'
            : 'No notes from your Vault went to this model';
  const where = opts.remote ? 'your computer' : 'this computer';
  return {
    headline,
    seat: pack.seat === 'cloud' ? 'Sent to a cloud model' : 'Stayed with a local model',
    notes,
    ...(withheld
      ? {
          withheld: `${withheld} private ${withheld === 1 ? 'note' : 'notes'} stayed on ${where}.`,
        }
      : {}),
    ...(pack.cold && currentState
      ? { cold: 'Your Vault was still loading, so this turn has Current State only.' }
      : {}),
    ...(opts.remote && notes.length
      ? {
          remote: `${notes.length === 1 ? 'This note is' : 'These notes are'} on your computer. Open ${notes.length === 1 ? 'it' : 'them'} there for now.`,
        }
      : {}),
  };
}

/** Linked mentions in a vault over VAULT_LARGE_NOTES notes, on request. */
export function vaultMentionsOnDemand(n: number): { hint: string; button: string; busy: string } {
  return {
    hint: `This vault has ${n} notes, so Linked mentions load when you ask. Finding them reads every note, which takes a moment.`,
    button: 'Find linked mentions',
    busy: `Reading ${n} notes`,
  };
}

// ============================================================================
// Vault M6 wave 0: one fenced section per build stream. A stream writes only
// inside its own fence. Every string passes the RETIRED list, copy-glossary and
// both em-dash guards (CX R1, R2).

// ---- M6 stream C begin ----
// Capabilities (K1): the line per provider and cap pair that says why an
// action is not offered here. Covered for every pair by vaultCaps.test.ts
// (kept apart from vaultCopy.test.ts so the wave 1 streams do not collide),
// and swept by the RETIRED list, copy-glossary and both em-dash guards.

/** The caps that can be missing for a reason a person should read. (The
 *  eight in `VaultCaps` minus `renameNative`, which changes nothing a person
 *  sees, plus `emptyTrash`.) */
export type VaultCapLineName =
  | 'rename'
  | 'folders'
  | 'trash'
  | 'emptyTrash'
  | 'attachments'
  | 'taskWriteBack'
  | 'linkRewrite'
  | 'today'
  // Vault M7 (CTO L7): the settings sheet; its lines are in the M7 stream E
  // fence (`vaultSettingsCapLine`).
  | 'settingsWrite';

export const VAULT_CAP_LINE_NAMES: readonly VaultCapLineName[] = [
  'rename',
  'folders',
  'trash',
  'emptyTrash',
  'attachments',
  'taskWriteBack',
  'linkRewrite',
  'today',
  'settingsWrite',
];

/** The M6 caps, whose lines are in the tables below. */
type M6CapLineName = Exclude<VaultCapLineName, 'settingsWrite'>;

const DRIVE_READ_ONLY = 'Google Drive vaults are read-only here';

/** How many days a deleted team note waits in Trash: org_vault_purge's
 *  default window, which pg_cron runs weekly with no argument (migration
 *  0021; vaultCopy.test.ts reads both there). A lower bound, since the purge
 *  runs once a week, so the copy says "for 30 days" and "after 30 days". */
export const VAULT_TEAM_TRASH_DAYS = 30;

const CAP_LINES: Record<M6CapLineName, Partial<Record<VaultCopyProvider, string>>> = {
  rename: {
    icloud: 'Notes in iCloud Drive cannot be renamed here yet. The Files app can rename them.',
    org: 'Team notes cannot be renamed here yet.',
    gdrive: `${DRIVE_READ_ONLY}, so notes cannot be renamed.`,
  },
  folders: {
    icloud: 'Folders in iCloud Drive cannot be made or renamed here yet. The Files app can.',
    org: 'Team folders cannot be made or renamed here yet.',
    gdrive: `${DRIVE_READ_ONLY}, so folders cannot change.`,
  },
  trash: {
    icloud: 'iCloud Drive has no Trash here yet, so a delete is for good and asks twice.',
    org: 'Team notes have no Trash here yet, so a delete is for good and asks twice.',
    gdrive: `${DRIVE_READ_ONLY}, so notes cannot be deleted.`,
  },
  emptyTrash: {
    org: `Deleted team notes are cleared from your organization's history after ${VAULT_TEAM_TRASH_DAYS} days.`,
  },
  attachments: {
    local: 'This device keeps notes only, so images and PDFs do not show here.',
    icloud: 'Images and PDFs in iCloud Drive do not show here yet.',
    org: 'Team vaults hold notes only, so images and PDFs do not show here.',
    gdrive: 'Images and PDFs in Google Drive do not show here.',
  },
  taskWriteBack: {
    icloud: 'To tick a box in an iCloud Drive note, edit the note.',
    org: 'To tick a box in a team note, edit the note.',
    gdrive: `${DRIVE_READ_ONLY}, so boxes cannot be ticked.`,
  },
  linkRewrite: {
    icloud: 'Links are not updated in iCloud Drive yet.',
    org: 'Links are not updated in team notes yet.',
    gdrive: `${DRIVE_READ_ONLY}, so links cannot be updated.`,
  },
  today: {
    icloud:
      "Today's note is not offered for iCloud Drive yet, so a note already there is never written over.",
    org: "Today's note is not offered for team vaults yet, so no one's note is written over.",
    gdrive: `${DRIVE_READ_ONLY}, so today's note cannot be started.`,
  },
};

const CAP_FALLBACK: Record<M6CapLineName, string> = {
  rename: 'This storage cannot rename notes here yet.',
  folders: 'This storage cannot make or rename folders here yet.',
  trash: 'This storage has no Trash here, so a delete is for good and asks twice.',
  emptyTrash: 'Trash here cannot be emptied from this app.',
  attachments: 'Images and PDFs do not show from this storage yet.',
  taskWriteBack: 'To tick a box here, edit the note.',
  linkRewrite: 'Links to a renamed note are not updated on this storage.',
  today: "Today's note is not offered for this storage yet.",
};

/** Why `cap` is not offered on `provider`. Total over every pair, so a held
 *  branch that lights a cap needs no copy change; the room shows it only
 *  where `vaultCaps(...)[cap]` is false for the storage itself (read-only
 *  and away keep their own standing lines). */
export function vaultCapLine(provider: VaultCopyProvider, cap: VaultCapLineName): string {
  if (cap === 'settingsWrite') return vaultSettingsCapLine(provider);
  return CAP_LINES[cap][provider] ?? CAP_FALLBACK[cap];
}

/** A desktop build whose main process does not answer an M6 call. */
export const VAULT_CAP_UPDATE_LINE = 'Update OpenShore on this computer to do that here.';

/** A folder moved into itself, refused before anything moves. */
export const VAULT_FOLDER_INTO_ITSELF = 'A folder cannot move inside itself, so nothing changed.';

/** A path that is not a folder the vault can act on (rooted, a dot folder,
 *  or empty), refused before it reaches the storage. */
export function vaultNotFolderLine(path: string): string {
  return `"${path}" is not a folder the vault can change.`;
}

/** A path that is not an attachment the vault reads. */
export function vaultNotAttachmentLine(path: string): string {
  return `"${path}" is not an image or a PDF the vault can open.`;
}

// ---- M6 stream C end ----

// ---- M6 stream E begin ----
// Reader (6.5, 6.6): callout titles, embeds, images and PDFs (CX X12, X14).

/** The reading view's lines: scroll-to, note embeds, images, PDFs. */
export const vaultReaderCopy = {
  /** `[[Note#Heading]]` or `[[Note#^id]]` opened, and the target is gone. */
  anchorMissing: (heading: string, note: string): string =>
    `No heading "${heading}" in "${note}", so it opened at the top.`,
  /** The quiet header over a note embed; a tap opens the note. */
  embedFrom: (title: string): string => `From "${title}"`,
  /** A second level of embed, or one past the per-note cap. */
  embedNested: (title: string): string => `"${title}" is embedded here. Open it to read it.`,
  embedMissing: (title: string): string => `No note named "${title}" yet.`,
  /** Visually hidden while an embed or an image reads. */
  loading: (name: string): string => `Loading ${name}`,
  imageMissing: (name: string): string => `Image not found: ${name}`,
  imageDownloading: (name: string): string => `Downloading ${name}`,
  imageAway: 'Your computer is off, so this image cannot load.',
  imageTooLarge: (name: string): string => `${name} is too large to show here.`,
  /** A PDF that would not open, and an image whose bytes are not an image. */
  couldNotOpen: (name: string): string => `${name} could not be opened here.`,
  pdfSub: 'PDF',
  /** The phone, until a native preview lands (CTO K11). */
  pdfElsewhere: 'Open it on your computer.',
  fileMissing: (name: string): string => `File not found: ${name}`,
  /** Other file types keep M3's line (CX X14). */
  otherFile: 'Attachments do not open in the Vault yet.',
} as const;

// ---- M6 stream E end ----

// ---- M6 stream F begin ----
// Search (6.1): the search field, results, counts, index states, the switcher,
// Recent (CX X1 to X4).

/** The tree's search field (X1): the placeholder matches VaultNotePicker's. */
export const VAULT_SEARCH_PLACEHOLDER = 'Search notes';
export const VAULT_SEARCH_LABEL = 'Search your vault';
/** Under the field while it is focused and empty. */
export const VAULT_SEARCH_HINT = 'Try tag:, path:, file:, or "an exact phrase".';
/** The two result groups (X2): titles are instant, text follows. */
export const VAULT_SEARCH_TITLES = 'Titles';
export const VAULT_SEARCH_IN_NOTES = 'In notes';
/** Past the row cap. */
export const VAULT_SEARCH_CAPPED = 'Showing the first 50. Add a word to narrow it.';
/** While the index is still reading bodies, a no-match is not final. */
export const VAULT_SEARCH_MORE_LOADING = 'More may appear as notes finish loading.';
/** The index could not read bodies: titles still match. */
export const VAULT_SEARCH_FAILED =
  'Could not read note text for search, so only titles match. Try again.';
export const VAULT_SEARCH_TRY_AGAIN = 'Try again';
/** Your computer is off: the search runs over what this device last saw. */
export const VAULT_SEARCH_AWAY = 'Your computer is off, so this searches the notes last seen here.';

/** The count line under the field, `role="status"`. */
export function vaultSearchCount(n: number): string {
  return n === 1 ? '1 note' : `${n} notes`;
}

/** No row matched what was typed. */
export function vaultSearchNoMatch(q: string): string {
  return `No notes match "${q.trim()}".`;
}

/** The M3 index is still building: titles answer now, text follows. */
export function vaultSearchIndexing(done: number, total: number): string {
  return `Titles are ready. Reading note text, ${done} of ${total}.`;
}

/** A result row's folder as a muted sub-label: `Work / Plans`, nothing at the
 *  root. */
export function vaultSearchFolder(folder: string): string {
  return folder ? folder.split('/').join(' / ') : '';
}

/** A row's spoken label (X2): `{title}, in {folder}. {excerpt}`. The marks
 *  add nothing spoken. */
export function vaultSearchRowLabel(title: string, folder: string, excerpt?: string): string {
  const where = folder ? `${title}, in ${vaultSearchFolder(folder)}.` : `${title}.`;
  return excerpt ? `${where} ${excerpt}` : where;
}

/** The quick switcher (X3), a desktop overlay. */
export const VAULT_SWITCHER_TITLE = 'Open a note';
export const VAULT_SWITCHER_PLACEHOLDER = 'Type a note name';
export const VAULT_SWITCHER_TODAY = "Today's note";
export const VAULT_RECENT_TITLE = 'Recent';

/** The switcher's last row when no title matches exactly. */
export function vaultSwitcherNew(q: string): string {
  return `New note "${q.trim()}"`;
}

/** The sub-label on an agent-written Recent row (X4), shown ONLY where
 *  `vaultCopy(platform, provider).agent` is defined: desktop This folder and a
 *  paired phone on Your computer. Everywhere else the row is plain. */
export function vaultRecentAgentLabel(copy: Pick<VaultCopy, 'agent'>): string | undefined {
  return copy.agent ? 'From your agent' : undefined;
}

// ---- M6 stream F end ----

// ---- M6 stream G begin ----
// Rename (6.2), Trash (6.3) and checkbox write-back: rename and move, folders,
// Update links and the partial report, delete, Undo, the Trash view, a refused
// tick (CX X5 to X10, X13; CTO R1 to R3).

/** How a folder reads in a line: "Work / Plans", or nothing at the root. */
export function vaultFolderLabel(folder: string): string {
  return folder.split('/').filter(Boolean).join(' / ');
}

/** "1 note" or "12 notes", and the same for links and other files. */
function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A note count with its attachments, the way every folder sheet states it
 *  before it acts (CTO K5): "12 notes and 3 other files". */
export function vaultNotesAndFiles(notes: number, files: number): string {
  return files ? `${count(notes, 'note')} and ${count(files, 'other file')}` : count(notes, 'note');
}

// Rename or move (6.2, CX X5).
export const VAULT_RENAME_ROW = 'Rename or move';
export const VAULT_RENAME_TITLE = 'Rename or move';
export const VAULT_RENAME_NAME = 'Name';
export const VAULT_RENAME_FOLDER = 'Folder';
export const VAULT_RENAME_ROOT = 'Top of the vault';
export const VAULT_RENAME_HERE = 'Here now';
export const VAULT_RENAME_SAVE = 'Rename';
export const VAULT_RENAME_MOVE = 'Move here';
export const VAULT_RENAME_BAD_CHARS = 'Note names cannot use [ ] # ^ | \\ : * ? " < or >.';

/** The name is taken where it would go (X5). */
export function vaultRenameTaken(name: string, folder: string): string {
  const where = folder ? vaultFolderLabel(folder) : 'your vault';
  return `"${name}" is already in ${where}. Pick another name.`;
}

/** The rename itself failed, so nothing changed (X5). */
export function vaultRenameFailed(old: string): string {
  return `Could not rename "${old}", so nothing changed. Try again in a moment.`;
}

/** The note changed somewhere else before the rename ran. */
export function vaultRenameChanged(old: string): string {
  return `"${old}" changed somewhere else, so it was not renamed. The newer version is open now.`;
}

/** The note is open with a choice waiting (R1: never renamed under it). */
export const VAULT_RENAME_CHOICE_OPEN = 'Choose what to keep in this note first, then rename it.';

// "Update links?" (X6).
export interface VaultUpdateLinksCopy {
  title: string;
  sub: string;
  primary: string;
  quiet: string;
  quietSub: string;
}

export function vaultUpdateLinksCopy(o: {
  kind: 'note' | 'folder';
  old: string;
  next: string;
  links: number;
  notes: number;
  /** Notes moving with a folder. */
  moving?: number;
}): VaultUpdateLinksCopy {
  const links = count(o.links, 'link');
  const inNotes = count(o.notes, 'note');
  const sub =
    o.kind === 'folder'
      ? `${count(o.moving ?? 0, 'note')} move to "${o.next}", and ${links} in ${inNotes} point into it. Update them?`
      : `${links} in ${inNotes} ${o.links === 1 ? 'points' : 'point'} to "${o.old}". Update ${o.links === 1 ? 'it' : 'them'} to "${o.next}"?`;
  return {
    title: 'Update links?',
    sub,
    primary: 'Update links',
    quiet: 'Rename only',
    quietSub: `Links to "${o.old}" will not open "${o.next}" until you change them.`,
  };
}

/** While a long pass runs (over 20 notes). */
export function vaultUpdatingLinks(i: number, m: number): string {
  return `Updating links, ${i} of ${m}`;
}

/** A pass over this many notes shows its progress on the primary (X6). */
export const VAULT_UPDATING_SHOWN_OVER = 20;

/** The toast after a rename or move lands (X6, X7). A skipped note is named,
 *  and a partial pass never reads as a plain success. */
export function vaultRenameToast(o: {
  old: string;
  next: string;
  /** Undefined for Rename only. */
  rewrite?: {
    updated: number;
    total: number;
    skipped: readonly string[];
    notUpdated: readonly string[];
    stopped: boolean;
    /** A refusal for good stopped the pass (a team out of free space): its
     *  reason, said in place of "tries again". */
    refusal?: string;
  };
}): string {
  const head = `Renamed to "${o.next}".`;
  const r = o.rewrite;
  if (!r) return head;
  // Refused for good (a team out of free space, 0023): the storage's reason,
  // never "tries again", since Update the rest would be refused the same way.
  if (r.refusal) {
    const left = r.skipped.length + r.notUpdated.length;
    return r.updated === 0
      ? `${head} Its links were not updated. ${reasonSentence(r.refusal)}`
      : `${head} ${r.updated} of ${count(r.total, 'link')} updated. ${count(left, 'note')} still ${left === 1 ? 'links' : 'link'} to "${o.old}". ${reasonSentence(r.refusal)}`;
  }
  if (r.stopped && r.updated === 0) {
    return `Renamed to "${o.next}", but its links could not be updated. Update the rest tries again.`;
  }
  const left = [...r.skipped, ...r.notUpdated];
  if (!left.length) return `${head} ${count(r.updated, 'link')} updated.`;
  if (left.length === 1 && !r.notUpdated.length) {
    return `${head} "${left[0]}" changed while this ran, so its link still points to "${o.old}".`;
  }
  if (r.stopped) {
    return `${head} ${r.updated} of ${count(r.total, 'link')} updated. ${count(left.length, 'note')} could not be reached, so their links still point to "${o.old}".`;
  }
  return `${head} ${r.updated} of ${count(r.total, 'link')} updated. ${count(left.length, 'note')} changed while this ran, so their links still point to "${o.old}".`;
}

/** The standing card on the renamed note, since toasts fade (X7). */
export function vaultLinksLeftCard(old: string): { title: string; button: string } {
  return { title: `Some links still point to "${old}"`, button: 'Update the rest' };
}

// Folders (X5, X8).
export const VAULT_FOLDER_OPTIONS = 'Folder options';
export const VAULT_FOLDER_RENAME = 'Rename folder';
export const VAULT_FOLDER_MOVE = 'Move folder';
export const VAULT_FOLDER_DELETE = 'Delete folder';
export const VAULT_FOLDER_NEW = 'New folder';
export const VAULT_FOLDER_NAME = 'Folder name';
export const VAULT_FOLDER_CREATE = 'Create folder';
export const VAULT_FOLDER_BAD_NAME = 'Folder names cannot use [ ] # ^ | \\ : * ? " < or >.';

/** The folder options button's label (X18). */
export function vaultFolderOptionsLabel(folder: string): string {
  return `Options for ${vaultFolderLabel(folder)}`;
}

/** The folder name is taken. */
export function vaultFolderTaken(name: string): string {
  return `A folder named "${name}" is already here. Pick another name.`;
}

/** The armed second tap on Delete folder (X8). */
export function vaultFolderDeleteArmed(notes: number, files: number): string {
  return `Really move ${vaultNotesAndFiles(notes, files)} to Trash? Tap to confirm.`;
}

/** What a folder holds, said before anything acts on it (K5). */
export function vaultFolderHolds(notes: number, files: number): string {
  return `This folder holds ${vaultNotesAndFiles(notes, files)}.`;
}

// Delete (6.3, X8 with R2). One tap where Trash is real; two taps, worded as
// permanent, everywhere else.
export const VAULT_DELETE_ROW = 'Delete this note';

/** The armed second tap where a delete is for good (R2). */
export function vaultDeleteForGood(title?: string): string {
  return title
    ? `Really delete "${title}" for good? Tap to confirm.`
    : 'Really delete this note for good? Tap to confirm.';
}

/** A trash move that did not happen (X8). */
export function vaultTrashFailed(title: string): string {
  return `Not deleted. Could not move "${title}" to Trash. Try again in a moment.`;
}

// Undo (X9).
export const VAULT_UNDO = 'Undo';
export const VAULT_UNDO_ALSO_IN_TRASH = 'Also in Trash.';
/** A delete with no Trash behind it (K6, R2). */
export const VAULT_DELETED = 'Deleted.';

/** The Undo toast's text. */
export function vaultUndoText(o: { trashed: boolean; folder: boolean; notes: number }): string {
  if (!o.trashed) return VAULT_DELETED;
  return o.folder ? `Moved ${count(o.notes, 'note')} to Trash.` : 'Moved to Trash.';
}

/** The Undo button's accessible label (X9). */
export function vaultUndoLabel(title: string): string {
  return `Undo, restore ${title}`;
}

/** Undo or Restore landed (X9, X10). `folder` names where it went back to;
 *  `renamed` is the "(restored)" beside rule (R3). */
export function vaultRestoredToast(o: {
  title: string;
  folder?: string;
  renamed?: boolean;
  /** The Trash view names the folder; Undo does not need to. */
  sayFolder?: boolean;
}): string {
  const where = o.folder ? vaultFolderLabel(o.folder) : 'your vault';
  if (o.renamed) {
    return `"${o.title}" was already in ${where}, so the restored one is "${o.title} (restored)".`;
  }
  return o.sayFolder ? `Restored "${o.title}" to ${where}.` : `Restored "${o.title}".`;
}

/** Undo or Restore found nothing left in Trash to put back: it was restored
 *  or cleared somewhere else (a teammate, the purge, another device). */
export function vaultTrashGone(title: string): string {
  return `"${title}" is no longer in Trash. It was restored or cleared somewhere else.`;
}

/** Undo or Restore could not put it back. */
export function vaultRestoreFailed(title: string): string {
  return `Could not restore "${title}". It is still in Trash. Try again in a moment.`;
}

/** The courtesy Undo (no Trash) found the name taken twice. */
export function vaultUndoFailed(title: string): string {
  return `Could not bring back "${title}", since its name is taken. Try again in a moment.`;
}

// The Trash view (X10, R3).
export const VAULT_TRASH = 'Trash';
export const VAULT_TRASH_BACK = 'Vault';
export const VAULT_TRASH_RESTORE = 'Restore';
export const VAULT_TRASH_EMPTY = 'Empty Trash';
export const VAULT_TRASH_IS_EMPTY = 'Trash is empty.';
/** The team Trash's second line: what the weekly purge does after the lead's
 *  window (VAULT_TEAM_TRASH_DAYS). */
export const VAULT_TRASH_TEAM_LINE =
  "After that they are cleared from your organization's history.";

/** The lead line, per kind of storage (X10; never "stay in the vault"). */
export function vaultTrashLead(kind: 'folder' | 'local' | 'team'): string {
  if (kind === 'folder') {
    return 'Deleted notes wait here, in the .trash folder, until you empty it.';
  }
  if (kind === 'team') {
    return `Deleted team notes can be restored from here for ${VAULT_TEAM_TRASH_DAYS} days.`;
  }
  return 'Deleted notes wait here until you empty Trash.';
}

/** When a note was deleted, in the `vaultResolveWhen` style: "today at 2:14
 *  PM", else "Sep 27". Undefined when the storage does not say. */
export function vaultTrashWhen(
  trashedAt: string | undefined,
  now = Date.now(),
): string | undefined {
  if (!trashedAt) return undefined;
  const t = new Date(trashedAt);
  if (Number.isNaN(t.getTime())) return undefined;
  if (new Date(now).toDateString() === t.toDateString()) {
    return `today at ${t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  return t.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** A Trash row's sub-label: "From Work / Plans · Deleted today at 2:14 PM",
 *  plus " · by {name}" on a team row. */
export function vaultTrashRowSub(o: { folder: string; when?: string; by?: string }): string {
  const parts = [`From ${o.folder ? vaultFolderLabel(o.folder) : 'the top of the vault'}`];
  if (o.when) parts.push(`Deleted ${o.when}`);
  if (o.by) parts.push(`by ${o.by}`);
  return parts.join(' · ');
}

/** The Restore button's accessible label. */
export function vaultTrashRestoreLabel(title: string): string {
  return `Restore ${title}`;
}

/** The armed second tap on Empty Trash (X10). */
export function vaultTrashEmptyArmed(n: number): string {
  return `Really delete ${count(n, 'note')} for good? Tap to confirm.`;
}

/** Empty Trash landed, whole or in part (X10). */
export function vaultTrashEmptied(removed: number, asked: number): string {
  if (removed >= asked) return `Trash emptied. ${count(removed, 'note')} deleted for good.`;
  const stayed = asked - removed;
  return `${count(removed, 'note')} deleted for good. ${stayed} could not be removed and ${stayed === 1 ? 'is' : 'are'} still in Trash.`;
}

/** Empty Trash did not run. */
export const VAULT_TRASH_EMPTY_FAILED =
  'Could not empty Trash, so nothing was deleted. Try again in a moment.';

/** Trash could not be read. */
export const VAULT_TRASH_LIST_FAILED = 'Could not open Trash. Try again in a moment.';

// A refused tick (X13).
export function vaultTickChanged(title: string): string {
  return `"${title}" changed somewhere else, so that box was not ticked. The newer version is open now.`;
}
export const VAULT_TICK_FAILED = 'Could not save that tick. Try again.';
/** A tick on a note whose editor holds text the note does not have yet (a
 *  save held under Not saved, or kept to send when the connection returns):
 *  the box was counted on that text, so it is not ticked on the note, whose
 *  line there may be another task (round 7 E30). */
export function vaultTickUnsaved(title: string): string {
  return `"${title}" has text that is not saved yet, so that box was not ticked.`;
}

// ---- M6 stream G end ----

// ---- M6 stream H begin ----
// Linking and context (6.7, 6.8) and Today (6.4): link suggestions and the
// accessory bar, outline, outgoing and unlinked mentions, the backlinks
// skeleton, Today's note (CX X11, X15 to X17).

/** The link suggestions (CX X15). */
export const VAULT_LINK_LIST_LABEL = 'Link a note';
export function vaultLinkChipAria(title: string, folder: string): string {
  return folder ? `${title}, in ${folder}` : title;
}
export function vaultLinkNew(q: string): string {
  return `New: ${q}`;
}
export function vaultLinkNewAria(q: string): string {
  return `Link to a new note named ${q}`;
}
export function vaultLinkHeading(heading: string): string {
  return `# ${heading}`;
}
export function vaultLinkHeadingAria(heading: string): string {
  return `Heading ${heading}`;
}

/** The phone's accessory bar above the keyboard (CX X15). */
export const VAULT_ACCESSORY = {
  label: 'Note tools',
  link: 'Insert link',
  tag: 'Insert tag',
  task: 'Make this line a task',
  hide: 'Hide keyboard',
} as const;

/** The outline sheet (CX X16). */
export const VAULT_OUTLINE_TITLE = 'Outline';
export function vaultOutlineRowAria(level: number, text: string): string {
  return `Heading level ${level}, ${text}`;
}

/** The card under a note: three quiet sections (CX X16, X17). */
export const VAULT_LINKED_MENTIONS = 'Linked mentions';
export const VAULT_OUTGOING_LINKS = 'Links from this note';
export const VAULT_UNLINKED_MENTIONS = 'Unlinked mentions';
export const VAULT_BACKLINKS_LOADING = 'Finding linked mentions';
export const VAULT_OUTGOING_MISSING = 'Not created yet. Tap to create it.';
/** The same row where no note can be made now (a lapsed team plan). */
export const VAULT_OUTGOING_MISSING_OFF = 'Not created yet.';
export const VAULT_FIND_UNLINKED = 'Find unlinked mentions';
export const VAULT_LINK_BUTTON = 'Link';
export function vaultUnlinkedBusy(n: number): string {
  return `Reading ${n} ${n === 1 ? 'note' : 'notes'}`;
}
export function vaultUnlinkedNone(title: string): string {
  return `No other note names "${title}" without linking it.`;
}
export function vaultLinkMentionAria(title: string, other: string): string {
  return `Link "${title}" in ${other}`;
}
export function vaultLinkedIn(other: string): string {
  return `Linked in "${other}".`;
}
export function vaultLinkMentionFailed(other: string): string {
  return `Could not link it in "${other}", so nothing changed. Try again in a moment.`;
}

/** Today's note (CX X11). English names only, as the date tokens are (K7). */
const TODAY_WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const TODAY_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const VAULT_TODAY_TITLE = "Today's note";
export function vaultTodayAria(day: { weekday: number; month: number; day: number }): string {
  const weekday = TODAY_WEEKDAYS[day.weekday] ?? '';
  const month = TODAY_MONTHS[day.month - 1] ?? '';
  return `Today's note, ${weekday}, ${month} ${day.day}`;
}
export const VAULT_TODAY_STARTED = "Started today's note.";
export function vaultTodayStartedFrom(template: string): string {
  return `Started today's note from ${noteTitle(template)}.`;
}
export function vaultTodayTemplateMissing(path: string): string {
  return `Started today's note. The template ${path} was not found, so it is blank.`;
}
/** The daily notes format names a token this app cannot read, so no note
 *  was made rather than one under a guessed name (K7). */
export function vaultTodayFormatRefused(format: string, token: string): string {
  return `Your daily notes format "${format}" uses "${token}", which OpenShore cannot read yet, so no note was made.`;
}
/** The day's name is not a note name (a format with a character notes
 *  cannot use). */
export function vaultTodayNameRefused(error: string): string {
  return `Today's note could not be named, so no note was made. ${error}`;
}

// ---- M6 stream H end ----

// ---- M6 wave 2 begin ----
// The integrator's few lines (Vault M6 wave 2): what the room says where no
// stream's fence had a line for it.

/** A folder could not be made, for a reason other than its name. */
export const VAULT_FOLDER_CREATE_FAILED = 'Could not make that folder. Try again in a moment.';

/** A folder moved note by note (Local) stopped part way (K5): what moved is
 *  said, never a plain success and never "nothing changed". */
export function vaultFolderMovePartial(old: string, moved: number, total: number): string {
  return `Moved ${moved} of ${total} ${total === 1 ? 'note' : 'notes'} from "${old}". The rest could not be moved, so they are still there. Try again in a moment.`;
}
/** Today's note could not be read or started, for a reason the storage did
 *  not name. */
export const VAULT_TODAY_FAILED = "Could not open today's note. Try again in a moment.";
// ---- M6 wave 2 end ----

// ============================================================================
// Vault M7 wave 0: one fenced section per build stream. A stream writes only
// inside its own fence. Every string passes the RETIRED list, M6_RETIRED,
// M7_BANNED (no faster, better, remembers, always, and no "picks up where you
// left off" until D12's handoff eval), copy-glossary and both em-dash guards
// (CX R1, R2). Settings copy says "this vault", "beside your notes" or names
// `.oscode/vault.json`, never "saved in your vault".

// ---- M7 stream E begin ----
// Providers (L7, L16): the line that says why this storage's settings cannot
// change here (`vaultCaps().settingsWrite` false for the storage itself), per
// provider, in the `vaultCapLine` style.

const SETTINGS_CAP_LINES: Partial<Record<VaultCopyProvider, string>> = {
  icloud: 'Vault settings in iCloud Drive cannot change here yet.',
  org: 'Team vault settings cannot change here yet.',
  gdrive: 'Google Drive vaults are read-only here, so vault settings cannot change.',
};

const SETTINGS_CAP_FALLBACK = 'Vault settings on this storage cannot change here yet.';

/** Why the Vault settings sheet cannot save on `provider` (read through
 *  `vaultCapLine(provider, 'settingsWrite')`). Read-only and away keep the
 *  room's own standing lines. */
export function vaultSettingsCapLine(provider: VaultCopyProvider): string {
  return SETTINGS_CAP_LINES[provider] ?? SETTINGS_CAP_FALLBACK;
}

/** A settings write named something other than the vault's own file. Only
 *  `.oscode/vault.json` is written here; Obsidian's files are read, never
 *  written. */
export const VAULT_SETTINGS_NAME_REFUSED =
  "Only this vault's own settings file can change here, so nothing changed.";

/** A settings file over the 256 KB cap. */
export const VAULT_SETTINGS_TOO_LARGE = 'That settings file is over 256 KB, so nothing changed.';

/** The storage would not write the settings file (`.oscode` is not a real
 *  folder there, or the computer refused it). */
export const VAULT_SETTINGS_WRITE_REFUSED =
  'The vault folder would not take the settings file, so nothing changed.';

/** Your computer took the settings file but its answer named no version, so
 *  the next change could not be guarded. */
export const HUB_SETTINGS_NO_VERSION =
  'Your computer took the settings but did not say which version they are.';

/** Local's write refuses a name under a dot folder (CTO L8): nothing lands
 *  under `.oscode` or `.obsidian`, and a dot name is never a note here. */
export function vaultDotPathLine(path: string): string {
  return `"${path}" is not a note name the vault can use, so nothing changed.`;
}

// ---- M7 stream E end ----

// ---- M7 stream F begin ----
// The settings sheet and its switches (CX Y1 to Y10, Y13; CTO L1 to L4, L7,
// L11 to L13, reconciliation 3 and 4): the title and seven section labels,
// row labels and subs, "From Obsidian" and "From your computer's config",
// the set-aside line around the schema's `plain` fragments, the save status
// and conflict lines, the storage footers, Notes in chats (built from
// PACK_BY_CLASS), Handoff, Room for notes and its amber spend line, the
// Delete choice, excluded and local-only folders, Your agent writes in, the
// Wayfinding rows and toasts, and the starter layout's notes and lines.

/** The sheet's title, and the Wayfinding and Options rows that open it. */
export const VAULT_SETTINGS_TITLE = 'Vault settings';

/** The seven sections, in CX Y1's order (what people change most and what
 *  models see first; where it lives last). */
export const VAULT_SETTINGS_SECTIONS = Object.freeze({
  notes: 'Notes',
  models: 'Models and your notes',
  device: 'On this device',
  today: "Today's note",
  links: 'Links and files',
  editor: 'Editor',
  where: 'Where it lives',
} as const);

/** Row labels, section by section (CX Y1, Y7 to Y10). */
export const VAULT_SETTINGS_ROWS = Object.freeze({
  newNotes: 'New notes go in',
  openMode: 'Open notes in',
  sort: 'Sort notes by',
  delete: 'Delete',
  exclude: 'Notes models never see',
  localOnly: 'Notes that stay on this computer',
  agentFolder: 'Your agent writes in',
  context: 'Notes in chats',
  packSize: 'Room for notes',
  handoff: 'Handoff',
  dailyFolder: 'Folder',
  dateFormat: 'Date format',
  template: 'Template',
  templatesFolder: 'Templates folder',
  linkStyle: 'New links use',
  linkFormat: 'Link paths',
  attachments: 'Attachments folder',
  font: 'Font',
  size: 'Text size',
  where: 'Where it lives',
} as const);

/** Each choice a segmented row or a picker offers, by the schema's value. */
export const VAULT_SETTINGS_CHOICES = Object.freeze({
  newNotes: { root: 'Top of this vault', current: 'Same folder as the open note' },
  openMode: { read: 'Reading', edit: 'Editing' },
  sort: { name: 'Name', modified: 'Last edited', created: 'Created' },
  delete: { trash: 'To Trash', permanent: 'For good' },
  packSize: { small: 'Small', normal: 'Normal', large: 'Large' },
  linkStyle: { wiki: 'Wikilinks', markdown: 'Markdown links' },
  linkFormat: { shortest: 'Shortest', relative: 'Relative', absolute: 'From the top' },
  font: { default: 'Default', serif: 'Serif', mono: 'Mono' },
  size: { smaller: 'Smaller', default: 'Default', larger: 'Larger' },
} as const);

/** A field's name in the conflict line ("{Field} changed somewhere else"),
 *  keyed like `VAULT_SETTINGS_FIELDS`. The four rows the sheet calls only
 *  "Folder", "Template" and the like say which note they belong to here. */
export const VAULT_SETTINGS_FIELD_LABELS = Object.freeze({
  'newNotes.location': 'New notes go in',
  'newNotes.folder': 'New notes go in',
  'editor.openMode': 'Open notes in',
  'tree.sort': 'Sort notes by',
  delete: 'Delete',
  exclude: 'Notes models never see',
  'localOnly.paths': 'Notes that stay on this computer',
  'localOnly.tags': 'Notes that stay on this computer',
  'agent.folder': 'Your agent writes in',
  'daily.folder': "Today's note folder",
  'daily.format': 'Date format',
  'daily.template': "Today's note template",
  'templates.folder': 'Templates folder',
  'templates.dateFormat': 'Templates date format',
  'templates.timeFormat': 'Templates time format',
  'links.style': 'New links use',
  'links.format': 'Link paths',
  'links.updateOnRename': 'Links on rename',
  'attachments.folder': 'Attachments folder',
  'editor.font': 'Font',
  'editor.size': 'Text size',
} as const);

/** `Date format`'s live line under the field. */
export function vaultSettingsTodayIs(formatted: string): string {
  return `Today: ${formatted}`;
}

// Y1 footers, one per storage (Team is Y14's).
/** A folder, iCloud or Your computer: the file travels with the notes. */
export const VAULT_SETTINGS_FOOTER_FILE =
  'These settings are kept in .oscode/vault.json, so they travel with your notes.';
/** Local: the sealed store. */
export const VAULT_SETTINGS_FOOTER_LOCAL =
  'These settings are kept on this device with your notes.';

// Y2: what Obsidian sets is read here and changed there.
export const VAULT_SETTINGS_FROM_OBSIDIAN = 'From Obsidian';
export const VAULT_SETTINGS_FROM_OBSIDIAN_MORE =
  'Set in Obsidian. Change it there, and OpenShore follows.';
/** A field Obsidian leaves unset, in a vault that has `.obsidian/`. */
export const VAULT_SETTINGS_OBSIDIAN_OWN = 'Obsidian keeps its own setting for this.';
export const VAULT_SETTINGS_OBSIDIAN_EXCLUDED = 'Excluded in Obsidian';
export const VAULT_SETTINGS_OBSIDIAN_EXCLUDED_SUB =
  'Left out of search and link suggestions here too.';

// Y3: what the vault file cannot widen.
export const VAULT_SETTINGS_FROM_MACHINE = "From your computer's config";
export const VAULT_SETTINGS_BUILT_IN = "Built in. Only your computer's config can change these.";
/** Section 3's own footer. */
export const VAULT_SETTINGS_DEVICE_FOOTER =
  'These stay on this device and never travel with your notes, so a shared folder cannot change them.';

/** One quiet line per ask the file may not make, around the schema's
 *  `plain` fragment (CTO L1). No warn color: a set-aside is the system
 *  working. */
export function vaultSettingsSetAside(plain: string): string {
  return `This vault's settings file also asks to ${plain}. A settings file can only narrow what models see, so that part is set aside.`;
}

/** The tool card's reason for a write under `.oscode/` (CTO L8). */
export const VAULT_SETTINGS_AGENT_DENY =
  'Vault settings are yours to change, so a model cannot write under .oscode.';

// Y5: saving on commit, and a conflict.
export const VAULT_SETTINGS_SAVING = 'Saving';
export const VAULT_SETTINGS_SAVED = 'Saved';
/** Once, on the first change in a folder vault with no file yet. */
export const VAULT_SETTINGS_FIRST_CHANGE =
  'The first change adds a small .oscode folder beside your notes to keep these settings.';
/** A different field changed elsewhere: this one was re-applied and saved. */
export const VAULT_SETTINGS_MERGED =
  'Saved. Some other settings changed somewhere else and show here now.';

/** The same field changed elsewhere: nothing was written. */
export function vaultSettingsSameField(field: string, value: string): string {
  return `${field} changed somewhere else while this was open, so yours was not saved. It is ${value} now.`;
}

/** The one quiet button under a same-field conflict. */
export function vaultSettingsUseYours(yours: string): string {
  return `Use ${yours}`;
}

export const VAULT_SETTINGS_FAILED =
  'Could not save that setting, so nothing changed. Try again in a moment.';
export const VAULT_SETTINGS_UNREADABLE =
  '.oscode/vault.json could not be read, so these show the defaults and cannot change here. Fix or delete that file to change them.';
export const VAULT_SETTINGS_AWAY =
  'Your computer is off, so these settings cannot change right now.';

// Y6: the Delete choice.
export const VAULT_SETTINGS_DELETE_FOR_GOOD = 'Deletes skip Trash and ask twice.';

// Y7: Notes in chats and Handoff.
/** The words the Notes in chats sub is built from, so the sub can never
 *  outrun the eval: it names matching notes only when some class's pack
 *  retrieves (`full` in PACK_BY_CLASS). Pass the core's table. */
export function vaultNotesInChatsSub(byClass: Readonly<Record<string, string>>): string {
  const modes = Object.values(byClass);
  const all = modes.length > 0 && modes.every((m) => m === 'full');
  const some = modes.some((m) => m === 'full');
  const what = all
    ? "Each chat starts with this project's Current State, any notes you pinned, and notes that match the task."
    : some
      ? "Each chat starts with this project's Current State and any notes you pinned, and on some models notes that match the task."
      : "Each chat starts with this project's Current State and any notes you pinned.";
  return `${what} A card shows what went. Off applies to new chats.`;
}
export const VAULT_HANDOFF_SUB =
  'When you switch models in a chat, the next one starts with a short summary of the work so far. Off applies to new chats.';
/** A project's config turns the row off: the switch shows off, disabled. */
export const VAULT_SWITCH_PROJECT_OFF = "This project's settings turn this off.";
/** Memory off: both rows disabled. */
export const VAULT_SWITCH_MEMORY_OFF = 'Memory is off, so chats carry no notes.';
/** Memory's own sub, now that it gates the vault too (CX Y7; the
 *  integrator places it on the Memory row). */
export const VAULT_MEMORY_SUB =
  "The agent keeps notes on each coding project in that project's own repository, and chats can carry your vault. Off stops both, for new chats.";

/** The Wayfinding toasts, in the Memory row's pattern. */
export function vaultNotesInChatsToast(on: boolean): string {
  return on ? 'Notes in chats on.' : 'Notes in chats off.';
}
export function vaultHandoffToast(on: boolean): string {
  return on ? 'Handoff on.' : 'Handoff off.';
}

// Y8: Room for notes. No numbers and no speed or quality claim (D12).
/** Adapted from CX's "so a smaller model always gets less": M7_BANNED bars
 *  "always", and the sentence holds without it. */
export const VAULT_PACK_SIZE_SUB =
  "How much of each model's room your notes may take. It scales with the model, so a smaller model gets less.";
/** Amber dot, only while a cloud seat is connected: a spend fact. */
export const VAULT_PACK_SIZE_CLOUD = 'On a cloud model, Large sends more text on your account.';
export const VAULT_PACK_SIZE_NEEDS_CONTEXT = 'Turn on Notes in chats to choose this.';
export const VAULT_PACK_SIZE_MACHINE_ABOVE =
  "Your computer's config gives notes more room than Large.";

// Y9: excluded and local-only folders.
export const VAULT_EXCLUDE_SUB = 'Models never see these, in any chat.';
export const VAULT_LOCAL_ONLY_SUB =
  'A local model may read these. Nothing here goes to a cloud model.';
export const VAULT_ADD_FOLDER = 'Add a folder';
export const VAULT_ADD_TAG = 'Add a tag';
export function vaultRemoveEntry(entry: string): string {
  return `Remove ${entry}`;
}

// Y10: Your agent writes in (only where `vaultCopy(...).agent` is defined).
export const VAULT_AGENT_FOLDER_ANYWHERE = 'Anywhere in this vault';
export const VAULT_AGENT_FOLDER_SUB = 'Your agent writes only here, and still asks first.';

// Y13: the starter layout (the preview sheet's rows are stream G's).
/** The ramp's second button, where the layout is offered. */
export const VAULT_STARTER_OFFER = 'Start with a simple layout';
/** The preview's one line on settings, shown only when the settings file
 *  will be written. */
export const VAULT_STARTER_SETTINGS_LINE =
  "New notes go in Inbox, and today's note uses Templates/Daily.";
export const VAULT_STARTER_ADDED = 'Added a simple layout.';
export function vaultStarterPartial(added: number, total: number): string {
  return `Added ${added} of ${total}. Try again to add the rest.`;
}

/** `Templates/Daily.md`: no `{{date}}` heading, since the file name is the
 *  date. */
export function vaultStarterDailyTemplate(): string {
  return ['## Plan', '', '- [ ] ', '', '## Notes', ''].join('\n');
}

/** `Vault conventions.md`. It travels, so like the welcome note it names no
 *  storage, no Obsidian and no agent. The Private and Journal line is here
 *  only when the vault's own settings file landed with those globs (CTO
 *  reconciliation 3): machine config can replace the D5 defaults, but it
 *  cannot remove the vault file's union. */
export function vaultStarterConventions(settingsLanded: boolean): string {
  return [
    '# Vault conventions',
    '',
    'New notes start in Inbox. Move them into a folder when they find a home.',
    '',
    "Today's note uses Templates/Daily. Edit that note to change what every new day starts with.",
    '',
    'Link notes with [[two square brackets]].',
    ...(settingsLanded
      ? ['', "This vault's settings keep anything in Private or Journal off cloud models."]
      : []),
    '',
  ].join('\n');
}

// ---- M7 stream F end ----

// ---- M7 stream G begin ----
// Components (CX Y11, Y12, Y13, Y16): the provenance chip and its accessible
// label, "About this note" and Mark as reviewed, the starter preview sheet's
// rows, the editor sample line.

/** Where the writing seat ran, in words: the chip is never color alone (R4). */
export const VAULT_PROV_WHERE: Readonly<Record<'local' | 'cloud', string>> = {
  local: 'Local',
  cloud: 'Cloud',
};

/** What the provenance chip says (CX Y11). `edit` is a model's edit to a note
 *  it did not create. Reviewed keeps the Local or Cloud word beside the model
 *  (Y17: the chip always says it in words). */
export function vaultProvChipText(p: {
  model: string;
  where: 'local' | 'cloud';
  edit?: boolean;
  reviewed?: boolean;
}): string {
  const where = VAULT_PROV_WHERE[p.where];
  if (p.reviewed) return `${p.model} · ${where} · Reviewed`;
  return `${p.edit ? 'Edited' : 'Written'} by ${p.model} · ${where}`;
}

/** The chip's accessible name (CX Y16). */
export function vaultProvChipLabel(p: {
  model: string;
  where: 'local' | 'cloud';
  edit?: boolean;
  reviewed?: boolean;
}): string {
  const on = p.where === 'local' ? 'this computer' : 'a cloud model';
  const verb = p.edit ? 'Edited' : 'Written';
  return `${verb} by ${p.model}, on ${on}.${p.reviewed ? ' Reviewed.' : ''} Open details.`;
}

// "About this note" (CX Y12).
export const VAULT_ABOUT_TITLE = 'About this note';
export const VAULT_ABOUT_WRITTEN_BY = 'Written by';
export const VAULT_ABOUT_EDITED_BY = 'Edited by';
export const VAULT_ABOUT_RAN = 'Ran';
export const VAULT_ABOUT_RAN_LOCAL = 'On this computer';
/** The cloud row names the provider when the note carries one. */
export function vaultAboutRanCloud(provider?: string): string {
  return provider ? `On a cloud model, ${provider}` : 'On a cloud model';
}
export const VAULT_ABOUT_SIZE = 'Model size';
export const VAULT_ABOUT_SIZES: Readonly<Record<'tiny' | 'small' | 'mid' | 'large', string>> = {
  tiny: 'Tiny',
  small: 'Small',
  mid: 'Mid',
  large: 'Large',
};
export const VAULT_ABOUT_HOW = 'How';
export const VAULT_ABOUT_HOWS: Readonly<
  Record<'agent' | 'agent-edit' | 'crew' | 'handoff', string>
> = {
  agent: 'In a chat, with your approval',
  'agent-edit': 'In a chat, with your approval',
  crew: 'By a Crew routine',
  handoff: 'A handoff you saved',
};
export const VAULT_ABOUT_CREATED = 'Created';
export const VAULT_ABOUT_REVIEWED = 'Reviewed';
export const VAULT_ABOUT_NOT_YET = 'Not yet';
export const VAULT_ABOUT_FOOT =
  "This comes from the note's own properties, which anyone who can edit the note can change.";
export const VAULT_MARK_REVIEWED = 'Mark as reviewed';
export const VAULT_MARK_REVIEWED_SUB =
  'Reviewed means you read it. It changes nothing a model sees.';
export const VAULT_MARK_NOT_REVIEWED = 'Mark as not reviewed';
export const VAULT_MARKED_REVIEWED = 'Marked as reviewed.';
export const VAULT_MARKED_NOT_REVIEWED = 'Marked as not reviewed.';
export function vaultMarkRefused(title: string): string {
  return `"${title}" changed somewhere else, so it was not marked. The newer version is open now.`;
}
export function vaultMarkFailed(title: string): string {
  return `Could not mark "${title}", so nothing changed. Try again in a moment.`;
}

// The starter layout's preview sheet (CX Y13). The notes it writes, the ramp
// button and the toasts are stream F's.
export const VAULT_STARTER_TITLE = 'A simple layout';
export const VAULT_STARTER_SUB =
  'These are added to your empty vault. Change or delete any of them later.';
export const VAULT_STARTER_ROWS: ReadonlyArray<{
  glyph: 'note' | 'folder' | 'template';
  name: string;
  line: string;
}> = [
  { glyph: 'note', name: 'Welcome to your Vault', line: 'A note on how links and folders work.' },
  { glyph: 'folder', name: 'Inbox', line: 'A folder where new notes go.' },
  { glyph: 'template', name: 'Templates/Daily', line: "A template for today's note." },
  {
    glyph: 'note',
    name: 'Vault conventions',
    line: 'A note that says how this vault is laid out. Pin it to a project so its chats start with it.',
  },
];
// The settings line and the partial result are stream F's (one source per
// string); the sheet imports them from F's section above.
export const VAULT_STARTER_ADD = 'Add these';

/** The Editor section's one sample line, drawn in the chosen font and size. */
export const VAULT_EDITOR_SAMPLE = 'A line of your notes looks like this.';

// ---- M7 stream G end ----

// ---- M7 wave 2 begin ----
// The integrator's few lines: what the room and Settings say where no
// stream's fence had a line for it (the team read-only footer, Y4's rows).

/** A list or a note field with nothing set. */
export const VAULT_SETTINGS_NONE = 'None';
/** The Add a tag field's hint. */
export const VAULT_SETTINGS_TAG_PLACEHOLDER = 'Tag name';

/** Obsidian's attachment folder form (`/`, `./`, `./sub`, a folder) in
 *  words, for the Attachments folder row. */
export function vaultAttachmentsValue(setting: string | undefined): string {
  const v = (setting ?? '').trim();
  if (!v || v === '/') return 'Top of this vault';
  if (v === './' || v === '.') return 'Same folder as the note';
  if (v.startsWith('./')) return `"${v.slice(2).replace(/\/+$/, '')}", beside the note`;
  return v.replace(/^\/+|\/+$/g, '');
}

/** The starter layout found the vault no longer empty right before it
 *  wrote (CTO L12), so nothing was added. */
export const VAULT_STARTER_NOT_EMPTY =
  'This vault has something in it now, so the layout was not added.';

/** The team vault's footer (CX Y14): an admin reads who the settings reach,
 *  a member reads who sets them. On main no one edits them here yet, so the
 *  rows read-only with the storage's own line. */
export function vaultSettingsTeamFooter(o: { admin: boolean; org?: string }): string {
  if (!o.admin) return 'Your admins set these.';
  return o.org ? `These apply to everyone in ${o.org}.` : 'These apply to everyone in your team.';
}

/** The approval card's line for the property change a model's write also
 *  makes (CTO L9): the person approves the note's properties with its text.
 *  In the chip's own words (CX Y11), so the card and the chip agree. */
export function vaultProposalRecords(p: {
  model?: string;
  where: 'local' | 'cloud';
  edit?: boolean;
  clearsReview?: boolean;
}): string {
  const who = p.model
    ? vaultProvChipText({ model: p.model, where: p.where, ...(p.edit ? { edit: true } : {}) })
    : `${p.edit ? 'Edited' : 'Written'} · ${VAULT_PROV_WHERE[p.where]}`;
  return `Also records in its properties: ${who}.${p.clearsReview ? ' Its review mark is cleared.' : ''}`;
}

// ---- M7 wave 2 end ----

// ---- M8 begin ----
// The ship gate's copy (Vault M8).

/** 8.4 and D12: claims beyond "your models can read your notes" wait on the
 *  number. False until the 4.8 context pack eval (a with-and-without number
 *  per model class on the reference box) and the 5.4 handoff eval (the
 *  handoff task passing on each class) are recorded in DECISIONS with the
 *  founder's thresholds. While false, `vaultCopy.test.ts` refuses "faster",
 *  "smarter", "remembers" and the rest of its claim list across this whole
 *  file and the Vault's components. Flip it only with those results in hand,
 *  and only for the claim and the class they cover. */
export const VAULT_EVAL_CLAIMS_UNLOCKED = false;

/** Room for notes on the computer's sessions (CX Y8, M8): the computer's own
 *  `vault.packSize` is the most room an engine session there gives notes,
 *  and this device's choice may only lower it. Shown under the row when the
 *  size those sessions use differs from the one selected here; with the
 *  computer's size unknown (it did not answer, or is older), the careful
 *  line. Neutral, never amber: it is the system working. */
export function vaultPackEngineLine(
  where: 'this' | 'your',
  size?: keyof typeof VAULT_SETTINGS_CHOICES.packSize,
): string {
  return size
    ? `Sessions on ${where} computer use its own setting, ${VAULT_SETTINGS_CHOICES.packSize[size]}.`
    : `Sessions on ${where} computer can use its own setting instead.`;
}

// ---- M8 end ----

// ---- Team vault begin ----
// The team vault's M6 and M7 lines (the held vault-m2-team branch; CX Y14,
// Y15). Neutral words, no price or tier name (pricing is a Board gate).

/** A member's delete refused by the server under admins-only (OV403, Y14). */
export const VAULT_TEAM_DELETE_REFUSED = 'Not deleted. Only admins can delete team notes.';

/** Options' note for a member when only admins may delete (Y14). */
export const VAULT_TEAM_DELETE_ADMINS_ONLY = 'Only admins can delete team notes here.';

/** The lapsed plan's lead (Y15): read-only, calm, export still there. */
export const VAULT_TEAM_LAPSED_LEAD =
  "Your organization's plan is not active, so team notes are read-only. Everyone can still read and export all of them.";

/** The lapsed lead's export line on the web, where Export is not offered. */
export const VAULT_TEAM_LAPSED_WEB = 'Open OpenShore on your computer or iPhone to export them.';

/** The one more line an admin reads in the lapsed lead, and its button. */
export const VAULT_TEAM_LAPSED_ADMIN = 'Editing comes back when the plan is active again.';
export const VAULT_TEAM_OPEN_ADMIN = 'Open Admin';

/** A save refused mid-edit because the plan lapsed (OV402): the Not saved
 *  reason. The text is held, never lost. */
export const VAULT_TEAM_LAPSED_NOT_SAVED =
  'The team plan is not active, so team notes cannot change.';

/** A tapped link to a note not made yet, while the plan is lapsed: said here,
 *  and the server (which refuses it, OV402) is never asked. */
export const VAULT_TEAM_LAPSED_NOT_CREATED = `Not created. ${VAULT_TEAM_LAPSED_NOT_SAVED}`;

/** A Restore in Trash, or an Undo, while the plan is lapsed: said here, and
 *  the server (which refuses it, OV402) is never asked. */
export const VAULT_TEAM_LAPSED_NOT_RESTORED = `Not restored. ${VAULT_TEAM_LAPSED_NOT_SAVED}`;

/** A delete while the plan is lapsed, said before the server is asked. */
export const VAULT_TEAM_LAPSED_NOT_DELETED = `Not deleted. ${VAULT_TEAM_LAPSED_NOT_SAVED}`;

/** A choice on the resolve sheet that would write while the plan is lapsed:
 *  the text goes under Not saved with VAULT_TEAM_LAPSED_NOT_SAVED as its
 *  reason, and nothing is sent. */
export const VAULT_TEAM_LAPSED_NOT_SAVED_LINE = `Not saved. ${VAULT_TEAM_LAPSED_NOT_SAVED}`;

/** The notice a never-paid team reads while its deadline is set
 *  (`entitled_until`, migration 0025): shown before any refusal. */
export function vaultTeamEditableUntil(until: string | Date): string | undefined {
  const d = typeof until === 'string' ? new Date(until) : until;
  if (Number.isNaN(d.getTime())) return undefined;
  const date = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return `Team notes stay editable until ${date}.`;
}

/** The free space a team without a live plan holds for its notes and their
 *  history, in MiB: migration 0023's no_entitlement_max_org_bytes (26214400
 *  bytes). vaultCopy.test.ts reads the number there. */
export const VAULT_TEAM_FREE_MIB = 25;

/** A write refused because a team without a live plan has used its free
 *  space (0023's check_violation, SQLSTATE 23514): a save, a new note,
 *  Today, a Restore or an Undo, and a rename once a team is past it. Said in
 *  0023's own words and the gate 1 runbook's (4.5): a delete frees nothing
 *  until the weekly purge clears its history, about a month later
 *  (VAULT_TEAM_TRASH_DAYS). No price or plan name (a Board gate), and no
 *  "start a plan" while no build offers one. The reason only: the store puts
 *  the verb first (VAULT_REFUSED_VERB). */
export const VAULT_TEAM_FULL = `This team has used its ${VAULT_TEAM_FREE_MIB} MiB of free space. A deleted note frees its space when its history is cleared, about a month later.`;

/** What did not happen, said first when a storage refuses for good (a team
 *  out of free space, a plan not active), before the storage's reason. */
export const VAULT_REFUSED_VERB = {
  save: 'Not saved.',
  today: 'Not started.',
  rename: 'Not renamed.',
  restore: 'Not restored.',
  delete: 'Not deleted.',
  link: 'Not linked.',
  mark: 'Not marked.',
  update: 'Not updated.',
} as const;

/** A storage's reason ("a note is limited to 1 MB") as a sentence. */
function reasonSentence(line: string): string {
  const t = line.trim();
  const s = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** A refusal as the room says it: a line that already names what did not
 *  happen (`whole`, the admins-only delete, CX Y14) as it is; any other line
 *  is the storage's reason, so the verb goes first and the reason follows as
 *  a sentence ("Not restored. This team has used its 25 MiB..."). */
export function vaultRefusedLine(
  verb: keyof typeof VAULT_REFUSED_VERB,
  r: { line: string; whole?: boolean },
): string {
  return r.whole ? r.line : `${VAULT_REFUSED_VERB[verb]} ${reasonSentence(r.line)}`;
}

/** A folder's Restore (or its Undo) that brought back only some of its
 *  notes: how many came back, which are still in Trash (the first three by
 *  title), and why, when the storage said. With no reason, the rest were not
 *  reached, so trying again is true. */
export function vaultRestorePartial(o: {
  title: string;
  restored: number;
  left: readonly string[];
  reason?: string;
}): string {
  const total = o.restored + o.left.length;
  const names = o.left.slice(0, 3).map((p) => `"${noteTitle(p)}"`);
  const more = o.left.length > 3 ? ` and ${o.left.length - 3} more` : '';
  const why = o.reason ? reasonSentence(o.reason) : 'Try again in a moment.';
  return `Restored ${o.restored} of ${total} ${total === 1 ? 'note' : 'notes'} from "${o.title}". Still in Trash: ${names.join(', ')}${more}. ${why}`;
}

/** A restore or an Undo that brought notes back beside their own names (the
 *  team vault, round 7 E23): a note of that name is in the vault now, or the
 *  name is held by a later delete that is still in Trash, which keeps it.
 *  `folder` is set for a folder's Restore or Undo, whose title is the
 *  folder's. Undefined when a note came back beside a note in the vault,
 *  which vaultRestoredToast already says. */
export function vaultRestoredBeside(o: {
  title: string;
  folder: boolean;
  beside: readonly { from: string; to: string; inTrash: boolean }[];
}): string | undefined {
  const first = o.beside[0];
  if (!first) return undefined;
  const why = (inTrash: boolean) =>
    inTrash ? 'that name is in Trash from a later delete' : 'a note of that name is there now';
  if (!o.folder) {
    if (!first.inTrash) return undefined;
    return `"${o.title}" came back as "${noteTitle(first.to)}", since ${why(true)}.`;
  }
  if (o.beside.length === 1) {
    return `Restored "${o.title}". "${noteTitle(first.from)}" came back as "${noteTitle(first.to)}", since ${why(first.inTrash)}.`;
  }
  return `Restored "${o.title}". ${o.beside.length} notes came back beside their names, as "(restored)", since those names are taken or in Trash.`;
}

/** A folder delete that stopped part way (the team vault trashes a folder
 *  note by note): how many went to Trash, that the rest are still there, and
 *  why, when a refusal said; with no reason, the rest were not reached, so
 *  trying again is true (round 7 E20). Never "Not deleted": some were. */
// With `changed` (the paths a teammate saved while the delete ran, which
// its guard passed over, E21) and nothing else left, it names them instead.
export function vaultFolderTrashPartial(o: {
  title: string;
  trashed: number;
  left: number;
  reason?: string;
  changed?: readonly string[];
}): string {
  const total = o.trashed + o.left;
  const moved = `Moved ${o.trashed} of ${total} ${total === 1 ? 'note' : 'notes'} from "${o.title}" to Trash.`;
  if (o.changed?.length && o.changed.length === o.left && !o.reason) {
    const they = o.changed.length === 1 ? 'it is' : 'they are';
    return `${moved} ${changedWhileThisRan(o.changed)}, so ${they} still there.`;
  }
  const why = o.reason ? reasonSentence(o.reason) : 'Try again in a moment.';
  return `${moved} The rest are still there. ${why}`;
}

/** Which notes changed while a folder delete ran: one or two by title,
 *  more by count. */
function changedWhileThisRan(paths: readonly string[]): string {
  const names = paths.map((p) => `"${noteTitle(p)}"`);
  const who =
    names.length === 1
      ? names[0]!
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.length} notes`;
  return `${who} changed while this ran`;
}

/** A folder delete that moved nothing, because every note in it was saved
 *  by a teammate while it ran (its guard passes over a note it has not
 *  seen): nothing went to Trash, and which changed (round 7 E21). */
export function vaultFolderTrashChanged(title: string, changed: readonly string[]): string {
  return `Not deleted. ${changedWhileThisRan(changed)}, so nothing in "${title}" went to Trash.`;
}

/** A folder move that stopped part way on a refusal that trying again cannot
 *  fix (a team out of free space): what moved, and the storage's reason. */
export function vaultFolderMoveRefused(
  old: string,
  moved: number,
  total: number,
  reason: string,
): string {
  return `Moved ${moved} of ${total} ${total === 1 ? 'note' : 'notes'} from "${old}". The rest were not moved, so they are still there. ${reasonSentence(reason)}`;
}

/** A new note, a rename, Today or a keep-both copy whose name is a team note
 *  in Trash: making it there would take that note out of Trash for good (the
 *  team's Trash is keyed by name), so it is not made (round 7 E22). The
 *  reason only: the store puts the verb first. */
export function vaultNameInTrash(title: string): string {
  return `"${title}" is in Trash. Restore it from Trash, or use another name.`;
}

/** A folder move refused before any note moved, because a note would land on
 *  a name in team Trash (E22). */
export function vaultFolderMoveInTrash(old: string, title: string): string {
  return `"${old}" was not moved. ${vaultNameInTrash(title)}`;
}

/** A folder moved note by note that stopped because a note's name is taken
 *  where it was going (letter case counts as the same name): what moved,
 *  and which name, never "try again", since the same move meets the same
 *  name every time. */
export function vaultFolderMoveTaken(o: {
  old: string;
  moved: number;
  total: number;
  /** The title of the note already there. */
  name: string;
  /** The folder it is in ("" for the top of the vault). */
  folder: string;
}): string {
  const where = o.folder ? vaultFolderLabel(o.folder) : 'your vault';
  const fix = 'Rename one of them, then move the folder again.';
  return o.moved
    ? `Moved ${o.moved} of ${o.total} ${o.total === 1 ? 'note' : 'notes'} from "${o.old}". "${o.name}" is already in ${where}, so the rest were not moved and are still there. ${fix}`
    : `"${o.old}" was not moved. "${o.name}" is already in ${where}. ${fix}`;
}

/** The team settings sheet (Y14): its title, the lead's link to it, and the
 *  who-may-delete row. */
export const VAULT_TEAM_SETTINGS_TITLE = 'Team vault settings';
export const VAULT_TEAM_SETTINGS_LINK = 'Team settings';
export const VAULT_TEAM_WHO_DELETES = 'Who can delete team notes';
export const VAULT_TEAM_WHO_DELETES_SUB = 'Everyone can still read and export every note.';
export const VAULT_TEAM_DELETE_ROLES = { admin: 'Admins', member: 'Everyone' } as const;

// ---- Team vault end ----
