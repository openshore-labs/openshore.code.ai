// The Vault settings sheet's picks (Vault M7 wave 2; UX review Y1, Y9, Y10): which
// folders a pick offers, and the patches one pick commits. Pure, so the host
// component stays thin and the rules are tested without a store.
import type { ResolvedVaultSettings, VaultSettingsPatch } from 'os-code/protocol';
import type { VaultSettingsPickField } from '../components/vault/VaultSettingsSheet.js';

/** Every folder a vault holds: the parents its notes imply and the folders
 *  its storage lists, never a dot folder, in code-point order. */
export function vaultFolderChoices(
  paths: readonly string[],
  extra: readonly string[] = [],
): string[] {
  const out = new Set<string>();
  const add = (folder: string) => {
    const segs = folder.split('/').filter(Boolean);
    for (let i = 1; i <= segs.length; i++) {
      const f = segs.slice(0, i).join('/');
      if (segs.slice(0, i).some((s) => s.startsWith('.'))) return;
      out.add(f);
    }
  };
  for (const p of paths) {
    const at = p.lastIndexOf('/');
    if (at > 0) add(p.slice(0, at));
  }
  for (const f of extra) add(f);
  return [...out].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The patches one pick commits, in order (UX review Y1): a folder for "New notes
 *  go in" also says new notes go to a folder; a list pick adds the folder's
 *  glob to what the vault file already holds. */
export function vaultPickPatches(
  field: VaultSettingsPickField,
  choice: { kind: 'value'; value: string } | { kind: 'default' } | { kind: 'current' },
  settings: ResolvedVaultSettings,
): VaultSettingsPatch[] {
  if (field === 'newNotes.folder') {
    if (choice.kind === 'default') {
      return [
        { field: 'newNotes.location', value: 'root' },
        { field: 'newNotes.folder', value: null },
      ];
    }
    if (choice.kind === 'current') return [{ field: 'newNotes.location', value: 'current' }];
    return [
      { field: 'newNotes.folder', value: choice.value },
      { field: 'newNotes.location', value: 'folder' },
    ];
  }
  if (field === 'exclude' || field === 'localOnly.paths') {
    if (choice.kind !== 'value') return [];
    const now =
      field === 'exclude'
        ? (settings.narrowing.exclude ?? [])
        : (settings.narrowing.localOnly?.paths ?? []);
    const glob = `${choice.value}/**`;
    return now.includes(glob) ? [] : [{ field, value: [...now, glob] }];
  }
  if (choice.kind !== 'value') return [{ field, value: null }];
  // Obsidian names the daily template without its extension.
  const value = field === 'daily.template' ? choice.value.replace(/\.md$/i, '') : choice.value;
  return [{ field, value }];
}
