// Which folder holds a vault's Obsidian config, and which files a host may
// read from it (Vault M3, CTO H5). Pure, so the desktop's main process and the
// iPhone folder provider pick the same folder by the same rule; the Node
// reader is `core/vault/configFile.ts`.
//
// Only logical names cross the readConfig seam. Each maps here to one file,
// and nothing else is readable: never a plugin folder (`plugins/**` can hold
// tokens), never `workspace*.json`.
import type { VaultConfigName } from './types.js';

/** A root dot folder a host listed: its name and the file names directly in
 *  it. */
export interface ConfigDirCandidate {
  name: string;
  files: readonly string[];
}

export type ConfigDirPlatform = 'desktop' | 'ios';

/** A config folder's name: a dot, then 1 to 64 of `[A-Za-z0-9._-]`. */
export const CONFIG_DIR_NAME = /^\.[A-Za-z0-9._-]{1,64}$/;

/** Dot folders that are never a config folder. */
const NEVER_CONFIG = new Set(['.oscode', '.git', '.trash']);

/** A config file is capped at 256 KB of UTF-8. */
export const VAULT_CONFIG_MAX_BYTES = 256 * 1024;

/** Where each logical name lives: in the detected Obsidian config folder, or
 *  in the vault's own `.oscode` folder. */
export const VAULT_CONFIG_FILES: Readonly<
  Record<VaultConfigName, { dir: 'obsidian' | 'oscode'; file: string }>
> = Object.freeze({
  'obsidian/app': { dir: 'obsidian', file: 'app.json' },
  'obsidian/daily-notes': { dir: 'obsidian', file: 'daily-notes.json' },
  'obsidian/templates': { dir: 'obsidian', file: 'templates.json' },
  'oscode/vault': { dir: 'oscode', file: 'vault.json' },
});

export function isVaultConfigName(name: unknown): name is VaultConfigName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(VAULT_CONFIG_FILES, name);
}

function holdsConfig(files: readonly string[]): boolean {
  return files.some((f) => f === 'app.json' || /^workspace.*\.json$/.test(f));
}

/** A dot folder that may be a config folder. */
export function isConfigDirCandidate(c: ConfigDirCandidate): boolean {
  return (
    CONFIG_DIR_NAME.test(c.name) && !NEVER_CONFIG.has(c.name.toLowerCase()) && holdsConfig(c.files)
  );
}

/** The vault's config folder, or undefined when there is none. The desktop
 *  prefers `.obsidian`. The iPhone folder prefers the folder its pick
 *  recorded, then the one holding `workspace-mobile.json`, then `.obsidian`.
 *  Otherwise the first candidate in code-unit order. */
export function detectConfigDir(
  candidates: readonly ConfigDirCandidate[],
  platform: ConfigDirPlatform,
  recorded?: string,
): string | undefined {
  const valid = candidates
    .filter(isConfigDirCandidate)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (valid.length === 0) return undefined;
  const named = (name: string) => valid.find((c) => c.name === name)?.name;
  if (platform === 'ios') {
    if (recorded && named(recorded)) return recorded;
    const mobile = valid.find((c) => c.files.includes('workspace-mobile.json'));
    if (mobile) return mobile.name;
  }
  return named('.obsidian') ?? valid[0]!.name;
}
