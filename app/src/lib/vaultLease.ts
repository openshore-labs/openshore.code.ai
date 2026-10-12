// The vault's single-writer lease (Vault M2 2.5, tech review G5). Pure, so the rule is
// testable without a store or a device.
//
// Compare-and-swap is what keeps two writers apart. A storage that checks the
// write's guard (every one a person can write to in v1) needs no lease to be
// safe, so the lease there is only advisory: a quiet "Also open on your iPad"
// line, and only iCloud writes a lease file for it (it is the one storage one
// person's devices share while typing). A storage without compare-and-swap
// (a future Dropbox, Drive once it takes writes) gets the lease enforced,
// automatically, by the one generic rule below: while another device holds
// it, this one writes nothing to the note.

/** How long a lease lasts past its last renewal: it expires about two
 *  minutes after the last keystroke. */
export const VAULT_LEASE_TTL_MS = 150_000;
/** A lease is renewed at most this often while keystrokes continue. */
export const VAULT_LEASE_RENEW_MS = 60_000;

export type VaultLeaseMode = 'none' | 'advisory' | 'enforced';

/** Which lease a vault takes. `leaseEnforced = writable && !compareAndSwap`;
 *  with compare-and-swap, only iCloud keeps an advisory lease file; every
 *  other storage keeps none. A read-only vault takes no lease at all. */
export function vaultLeaseMode(
  provider: { id: string; compareAndSwap?: true },
  writable: boolean,
): VaultLeaseMode {
  if (!writable) return 'none';
  if (!provider.compareAndSwap) return 'enforced';
  return provider.id === 'icloud' ? 'advisory' : 'none';
}

/** This device's kind, the lease's label ("iPhone", "iPad", "Mac"): never a
 *  personal device name. Undefined when it cannot be told (a browser). */
export function vaultDeviceKind(
  where: 'electron' | 'ios' | 'web',
  nav: { userAgent?: string; platform?: string; maxTouchPoints?: number } = {},
): string | undefined {
  const ua = nav.userAgent ?? '';
  const plat = nav.platform ?? '';
  if (where === 'ios') {
    // iPadOS asks for the desktop site by default and reports a Mac; the
    // touch screen gives it away.
    const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
    return ipad ? 'iPad' : 'iPhone';
  }
  if (where === 'electron') {
    const said = `${plat} ${ua}`;
    if (/Mac/i.test(said)) return 'Mac';
    if (/Win/i.test(said)) return 'Windows computer';
    if (/Linux/i.test(said)) return 'Linux computer';
    return 'computer';
  }
  return undefined;
}
