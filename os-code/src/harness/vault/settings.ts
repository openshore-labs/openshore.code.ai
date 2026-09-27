// The vault's settings (Vault M7, CTO L1 to L4, L13): one schema and one pure
// core, read by the engine, the daemon, the desktop's main process and the app
// alike. The in-vault file `.oscode/vault.json` holds conventions and
// narrowing only: anyone who can write the folder (a sync client, an Obsidian
// plugin, a teammate) can write it, so it can never widen reach. Obsidian's
// own config (`app.json`, `daily-notes.json`, `templates.json`) seeds the
// conventions and wins where it sets one (L3); OpenShore reads it and never
// writes it.
//
// Wave 0 stub: the signatures are the contract; stream A builds the bodies
// (and moves the tolerant readers here from app/src/lib/gitos/config.ts,
// which then re-exports them). Every function below throws until then, since
// a silent default from a parser or a precedence helper could widen reach.
// Pure and import-free past the vault core (harnessPurity).

import type {
  ResolvedVaultSettings,
  VaultPackSize,
  VaultPrivacyNarrowing,
  VaultSettingsField,
  VaultSettingsParse,
  VaultSettingsPatch,
  VaultSettingsReads,
} from './types.js';
import type { VaultContextSetting } from '../vaultContext.js';

function notBuilt(name: string): never {
  throw new Error(`not built: ${name} (Vault M7, stream A)`);
}

/** Every field of the in-vault file, in CX Y1's sheet order (L2, L18). */
export const VAULT_SETTINGS_FIELDS: readonly VaultSettingsField[] = Object.freeze([
  'newNotes.location',
  'newNotes.folder',
  'editor.openMode',
  'tree.sort',
  'delete',
  'exclude',
  'localOnly.paths',
  'localOnly.tags',
  'agent.folder',
  'daily.folder',
  'daily.format',
  'daily.template',
  'templates.folder',
  'templates.dateFormat',
  'templates.timeFormat',
  'links.style',
  'links.format',
  'links.updateOnRename',
  'attachments.folder',
  'editor.font',
  'editor.size',
] as const);

/** Top-level keys the in-vault file may never hold, each set aside as
 *  `widens` with its plain fragment (L4). One test per key. */
export const WIDENING_KEYS: readonly string[] = Object.freeze([
  'context',
  'pack',
  'packSize',
  'packMaxTokens',
  'budget',
  'handoff',
  'pins',
  'dir',
  'location',
  'provider',
  'provenance',
  'include',
  'unexclude',
  'allow',
  'permissions',
  'trust',
  'cloud',
  'share',
  'memory',
] as const);

/** Entries kept per list, and characters per string, in the in-vault file. */
export const VAULT_SETTINGS_LIST_MAX = 200;
export const VAULT_SETTINGS_STRING_MAX = 512;

/** Parse `.oscode/vault.json` as an allow-list (L4). Never throws once
 *  built; `unreadable` for bad JSON or a non-object top level. */
export function parseVaultSettingsFile(_text: string): VaultSettingsParse {
  return notBuilt('parseVaultSettingsFile');
}

/** Resolve every field by L3's precedence from the four reads. No file
 *  anywhere gives exactly `VAULT_SETTINGS_DEFAULTS`. */
export function resolveVaultSettings(_reads: VaultSettingsReads): ResolvedVaultSettings {
  return notBuilt('resolveVaultSettings');
}

/** The union of several narrowings (L4): lists join, nothing is removed, so
 *  an empty list can never drop an entry another part holds. */
export function unionNarrowing(
  ..._parts: Array<VaultPrivacyNarrowing | undefined>
): VaultPrivacyNarrowing {
  return notBuilt('unionNarrowing');
}

/** The file's next text with one field changed (L7), or undefined when
 *  `current` is present and not a JSON object (never overwrite it). Unknown
 *  and set-aside keys are kept as found; `JSON.stringify(obj, null, 2) +
 *  "\n"`. `current` undefined starts a new `{ "version": 1 }` file. */
export function patchVaultSettingsFile(
  _current: string | undefined,
  _patch: VaultSettingsPatch,
): string | undefined {
  return notBuilt('patchVaultSettingsFile');
}

/** Whether the vault context pack is on (L13): machine or project `off`
 *  wins, and the app's override only ever turns it off. `machine` and
 *  `project` are `vault.context` as each holds it (on the engine the loaded
 *  config already carries both, so `project` may be undefined). */
export function vaultContextOn(
  _machine: VaultContextSetting | undefined,
  _project: VaultContextSetting | undefined,
  _app: 'off' | undefined,
): boolean {
  return notBuilt('vaultContextOn');
}

/** Whether the handoff is written and read (L13, CTO reconciliation 4):
 *  true only when machine `vault.handoff`, the project and the app all allow
 *  it. */
export function vaultHandoffOn(
  _machine: 'auto' | 'off' | undefined,
  _project: 'auto' | 'off' | undefined,
  _app: 'off' | undefined,
): boolean {
  return notBuilt('vaultHandoffOn');
}

/** The pack size in force (L13): the app may only lower the machine's. */
export function vaultPackSize(
  _machine: VaultPackSize | undefined,
  _app: VaultPackSize | undefined,
): VaultPackSize {
  return notBuilt('vaultPackSize');
}
