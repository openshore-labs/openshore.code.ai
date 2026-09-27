// A vault's config files, read through the seam (Vault M3, CTO H5). Only
// logical names cross (`obsidian/app`, `obsidian/daily-notes`,
// `obsidian/templates`, `oscode/vault`); each provider maps a name through its
// own allow-list, so a plugin's folder (which can hold tokens) and
// `workspace*.json` are never readable from here.
//
// readVaultConfig is the one entry point: it answers `unsupported` for a
// provider that has not gained readConfig, `refused` for any other name, and
// holds every answer to the 256 KB cap. The readers re-exported below turn a
// file into the few settings the Vault uses, and never throw: bad JSON, a
// wrong type, or a missing key each read as "not set", so a hand-edited file
// can only ever fall back to the defaults.
import {
  VAULT_CONFIG_MAX_BYTES,
  isVaultConfigName,
  utf8Length,
  type ConfigRead,
  type ConfigReadRefusal,
} from 'os-code/protocol';
import type { StorageProvider } from './providers.js';

const REFUSALS: ReadonlySet<string> = new Set<ConfigReadRefusal>([
  'absent',
  'too-large',
  'downloading',
  'unsupported',
  'refused',
]);

/** A provider's answer as the seam promises it, whatever came back: an ok
 *  carries text and a version and fits the cap, and a refusal names one of
 *  the known reasons. Anything else reads as `unsupported`. */
export function asConfigRead(r: unknown): ConfigRead {
  if (typeof r !== 'object' || r === null) return { ok: false, reason: 'unsupported' };
  const v = r as Record<string, unknown>;
  if (v.ok === true) {
    if (typeof v.text !== 'string' || typeof v.version !== 'string') {
      return { ok: false, reason: 'unsupported' };
    }
    if (utf8Length(v.text) > VAULT_CONFIG_MAX_BYTES) return { ok: false, reason: 'too-large' };
    return { ok: true, text: v.text, version: v.version };
  }
  if (v.ok === false && typeof v.reason === 'string' && REFUSALS.has(v.reason)) {
    return { ok: false, reason: v.reason as ConfigReadRefusal };
  }
  return { ok: false, reason: 'unsupported' };
}

/** Read one config file of a vault. A name outside the allow-list is
 *  `refused` before any provider sees it; a provider without readConfig, or
 *  one whose read failed outright, answers `unsupported`, which every caller
 *  treats as "use the defaults". */
export async function readVaultConfig(
  provider: Pick<StorageProvider, 'readConfig'> | undefined,
  resourceId: string,
  name: unknown,
): Promise<ConfigRead> {
  if (!isVaultConfigName(name)) return { ok: false, reason: 'refused' };
  if (typeof provider?.readConfig !== 'function') return { ok: false, reason: 'unsupported' };
  try {
    return asConfigRead(await provider.readConfig(resourceId, name));
  } catch {
    return { ok: false, reason: 'unsupported' };
  }
}

// ---------------------------------------------------------------------------
// Tolerant JSON readers: moved to the pure core in Vault M7 (CTO L1), so the
// engine seeds from `.obsidian` exactly as the app does. Re-exported here so
// every app import keeps its path.
export {
  configJson,
  readDailyNotesConfig,
  readObsidianAppConfig,
  readTemplatesConfig,
} from 'os-code/protocol';
export type { DailyNotesConfig, ObsidianAppConfig, TemplatesConfig } from 'os-code/protocol';
