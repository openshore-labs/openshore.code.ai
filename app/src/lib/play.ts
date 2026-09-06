// The play: how OpenShore turns a prompt into a run. The reasoning LLM from My
// Stack frames the prompt (asking the user to clarify only when it is genuinely
// ambiguous), then composes a play, an ordered set of handoffs to the stack's
// specialist models with dependencies between them, the way a coach draws up a
// sequence of passes. Any category with no assigned specialist is run by the
// reasoning LLM itself. This module is the pure core: the shapes, the planner
// and re-plan prompts and their robust parsing, the dependency scheduling, the
// owner resolution, and the brief the user sees before it runs. The driver
// (stackDriver.ts) executes it; keeping the hard logic here keeps it testable
// without a model or a network.
import type { TodoItem } from 'os-code/protocol';
import {
  STACK_CATEGORIES,
  categoryLabel,
  defaultVisionCloudRef,
  refKey,
  refName,
  visionSlots,
  type AppStack,
  type Placement,
  type StackCategory,
  type StackModelRef,
} from './stack.js';

/** A step is owned by a specialist category, or by the reasoning anchor. */
export type StepCategory = StackCategory | 'reasoning';

const STEP_CATEGORIES: StepCategory[] = ['reasoning', ...STACK_CATEGORIES.map((c) => c.id)];

export interface ClarifyingQuestion {
  id: string;
  question: string;
  /** Suggested answers for the picker; free text is always allowed too. */
  options?: string[];
}

export interface PlayStep {
  id: string;
  title: string;
  category: StepCategory;
  /** One line telling the owner what to do in this step. */
  brief: string;
  /** Ids of steps that must finish before this one starts. */
  dependsOn: string[];
  /** This step edits the repo or runs commands, so it routes to the paired
   *  computer's engine when docked rather than a chat-only model. */
  needsTools?: boolean;
  /** A level deeper than the category: a specific model to run this step, by its
   *  stack id (refKey). Set when the reasoning LLM wants a particular model for
   *  a particular subject or decision (the founder's parameterized routing).
   *  Falls back to category routing when it names no model in the stack. */
  owner?: string;
}

export interface Play {
  /** One-line restatement of the refined goal. */
  summary: string;
  steps: PlayStep[];
}

/** The reasoning LLM's framing of a prompt: clear enough to run, or a short set
 *  of questions to settle first. When clear, the play's steps are present. */
export interface Framing {
  clear: boolean;
  summary: string;
  questions: ClarifyingQuestion[];
  steps: PlayStep[];
}

export interface StepResult {
  id: string;
  title: string;
  text: string;
}

// ---- validation and scheduling -------------------------------------------

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asCategory(v: unknown): StepCategory {
  return STEP_CATEGORIES.includes(v as StepCategory) ? (v as StepCategory) : 'reasoning';
}

/** Coerce raw model output into a clean, runnable step list: string fields,
 *  known categories, unique ids, and a dependency graph with no dangling refs
 *  and no cycles (a dependency that would form a cycle is dropped, never the
 *  step). Order is preserved as given; scheduling reads dependsOn, not order. */
export function sanitizePlay(raw: unknown): PlayStep[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const steps: PlayStep[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = (raw[i] ?? {}) as Record<string, unknown>;
    let id = asString(r.id).trim() || `s${i + 1}`;
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    steps.push({
      id,
      title: asString(r.title).trim() || `Step ${i + 1}`,
      category: asCategory(r.category),
      brief: asString(r.brief).trim(),
      dependsOn: Array.isArray(r.dependsOn)
        ? r.dependsOn.map((d) => asString(d)).filter(Boolean)
        : [],
      needsTools: Boolean(r.needsTools),
      owner: asString(r.owner).trim() || undefined,
    });
  }
  // Keep only dependencies that name a real, earlier-resolvable step, and drop
  // any that would create a cycle. A step keyed to a later step is allowed as
  // long as the graph stays acyclic; the cycle check below enforces that.
  const ids = new Set(steps.map((s) => s.id));
  for (const s of steps) s.dependsOn = s.dependsOn.filter((d) => ids.has(d) && d !== s.id);
  return dropCycles(steps);
}

/** Remove dependency edges that would make the graph cyclic, greedily, so a
 *  malformed plan still runs in a sensible order instead of deadlocking. */
function dropCycles(steps: PlayStep[]): PlayStep[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const hasPath = (from: string, to: string, guard = new Set<string>()): boolean => {
    if (from === to) return true;
    if (guard.has(from)) return false;
    guard.add(from);
    const node = byId.get(from);
    if (!node) return false;
    return node.dependsOn.some((d) => hasPath(d, to, guard));
  };
  for (const s of steps) {
    s.dependsOn = s.dependsOn.filter((d) => !hasPath(d, s.id));
  }
  return steps;
}

/** Steps whose every dependency is already done and that are not done or
 *  running themselves. */
export function readySteps(steps: PlayStep[], done: Set<string>, running: Set<string>): PlayStep[] {
  return steps.filter(
    (s) => !done.has(s.id) && !running.has(s.id) && s.dependsOn.every((d) => done.has(d)),
  );
}

/** A dependency-respecting order (Kahn's algorithm). Any leftover steps from a
 *  residual cycle are appended so nothing is silently dropped. */
export function topoOrder(steps: PlayStep[]): PlayStep[] {
  const done = new Set<string>();
  const out: PlayStep[] = [];
  const remaining = [...steps];
  let progressed = true;
  while (remaining.length && progressed) {
    progressed = false;
    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i]!;
      if (s.dependsOn.every((d) => done.has(d))) {
        out.push(s);
        done.add(s.id);
        remaining.splice(i, 1);
        progressed = false || true;
        i--;
      }
    }
  }
  return [...out, ...remaining];
}

/** Merge a mid-run re-plan: keep the steps already done, replace the rest with
 *  the reasoning LLM's revised remaining steps. Revised steps may depend on the
 *  done ones. Ids stay unique across the merge. */
export function mergeReplan(play: Play, done: Set<string>, rawRemaining: unknown): Play {
  const keptDone = play.steps.filter((s) => done.has(s.id));
  const doneIds = new Set(keptDone.map((s) => s.id));
  // Drop any revised step that reuses a done id (never redo done work), then
  // sanitize the done steps and the revised ones together, so a revised step's
  // dependency on an already-done step survives the validation.
  const rawRevised = Array.isArray(rawRemaining)
    ? rawRemaining.filter((r) => !doneIds.has(asString((r as Record<string, unknown>)?.id).trim()))
    : [];
  const steps = sanitizePlay([...keptDone, ...rawRevised]);
  return { summary: play.summary, steps };
}

// ---- owner resolution ----------------------------------------------------

export interface StepOwner {
  ref: StackModelRef;
  placement?: Placement;
  /** True when no specialist is placed for this category, so the reasoning
   *  anchor owns it (the founder's "the reasoning LLM takes over"). */
  fellBack: boolean;
}

/** Who runs a step: the specialist placed for its category, else the reasoning
 *  anchor. Vision reads from its two slots (local preferred, then cloud, then
 *  the default cloud model). This is the intended owner for the briefing;
 *  execution re-checks reachability and may fall back further. */
export function ownerFor(step: PlayStep, stack: AppStack): StepOwner {
  const reasoning = stack.reasoning;
  // A level deeper: a step may name a specific model to run it. Honor it when it
  // names a model actually in the stack (an active specialist or the anchor).
  if (step.owner) {
    const member = stack.active.find((m) => refKey(m.ref) === step.owner);
    if (member) return { ref: member.ref, placement: member.placement, fellBack: false };
    if (reasoning && refKey(reasoning) === step.owner) {
      return { ref: reasoning, placement: undefined, fellBack: false };
    }
  }
  if (step.category === 'reasoning') {
    return { ref: reasoning ?? defaultVisionCloudRef(), placement: undefined, fellBack: false };
  }
  if (step.category === 'vision') {
    const { local, cloud } = visionSlots(stack);
    const member = local ?? cloud;
    if (member) return { ref: member.ref, placement: member.placement, fellBack: false };
    return { ref: defaultVisionCloudRef(), placement: undefined, fellBack: true };
  }
  const specialist = stack.active.find((m) => m.placement.category === step.category);
  if (specialist) return { ref: specialist.ref, placement: specialist.placement, fellBack: false };
  return { ref: reasoning ?? defaultVisionCloudRef(), placement: undefined, fellBack: true };
}

/** A short owner label for the briefing: the model's name, noting when the
 *  reasoning anchor is covering an unplaced category. */
export function ownerLabel(step: PlayStep, stack: AppStack): string {
  const owner = ownerFor(step, stack);
  const name = refName(owner.ref);
  return owner.fellBack && step.category !== 'reasoning' ? `${name} (reasoning)` : name;
}

// ---- the user-facing brief -----------------------------------------------

/** The play as todo rows (the chat renders these as the briefing and updates
 *  them live as steps run): the step title, its owner, and its status. */
export function briefTodos(
  play: Play,
  stack: AppStack,
  statusById: Map<string, TodoItem['status']> = new Map(),
): TodoItem[] {
  return topoOrder(play.steps).map((s) => ({
    content: s.title,
    status: statusById.get(s.id) ?? 'pending',
    owner: ownerLabel(s, stack),
  }));
}

/** A compact text brief for the chat: one line per play in run order, each with
 *  its owner. Deliberately terse (the founder: "as brief as possible"). */
export function formatBriefTable(play: Play, stack: AppStack): string {
  const lines = topoOrder(play.steps).map(
    (s, i) => `${i + 1}. ${s.title}  ->  ${ownerLabel(s, stack)}`,
  );
  return [`Plan: ${play.summary}`, ...lines].join('\n');
}

// ---- prompts and parsing -------------------------------------------------

/** The categories this stack can hand off to, and who owns each, so the planner
 *  plans against the real roster and marks a fallback honestly. */
function rosterLines(stack: AppStack): string {
  const byCategory = STACK_CATEGORIES.map((c) => {
    const placed =
      c.id === 'vision'
        ? Boolean(visionSlots(stack).local || visionSlots(stack).cloud)
        : stack.active.some((m) => m.placement.category === c.id);
    return `- ${c.id} (${c.plain}): ${placed ? 'has a specialist' : 'no specialist, the reasoning LLM covers it'}`;
  });
  // A level deeper: the specific models placed in the stack, with the id to
  // target and, when set, the subject that model was placed for. The planner can
  // set a step's owner to one of these ids to send that step to that model.
  const targetable = stack.active.map((m) => {
    const when = m.placement.whenCalled?.trim() ? ` for: ${m.placement.whenCalled.trim()}` : '';
    return `- ${refName(m.ref)} (id: ${refKey(m.ref)}, ${m.placement.category})${when}`;
  });
  return [
    'Categories:',
    ...byCategory,
    ...(targetable.length
      ? ["Specific models you can target with a step's owner id:", ...targetable]
      : []),
  ].join('\n');
}

/** The plan call: the reasoning LLM frames the prompt and, when it is clear,
 *  lays out the play. It returns ONLY JSON. Kept provider-agnostic so the same
 *  prompt works for Claude, an OpenAI-compatible model, or a capable local one. */
export function planPrompt(userText: string, stack: AppStack, contextNote?: string): string {
  return [
    'You are the reasoning lead of a small team of models. Turn the user request into a plan.',
    'First decide if the request is clear enough to act on. Ask a question ONLY when a wrong assumption would waste real work; do not ask about taste or things you can reasonably choose. Most requests are clear.',
    'When clear, compose a play: an ordered list of steps, each owned by one category, with dependencies between them so work flows correctly (for example a coding step that a later writing step depends on).',
    'Keep the play as small as it can be to do the job well. A simple request is a single step. Do not invent steps.',
    '',
    'The categories you can hand off to (anything else the reasoning LLM does itself):',
    rosterLines(stack),
    '',
    contextNote ? `Context: ${contextNote}` : '',
    '',
    'Reply with ONLY a JSON object, no prose, in this shape:',
    '{',
    '  "clear": boolean,',
    '  "summary": string,              // one line restating the goal',
    '  "questions": [ { "id": string, "question": string, "options"?: string[] } ],  // only when not clear',
    '  "steps": [ { "id": string, "title": string, "category": string, "brief": string, "dependsOn": string[], "needsTools"?: boolean, "owner"?: string } ]  // only when clear',
    '}',
    'Set needsTools true for a step that must edit files or run commands.',
    'Set owner to a specific model id from the list above ONLY when a particular model should run that step (a subject or decision it was placed for); otherwise leave owner out and it routes by category.',
    '',
    `User request: ${userText}`,
  ]
    .filter((l) => l !== undefined)
    .join('\n');
}

/** The re-plan call: mid-run, given what is done, revise the remaining steps
 *  (or keep them). Returns ONLY the JSON array of remaining steps. */
export function replanPrompt(play: Play, results: StepResult[]): string {
  const doneIds = new Set(results.map((r) => r.id));
  const remaining = play.steps.filter((s) => !doneIds.has(s.id));
  return [
    'You are re-checking a play mid-run. Here is the goal, what is done, and what remains.',
    `Goal: ${play.summary}`,
    'Done so far:',
    ...results.map((r) => `- [${r.id}] ${r.title}: ${truncate(r.text, 500)}`),
    'Remaining steps:',
    ...remaining.map(
      (s) => `- [${s.id}] ${s.title} (${s.category}) depends on [${s.dependsOn.join(', ')}]`,
    ),
    '',
    'If the remaining plan is still right, return it unchanged. If a result changed the picture, return a better remaining plan. Do not redo done work.',
    'Reply with ONLY a JSON array of the remaining steps, each { "id", "title", "category", "brief", "dependsOn", "needsTools"? }.',
  ].join('\n');
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}

/** Pull the first JSON value out of a model reply that may wrap it in prose or a
 *  fenced code block. Returns undefined when nothing parses. */
export function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = fence?.[1] ?? text;
  // 1. The candidate as a whole (a clean object or array reply parses here).
  const whole = tryParse(raw.trim());
  if (whole.ok) return whole.value;
  // 2. The earliest-starting balanced object or array, so an array embedded in
  // prose is not shadowed by its own first inner object.
  const slices = [sliceBalanced(raw, '{'), sliceBalanced(raw, '[')].filter((s): s is string =>
    Boolean(s),
  );
  slices.sort((a, b) => raw.indexOf(a) - raw.indexOf(b));
  for (const c of slices) {
    const parsed = tryParse(c);
    if (parsed.ok) return parsed.value;
  }
  return undefined;
}

function tryParse(s: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false };
  }
}

/** The substring from the first opening bracket to its matching close, so a
 *  trailing sentence after the JSON does not defeat the parse. */
function sliceBalanced(text: string, open: '{' | '['): string | undefined {
  const close = open === '{' ? '}' : ']';
  const start = text.indexOf(open);
  if (start < 0) return undefined;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

/** Parse a plan reply into a Framing, or undefined when it is unusable (the
 *  driver then degrades to a single reasoning turn). */
export function parsePlan(text: string): Framing | undefined {
  const obj = extractJson(text) as Record<string, unknown> | undefined;
  if (!obj || typeof obj !== 'object') return undefined;
  const clear = obj.clear !== false; // default to clear if the field is missing
  const summary = asString(obj.summary).trim();
  const questions: ClarifyingQuestion[] = [];
  if (Array.isArray(obj.questions)) {
    obj.questions.forEach((q, i) => {
      const r = (q ?? {}) as Record<string, unknown>;
      const question = asString(r.question).trim();
      if (!question) return;
      const cq: ClarifyingQuestion = { id: asString(r.id).trim() || `q${i + 1}`, question };
      if (Array.isArray(r.options)) {
        const opts = r.options.map((o) => asString(o)).filter(Boolean);
        if (opts.length) cq.options = opts;
      }
      questions.push(cq);
    });
  }
  const steps = sanitizePlay(obj.steps);
  // A "clear" reply with no steps is treated as a single reasoning step so the
  // request still runs; an "unclear" reply with no questions is treated as
  // clear (nothing to ask), also falling through to steps or the single step.
  if (!clear && questions.length) {
    return { clear: false, summary, questions, steps: [] };
  }
  return { clear: true, summary, questions: [], steps };
}

/** Parse a re-plan reply into the revised remaining steps, or undefined. */
export function parseReplan(text: string): PlayStep[] | undefined {
  const obj = extractJson(text);
  const arr = Array.isArray(obj)
    ? obj
    : Array.isArray((obj as { steps?: unknown })?.steps)
      ? (obj as { steps: unknown[] }).steps
      : undefined;
  if (!arr) return undefined;
  return sanitizePlay(arr);
}

/** How the driver labels the plan step in the chat when it hands off. */
export function handoffNote(step: PlayStep, stack: AppStack): string {
  return `${step.title}. Handing to ${ownerLabel(step, stack)}.`;
}

/** The default categories, re-exported so callers do not reach past this module
 *  for the label of a step's category. */
export function stepCategoryLabel(category: StepCategory): string {
  return category === 'reasoning' ? 'Reasoning' : categoryLabel(category);
}
