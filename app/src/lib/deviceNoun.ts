// How copy names the device in hand (UI/UX review follow-up, 2026-10-07). The
// app said "this phone" in every line about the device itself, though an iPad
// is a target, so every such line asks here instead: "this iPad" on an iPad,
// "this phone" everywhere else. The desktop's own lines say "this computer"
// and never ask. No imports on purpose: copy modules build their strings when
// they load, and a module that pulled in the platform layer would make every
// test that mocks it name this helper too.

/** The two answers, lowercase, for the middle of a sentence. */
export type DeviceNoun = 'this iPad' | 'this phone';

interface Nav {
  userAgent?: string;
  maxTouchPoints?: number;
}

/** The noun for a given navigator. iPadOS asks for the desktop site by default
 *  and reports a Mac, so the touch screen gives it away; a Mac has none. The
 *  same test as vaultDeviceKind in vaultLease.ts. */
export function deviceNounFor(nav: Nav = {}): DeviceNoun {
  const ua = nav.userAgent ?? '';
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
  return ipad ? 'this iPad' : 'this phone';
}

let cached: DeviceNoun | undefined;

/** "this iPad" or "this phone", read once from this device. `start` gives the
 *  sentence-start form ("This iPad", "This phone"). */
export function thisDeviceNoun(opts: { start?: boolean } = {}): string {
  cached ??= deviceNounFor(typeof navigator === 'undefined' ? {} : navigator);
  return opts.start ? cached[0]!.toUpperCase() + cached.slice(1) : cached;
}
