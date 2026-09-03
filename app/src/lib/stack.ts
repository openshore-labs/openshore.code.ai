// The app-side Stack model: the user's Reasoning LLM (the anchor, required and
// immovable) plus categorized specialists, with a Bench of models that are
// available but not yet placed. This mirrors the engine's capability taxonomy
// (os-code/src/router/roles.ts) so the app and the router speak the same
// categories, and adds what the engine does not yet carry: a per-specialist
// persona, a free-text "when called" trigger, and a Custom category.
//
// The Reasoning LLM plans and routes each task to the specialist whose category
// fits, and executes the task itself whenever no specialist is placed for it.
import { HARBOR_MINI_MODEL_ID, HARBOR_MINI_MODEL_NAME } from './harborMini.js';
import type { ProfileId } from './profiles.js';

export type StackCategory =
  'coding' | 'writing' | 'analysis' | 'vision' | 'image-gen' | 'embedding' | 'fast' | 'custom';

export interface CategoryInfo {
  id: StackCategory;
  /** Plain label the user picks from the dropdown. */
  plain: string;
  /** One line describing when the Reasoning LLM calls this specialist. */
  hint: string;
}

// The standard categories, in dropdown order, then Custom last.
export const STACK_CATEGORIES: CategoryInfo[] = [
  { id: 'coding', plain: 'Coding', hint: 'Writes and edits code, sticks to a diff.' },
  { id: 'writing', plain: 'Writing', hint: 'Long-form prose, docs, and copy.' },
  { id: 'analysis', plain: 'Analysis', hint: 'Math, data, careful step-by-step work.' },
  { id: 'vision', plain: 'Image reading', hint: 'Reads screenshots, charts, and photos.' },
  { id: 'image-gen', plain: 'Image creation', hint: 'Generates illustrations and mockups.' },
  { id: 'embedding', plain: 'Retrieval', hint: 'Finds the right files in a repo.' },
  { id: 'fast', plain: 'Fast', hint: 'Quick, cheap answers and trivial edits.' },
  { id: 'custom', plain: 'Custom', hint: 'You define exactly when it is called.' },
];

export function categoryLabel(id: StackCategory): string {
  return STACK_CATEGORIES.find((c) => c.id === id)?.plain ?? id;
}

// A model that can sit in the stack: an on-device model, a built-in cloud
// provider's model, or a user-connected "bring your own model" endpoint.
export type StackModelRef =
  | { kind: 'device'; modelId: string; modelName: string }
  | { kind: 'cloud'; provider: string; model: string; label: string }
  | { kind: 'byom'; id: string; label: string; baseUrl: string; model: string };

export interface Placement {
  category: StackCategory;
  /** Free-text trigger. Required when the category is Custom. */
  whenCalled?: string;
  /** Custom system persona for this specialist. Required when Custom. */
  persona?: string;
}

export interface ActiveMember {
  ref: StackModelRef;
  placement: Placement;
}

// The persisted stack: the reasoning anchor, the active specialists, and the
// placements we remember for models currently benched (so moving back and forth
// keeps a model's category, trigger, and persona).
export interface AppStack {
  reasoning?: StackModelRef;
  active: ActiveMember[];
  saved: Record<string, Placement>;
}

export function refKey(ref: StackModelRef): string {
  switch (ref.kind) {
    case 'device':
      return `device:${ref.modelId}`;
    case 'cloud':
      return `cloud:${ref.provider}:${ref.model}`;
    case 'byom':
      return `byom:${ref.id}`;
  }
}

export function refName(ref: StackModelRef): string {
  return ref.kind === 'device' ? ref.modelName : ref.label;
}

export function refsEqual(a: StackModelRef, b: StackModelRef): boolean {
  return refKey(a) === refKey(b);
}

/** A placement is only complete when a Custom category has its trigger + persona. */
export function placementValid(p: Placement): boolean {
  if (p.category === 'custom') {
    return Boolean(p.whenCalled && p.whenCalled.trim() && p.persona && p.persona.trim());
  }
  return true;
}

export function harborRef(): StackModelRef {
  return { kind: 'device', modelId: HARBOR_MINI_MODEL_ID, modelName: HARBOR_MINI_MODEL_NAME };
}

// A stack per connectivity profile. Reach changes what your stack can use, so
// each status (docked, offshore, offline) carries its own configuration and the
// app switches to the matching one automatically as your status changes. The
// map is partial: a status with no entry falls back to a fresh anchor-only
// stack, so a profile the user has not tuned still answers.
export type ProfileStacks = Partial<Record<ProfileId, AppStack>>;

/** The stack configured for a status, or a fresh anchor-only one if none. */
export function stackForProfile(stacks: ProfileStacks | undefined, profile: ProfileId): AppStack {
  return stacks?.[profile] ?? emptyStack();
}

/** A fresh stack: Harbor Mini is the first Reasoning LLM (kept small so
 *  first-run download size and time stay low), nothing placed yet. */
export function emptyStack(): AppStack {
  return { reasoning: harborRef(), active: [], saved: {} };
}

// Whether a model can actually produce an answer on this device right now. An
// on-device model runs only on a device that hosts local inference (iPhone or
// iPad) and only once it is downloaded; a cloud ref needs its provider's key; a
// connected BYOM endpoint carries its own stored key, so it is treated as ready.
// This is the ONE definition of "ready" that the first-answer gate and the model
// sheet share, so they never disagree and a user is never routed to a brain that
// cannot answer. The signals are supplied by the caller (the store) from live
// state, keeping this pure and testable.
export interface ReadinessSignals {
  /** This platform can host on-device (llama.cpp) inference. */
  onDeviceHost: boolean;
  /** A downloaded, loadable on-device model with this id exists here. */
  deviceModelReady: (modelId: string) => boolean;
  /** A usable key is stored for this cloud provider. */
  cloudReady: (provider: string) => boolean;
}

export function refReady(ref: StackModelRef, s: ReadinessSignals): boolean {
  switch (ref.kind) {
    case 'device':
      return s.onDeviceHost && s.deviceModelReady(ref.modelId);
    case 'cloud':
      return s.cloudReady(ref.provider);
    case 'byom':
      return true;
  }
}

/** A stack can answer when its Reasoning anchor can. Specialists are optional:
 *  the anchor executes any task no placed specialist covers. */
export function stackReady(stack: AppStack | undefined, s: ReadinessSignals): boolean {
  return stack?.reasoning ? refReady(stack.reasoning, s) : false;
}
