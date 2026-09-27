// The starter layout (Vault M7, 7.3; CTO L12, CX Y13): a few notes and a
// folder for a vault that is truly empty, offered, previewed, and added only
// when the person taps "Add these". Never automatic, and an existing vault is
// never touched.
//
// Offered only when: a personal vault, the storage can make folders
// (`vaultCaps().folders` and `createFolder`), no notes, no attachments, no
// folders, an empty Trash, and all four config reads `absent`. A config read
// that is `unsupported` or `downloading` is not proof of empty, and an
// Obsidian config folder means the person brings their own conventions.
//
// Emptiness is checked again right before writing, every note is written
// `ifAbsent`, and a partial result says so. Where the storage can save
// settings (`settingsWrite`) the vault's own `.oscode/vault.json` is written
// FIRST, also `ifAbsent`, so the conventions note says the Private and
// Journal line only when that file landed (CTO reconciliation 3). Nothing
// pins itself.
import type { ConfigRead } from 'os-code/protocol';
import { readVaultConfig } from './gitos/config.js';
import type { StorageProvider } from './gitos/providers.js';
import type { VaultCaps } from './vaultCaps.js';
import {
  VAULT_STARTER_ADDED,
  vaultStarterConventions,
  vaultStarterDailyTemplate,
  vaultStarterPartial,
  vaultWelcomeNote,
} from './vaultCopy.js';

/** The starter's paths. */
export const VAULT_STARTER_PATHS = Object.freeze({
  welcome: 'Welcome to your Vault.md',
  inbox: 'Inbox',
  daily: 'Templates/Daily.md',
  conventions: 'Vault conventions.md',
} as const);

/** The settings the starter writes (CTO L12): new notes in Inbox, today's
 *  note from Templates/Daily, the templates folder, and Private and Journal
 *  kept off cloud models by the vault's own union. */
export function vaultStarterSettingsText(): string {
  return `${JSON.stringify(
    {
      version: 1,
      newNotes: { location: 'folder', folder: 'Inbox' },
      daily: { template: 'Templates/Daily' },
      templates: { folder: 'Templates' },
      localOnly: { paths: ['Private/**', 'Journal/**'] },
    },
    null,
    2,
  )}\n`;
}

type StarterProvider = Pick<
  StorageProvider,
  | 'list'
  | 'write'
  | 'readConfig'
  | 'writeConfig'
  | 'createFolder'
  | 'listFolders'
  | 'listAttachments'
  | 'listTrash'
>;

/** What the offer is judged on. */
export interface VaultStarterState {
  /** The personal vault (never the team vault). */
  personal: boolean;
  caps: Pick<VaultCaps, 'folders' | 'settingsWrite'>;
  provider: StarterProvider;
  resourceId: string;
  /** An Obsidian config folder is known to be there (a picker saw it). */
  obsidianFolder?: boolean;
}

const CONFIG_NAMES = [
  'oscode/vault',
  'obsidian/app',
  'obsidian/daily-notes',
  'obsidian/templates',
] as const;

/** The vault's state as the starter sees it: `foreign` when anything but
 *  the starter's own items is there (so it is not empty), else which of the
 *  starter's items a partial run already added. */
type StarterScan =
  { foreign: true } | { foreign: false; notes: Set<string>; inbox: boolean; settings: boolean };

const STARTER_NOTES: readonly string[] = [
  VAULT_STARTER_PATHS.welcome,
  VAULT_STARTER_PATHS.daily,
  VAULT_STARTER_PATHS.conventions,
];
const STARTER_FOLDERS: readonly string[] = [VAULT_STARTER_PATHS.inbox, 'Templates'];

/** Read everything L12 names. Any read that cannot answer counts as foreign,
 *  so an unknown state is never treated as empty. A run that added part of
 *  the layout leaves only the starter's own items, which do not count, so
 *  "Try again to add the rest" can finish it. */
async function scanForStarter(s: VaultStarterState): Promise<StarterScan> {
  if (s.obsidianFolder) return { foreign: true };
  const p = s.provider;
  try {
    const [notes, folders, attachments, trash, file, ...obsidian] = await Promise.all([
      p.list(s.resourceId),
      p.listFolders ? p.listFolders(s.resourceId) : Promise.resolve([] as string[]),
      p.listAttachments ? p.listAttachments(s.resourceId) : Promise.resolve([]),
      p.listTrash ? p.listTrash(s.resourceId) : Promise.resolve([]),
      ...CONFIG_NAMES.map((n) => readVaultConfig(p, s.resourceId, n)),
    ]);
    if (attachments.length || trash.length) return { foreign: true };
    if (!(obsidian as ConfigRead[]).every((r) => !r.ok && r.reason === 'absent')) {
      return { foreign: true };
    }
    const f = file as ConfigRead;
    const settings = f.ok && f.text === vaultStarterSettingsText();
    if (!settings && !(!f.ok && f.reason === 'absent')) return { foreign: true };
    if (notes.some((n) => !STARTER_NOTES.includes(n.path))) return { foreign: true };
    if ((folders as string[]).some((d) => !STARTER_FOLDERS.includes(d))) return { foreign: true };
    return {
      foreign: false,
      notes: new Set(notes.map((n) => n.path)),
      inbox: (folders as string[]).includes(VAULT_STARTER_PATHS.inbox),
      settings,
    };
  } catch {
    return { foreign: true };
  }
}

/** Whether the vault is empty in every way L12 names (the starter's own
 *  items from a partial run aside). */
export async function vaultIsEmptyForStarter(s: VaultStarterState): Promise<boolean> {
  return !(await scanForStarter(s)).foreign;
}

function complete(scan: Exclude<StarterScan, { foreign: true }>): boolean {
  return STARTER_NOTES.every((n) => scan.notes.has(n)) && scan.inbox;
}

/** Whether "Start with a simple layout" is offered (CX Y13). Otherwise the
 *  ramp keeps "Add a welcome note". */
export async function vaultStarterOffered(s: VaultStarterState): Promise<boolean> {
  if (!s.personal || !s.caps.folders) return false;
  if (typeof s.provider.createFolder !== 'function') return false;
  const scan = await scanForStarter(s);
  return !scan.foreign && !complete(scan);
}

/** One item the preview lists and the apply adds. */
export type VaultStarterItem =
  { kind: 'settings' } | { kind: 'folder'; path: string } | { kind: 'note'; path: string };

/** What the preview shows (the settings line only when the file will be
 *  written) and what `applyVaultStarter` adds, in order. */
export function planVaultStarter(caps: Pick<VaultCaps, 'settingsWrite'>): VaultStarterItem[] {
  return [
    ...(caps.settingsWrite ? [{ kind: 'settings' } as const] : []),
    { kind: 'note', path: VAULT_STARTER_PATHS.welcome },
    { kind: 'folder', path: VAULT_STARTER_PATHS.inbox },
    { kind: 'note', path: VAULT_STARTER_PATHS.daily },
    { kind: 'note', path: VAULT_STARTER_PATHS.conventions },
  ];
}

/** What applying did. `refused`: the vault was no longer empty, so nothing
 *  was written. */
export type VaultStarterResult =
  | { ok: false; refused: 'not-empty' }
  | {
      ok: true;
      added: number;
      total: number;
      /** The settings file landed (the conventions note says so). */
      settingsLanded: boolean;
      /** Note paths written, for the list and the index. */
      notes: string[];
      /** The toast (CX Y13): the whole layout, or how much of it. */
      line: string;
    };

/** Add the layout (CX Y13's "Add these"). Emptiness re-checked first; every
 *  write `ifAbsent`, so a note that appeared since is left as it is. The
 *  caller plays `hapticCommit()` on a full result. */
export async function applyVaultStarter(s: VaultStarterState): Promise<VaultStarterResult> {
  if (!s.personal || !s.caps.folders || typeof s.provider.createFolder !== 'function') {
    return { ok: false, refused: 'not-empty' };
  }
  const scan = await scanForStarter(s);
  if (scan.foreign || complete(scan)) return { ok: false, refused: 'not-empty' };
  const p = s.provider;
  const items = planVaultStarter(s.caps);
  let added = 0;
  let settingsLanded = false;
  const notes: string[] = [];
  const text = (path: string): string =>
    path === VAULT_STARTER_PATHS.welcome
      ? vaultWelcomeNote()
      : path === VAULT_STARTER_PATHS.daily
        ? vaultStarterDailyTemplate()
        : vaultStarterConventions(settingsLanded);
  for (const item of items) {
    try {
      if (item.kind === 'settings') {
        if (scan.settings) {
          settingsLanded = true;
          added++;
          continue;
        }
        if (typeof p.writeConfig !== 'function') continue;
        const r = await p.writeConfig(s.resourceId, 'oscode/vault', vaultStarterSettingsText(), {
          ifAbsent: true,
        });
        settingsLanded = r.ok;
        if (r.ok) added++;
      } else if (item.kind === 'folder') {
        if (scan.inbox) {
          added++;
          continue;
        }
        const r = await p.createFolder!(s.resourceId, item.path);
        if (r.ok || r.conflict === 'exists') added++;
      } else {
        if (scan.notes.has(item.path)) {
          added++;
          continue;
        }
        const r = await p.write(s.resourceId, item.path, text(item.path), { ifAbsent: true });
        if (r.ok) {
          added++;
          notes.push(item.path);
        }
      }
    } catch {
      // One item that fails is counted as not added; the rest still go.
    }
  }
  const total = items.length;
  return {
    ok: true,
    added,
    total,
    settingsLanded,
    notes,
    line: added === total ? VAULT_STARTER_ADDED : vaultStarterPartial(added, total),
  };
}
