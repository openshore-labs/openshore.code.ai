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
// - Everywhere else the notes on screen are not the agent's. The phone says
//   where the agent's vault is instead; a member on someone else's computer
//   gets no vault in their sessions (0.13), so nothing is promised there.
// - Obsidian opens a plain folder. "This folder" is one; the iCloud folder is
//   one that Obsidian on a Mac can open (Obsidian on the iPhone opens vaults
//   only in its own folders). Local is a sealed store, Google Drive is held
//   back, and the team vault is a server, so none of them claims Obsidian.
import type { Platform } from './platform.js';

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
}

/** The phone's line about the agent: its vault is the computer's folder. */
export const PHONE_AGENT_LINE = 'Your agent uses the vault on your computer.';
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
  icloud: 'Obsidian on a Mac signed in to the same iCloud can open the folder.',
};

/** The lines for one platform and one storage. `hubMember` is a phone paired
 *  to someone else's computer as a member, whose sessions have no vault. */
export function vaultCopy(
  platform: Platform,
  provider: VaultCopyProvider,
  opts: { hubMember?: boolean } = {},
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
  } else if (!opts.hubMember) {
    copy.agentElsewhere = PHONE_AGENT_LINE;
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
  opts: { hubMember?: boolean } = {},
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
  const agentLine = c.agent ? [c.agent, c.routines].filter(Boolean).join(' ') : c.agentElsewhere;
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
 *  opens on one. Written into the note, so it says only what holds here. */
export function vaultWelcomeNote(
  platform: Platform,
  provider: VaultCopyProvider,
  opts: { hubMember?: boolean } = {},
): string {
  const c = vaultCopy(platform, provider, opts);
  const agentLine = c.agent ? [c.agent, c.routines].filter(Boolean).join(' ') : c.agentElsewhere;
  return [
    '# Welcome to your Vault',
    '',
    `This is a note, written in plain markdown. ${[c.storage, c.obsidian].filter(Boolean).join(' ')}`,
    'Write anything you want here.',
    '',
    ...(agentLine
      ? [`## ${c.agent ? 'You and your agent share this' : 'Your agent'}`, '', agentLine, '']
      : []),
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
    `iCloud Drive, on the iPhone: ${icloud.storage} ${icloud.obsidian}`,
    `Google Drive: ${vaultCopy('ios', 'gdrive').storage} A vault already there is read-only and moves off in one tap.`,
    `On the iPhone, Export writes the notes out as plain .md files in Files, and ${lowerFirst(PHONE_AGENT_LINE)}`,
    "A member using someone else's computer has no vault in their sessions yet.",
    `The team vault: ${vaultCopy('ios', 'org').storage}`,
  ].join(' ');
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** What a vault move did, said plainly. Never a count: a move is all or
 *  nothing, so the line says where the vault is, not how many notes rode. */
export function vaultMoveLine(
  result: { ok: boolean; skipped: string[]; reason?: string } | undefined,
  label: string,
  obsidian?: string,
): string {
  if (result?.ok) return [`Your vault moved to ${label}.`, obsidian].filter(Boolean).join(' ');
  switch (result?.reason) {
    case 'unreadable': {
      const n = result.skipped.length;
      return n
        ? `${n === 1 ? 'A note is' : `${n} notes are`} still downloading or could not be read, so nothing moved. Try again once they are here.`
        : 'Could not read your vault to move it, so nothing moved. Try again in a moment.';
    }
    case 'copy-failed':
      return `Could not copy your notes to ${label}, so nothing moved. Try again in a moment.`;
    case 'unverified':
      return `${label} did not show every copied note, so your vault stayed where it was.`;
    case 'unavailable':
      return `${label} is not available right now, so your vault stayed where it was.`;
    default:
      return `Could not move to ${label}. Try again in a moment.`;
  }
}
