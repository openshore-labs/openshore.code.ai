// Entitlement checks: which gated surfaces this install can use, from the
// cached license state. The shell itself always works; the license unlocks
// the curated feed, signed connector configs, and the update channel.
import { readLicenseState, type LicenseState } from './verify.js';

export type GatedFeature = 'curated-catalog' | 'connector-configs' | 'updates';

export interface EntitlementCheck {
  entitled: boolean;
  detail: string;
}

export function checkEntitlement(feature: GatedFeature, state = readLicenseState()): EntitlementCheck {
  if (!state || state.status !== 'active') {
    return {
      entitled: false,
      detail:
        'No active license on this machine. The built-in starter catalog and everything local keep working; the curated feed, connector configs, and updates come with a license from openshore.ai.',
    };
  }
  if (state.entitlement?.type === 'perpetual' && state.entitlement.updatesUntil) {
    const frozen = Date.parse(state.entitlement.updatesUntil) < Date.now();
    if (frozen && (feature === 'curated-catalog' || feature === 'connector-configs' || feature === 'updates')) {
      return {
        entitled: false,
        detail: `Your perpetual license's update window ended ${state.entitlement.updatesUntil.slice(0, 10)}. Everything you have keeps working; renew at openshore.ai for fresh ${feature.replace('-', ' ')}.`,
      };
    }
  }
  return { entitled: true, detail: describeShort(state) };
}

function describeShort(state: LicenseState): string {
  return state.entitlement?.type === 'perpetual' ? 'Perpetual license active.' : 'Subscription active.';
}
