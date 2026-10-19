// Where Harbor Lite runs: bundled with the phone, and with the desktop app
// since 2026-10-19 (electron/harborLite.ts). Its own module, read through the
// platform layer's isPhone and isDesktop, so a test that mocks the platform
// decides this too.
import { bridge } from './electronBridge.js';
import { isDesktop, isPhone } from './platform.js';

/** Harbor Lite can run on this device. An older desktop shell without the
 *  runner cannot. */
export function harborLiteHere(): boolean {
  return isPhone() || (isDesktop() && Boolean(bridge()?.harborLiteGenerate));
}
