// Putting the picked app icon on this device (lib/appIcon.ts holds the three
// tiles): the Home Screen icon on an iPhone or iPad, through the app's own
// native plugin, and the Dock or window icon on the desktop, through the
// bridge. Kept apart from the list so the mark never loads native code.
import { Llama } from './llamaPlugin.js';
import { bridge } from './electronBridge.js';
import { isDesktop, isPhone } from './platform.js';
import { appIconOf, type AppIconId } from './appIcon.js';

/** Put the chosen icon on this device: the Home Screen icon on an iPhone or
 *  iPad, the Dock or window icon on the desktop. The in-app mark follows the
 *  `data-icon` attribute App.tsx sets. Never throws; false when this device
 *  could not change it (an older build, or a device that does not allow it). */
export async function applyAppIcon(id: AppIconId): Promise<boolean> {
  try {
    if (isPhone()) {
      const set = Llama.setAppIcon;
      if (!set) return false;
      const result = await set.call(Llama, { name: appIconOf(id).iosName });
      return result.ok;
    }
    if (isDesktop()) {
      const result = await bridge()?.setAppIcon?.(id);
      return Boolean(result?.ok);
    }
  } catch {
    // An older native build without the method answers here.
  }
  return false;
}
