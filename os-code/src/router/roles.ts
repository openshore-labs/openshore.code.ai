// The capability taxonomy, in ONE place. Tags follow the industry-standard
// assessment dimensions so a specialist's tag is objective and matches how
// models are actually benchmarked. The UI speaks plain language; these
// benchmark names power matching underneath and surface only in detail views.
// Extend here as the standard evolves; everything else imports from here.

export type CapabilityCategory =
  | 'reasoning' // the quarterback dimension
  | 'coding'
  | 'writing'
  | 'analysis'
  | 'vision'
  | 'image-gen'
  | 'embedding'
  | 'fast';

export interface CapabilityInfo {
  id: CapabilityCategory;
  /** Plain language, what the user sees. */
  plain: string;
  /** One warm sentence describing what enabling this gets you. */
  blurb: string;
  /** The benchmarks that define this dimension, one keystroke away in the UI. */
  benchmarks: string[];
  /** Whether a model tagged with this can serve as the mandatory orchestrator. */
  orchestratorDimension: boolean;
}

export const CAPABILITIES: Record<CapabilityCategory, CapabilityInfo> = {
  reasoning: {
    id: 'reasoning',
    plain: 'runs the show',
    blurb:
      'The quarterback: plans, reasons, and decides which model gets each play. Every stack has exactly one in charge.',
    benchmarks: ['MMLU', 'GPQA', 'ARC-AGI'],
    orchestratorDimension: true,
  },
  coding: {
    id: 'coding',
    plain: 'great at code',
    blurb: 'Writes and edits code, calls tools reliably, and sticks to a diff.',
    benchmarks: ['SWE-bench', 'HumanEval', 'LiveCodeBench', 'BFCL'],
    orchestratorDimension: false,
  },
  writing: {
    id: 'writing',
    plain: 'writes beautifully',
    blurb: 'Long-form prose, docs, and copy with a human ear.',
    benchmarks: ['Chatbot Arena (writing)', 'EQ-Bench', 'MT-Bench'],
    orchestratorDimension: false,
  },
  analysis: {
    id: 'analysis',
    plain: 'good with numbers',
    blurb: 'Math, data analysis, and careful step-by-step calculation.',
    benchmarks: ['MATH-500', 'GSM8K', 'AIME', 'TableBench'],
    orchestratorDimension: false,
  },
  vision: {
    id: 'vision',
    plain: 'can read screenshots',
    blurb: 'Understands images: screenshots, charts, UI mockups, whiteboard photos.',
    benchmarks: ['MMMU', 'MathVista', 'ChartQA'],
    orchestratorDimension: false,
  },
  'image-gen': {
    id: 'image-gen',
    plain: 'draws pictures',
    blurb: 'Generates illustrations and mockup art through a local image server.',
    benchmarks: ['GenEval', 'DPG-Bench'],
    orchestratorDimension: false,
  },
  embedding: {
    id: 'embedding',
    plain: 'finds the right files',
    blurb: 'Turns your repo into a searchable index so the agent reads the right code.',
    benchmarks: ['MTEB'],
    orchestratorDimension: false,
  },
  fast: {
    id: 'fast',
    plain: 'fast for small edits',
    blurb: 'A small, quick model for trivial edits and instant answers.',
    benchmarks: ['latency, tokens per second'],
    orchestratorDimension: false,
  },
};

/** The specialist slots a stack can fill (everything except the quarterback). */
export const SPECIALIST_ROLES = [
  'coding',
  'writing',
  'analysis',
  'vision',
  'imageGen',
  'embedding',
  'fast',
] as const;
export type SpecialistRole = (typeof SPECIALIST_ROLES)[number];

/** Chat-delegable roles (everything a specialist chat model can take on). */
export type DelegableRole = 'coding' | 'writing' | 'analysis' | 'fast' | 'vision';

/** Map a specialist slot to the capability category it needs. */
export const ROLE_CATEGORY: Record<SpecialistRole, CapabilityCategory> = {
  coding: 'coding',
  writing: 'writing',
  analysis: 'analysis',
  vision: 'vision',
  imageGen: 'image-gen',
  embedding: 'embedding',
  fast: 'fast',
};

export function plainLabel(category: CapabilityCategory): string {
  return CAPABILITIES[category].plain;
}
