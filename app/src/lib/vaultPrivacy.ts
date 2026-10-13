// The app's vault privacy rules (Vault M5, tech review J3): which notes are hidden and
// which stay on this computer, compiled with the core's `compileVaultPrivacy`
// so the app judges every note exactly as the engine does.
//
// The phone has no machine config of its own, so the rules come from the
// machine that holds the vault: the desktop's main process through the bridge,
// or the paired hub over `GET /vault/privacy`. An unpaired phone uses the D5
// defaults. The device setting only ever narrows, and nothing loaded means the
// D5 defaults, never no rules at all (fail closed).
//
// The vault's own `.oscode/vault.json` (Vault M7, tech review L4) narrows too: its
// lists join the device setting's through the core's `unionNarrowing`, so
// the rules are `compileVaultPrivacy(source, unionNarrowing(device, file))`.
// Union only: an empty list in the file can never drop a D5, machine or
// device entry. The loader (lib/vaultSettings.ts) hands the last good
// narrowing when the file cannot be read, never none.
import {
  VAULT_PRIVACY_ROUTE,
  compileVaultPrivacy,
  unionNarrowing,
  type VaultPrivacy,
  type VaultPrivacyConfig,
  type VaultPrivacyNarrowing,
  type VaultPackSize,
} from 'os-code/protocol';
import { VAULT_PRIVACY_DEFAULTS, type VaultPrivacySetting } from '../state/types.js';
import { nativeFetch } from './nativeFetch.js';
import { storeGetJson, storeSetJson } from './platform.js';

/** Where the rules come from, in order (J3). */
export interface AppVaultPrivacyDeps {
  /** Desktop renderer: the bridge's `vaultPrivacy()`, main reading the
   *  machine's own keys (`vaultPrivacyConfig(loadConfig())`). */
  bridge?: { vaultPrivacy(): Promise<VaultPrivacyConfig> };
  /** Paired phone: `GET /vault/privacy` on the hub, cached sealed on the
   *  device; a failed fetch uses the last cached value unioned with D5. */
  hub?: { fetchPrivacy(): Promise<VaultPrivacyConfig> };
  /** The device setting (`settings.vaultPrivacy`), union-only on top of the
   *  source's rules; the only source on an unpaired phone. */
  device?: VaultPrivacySetting;
  /** Where the hub's last answer is kept, sealed (default: none, so a failed
   *  fetch reads D5 alone). `hubPrivacyCache` is the device store. */
  cache?: PrivacyCache;
  /** The in-vault file's narrowing (`ResolvedVaultSettings.narrowing` from
   *  `loadVaultSettings`), union-only on top of everything else. */
  vault?: VaultPrivacyNarrowing;
  /** The core's union (tests pass their own); default os-code/protocol's. */
  union?: (...parts: Array<VaultPrivacyNarrowing | undefined>) => VaultPrivacyNarrowing;
}

/** The last privacy answer a hub gave, kept for when it is out of reach. */
export interface PrivacyCache {
  load(): Promise<VaultPrivacyConfig | undefined>;
  save(config: VaultPrivacyConfig): Promise<void>;
}

/** The D5 defaults as a config. */
function d5(): VaultPrivacyConfig {
  return {
    exclude: [...VAULT_PRIVACY_DEFAULTS.exclude],
    localOnly: {
      paths: [...VAULT_PRIVACY_DEFAULTS.localOnly.paths],
      tags: [...VAULT_PRIVACY_DEFAULTS.localOnly.tags],
    },
  };
}

function strings(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
}

/** A privacy config as a source sent it, or null when it is not one (a
 *  malformed answer is no answer, so the caller falls back to D5). */
export function readPrivacyConfig(raw: unknown): VaultPrivacyConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { exclude?: unknown; localOnly?: { paths?: unknown; tags?: unknown } };
  const exclude = strings(o.exclude);
  const paths = strings(o.localOnly?.paths);
  const tags = strings(o.localOnly?.tags);
  if (!exclude || !paths || !tags) return null;
  return { exclude, localOnly: { paths, tags } };
}

/** Both configs at once: a union, so neither can lift the other's rule. */
function union(a: VaultPrivacyConfig, b: VaultPrivacyConfig): VaultPrivacyConfig {
  return {
    exclude: [...a.exclude, ...b.exclude],
    localOnly: {
      paths: [...a.localOnly.paths, ...b.localOnly.paths],
      tags: [...a.localOnly.tags, ...b.localOnly.tags],
    },
  };
}

/** The source's rules (J3's order), before the device setting narrows them. */
async function sourceRules(deps: AppVaultPrivacyDeps): Promise<VaultPrivacyConfig> {
  if (deps.bridge) {
    // The machine's own keys. A bridge that cannot answer is no rules, so D5.
    try {
      return readPrivacyConfig(await deps.bridge.vaultPrivacy()) ?? d5();
    } catch {
      return d5();
    }
  }
  if (deps.hub) {
    try {
      const got = readPrivacyConfig(await deps.hub.fetchPrivacy());
      if (got) {
        try {
          await deps.cache?.save(got);
        } catch {
          // A cache that cannot be written only costs the offline fallback.
        }
        return got;
      }
    } catch {
      // Out of reach: the last answer below, with D5 on top.
    }
    let cached: VaultPrivacyConfig | null = null;
    try {
      cached = readPrivacyConfig(await deps.cache?.load());
    } catch {
      cached = null;
    }
    return cached ? union(cached, d5()) : d5();
  }
  // Unpaired: there is no machine to ask, so D5 (it has no person override in
  // v1, so the device setting below can add to it and never take it away).
  return d5();
}

/**
 * The effective privacy rules for this device. Fail closed: no rules loaded
 * means the D5 defaults (`VAULT_PRIVACY_DEFAULTS`), never none. The device
 * setting may only narrow (the compiler's union-only second argument).
 */
export async function appVaultPrivacy(deps: AppVaultPrivacyDeps = {}): Promise<VaultPrivacy> {
  const source = await sourceRules(deps);
  const device = readPrivacyConfig(deps.device) ?? undefined;
  if (!hasEntries(deps.vault)) return compileVaultPrivacy(source, device);
  const union = deps.union ?? unionNarrowing;
  return compileVaultPrivacy(source, union(device, deps.vault));
}

/** Whether a narrowing adds anything (an empty one changes no rule, so the
 *  compile stays exactly as it was before M7). */
function hasEntries(n: VaultPrivacyNarrowing | undefined): n is VaultPrivacyNarrowing {
  return Boolean(
    n &&
    ((n.exclude?.length ?? 0) > 0 ||
      (n.localOnly?.paths?.length ?? 0) > 0 ||
      (n.localOnly?.tags?.length ?? 0) > 0),
  );
}

/** A paired hub's privacy source: `GET /vault/privacy` with the pairing's
 *  bearer token, through the native shim (the hub sends no CORS headers). */
export function hubPrivacySource(target: {
  baseUrl: string;
  token: string;
}): NonNullable<AppVaultPrivacyDeps['hub']> {
  return {
    async fetchPrivacy() {
      const res = await nativeFetch(`${target.baseUrl.replace(/\/+$/, '')}${VAULT_PRIVACY_ROUTE}`, {
        headers: { authorization: `Bearer ${target.token}` },
        responseType: 'json',
      });
      if (!res.ok) throw new Error(`Your computer answered ${res.status}.`);
      const got = readPrivacyConfig(await res.json());
      if (!got) throw new Error('Your computer sent privacy rules this app cannot read.');
      return got;
    },
  };
}

/** The machine's Room for notes in a privacy answer (Vault M8), or
 *  undefined when the answer carries none (an older computer). */
export function readMachinePackSize(raw: unknown): VaultPackSize | undefined {
  const v = raw && typeof raw === 'object' ? (raw as { packSize?: unknown }).packSize : undefined;
  return v === 'small' || v === 'normal' || v === 'large' ? v : undefined;
}

/** A paired hub's Room for notes, from the same `GET /vault/privacy` answer
 *  (Vault M8). Undefined when the hub does not say or cannot be reached, so
 *  the sheet says it conservatively; never a guess. */
export async function hubMachinePackSize(target: {
  baseUrl: string;
  token: string;
}): Promise<VaultPackSize | undefined> {
  try {
    const res = await nativeFetch(`${target.baseUrl.replace(/\/+$/, '')}${VAULT_PRIVACY_ROUTE}`, {
      headers: { authorization: `Bearer ${target.token}` },
      responseType: 'json',
    });
    return res.ok ? readMachinePackSize(await res.json()) : undefined;
  } catch {
    return undefined;
  }
}

/** The sealed device store for one hub's last privacy answer, keyed by the
 *  hub's address so a second hub never reads the first one's rules. */
export function hubPrivacyCache(baseUrl: string): PrivacyCache {
  const key = 'oscode.vaultPrivacy.hub.v1';
  return {
    async load() {
      const kept = await storeGetJson<{ baseUrl?: string; config?: unknown }>(key);
      if (!kept || kept.baseUrl !== baseUrl) return undefined;
      return readPrivacyConfig(kept.config) ?? undefined;
    },
    async save(config) {
      await storeSetJson(key, { baseUrl, config });
    },
  };
}
