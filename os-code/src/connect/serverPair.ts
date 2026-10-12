// Docking a phone to a server (connect-anywhere, 2026-10-07). A rented Linux
// box runs `osc serve` with no desktop app, so nothing on it can show the
// pairing dialog. `osc pair --server` stands in, in the person's own SSH
// terminal: it asks the running daemon (over loopback, with the shared token)
// for a one-time claim, prints the QR the phone scans, and puts each request
// to the person as "Allow this device?". The yes is still typed by the person
// on the machine, as the desktop's dialog has it (tech review 2026-10-01, F3).
// This file is the logic; the command renders it.

/** The link the phone's camera or in-app scanner reads. The same shape as the
 *  desktop QR (app/src/lib/qrDecode.ts pairingLink), so one scanner reads both. */
export function serverPairingLink(address: string, claim: string): string {
  return `oscode://pair?u=${encodeURIComponent(address)}&c=${encodeURIComponent(claim)}`;
}

/** The address a phone reaches over the tailnet, or undefined with no tailnet
 *  (a phone can only dock to an address on the person's own network). */
export function tailnetAddress(ip: string | undefined, port: number): string | undefined {
  return ip ? `http://${ip}:${port}` : undefined;
}

export interface PendingPairRequest {
  id: string;
  label: string;
  code: string;
  expiresAt: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** The daemon's admin pairing routes, reached on this machine. */
export class ServerPairClient {
  constructor(
    private readonly base: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' };
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, { ...init, headers: this.headers() });
    } catch {
      throw new Error(
        'The OpenShore daemon is not running on this server. Start it with: osc serve --bind tailscale',
      );
    }
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `The daemon answered ${res.status}.`);
    return body;
  }

  /** Whether the daemon running here can take answers from this terminal. */
  async health(): Promise<{ kind?: string }> {
    return this.call<{ kind?: string }>('/health');
  }

  mintClaim(): Promise<{ claim: string; expiresAt: string }> {
    return this.call('/pair/claims', { method: 'POST', body: '{}' });
  }

  async pending(): Promise<PendingPairRequest[]> {
    const body = await this.call<{ requests?: PendingPairRequest[] }>('/pair/requests');
    return body.requests ?? [];
  }

  answer(id: string, allow: boolean): Promise<{ state: string }> {
    return this.call(`/pair/requests/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({ allow }),
    });
  }
}

/** A device's label as the terminal prints it: control and format
 *  characters (C1 controls, bidi overrides) removed, so a label cannot move
 *  the cursor or reorder the line it sits in. The four-digit code stays the
 *  real check. */
export function terminalSafe(label: string): string {
  return label.replace(/[\p{Cc}\p{Cf}]/gu, '').slice(0, 40) || 'A device';
}

/** Only a plain "y" or "yes" allows. Anything else, an empty line included,
 *  is a no: the safe answer is the default. */
export function isYes(answer: string): boolean {
  return /^\s*y(es)?\s*$/i.test(answer);
}
