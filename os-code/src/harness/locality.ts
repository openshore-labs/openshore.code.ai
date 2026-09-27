// What counts as "this computer's own network" (Vault M5, CTO J2). One pure
// judge, by address and never by a provider's label, shared by the engine
// (`isLocalHost` in core/security/egress.ts delegates here) and the app (the
// BYOM reach pill and the vault pack's seat, `packSeatFor`), so a pill's color
// and what a seat is allowed to read can never disagree.
//
// Node-free on purpose (tenet 5): `node:net`'s `isIP` is replaced by a
// hand-rolled IPv4 and IPv6 literal parse that accepts exactly what `isIP`
// does, so the phone runs the same rules. The caller supplies this machine's
// own tailnet suffix, since finding it is I/O (the engine asks Tailscale; the
// app reads the paired hub's `*.ts.net` name).

export interface HostIsLocalOptions {
  /** This machine's own tailnet as a MagicDNS suffix ("tail1234.ts.net"),
   *  without a leading dot. Unset or null means no tailnet is known, so every
   *  `*.ts.net` name is judged remote. */
  ownTailnetSuffix?: string | null;
}

/** The private IPv4 ranges: 10/8, 127/8, 192.168/16, 172.16/12, and the
 *  tailnet's 100.64.0.0/10. */
const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

/** One dotted-decimal octet as `isIP` accepts it: 0 to 255, no leading zero. */
const V4_OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)$/;
/** One IPv6 group: one to four hex digits. */
const V6_GROUP = /^[0-9a-f]{1,4}$/i;
/** An IPv6 zone id as `isIP` accepts it after a `%`. */
const V6_ZONE = /^[0-9a-z.:-]+$/i;

/** True for a dotted-decimal IPv4 literal (what `isIP(s) === 4` means). */
export function isIPv4Literal(s: string): boolean {
  const parts = s.split('.');
  return parts.length === 4 && parts.every((p) => V4_OCTET.test(p));
}

/** True for an IPv6 literal, unbracketed, optionally with a `%zone` (what
 *  `isIP(s) === 6` means): eight groups, or fewer with one `::`, and an
 *  embedded dotted IPv4 in place of the last two groups. */
export function isIPv6Literal(s: string): boolean {
  let addr = s;
  const pct = addr.indexOf('%');
  if (pct !== -1) {
    if (!V6_ZONE.test(addr.slice(pct + 1))) return false;
    addr = addr.slice(0, pct);
  }
  if (addr.length === 0) return false;
  const halves = addr.split('::');
  if (halves.length > 2) return false;
  const compressed = halves.length === 2;
  const groupsOf = (half: string): string[] | null => (half === '' ? [] : half.split(':'));
  const head = groupsOf(halves[0]!);
  const tail = compressed ? groupsOf(halves[1]!) : [];
  if (!head || !tail) return false;
  const all = [...head, ...tail];
  // An embedded IPv4 may only close the address: the last group of the
  // final written half, never just before a trailing `::`.
  const v4At = compressed && tail.length === 0 ? -1 : all.length - 1;
  let count = 0;
  for (let i = 0; i < all.length; i++) {
    const g = all[i]!;
    if (i === v4At && g.includes('.')) {
      if (!isIPv4Literal(g)) return false;
      count += 2;
    } else if (V6_GROUP.test(g)) {
      count += 1;
    } else {
      return false;
    }
  }
  // A `::` stands for at least one zero group.
  return compressed ? count <= 7 : count === 8;
}

/** Strip the brackets a URL keeps on an IPv6 literal (`[::1]`) and any zone
 *  id (`fe80::1%eth0`), so a bracketed loopback is classified as IPv6 (P2-8). */
function normalizeIpLiteral(host: string): string {
  let h = host;
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  const zone = h.indexOf('%');
  if (zone !== -1) h = h.slice(0, zone);
  return h;
}

/**
 * True when a host is on this computer's own network: loopback, the LAN
 * (private ranges, link-local, mDNS), or the person's own tailnet (its
 * 100.64.0.0/10 addresses, or a MagicDNS name under `ownTailnetSuffix`). Any
 * other `*.ts.net` name is NOT local: Tailscale Funnel serves those on the
 * public internet, so a stranger's Funnel host would otherwise pass as local
 * and receive whatever local-only traffic goes to it.
 */
export function hostIsLocal(hostname: string, options: HostIsLocalOptions = {}): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true;
  }
  if (host.endsWith('.ts.net')) {
    const own = options.ownTailnetSuffix?.toLowerCase().replace(/^\./, '');
    return Boolean(own) && host.endsWith(`.${own}`);
  }
  if (isIPv4Literal(host)) return PRIVATE_V4.some((re) => re.test(host));
  const v6 = normalizeIpLiteral(host);
  if (isIPv6Literal(v6)) return v6 === '::1' || v6.startsWith('fd') || v6.startsWith('fe80');
  return false;
}

/** The tailnet suffix of a `*.ts.net` host ("mac.tail1234.ts.net" gives
 *  "tail1234.ts.net"), or null for any other host. The app takes its own
 *  tailnet from the paired hub's address this way (CTO J2). */
export function tailnetSuffixOf(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host.endsWith('.ts.net')) return null;
  const dot = host.indexOf('.');
  const suffix = host.slice(dot + 1);
  return dot > 0 && suffix !== 'ts.net' ? suffix : null;
}
