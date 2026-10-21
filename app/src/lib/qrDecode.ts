// The pairing link a docking QR carries: making it, and reading it back from
// the text the scanner decoded (lib/qrImage.ts turns camera pixels into text).
import { hostIsLocal } from 'os-code/protocol';

/** The desktop's pairing QR (pairing review, UX review 2026-10-01) is a link,
 *  `oscode://pair?u=<address>&c=<claim>`, so the iPhone's own Camera app opens
 *  OpenShore with it, and the in-app scanner reads the same link. The claim is
 *  a one-time code the phone trades at POST /pair/claim for its own
 *  per-device credential, never a credential itself. */
export function pairingLink(address: string, claim: string): string {
  return `oscode://pair?u=${encodeURIComponent(address)}&c=${encodeURIComponent(claim)}`;
}

/** Only an address on the person's own network can be paired from a QR: this
 *  computer, the LAN, or their tailnet's 100.x addresses, judged by address
 *  (protocol hostIsLocal). A planted QR pointing anywhere else is refused, so
 *  a stranger's server can never pose as "your computer" and receive prompts
 *  or vault traffic. */
export function pairableAddress(address: string): boolean {
  try {
    const u = new URL(address);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return hostIsLocal(u.hostname.replace(/^\[|\]$/g, ''));
  } catch {
    return false;
  }
}

/** The pairing QR's text, as the link above or the older JSON
 *  `{u: address, c: claim}` (a desktop not yet updated). Returns the pair when
 *  it is one of those and the address is pairable, otherwise undefined (a
 *  foreign QR is ignored, never half-applied). */
export function parsePairingQr(text: string): { address: string; claim: string } | undefined {
  const pair = readPairing(text.trim());
  return pair && pairableAddress(pair.address) ? pair : undefined;
}

function readPairing(text: string): { address: string; claim: string } | undefined {
  if (/^oscode:/i.test(text)) {
    try {
      const u = new URL(text);
      const route = (
        u.hostname ||
        u.pathname.replace(/^\/+/, '').split('/')[0] ||
        ''
      ).toLowerCase();
      const address = u.searchParams.get('u');
      const claim = u.searchParams.get('c');
      if (route === 'pair' && address && claim) return { address, claim };
    } catch {}
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as { u?: unknown; c?: unknown };
    if (typeof parsed.u === 'string' && typeof parsed.c === 'string' && parsed.u && parsed.c) {
      return { address: parsed.u, claim: parsed.c };
    }
  } catch {}
  return undefined;
}
