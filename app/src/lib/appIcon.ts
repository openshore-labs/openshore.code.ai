// The app icon, picked in Settings, Appearance (2026-10-01): the
// default ink tile, the turquoise tile from openshore.ai, or an all-white tile
// with the shore and wave in near-black. One list, so the picker, the in-app
// mark, the iPhone's Home Screen icon and the desktop's Dock or window icon
// all name the same three. The PNGs come from scripts/gen-icon.py. Pure, so
// the mark can read it anywhere; putting the icon on the device is
// lib/appIconApply.ts.

export type AppIconId = 'default' | 'turquoise' | 'white';

export interface AppIconChoice {
  id: AppIconId;
  label: string;
  /** The tile, the horizon line, and the wave, as the mark draws them. */
  tile: string;
  line: string;
  wave: string;
  /** The iOS alternate icon set, or null for the primary icon. */
  iosName: string | null;
}

export const APP_ICONS: readonly AppIconChoice[] = [
  {
    id: 'default',
    label: 'Ink',
    tile: '#1c2a33',
    line: '#f6f4ef',
    wave: '#4b90a3',
    iosName: null,
  },
  {
    id: 'turquoise',
    label: 'Turquoise',
    tile: '#5bb6cb',
    line: '#0b1417',
    wave: '#0b1417',
    iosName: 'AppIcon-Turquoise',
  },
  {
    id: 'white',
    label: 'White',
    tile: '#ffffff',
    line: '#0b1417',
    wave: '#0b1417',
    iosName: 'AppIcon-White',
  },
];

export function appIconOf(id: string | undefined): AppIconChoice {
  return APP_ICONS.find((i) => i.id === id) ?? APP_ICONS[0]!;
}

/** What the picker's line says, true to each platform. */
export function appIconNote(platform: 'phone' | 'desktop' | 'web'): string {
  if (platform === 'phone')
    return 'Changes the Home Screen icon. Your iPhone says so when it does.';
  if (platform === 'desktop')
    return 'Changes the Dock and window icon while OpenShore is open, and the logo in the app.';
  return 'Changes the logo in the app.';
}
