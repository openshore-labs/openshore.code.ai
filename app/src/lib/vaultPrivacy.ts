// The app's vault privacy rules (Vault M5, CTO J3): which notes are hidden and
// which stay on this computer, compiled with the core's `compileVaultPrivacy`
// so the app judges every note exactly as the engine does.
//
// WAVE 0 CONTRACT. Built by stream E; throws until then. Privacy must be real:
// a silent default here could send a private note to a cloud seat.
import type { VaultPrivacy, VaultPrivacyConfig } from 'os-code/protocol';
import type { VaultPrivacySetting } from '../state/types.js';

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
}

/**
 * The effective privacy rules for this device. Fail closed: no rules loaded
 * means the D5 defaults (`VAULT_PRIVACY_DEFAULTS`), never none. The device
 * setting may only narrow (the compiler's union-only second argument).
 */
export function appVaultPrivacy(deps?: AppVaultPrivacyDeps): Promise<VaultPrivacy> {
  void deps;
  return Promise.reject(new Error('appVaultPrivacy is not built yet (Vault M5, stream E).'));
}
