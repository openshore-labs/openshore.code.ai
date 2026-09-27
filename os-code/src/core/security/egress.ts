// Egress policy. Every outbound request the agent makes on the user's behalf
// (web search, page fetch, catalog refresh, cloud APIs) passes through here.
// Local endpoints (Ollama, LM Studio, a self-hosted SearXNG on the LAN or
// tailnet) are always allowed: local-first traffic is the point of the product.
import { ownTailnetSuffix } from '../../connect/tailscale.js';
import { hostIsLocal } from '../../harness/locality.js';

export interface EgressConfig {
  /** Master switch for the web tools (search + fetch). Default on, always visible. */
  webEnabled: boolean;
  /** When non-empty, only these hosts (and their subdomains) may be reached. */
  allowlist: string[];
  /** Hosts that may never be reached, wins over the allowlist. */
  blocklist: string[];
}

export const DEFAULT_EGRESS: EgressConfig = {
  webEnabled: true,
  allowlist: [],
  blocklist: [],
};

export type EgressPurpose =
  'web-search' | 'web-fetch' | 'cloud-api' | 'catalog' | 'license' | 'model-pull';

export interface EgressDecision {
  allowed: boolean;
  reason: string;
}

/**
 * True when a host is on this computer's own network: loopback, the LAN
 * (private ranges, link-local, mDNS), or the person's own tailnet (its
 * 100.64.0.0/10 addresses, or a MagicDNS name under this machine's own tailnet
 * suffix). Any other *.ts.net name is NOT local: Tailscale Funnel serves those
 * on the public internet, so a stranger's Funnel host would otherwise pass as
 * "local" and receive whatever local-only traffic goes to it.
 *
 * The rules live in the pure judge `hostIsLocal` (harness/locality.ts, Vault
 * M5, CTO J2), shared with the app; this machine's own tailnet suffix is the
 * one thing the engine adds, and it is asked for only for a *.ts.net host.
 */
export function isLocalHost(hostname: string): boolean {
  const tailnet = /\.ts\.net\.?$/i.test(hostname) ? ownTailnetSuffix() : null;
  return hostIsLocal(hostname, { ownTailnetSuffix: tailnet });
}

function hostMatches(host: string, entry: string): boolean {
  const e = entry.toLowerCase();
  return host === e || host.endsWith(`.${e}`);
}

export class EgressPolicy {
  constructor(private readonly config: EgressConfig = DEFAULT_EGRESS) {}

  get webEnabled(): boolean {
    return this.config.webEnabled;
  }

  /** Runtime toggle for the /web slash command; config on disk is unchanged. */
  setWebEnabled(on: boolean): void {
    this.config.webEnabled = on;
  }

  check(url: string, purpose: EgressPurpose): EgressDecision {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, reason: `Not a valid URL: ${url}` };
    }
    const host = parsed.hostname.toLowerCase();

    if (isLocalHost(host)) {
      return { allowed: true, reason: 'local endpoint' };
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { allowed: false, reason: `Only http(s) egress is supported, got ${parsed.protocol}` };
    }
    if (this.config.blocklist.some((b) => hostMatches(host, b))) {
      return {
        allowed: false,
        reason: `${host} is on your egress blocklist. Edit egress.blocklist in your config to change that.`,
      };
    }
    if ((purpose === 'web-search' || purpose === 'web-fetch') && !this.config.webEnabled) {
      return {
        allowed: false,
        reason:
          'Web access is switched off (egress.webEnabled: false). Turn it back on with /web on or in your config.',
      };
    }
    if (
      this.config.allowlist.length > 0 &&
      !this.config.allowlist.some((a) => hostMatches(host, a))
    ) {
      return {
        allowed: false,
        reason: `${host} is not on your egress allowlist. Add it to egress.allowlist in your config to reach it.`,
      };
    }
    return { allowed: true, reason: 'allowed by egress policy' };
  }

  /**
   * A fetch wrapper that refuses before any packet leaves the machine. Redirects
   * are followed manually so the egress policy is re-checked on EVERY hop: a
   * bare `fetch` follows 3xx responses itself, and an allowed first URL that
   * redirects into a blocklisted (or non-allowlisted, or non-local) host would
   * otherwise reach it unchecked (D2). Bounded so a redirect loop cannot hang.
   */
  async fetch(url: string, purpose: EgressPurpose, init?: RequestInit): Promise<Response> {
    const maxHops = 10;
    let current = url;
    let currentInit: RequestInit = { ...init, redirect: 'manual' };
    for (let hop = 0; hop <= maxHops; hop++) {
      const decision = this.check(current, purpose);
      if (!decision.allowed) {
        throw new EgressBlocked(current, decision.reason);
      }
      const res = await fetch(current, currentInit);
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        let next: string;
        try {
          next = new URL(location, current).toString();
        } catch {
          return res; // Unparseable Location: hand the raw redirect back.
        }
        currentInit = redirectInit(currentInit, current, next, res.status);
        current = next;
        continue;
      }
      return res;
    }
    throw new EgressBlocked(current, `Too many redirects following ${url} (over ${maxHops} hops).`);
  }
}

/** Headers that carry a credential and must not follow a request off-origin. */
const CREDENTIAL_HEADER = /^(authorization|proxy-authorization|cookie|x-.*-token)$/i;
const BODY_HEADER = /^content-(type|length|encoding)$/i;

/**
 * The request to send on a redirect hop (ENG-16). A browser-grade `fetch`
 * does this itself; with manual redirects we must: drop credential headers
 * when the origin changes, and turn a POST into a GET with no body on 301,
 * 302, and 303 the way every client does.
 */
function redirectInit(init: RequestInit, from: string, to: string, status: number): RequestInit {
  const out: RequestInit = { ...init };
  const headers = new Headers(init.headers ?? undefined);
  if (new URL(from).origin !== new URL(to).origin) {
    for (const name of [...headers.keys()]) {
      if (CREDENTIAL_HEADER.test(name)) headers.delete(name);
    }
  }
  const method = (init.method ?? 'GET').toUpperCase();
  const demote =
    status === 303
      ? method !== 'GET' && method !== 'HEAD'
      : (status === 301 || status === 302) && method === 'POST';
  if (demote) {
    out.method = 'GET';
    delete out.body;
    for (const name of [...headers.keys()]) {
      if (BODY_HEADER.test(name)) headers.delete(name);
    }
  }
  out.headers = headers;
  return out;
}

export class EgressBlocked extends Error {
  constructor(
    public readonly url: string,
    reason: string,
  ) {
    super(reason);
    this.name = 'EgressBlocked';
  }
}

/** True when a URL's host is on this computer's own network (see isLocalHost).
 *  An unparsable URL is not. */
export function isLocalUrl(url: string): boolean {
  try {
    return isLocalHost(new URL(url).hostname);
  } catch {
    return false;
  }
}
