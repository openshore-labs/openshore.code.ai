// Run leaner: honest, advisory suggestions for a stack that would use less
// energy per token. Pure and unit-tested, because this is exactly where the
// honesty risk lives. Two guardrails, both from the CTO/CMO call:
//
//   1. Capability-parity gate. modelEnergyPer1kTok is a size proxy, so left
//      ungated it always points at the smallest model, which would quietly gut
//      the stack. A candidate is surfaced ONLY when it preserves the capability
//      the role needs AND clears a quality floor. Leaner alone is never enough.
//   2. One basis. Energy is modelEnergyPer1kTok / SUSTAINABILITY_BASIS, the same
//      estimate the rest of Stack Health uses. No second energy model.
//
// It never mutates the stack: it returns suggestions the person chooses to act
// on. And it never calls a cloud model "greener" (it is not). When a role is a
// cloud model, the win it names is running a capable local peer instead.
import type { CapabilityCategory, CatalogModel } from 'os-code/protocol';
import { fitFor, modelEnergyPer1kTok, osCodeFit, starIn } from '../components/marketplace.js';

export interface CrewMemberLite {
  role: string;
  model: string;
  kind: 'local' | 'cloud';
}

export interface LeanerSuggestion {
  role: string;
  fromModel: string;
  /** true when the current model is a cloud model: the suggestion is to run a
   *  capable local peer instead, and the win is leaving the data center. */
  fromCloud: boolean;
  to: CatalogModel;
  /** Fraction leaner per token vs the current LOCAL model (0..1). Undefined when
   *  the current model is cloud, where a per-token local-vs-cloud delta would be
   *  an apples-to-oranges number we refuse to invent. */
  savingFraction?: number;
}

// A specialist role id is also its capability id in the catalog taxonomy
// (coding, writing, analysis, vision, embedding, fast, reasoning). The
// orchestrator is special-cased below. imageGen is not an energy-optimizable
// coding role and is excluded upstream (summarizeStack drops it).
const ROLE_CAPS: CapabilityCategory[] = [
  'reasoning',
  'coding',
  'writing',
  'analysis',
  'vision',
  'embedding',
  'fast',
];

const QUALITY_TOLERANCE = 0.5; // a candidate may sit at most half a star below the current model
const CLOUD_REPLACE_FLOOR = 4.0; // replacing a cloud model wants a genuinely strong local peer
const MIN_GAIN = 0.15; // only surface a swap that is meaningfully leaner (>= 15%)

function roleCap(role: string): CapabilityCategory | undefined {
  return ROLE_CAPS.includes(role as CapabilityCategory) ? (role as CapabilityCategory) : undefined;
}

/** Find the catalog entry for a configured model, matched by id, name, or the
 *  pull ref (the stack stores a ref or name). Undefined when the catalog does
 *  not carry it, in which case we make no claim about that role. */
function findInCatalog(model: string, models: CatalogModel[]): CatalogModel | undefined {
  const m = model.trim();
  if (!m) return undefined;
  return models.find((c) => c.id === m || c.name === m || c.source.ref === m);
}

/** Does the candidate preserve what the role needs and clear the quality floor?
 *  `current` is the catalog entry for the current model when known (local), else
 *  undefined (cloud, or an unknown local model), which raises the floor. */
function eligible(
  candidate: CatalogModel,
  role: string,
  current: CatalogModel | undefined,
  memoryGB: number | undefined,
): boolean {
  // Fit, only when we know the target memory (a leaner-than-current local swap
  // fits by construction; a cloud replacement on an unknown hub is left to the
  // person to confirm in the Marketplace, which shows fit).
  if (memoryGB !== undefined && fitFor(candidate.sizeGB, memoryGB) === 'too-big') return false;

  const cap = roleCap(role);
  if (role === 'orchestrator') {
    if (!candidate.orchestratorCapable) return false;
  } else if (cap) {
    if (!candidate.categories.includes(cap)) return false;
  }

  const candFit = osCodeFit(candidate);
  if (current) {
    // Capability-preserving: within tolerance of the current model's fit, and,
    // where the role has a rated capability, within tolerance on that axis too.
    const curFit = osCodeFit(current);
    if (curFit !== undefined) {
      if (candFit === undefined || candFit < curFit - QUALITY_TOLERANCE) return false;
    } else if (candFit === undefined || candFit < CLOUD_REPLACE_FLOOR) {
      return false;
    }
    if (cap) {
      const curStar = starIn(current, cap);
      const candStar = starIn(candidate, cap);
      if (
        curStar !== undefined &&
        (candStar === undefined || candStar < curStar - QUALITY_TOLERANCE)
      )
        return false;
    }
  } else {
    // Replacing a cloud model (or an unknown current): require a strong peer.
    if (candFit === undefined || candFit < CLOUD_REPLACE_FLOOR) return false;
  }
  return true;
}

/** The single best eligible candidate for a role: the most capable (highest
 *  osCodeFit), then the leanest, then curated order, so we never trade capability
 *  away for a marginal energy win. */
function bestCandidate(candidates: CatalogModel[]): CatalogModel | undefined {
  if (!candidates.length) return undefined;
  return [...candidates].sort((a, b) => {
    const fa = osCodeFit(a) ?? 0;
    const fb = osCodeFit(b) ?? 0;
    if (fa !== fb) return fb - fa;
    const ea = modelEnergyPer1kTok(a);
    const eb = modelEnergyPer1kTok(b);
    if (ea !== eb) return ea - eb;
    return a.curation.rank - b.curation.rank;
  })[0];
}

/** Advisory leaner-stack suggestions, at most one per role. Read-only: it never
 *  changes the stack. Roles with no honest suggestion simply do not appear. */
export function leanerSuggestions(
  crew: CrewMemberLite[],
  models: CatalogModel[],
  memoryGB?: number,
): LeanerSuggestion[] {
  const out: LeanerSuggestion[] = [];
  for (const member of crew) {
    if (!member.model) continue;
    const current = member.kind === 'local' ? findInCatalog(member.model, models) : undefined;
    // An unknown local model: make no claim (we cannot measure the delta).
    if (member.kind === 'local' && !current) continue;

    const currentEnergy = current ? modelEnergyPer1kTok(current) : undefined;
    const pool = models.filter((c) => {
      if (current && c.id === current.id) return false;
      if (!eligible(c, member.role, current, memoryGB)) return false;
      if (member.kind === 'local' && currentEnergy !== undefined) {
        // Must be meaningfully leaner than the current local model.
        return modelEnergyPer1kTok(c) <= currentEnergy * (1 - MIN_GAIN);
      }
      return true; // cloud current: any eligible local peer is the win
    });

    const pick = bestCandidate(pool);
    if (!pick) continue;
    out.push({
      role: member.role,
      fromModel: member.model,
      fromCloud: member.kind === 'cloud',
      to: pick,
      savingFraction:
        currentEnergy !== undefined
          ? Math.max(0, 1 - modelEnergyPer1kTok(pick) / currentEnergy)
          : undefined,
    });
  }
  return out;
}
