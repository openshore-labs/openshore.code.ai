// App Lock (founder 2026-10-12, CX ruling Q3). Off by default and needs no
// account. On, OpenShore asks for the device's own unlock (Face ID, Touch ID,
// or the device passcode) before it shows anything: at launch, and on return
// after the time the person chose. There is no OpenShore passcode, so there
// is no "forgot passcode" path that would wipe data or get around the lock.
//
// The lock hides the interface only. Data here is already sealed at rest by
// the keychain key; the lock keeps the app closed to anyone holding the phone
// unlocked. Work already running (routines on the computer, paired sessions,
// downloads, a reply streaming) keeps going, and an approval waits for the
// unlock: it is never given from a notice.
//
// iPhone and iPad only for now (CX): Electron's Touch ID prompt has no
// password fallback, so a few failed touches would lock a person out, and
// Windows and Linux have no system prompt to ask. The rules are pure so the
// tests pin them; the plugin calls at the bottom are thin.
import { registerPlugin } from '@capacitor/core';
import { platform } from './platform.js';

/** How long the app may sit in the background before it locks: at once,
 *  after 1 minute (the default), or after 15 minutes. Seconds. */
export type LockAfter = 0 | 60 | 900;
export const LOCK_AFTER_CHOICES: readonly LockAfter[] = [0, 60, 900];
export const DEFAULT_LOCK_AFTER: LockAfter = 60;

export interface AppLockSetting {
  on: boolean;
  after?: LockAfter;
}

/** Whether returning now should lock, given when the app went to the
 *  background. A launch (no time on record) locks whenever the lock is on. */
export function shouldLock(
  setting: AppLockSetting | undefined,
  backgroundedAt: number | undefined,
  now: number = Date.now(),
): boolean {
  if (!setting?.on) return false;
  if (backgroundedAt === undefined) return true;
  const after = setting.after ?? DEFAULT_LOCK_AFTER;
  return now - backgroundedAt >= after * 1000;
}

export function lockAfterLabel(after: LockAfter): string {
  return after === 0 ? 'Immediately' : after === 60 ? 'After 1 minute' : 'After 15 minutes';
}

export type Biometry = 'faceID' | 'touchID' | 'opticID' | 'none';

/** The unlock's name for the Settings row. */
export function biometryName(b: Biometry): string {
  return b === 'faceID'
    ? 'Face ID'
    : b === 'touchID'
      ? 'Touch ID'
      : b === 'opticID'
        ? 'Optic ID'
        : 'the passcode';
}

// The words, as CX ruled them.
export const APP_LOCK_LABEL = 'App Lock';
export function appLockSub(biometry: Biometry, device: string): string {
  const ask =
    biometry === 'none'
      ? `${device}'s passcode`
      : `${biometryName(biometry)} or ${device}'s passcode`;
  return `Ask for ${ask} before OpenShore opens. Your data is already encrypted here. This keeps the app closed to anyone holding it unlocked.`;
}
export function noPasscodeSub(device: string): string {
  return `Set a passcode for ${device} first.`;
}
export const LOCKED_TITLE = 'OpenShore is locked';
export const LOCKED_HINT = 'Anything running keeps running.';
export const UNLOCK = 'Unlock';
export const APP_LOCK_ON = 'App Lock on.';
export const APP_LOCK_OFF = 'App Lock off.';
/** What a notice says while the lock is on: nothing about the chat. */
export const LOCKED_NOTICE_TITLE = 'OpenShore';
export const LOCKED_REPLY_BODY = 'A reply is ready.';
export const LOCKED_APPROVAL_BODY = 'A chat needs you.';

// ------------------------------------------------------------ the plugin

export interface OscodeAppLockContract {
  /** Whether the device can ask for its owner, and its biometry. */
  status(): Promise<{ available: boolean; biometry: Biometry }>;
  /** Ask for the device's own unlock. Rejects with "canceled" on a back-out. */
  unlock(options: { reason: string }): Promise<{ ok: boolean }>;
  /** Cover the app switcher's snapshot while the lock is on. */
  setCover(options: { on: boolean }): Promise<void>;
}

class AppLockWeb implements OscodeAppLockContract {
  async status() {
    return { available: false, biometry: 'none' as Biometry };
  }
  async unlock(): Promise<{ ok: boolean }> {
    throw new Error('App Lock is not available here.');
  }
  async setCover() {}
}

export const OscodeAppLock = registerPlugin<OscodeAppLockContract>('OscodeAppLock', {
  web: () => new AppLockWeb() as unknown as OscodeAppLockContract,
});

/** The lock's status on this device, or unavailable off iOS. */
export async function appLockStatus(): Promise<{ available: boolean; biometry: Biometry }> {
  if (platform() !== 'ios') return { available: false, biometry: 'none' };
  try {
    return await OscodeAppLock.status();
  } catch {
    return { available: false, biometry: 'none' };
  }
}

// The system's unlock sheet makes iOS report the app inactive and then active
// again, which would read as a trip to the background: with "Immediately" the
// app would lock again the moment it opened. Changes while our own prompt is
// up, and for a moment after, are not a trip anywhere.
const PROMPT_SETTLE_MS = 1500;
let promptUntil = 0;

/** Whether an app state change now comes from our own unlock prompt. */
export function unlockPromptRecent(now: number = Date.now()): boolean {
  return now < promptUntil;
}

/** Ask for the device's unlock. True once the person proved it is them. */
export async function askUnlock(): Promise<boolean> {
  promptUntil = Number.POSITIVE_INFINITY;
  try {
    return (await OscodeAppLock.unlock({ reason: 'Unlock OpenShore' })).ok;
  } catch {
    return false;
  } finally {
    promptUntil = Date.now() + PROMPT_SETTLE_MS;
  }
}

export async function setAppSwitcherCover(on: boolean): Promise<void> {
  if (platform() !== 'ios') return;
  await OscodeAppLock.setCover({ on }).catch(() => {});
}
