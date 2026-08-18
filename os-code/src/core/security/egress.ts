// Egress policy. Every outbound request the agent makes on the user's behalf
// (web search, page fetch, catalog refresh, cloud APIs) passes through here.
// Local endpoints (Ollama, LM Studio, a self-hosted SearXNG on the LAN or
// tailnet) are always allowed: local-first traffic is the point of the product.
import { isIP } from 'node:net';

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

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.ts.net')
  ) {
    return true;
  }
  if (isIP(host) === 4) return PRIVATE_V4.some((re) => re.test(host));
  if (isIP(host) === 6) return host === '::1' || host.startsWith('fd') || host.startsWith('fe80');
  return false;
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

  /** A fetch wrapper that refuses before any packet leaves the machine. */
  async fetch(url: string, purpose: EgressPurpose, init?: RequestInit): Promise<Response> {
    const decision = this.check(url, purpose);
    if (!decision.allowed) {
      throw new EgressBlocked(url, decision.reason);
    }
    return fetch(url, init);
  }
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
