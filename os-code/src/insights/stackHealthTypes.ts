// The Stack Health payload types, split out into a pure (Node-free) module so
// the WebView can import them through 'os-code/protocol'. The aggregator that
// fills these in lives in stackHealth.ts and does touch the filesystem; nothing
// here does, so this file bundles cleanly for the app.

export type StackHealthRange = 'day' | 'week' | 'month' | 'year' | 'all';

export interface SavingsBasis {
  /** The named cloud model local work is repriced against. */
  model: string;
  inPerM: number;
  outPerM: number;
}

/** The stated, cited assumptions behind the sustainability estimate. It travels
 *  with the numbers so the UI can show exactly what was assumed, the same honesty
 *  contract SavingsBasis holds for the dollars figure. Every value is an
 *  estimate, never a meter reading: we do not measure wattage, we reprice tokens
 *  at published intensities. Sources are recorded beside the constants in
 *  sustainability.ts. */
export interface SustainabilityBasis {
  /** Energy at the accelerator per 1M tokens for a large cloud model, watt-hours. */
  cloudWhPerMTok: number;
  /** Energy at the accelerator per 1M tokens for a small model on personal
   *  hardware, watt-hours. Lower because the model is far smaller. */
  localWhPerMTok: number;
  /** Data-center power overhead (cooling, power delivery): a PUE multiplier. */
  cloudPue: number;
  /** Personal-machine power overhead: a PUE multiplier (about 1, no hall to cool). */
  localPue: number;
  /** Grid carbon intensity applied to both sides, grams CO2e per kWh. Applied
   *  equally so the carbon delta is the ENERGY delta, never a claim that the
   *  cloud runs on dirtier power than you do. */
  gridGramsPerKwh: number;
  /** Data-center on-site water per kWh, liters (evaporative cooling). A personal
   *  machine is air-cooled, so its on-site water is treated as zero. */
  cloudLitersPerKwh: number;
}

/** One side's footprint: energy at the wall (PUE folded in), the carbon it
 *  implies, and the water it draws. */
export interface SustainabilityFootprint {
  /** Energy drawn at the wall in kilowatt-hours (PUE included). */
  kwh: number;
  /** Grams of CO2e. */
  grams: number;
  /** Liters of water. */
  liters: number;
}

/** The sustainability read: what running on your own hardware actually cost the
 *  planet, what the same work would have cost in a hyperscale data center, and
 *  the difference you kept off the grid. Also the honest other half: the real
 *  footprint of the cloud turns you did send this period. */
export interface Sustainability {
  basis: SustainabilityBasis;
  /** What your LOCAL work actually drew on your own hardware. */
  local: SustainabilityFootprint;
  /** What the SAME local work would have drawn in a hyperscale data center, on
   *  the cloud reference model. The counterfactual behind "avoided." */
  cloudCounterfactual: SustainabilityFootprint;
  /** cloudCounterfactual minus local, floored at zero: what staying local kept
   *  off the grid this period. */
  avoided: SustainabilityFootprint;
  /** The real footprint of the cloud turns you DID send, so the picture is not
   *  one-sided (mirrors "you paid the cloud" in dollars). */
  cloudActual: SustainabilityFootprint;
}

export interface StackHealthCrewMember {
  /** Stack slot: 'orchestrator' or a specialist category. */
  role: string;
  model: string;
  kind: 'local' | 'cloud';
  /** Turns this member's model handled in the window (attributed by model id). */
  turns: number;
}

export interface StackHealthSealFact {
  key: 'telemetry' | 'dataLeftDevice' | 'encryptedAtRest';
  /** Honest state: 'good' green, 'note' amber (true but worth knowing), 'pending' amber. */
  state: 'good' | 'note' | 'pending';
  /** One fact-shaped line, no hedge, no em dash. */
  label: string;
}

export interface StackHealthBucket {
  /** Short axis label, e.g. "Mon" or "3p" or "Jan". */
  label: string;
  /** ISO start of the bucket, for tooltips. */
  start: string;
  localTurns: number;
  cloudTurns: number;
  savedDollars: number;
  cloudDollars: number;
}

export interface StackHealth {
  range: StackHealthRange;
  generatedAt: string;
  /** Whose activity this fold covers. 'personal' is a single-user machine (a
   *  desktop, or a legacy/solo hub): your own sessions. 'machine' is a shared
   *  multi-user hub, where the fold spans every session on that machine, not just
   *  the caller's, so the UI must say so plainly. */
  scope: 'personal' | 'machine';
  /** True when there is no activity in the window: the UI shows a first-run state. */
  empty: boolean;

  // Headline
  savedDollars: number;
  cloudDollars: number;
  /** What everything in the window would have cost if it had all run on the
   *  cloud reference model: savedDollars + cloudDollars. */
  wouldHavePaid: number;
  savingsBasis: SavingsBasis;

  /** The sustainability read: energy, carbon, and water saved by running local
   *  work on your own hardware instead of a hyperscale data center. Folded from
   *  the same token totals as the dollars figure, with a stated basis. */
  sustainability: Sustainability;

  // Rings (each a 0..1 fraction plus its raw parts)
  privacyRing: { localTurns: number; cloudTurns: number; fraction: number };
  flowRing: { tasksDone: number; tasksAttempted: number; fraction: number };
  savedRing: { savedDollars: number; wouldHavePaid: number; fraction: number };

  // Detail
  tokens: {
    local: { prompt: number; completion: number };
    cloud: { prompt: number; completion: number };
  };
  cloudFlips: number;
  tools: { runs: number; denied: number; approvalsRequested: number; approvalsDenied: number };
  outcomes: { complete: number; declined: number; error: number; other: number };

  crew: StackHealthCrewMember[];
  seal: StackHealthSealFact[];
  timeline: StackHealthBucket[];
  /** Per-model turn counts on THIS machine, most-used first, models with zero
   *  turns dropped. Fully local: folded from the session journals on disk, never
   *  cross-user and never sent anywhere. The marketplace reads this to offer a
   *  "Your most-used" browse axis. */
  modelUsage: Array<{ model: string; turns: number }>;
}
