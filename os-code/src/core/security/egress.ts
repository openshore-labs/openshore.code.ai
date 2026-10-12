// Egress policy. Every outbound request the agent makes on the user's behalf
// (web search, page fetch, catalog refresh, cloud APIs) passes through here.
// Local endpoints (Ollama, LM Studio, a self-hosted SearXNG on the LAN or
// tailnet) are always allowed: local-first traffic is the point of the product.
// A web tool is the exception (D3): the model steers its address, so a page
// fetch or a redirect into this computer's own network asks first, unless it
// is a configured model server or search service.
import { lookup } from 'node:dns/promises';
import { ownTailnetSuffix } from '../../connect/tailscale.js';
import { hostIsLocal, isIPv4Literal, isIPv6Literal } from '../../harness/locality.js';
import { RebindRefused, pinnedFetch } from './pinnedFetch.js';

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

export type EgressPurpose = 'web-search' | 'web-fetch' | 'cloud-api' | 'catalog' | 'model-pull';

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

/** The purposes a model steers (the web tools): a target on this computer's
 *  own network asks before it is reached (D3). */
const WEB_PURPOSES: ReadonlySet<EgressPurpose> = new Set(['web-search', 'web-fetch']);

/** Asked before a web tool reaches an address on this computer's own
 *  network; true lets it through. The agent loop answers it with an approval
 *  card, once per session for each host. */
export type LocalReachGate = (
  url: string,
  host: string,
  purpose: EgressPurpose,
) => Promise<boolean>;

export interface EgressOptions {
  /** Hosts (`host:port`, as a URL's `host`) on this computer's network that a
   *  web tool may reach without asking: the configured model servers and a
   *  self-hosted search service. */
  localExempt?: readonly string[];
  /** A name's addresses (tests stand it in). Defaults to the system resolver. */
  lookup?: (hostname: string) => Promise<string[]>;
}

/** How long a name lookup for the local check may take before the name is
 *  judged by itself; the fetch then resolves it on its own. */
const LOOKUP_TIMEOUT_MS = 3000;

async function systemLookup(hostname: string): Promise<string[]> {
  const found = await lookup(hostname, { all: true, verbatim: true });
  return found.map((a) => a.address);
}

/**
 * True when an address is on this computer's own network in the widest sense
 * a web fetch must not reach unasked: loopback, the LAN, the tailnet's
 * 100.64/10 (all `isLocalHost`), plus link-local 169.254/16 (a cloud
 * machine's metadata service), 0.0.0.0/8, `::`, unique-local fc00::/7, and an
 * IPv4 address written as IPv6 (`::ffff:127.0.0.1`).
 */
export function addressOnOwnNetwork(address: string): boolean {
  const a = address
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/%.*$/, '');
  if (isLocalHost(a)) return true;
  if (isIPv4Literal(a)) return /^(?:169\.254|0)\./.test(a);
  if (!isIPv6Literal(a)) return false;
  if (a === '::' || /^f[cd]/.test(a)) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a)?.[1];
  return mapped !== undefined && addressOnOwnNetwork(mapped);
}

export class EgressPolicy {
  private localGate?: LocalReachGate;
  private readonly localExempt: ReadonlySet<string>;

  constructor(
    private readonly config: EgressConfig = DEFAULT_EGRESS,
    private readonly options: EgressOptions = {},
  ) {
    this.localExempt = new Set((options.localExempt ?? []).map((h) => h.toLowerCase()));
  }

  /** Who answers before a web tool reaches this computer's own network (the
   *  agent loop sets it). Without one such a fetch is refused, since nobody
   *  could be asked. */
  setLocalGate(gate: LocalReachGate | undefined): void {
    this.localGate = gate;
  }

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

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { allowed: false, reason: `Only http(s) egress is supported, got ${parsed.protocol}` };
    }
    // This computer's own network is never the web switch's or the lists' to
    // refuse; a web tool's fetch there asks first (fetch, below).
    if (isLocalHost(host)) {
      return { allowed: true, reason: 'local endpoint' };
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
      // A model download follows only https addresses off this network, on
      // every hop: a source's redirect cannot turn it to plain http or to a
      // machine on the person's own network (security review, 2026-10-12).
      if (purpose === 'model-pull') {
        const target = new URL(current);
        const host = target.hostname.replace(/^\[|\]$/g, '');
        if (target.protocol !== 'https:' || isLocalHost(host) || addressOnOwnNetwork(host)) {
          throw new EgressBlocked(
            current,
            'A model download follows only https addresses off this network.',
          );
        }
      }
      const decision = this.check(current, purpose);
      if (!decision.allowed) {
        throw new EgressBlocked(current, decision.reason);
      }
      // A web tool's target (or a redirect's) on this computer's own network
      // asks first, judged by the address the name resolves to (D3).
      let allowOwnNetwork = false;
      if (WEB_PURPOSES.has(purpose)) allowOwnNetwork = await this.gateOwnNetwork(current, purpose);
      // A page the model chose connects through the same lookup that checks
      // it, so a name cannot answer public to the check and local to the
      // connection (F4, DNS rebinding).
      let res: Response;
      if (purpose === 'web-fetch') {
        try {
          res = await pinnedFetch(current, currentInit, {
            onOwnNetwork: addressOnOwnNetwork,
            allowOwnNetwork,
            ...(this.options.lookup ? { lookup: this.options.lookup } : {}),
          });
        } catch (err) {
          if (err instanceof RebindRefused) throw new EgressBlocked(current, err.message);
          throw err;
        }
      } else {
        res = await fetch(current, currentInit);
      }
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

  /** Refuse, or ask, before a web tool reaches this computer's own network:
   *  loopback (its own apps, the OpenShore daemon among them), the LAN (a
   *  router's settings page), the tailnet, a cloud machine's metadata
   *  address. A configured model server or search service passes. */
  private async gateOwnNetwork(url: string, purpose: EgressPurpose): Promise<boolean> {
    const parsed = new URL(url);
    if (this.localExempt.has(parsed.host.toLowerCase())) return true;
    if (!(await this.onOwnNetwork(parsed.hostname))) return false;
    if (!this.localGate) {
      throw new EgressBlocked(
        url,
        `${parsed.host} is on this computer's own network, and nobody here can approve opening it, so it was not opened.`,
      );
    }
    if (!(await this.localGate(url, parsed.host, purpose))) {
      throw new EgressBlocked(
        url,
        `The person did not allow opening ${parsed.host}, an address on their own network. Use a public address instead, or ask them.`,
      );
    }
    return true;
  }

  /** Is this name on this computer's own network, by the name itself or by
   *  any address it resolves to (a public name can point at 127.0.0.1)? A
   *  lookup that fails or stalls leaves the name to speak for itself. */
  private async onOwnNetwork(hostname: string): Promise<boolean> {
    const host = hostname.replace(/^\[|\]$/g, '');
    if (addressOnOwnNetwork(host)) return true;
    if (isIPv4Literal(host) || isIPv6Literal(host.replace(/%.*$/, ''))) return false;
    const resolve = this.options.lookup ?? systemLookup;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const addresses = await Promise.race([
        resolve(host),
        new Promise<string[]>((done) => {
          timer = setTimeout(() => done([]), LOOKUP_TIMEOUT_MS);
          timer.unref?.();
        }),
      ]);
      return addresses.some(addressOnOwnNetwork);
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
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
