// Where the key that seals this device's data lives, said per platform. The
// app seals what it keeps with one data key (lib/platform.ts), and how safe
// that is depends entirely on who holds the key: the iOS Keychain, the
// system on a Mac or a Windows PC, a system keyring on Linux, or nobody at
// all (Linux without a keyring falls back to Chromium's basic_text, and a
// plain browser keeps the key next to the data). So there is no blanket
// "encrypted at rest" claim anywhere: each platform says where its key lives,
// and the two that do not protect it say so plainly (advisory org ruling,
// 2026-09-24). Pure, so the wording is pinned by a test.
import type { Platform } from './platform.js';

/** What the desktop reports about its secret store (safeStorage): the OS,
 *  whether encryption is available this launch, and on Linux the backend
 *  Chromium selected (gnome_libsecret, kwallet, kwallet5, kwallet6,
 *  basic_text, or unknown). */
export interface KeyStoreStatus {
  os: string;
  available: boolean;
  backend?: string;
}

export type SealKind =
  | 'ios-keychain'
  | 'system'
  | 'keyring'
  | 'no-keyring'
  | 'desktop-unavailable'
  | 'browser'
  | 'checking';

/** The Linux backends that are a real system keyring. basic_text is a
 *  hardcoded password, not protection; unknown is treated the same way, since
 *  a line that promises protection must be earned by a known keyring. */
const LINUX_KEYRINGS = new Set(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']);

export function sealKind(platform: Platform, status?: KeyStoreStatus): SealKind {
  if (platform === 'ios') return 'ios-keychain';
  if (platform === 'web') return 'browser';
  if (!status) return 'checking';
  if (status.os === 'linux') {
    return status.available && LINUX_KEYRINGS.has(status.backend ?? '') ? 'keyring' : 'no-keyring';
  }
  // macOS (Keychain) and Windows (DPAPI): the system holds the key whenever
  // safeStorage is available. When it is not, the app keeps the key in the
  // renderer's own storage, which is no protection, and says so.
  return status.available ? 'system' : 'desktop-unavailable';
}

export const SEAL_LINES: Record<SealKind, string> = {
  'ios-keychain': 'Sealed on this device, key in the iOS Keychain.',
  system: 'Sealed on this computer, key held by the system.',
  keyring: 'Sealed on this computer, key in your system keyring.',
  'no-keyring':
    'Keys on this computer are stored unencrypted because no system keyring was found. Install and unlock a keyring (for example GNOME Keyring or KWallet), then restart OpenShore.',
  'desktop-unavailable':
    "Keys on this computer are stored unencrypted because the system's secure storage was not available. Restart OpenShore to try again.",
  browser: 'Not encrypted against anyone who can use this browser profile.',
  checking: 'Checking where this computer keeps the key.',
};

/** Does this kind actually protect the key? The two that do not are the
 *  ones the row flags. */
export function sealProtects(kind: SealKind): boolean {
  return kind === 'ios-keychain' || kind === 'system' || kind === 'keyring';
}

export function sealLine(platform: Platform, status?: KeyStoreStatus): string {
  return SEAL_LINES[sealKind(platform, status)];
}
