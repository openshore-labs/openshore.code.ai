// The premium harness, tenet 3: raise the floor, never the ceiling. A small
// model becomes capable not by hoping but by discipline the harness applies
// around it. This module is the discipline seam: it derives a model CLASS
// (tiny, small, mid, large) from what we can know about a model, then hands
// back the policy the loop should run for that class (how many tools it sees,
// how many tool calls it may make per turn, whether to constrain decoding to a
// tool-or-answer schema, whether it may run subagents or plan, and how much of
// its context window to spend on the code map before compaction kicks in).
//
// Everything here is PURE and synchronous so it is trivially testable and can
// live in the future Node-free core (tenet 5). It reads no files and makes no
// network calls. Nothing here is claimed without eval (tenet 2): the class is a
// resourcing decision, and the eval measures whether the discipline actually
// lifts a class, which is why `deriveModelClass` takes an optional eval score
// only as a tie-breaker when size is unknown, never to override a known size.
import type { ProviderCapabilities } from '../providers/types.js';

export type ModelClass = 'tiny' | 'small' | 'mid' | 'large';

export const MODEL_CLASSES: readonly ModelClass[] = ['tiny', 'small', 'mid', 'large'];

/** How much the harness may run subagents on a seat of this class. */
export type SubagentPolicy = 'no' | 'worker' | 'yes';

export interface ModelClassPolicy {
  /** The most tool descriptions the model should see in one turn. A small model
   *  drowns in twenty six tools; it needs the few the step calls for. Infinity
   *  means "show them all". */
  maxToolsShown: number;
  /** The most tool calls to accept from one turn. Small models fail on long
   *  chains, not on single calls, so the harness caps the chain and carries the
   *  checklist (verify, format, test) itself. */
  maxCallsPerTurn: number;
  /** Prefer constraining decoding to the tool-or-answer union schema for this
   *  class. This is a PREFERENCE: it only takes effect when the backend can
   *  actually constrain (see `useConstrainedDecoding`), and the eval decides
   *  per family whether it is a lift or a tax. */
  constrainedDecoding: boolean;
  /** Whether a seat of this class may itself spawn subagents. 'worker' means it
   *  can be a subagent but should not spawn its own. */
  subagents: SubagentPolicy;
  /** Whether this class composes multi-step plans, or only receives a plan and
   *  runs single steps. */
  plans: boolean;
  /** Fraction of the context window to spend on the repository code map. */
  codeMapContextFraction: number;
  /** Compact history once usage passes this fraction of the context window. A
   *  smaller window is compacted more eagerly so the model keeps its footing. */
  compactAtContextFraction: number;
  /** How many times a failing verify check goes back to a seat of this class
   *  for another go, at least (a project's harness.verify.maxRetries can only
   *  raise it). A small seat converges in small steps: the eval's 3B came
   *  within one line of a two-file rename after the default three checks. */
  verifyRetries: number;
  /** Best-of-N judged by the project's own check: how many independent
   *  attempts a task gets before it reports not verified. One means no
   *  picker. Set by measurement, not belief: `osc eval --deep --attempts 2`
   *  on the reference box showed the small class gains about 13 points from
   *  a second try (38% to 50%), so small and tiny get two; mid and large are
   *  unmeasured and stay at one until a number says otherwise. */
  bestOfAttempts: number;
}

export interface ModelClassProfile extends ModelClassPolicy {
  modelClass: ModelClass;
}

// The per-class policy table. This is the heart of "make the smallest models as
// capable as possible": the tighter the class, the more the harness does for it.
const POLICY: Record<ModelClass, ModelClassPolicy> = {
  tiny: {
    maxToolsShown: 6,
    maxCallsPerTurn: 1,
    constrainedDecoding: true,
    subagents: 'no',
    plans: false,
    codeMapContextFraction: 0.15,
    compactAtContextFraction: 0.6,
    verifyRetries: 4,
    bestOfAttempts: 2,
  },
  small: {
    maxToolsShown: 10,
    maxCallsPerTurn: 2,
    constrainedDecoding: true,
    subagents: 'worker',
    plans: true,
    codeMapContextFraction: 0.2,
    compactAtContextFraction: 0.65,
    verifyRetries: 4,
    bestOfAttempts: 2,
  },
  mid: {
    maxToolsShown: Infinity,
    maxCallsPerTurn: 8,
    constrainedDecoding: false,
    subagents: 'yes',
    plans: true,
    codeMapContextFraction: 0.25,
    compactAtContextFraction: 0.7,
    verifyRetries: 2,
    bestOfAttempts: 1,
  },
  large: {
    maxToolsShown: Infinity,
    maxCallsPerTurn: 16,
    constrainedDecoding: false,
    subagents: 'yes',
    plans: true,
    codeMapContextFraction: 0.3,
    compactAtContextFraction: 0.7,
    verifyRetries: 2,
    bestOfAttempts: 1,
  },
};

/** A partial policy a project may set per class in config (harness.profiles). */
export type ModelClassOverride = Partial<ModelClassPolicy>;

export interface DeriveInput {
  /** The model id as the provider knows it, e.g. "qwen2.5-coder:7b". A size
   *  hint is parsed from it when `paramsB`/`sizeGB` are not given. */
  model: string;
  /** 'cloud' is always the large class (frontier on a key). */
  kind: 'local' | 'cloud';
  /** Billions of parameters, when known (e.g. from the catalog or the name). */
  paramsB?: number;
  /** On-disk size in GB, a rough params proxy when `paramsB` is absent. */
  sizeGB?: number;
  /** The live capability probe, when available. */
  caps?: Pick<ProviderCapabilities, 'contextTokens' | 'supportsGrammar'>;
  /** A prior `osc eval` average (0..1), used only to break a size-unknown tie. */
  evalScore?: number;
}

// A Q4_K_M GGUF is roughly this many GB per billion parameters, the quant most
// of the catalog ships. Only used to estimate params when the name gives no
// size and the catalog did not supply one.
const GB_PER_B_PARAMS_Q4 = 0.6;

/** Parse a parameter count from a model id: "qwen2.5-coder:7b" -> 7,
 *  "...1.5b..." -> 1.5, "...135m..." -> 0.135. Undefined when the id carries no
 *  size (e.g. "deepseek-coder:latest"). */
export function paramsBFromModelId(model: string): number | undefined {
  const b = model.match(/(\d+(?:\.\d+)?)\s*b\b/i);
  if (b) return Number(b[1]);
  const m = model.match(/(\d+(?:\.\d+)?)\s*m\b/i);
  if (m) return Number(m[1]) / 1000;
  return undefined;
}

/** Derive the model class. Size is the strongest signal, then the name's size
 *  hint, then the on-disk size. When none of those is known the eval score
 *  breaks the tie, and absent even that we default to 'small' so the discipline
 *  is applied rather than skipped. */
export function deriveModelClass(input: DeriveInput): ModelClass {
  if (input.kind === 'cloud') return 'large';

  const paramsB =
    input.paramsB ??
    paramsBFromModelId(input.model) ??
    (input.sizeGB !== undefined ? input.sizeGB / GB_PER_B_PARAMS_Q4 : undefined);

  if (paramsB !== undefined) {
    if (paramsB < 3) return 'tiny';
    if (paramsB < 8) return 'small';
    if (paramsB < 32) return 'mid';
    return 'large';
  }

  // Size unknown. A clearly capable model (proven by eval) earns 'mid'; a very
  // large advertised context also suggests a bigger model. Otherwise stay
  // conservative at 'small', which applies the discipline without overreaching.
  if (input.evalScore !== undefined && input.evalScore >= 0.8) return 'mid';
  if (input.caps && input.caps.contextTokens >= 100_000) return 'mid';
  return 'small';
}

/** Derive the full profile: the class plus its policy, with any project
 *  overrides for that class applied on top. */
export function deriveProfile(
  input: DeriveInput,
  overrides: Partial<Record<ModelClass, ModelClassOverride>> = {},
): ModelClassProfile {
  const modelClass = deriveModelClass(input);
  const base = POLICY[modelClass];
  const over = overrides[modelClass] ?? {};
  return { modelClass, ...base, ...pruneUndefined(over) };
}

/** The concrete decision for one turn: constrain decoding only when the class
 *  prefers it AND the backend can actually honor a grammar. A cloud model or a
 *  backend without structured output falls back to native tool calling. */
export function useConstrainedDecoding(
  profile: ModelClassProfile,
  caps: Pick<ProviderCapabilities, 'supportsGrammar'>,
): boolean {
  return profile.constrainedDecoding && caps.supportsGrammar;
}

/** One honest line for a seat badge and the transcript, per tenet 3. */
export function classBlurb(modelClass: ModelClass): string {
  switch (modelClass) {
    case 'tiny':
      return 'Runs single steps. Best for quick edits and questions.';
    case 'small':
      return 'Runs short plans. The harness carries the checklist.';
    case 'mid':
      return 'Plans and runs multi-step work with subagents.';
    case 'large':
      return 'Full planning and delegation.';
  }
}

function pruneUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
