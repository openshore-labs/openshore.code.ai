// Sustainability: the energy, carbon, and water behind your stack, folded from
// the same token totals Stack Health already has. Nothing here is a meter
// reading. We do not measure wattage; we reprice tokens at published
// intensities, exactly the way "dollars saved" reprices tokens at a cloud rate.
// The basis travels with the numbers (see SUSTAINABILITY_BASIS) so the screen
// can show what it assumed, and every assumption is conservative by choice: we
// would rather understate what running local saves than overstate it.
//
// The comparison is honest about what it is: a small model on your own hardware
// against the SAME token count run on a large model in a hyperscale data center.
// Two real effects drive the gap. A frontier cloud model is far larger, so it
// spends much more energy per token; and a data center adds cooling and power
// delivery overhead (PUE) plus evaporative water that an air-cooled personal
// machine does not.
import type {
  Sustainability,
  SustainabilityBasis,
  SustainabilityFootprint,
} from './stackHealthTypes.js';

export type { Sustainability, SustainabilityBasis, SustainabilityFootprint };

// Sources, all read as dated references, never a live fetch:
//   - Cloud inference energy: order ~0.3 Wh for a typical large-model response
//     of a few hundred tokens (Epoch AI, 2025). Expressed per 1M tokens and held
//     conservative so "saved" is a floor, not a headline.
//   - PUE: hyperscale operators report ~1.1 (Google, Meta 2023 reports); the
//     wider industry runs higher. 1.2 is a conservative middle.
//   - Grid carbon intensity: global average electricity ~400 gCO2e/kWh (IEA,
//     2023). Applied to BOTH sides, so carbon avoided is purely the energy delta.
//   - Data-center water: on-site water usage effectiveness ~1.8 L/kWh for US
//     data centers (Li et al., "Making AI Less Thirsty," 2023). On-site only, so
//     the off-site water of power generation is left out and the number stays low.
export const SUSTAINABILITY_BASIS: SustainabilityBasis = {
  cloudWhPerMTok: 400,
  localWhPerMTok: 150,
  cloudPue: 1.2,
  localPue: 1.0,
  gridGramsPerKwh: 400,
  cloudLitersPerKwh: 1.8,
};

const ZERO: SustainabilityFootprint = { kwh: 0, grams: 0, liters: 0 };

/** Turn a token count into a footprint at a given intensity. Energy at the
 *  accelerator is (tokens / 1M) * Wh/1M-tok; the wall draw folds in PUE; carbon
 *  and water follow from the wall draw. */
function footprint(
  tokens: number,
  whPerMTok: number,
  pue: number,
  litersPerKwh: number,
  basis: SustainabilityBasis,
): SustainabilityFootprint {
  if (tokens <= 0) return { ...ZERO };
  const wallWh = (tokens / 1_000_000) * whPerMTok * pue;
  const kwh = wallWh / 1000;
  return {
    kwh,
    grams: kwh * basis.gridGramsPerKwh,
    liters: kwh * litersPerKwh,
  };
}

function diff(
  a: SustainabilityFootprint,
  b: SustainabilityFootprint,
): SustainabilityFootprint {
  // Floored at zero: a counterfactual can never be smaller than the local draw
  // in practice (a large cloud model costs more per token than a small local
  // one), but the floor keeps a degenerate basis from ever showing negative
  // "avoided."
  return {
    kwh: Math.max(0, a.kwh - b.kwh),
    grams: Math.max(0, a.grams - b.grams),
    liters: Math.max(0, a.liters - b.liters),
  };
}

/** Compute the sustainability read from the local and cloud token totals. Pure:
 *  no clock, no disk. `localTokens` is prompt + completion that ran on local
 *  models; `cloudTokens` the same for cloud turns. */
export function computeSustainability(
  localTokens: number,
  cloudTokens: number,
  basis: SustainabilityBasis = SUSTAINABILITY_BASIS,
): Sustainability {
  const local = footprint(localTokens, basis.localWhPerMTok, basis.localPue, 0, basis);
  const cloudCounterfactual = footprint(
    localTokens,
    basis.cloudWhPerMTok,
    basis.cloudPue,
    basis.cloudLitersPerKwh,
    basis,
  );
  const cloudActual = footprint(
    cloudTokens,
    basis.cloudWhPerMTok,
    basis.cloudPue,
    basis.cloudLitersPerKwh,
    basis,
  );
  return {
    basis,
    local,
    cloudCounterfactual,
    avoided: diff(cloudCounterfactual, local),
    cloudActual,
  };
}
