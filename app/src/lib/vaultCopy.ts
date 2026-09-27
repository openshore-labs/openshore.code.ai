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

/** Linked mentions in a vault over VAULT_LARGE_NOTES notes, on request. */
export function vaultMentionsOnDemand(n: number): { hint: string; button: string; busy: string } {
  return {
    hint: `This vault has ${n} notes, so Linked mentions load when you ask. Finding them reads every note, which takes a moment.`,
    button: 'Find linked mentions',
    busy: `Reading ${n} notes`,
  };
}
