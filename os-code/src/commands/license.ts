// osc license: activate, show, deactivate. The client is real; the hosted
// verify endpoint is the one documented stub in OS Code (see DECISIONS.md),
// with an offline grace period so a network blip never locks anyone out.
import { t } from '../brand/theme.js';
import { loadConfig } from '../config/load.js';
import { EgressPolicy } from '../core/security/egress.js';
import { deactivate, describeEntitlement, readLicenseState, verifyKey } from '../license/verify.js';
import { okLine, out, warnLine } from './util.js';

export async function licenseActivateCommand(key: string): Promise<void> {
  const { config } = loadConfig();
  const result = await verifyKey(key, config, new EgressPolicy(config.egress));
  if (result.ok) okLine(result.detail);
  else {
    warnLine(result.detail);
    process.exitCode = 1;
  }
}

export async function licenseShowCommand(): Promise<void> {
  const state = readLicenseState();
  if (!state) {
    out(
      t.muted(
        'No license on this machine. Everything local works without one; a license adds the curated catalog feed, cloud-connector configs, and updates. openshore.ai has the details.',
      ),
    );
    return;
  }
  okLine(describeEntitlement(state));
  out(
    t.muted(
      `  key ...${state.key.slice(-6)} ${'·'} last verified ${state.lastVerifiedAt.slice(0, 10)}`,
    ),
  );
}

export async function licenseDeactivateCommand(): Promise<void> {
  deactivate();
  okLine('License removed from this machine. Reactivate any time with osc license activate <key>.');
}
