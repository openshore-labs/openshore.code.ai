// License verification client. The paid gate lives SERVER-side on surfaces
// OpenShore controls (the curated catalog feed, signed connector configs, the
// update channel); this client activates a key, caches the entitlement, and
// keeps working offline through a grace period. There is no client-side DRM,
// on purpose. Price for the honest majority.
//
// Hosted endpoint contract (the server is the one documented stub in OS Code;
// see DECISIONS.md):
//   POST {verifyUrl}
//   -> { key: string, machineId: string, version: string }
//   <- 200 { status: "active" | "expired" | "invalid",
//            entitlement?: { type: "subscription" | "perpetual",
//                            validUntil?: string,      // subscription end
//                            updatesUntil?: string } } // perpetual update window
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { oscHome } from '../config/load.js';
import type { OscConfig } from '../config/schema.js';
import type { EgressPolicy } from '../core/security/egress.js';

export interface Entitlement {
  type: 'subscription' | 'perpetual';
  validUntil?: string;
  updatesUntil?: string;
}

export interface LicenseState {
  key: string;
  status: 'active' | 'expired' | 'invalid';
  entitlement?: Entitlement;
  lastVerifiedAt: string;
}

function statePath(): string {
  return join(oscHome(), 'license.json');
}

export function machineId(): string {
  let raw = hostname();
  try {
    raw += readFileSync('/etc/machine-id', 'utf8').trim();
  } catch {}
  return createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

export function readLicenseState(): LicenseState | undefined {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8'));
  } catch {
    return undefined;
  }
}

function writeLicenseState(state: LicenseState): void {
  mkdirSync(oscHome(), { recursive: true });
  writeFileSync(statePath(), JSON.stringify(state, null, 2), { mode: 0o600 });
}

export function deactivate(): void {
  try {
    unlinkSync(statePath());
  } catch {}
}

export interface VerifyResult {
  ok: boolean;
  state?: LicenseState;
  detail: string;
}

/** Verify against the endpoint; on network failure, lean on the grace cache. */
export async function verifyKey(
  key: string,
  config: OscConfig,
  egress: EgressPolicy,
): Promise<VerifyResult> {
  try {
    const res = await egress.fetch(config.license.verifyUrl, 'license', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, machineId: machineId(), version: '0.1.0' }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const body = (await res.json()) as { status: LicenseState['status']; entitlement?: Entitlement };
      const state: LicenseState = {
        key,
        status: body.status,
        entitlement: body.entitlement,
        lastVerifiedAt: new Date().toISOString(),
      };
      if (body.status === 'active') {
        writeLicenseState(state);
        return { ok: true, state, detail: describeEntitlement(state) };
      }
      deactivate();
      return {
        ok: false,
        detail:
          body.status === 'expired'
            ? 'This license has expired. Renew it at openshore.ai to keep the curated feed and updates.'
            : 'That key is not recognized. Check for a typo, or pick one up at openshore.ai.',
      };
    }
    return graceFallback(key, `The license server answered ${res.status}.`, config);
  } catch (err) {
    return graceFallback(key, `Could not reach the license server (${(err as Error).message}).`, config);
  }
}

function graceFallback(key: string, why: string, config: OscConfig): VerifyResult {
  const cached = readLicenseState();
  if (cached && cached.key === key && cached.status === 'active') {
    const ageDays = (Date.now() - Date.parse(cached.lastVerifiedAt)) / 86_400_000;
    if (ageDays <= config.license.graceDays) {
      return {
        ok: true,
        state: cached,
        detail: `${why} Running on the offline grace period (${Math.ceil(config.license.graceDays - ageDays)} days left). ${describeEntitlement(cached)}`,
      };
    }
    return {
      ok: false,
      detail: `${why} The offline grace period (${config.license.graceDays} days) has run out; connect once to re-verify.`,
    };
  }
  return { ok: false, detail: `${why} No cached activation for this key on this machine.` };
}

export function describeEntitlement(state: LicenseState): string {
  const e = state.entitlement;
  if (!e) return 'License active.';
  if (e.type === 'subscription') {
    return `Subscription active${e.validUntil ? ` through ${e.validUntil.slice(0, 10)}` : ''}.`;
  }
  return `Perpetual license. Yours forever; curated feed and connector updates${
    e.updatesUntil ? ` through ${e.updatesUntil.slice(0, 10)}` : ''
  }, and everything keeps working after that.`;
}
