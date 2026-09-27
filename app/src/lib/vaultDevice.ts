// The vault's switches on this device (Vault M7 wave 2; CTO L13, L14,
// reconciliation 2 and 4; CX Y7, Y8): Notes in chats, Handoff and Room for
// notes. Device-local, never the vault file's, and never able to widen what
// the machine or a project allows:
// - Notes in chats and Handoff are off-only overrides (the `memoryOverride`
//   pattern): off rides to every session as `vaultOverrides`; on sends
//   nothing, so the machine and the project stay in charge.
// - Room for notes lowers the machine's `vault.packSize` on the engine
//   (`vaultPackSize(machine, app)`, the daemon and bootstrap enforce it). An
//   app seat has no machine config in reach, so there the device's choice is
//   the size.
// - Memory off turns both switches off for new chats (it gates the vault
//   already, `vaultInChats`), and the rows say so.
// Pure, so the store, the settings sheet and Settings read one rule.
import { vaultPackSize, type VaultOverrides, type VaultPackSize } from 'os-code/protocol';
import type {
  VaultDeviceSwitch,
  VaultSettingsDevice,
} from '../components/vault/VaultSettingsSheet.js';
import type {
  AppVaultContextSetting,
  AppVaultHandoffSetting,
  AppVaultPackSize,
} from '../state/types.js';

/** The device settings these switches read. */
export interface VaultDeviceSettings {
  vaultContext?: AppVaultContextSetting;
  vaultHandoff?: AppVaultHandoffSetting;
  vaultPackSize?: AppVaultPackSize;
}

/** What a new engine session carries (CTO L13): only what turns something
 *  off or lowers it; an empty object when every switch is on and the size is
 *  unset. */
export function appVaultOverrides(s: VaultDeviceSettings): VaultOverrides {
  return {
    ...(s.vaultContext === 'off' ? { context: 'off' as const } : {}),
    ...(s.vaultHandoff === 'off' ? { handoff: 'off' as const } : {}),
    ...(s.vaultPackSize ? { packSize: s.vaultPackSize } : {}),
  };
}

/** Room for notes on an app seat: the device's choice, Normal when unset
 *  (the one reading of `vaultPackSize` with no machine above it). */
export function appPackSize(s: VaultDeviceSettings): VaultPackSize {
  return vaultPackSize(s.vaultPackSize, undefined);
}

/** Whether a new chat on this device carries a handoff: the device's switch
 *  and Memory (the machine and the project judge again on the engine). */
export function appHandoffOn(s: VaultDeviceSettings, memoryOn: boolean): boolean {
  return memoryOn && s.vaultHandoff !== 'off';
}

/** A switch as the rows show it: Memory off holds it off, disabled. */
function deviceSwitch(on: boolean, memoryOn: boolean): VaultDeviceSwitch {
  return memoryOn ? { on } : { on: false, lock: 'memory' };
}

/** "On this device" for the settings sheet (CX Y7, Y8). */
export function vaultDeviceView(
  s: VaultDeviceSettings,
  o: { memoryOn: boolean; cloudSeat: boolean },
): VaultSettingsDevice {
  return {
    context: deviceSwitch(s.vaultContext !== 'off', o.memoryOn),
    handoff: deviceSwitch(s.vaultHandoff !== 'off', o.memoryOn),
    packSize: appPackSize(s),
    cloudSeat: o.cloudSeat,
  };
}

/** The settings patch one change on the sheet's "On this device" makes.
 *  Turning a switch on clears the override (unset, never a stored "on"), so
 *  the machine and the project stay in charge. A size is stored as chosen. */
export function vaultDevicePatch(change: {
  context?: boolean;
  handoff?: boolean;
  packSize?: VaultPackSize;
}): Partial<VaultDeviceSettings> {
  return {
    ...(change.context !== undefined
      ? { vaultContext: change.context ? undefined : ('off' as const) }
      : {}),
    ...(change.handoff !== undefined
      ? { vaultHandoff: change.handoff ? undefined : ('off' as const) }
      : {}),
    // Normal is stored too: on the engine it lowers a machine set to Large.
    ...(change.packSize !== undefined ? { vaultPackSize: change.packSize } : {}),
  };
}
