// The app's vault context pack (Vault M5, CTO J1): the exact engine pack
// (`planContextPack` and `buildContextPack` from os-code/protocol), prepared
// once per send and rendered per seat, mirroring core/vault/contextSource.ts.
//
// WAVE 0 CONTRACT. Built by stream E. Until then `createAppVaultPack` returns
// a pack that carries nothing (no text, no card), which is exactly today's
// behaviour and cannot leak a note; nothing constructs one before wave 2.
import type { VaultPrivacy } from 'os-code/protocol';
import type { AppVaultPack } from '../drivers/types.js';
import type { AppVaultContextSetting } from '../state/types.js';
import type { VaultIndexHost } from './vaultIndexHost.js';

/** What a conversation's pack is built from. The store builds one per
 *  conversation in `buildUnguardedDriver`. */
export interface AppVaultPackDeps {
  /** `settings.vaultContext` (unset reads 'auto'). */
  setting: AppVaultContextSetting;
  /** The personal vault's index host (`vaultIndexFor` on the personal
   *  target), or undefined when another target is on screen (the team vault
   *  is never in context, D15) or none is open. Never switches the target. */
  index: () => VaultIndexHost | undefined;
  /** A note body through the provider seam (`read`); undefined when gone.
   *  Hidden notes are filtered before any read. */
  read: (path: string) => Promise<string | undefined>;
  /** The compiled privacy rules (`appVaultPrivacy`). */
  privacy: () => Promise<VaultPrivacy>;
  /** This project's Current State (`primaryRepoSource` with
   *  `localRepoReader` or `githubRepoReader`), cached per project for 10
   *  minutes, capped at 256 KB; undefined when neither is readable. */
  currentState: () => Promise<{ path: string; text: string } | undefined>;
  /** The active project's pins (`Project.vaultPins`, J14). */
  projectPins?: () => readonly string[];
  /** A handoff for a conversation's first send, at most
   *  `HANDOFF_MAX_AGE_DAYS` old (J13); undefined for none. */
  handoff?: () => string | undefined;
  /** The cold budget in ms (default `VAULT_PACK_COLD_MS`). */
  coldMs?: number;
}

/** The pack Current State is cached for, per project (J1). */
export const CURRENT_STATE_CACHE_MS = 10 * 60 * 1000;
/** The largest Current State a pack reads, like the engine (J1). */
export const CURRENT_STATE_MAX_BYTES = 256 * 1024;

/** One conversation's pack. */
export function createAppVaultPack(deps: AppVaultPackDeps): AppVaultPack {
  void deps;
  return {
    prepare: () => Promise.resolve(),
    render: () => ({}),
  };
}
