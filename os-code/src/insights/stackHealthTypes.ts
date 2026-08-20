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
  /** True when there is no activity in the window: the UI shows a first-run state. */
  empty: boolean;

  // Headline
  savedDollars: number;
  cloudDollars: number;
  /** What everything in the window would have cost if it had all run on the
   *  cloud reference model: savedDollars + cloudDollars. */
  wouldHavePaid: number;
  savingsBasis: SavingsBasis;

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
}
