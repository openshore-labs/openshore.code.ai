// The app-side Stack model: the user's Reasoning LLM (the anchor, required and
// immovable) plus categorized specialists, with a Bench of models that are
// available but not yet placed. This mirrors the engine's capability taxonomy
// (os-code/src/router/roles.ts) so the app and the router speak the same
// categories, and adds what the engine does not yet carry: a per-specialist
// persona, a free-text "when called" trigger, and a Custom category.
//
// The Reasoning LLM plans and routes each task to the specialist whose category
// fits, and executes the task itself whenever no specialist is placed for it.
import { HARBOR_MODEL_ID, HARBOR_MODEL_NAME } from './harbor.js';

export type StackCategory =
  | 'coding'
  | 'writing'
  | 'analysis'
  | 'vision'
  | 'image-gen'
  | 'embedding'
  | 'fast'
  | 'custom';

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

// A model that can sit in the stack: an on-device model or a cloud model.
export type StackModelRef =
  | { kind: 'device'; modelId: string; modelName: string }
  | { kind: 'cloud'; provider: string; model: string; label: string };

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
  return ref.kind === 'device'
    ? `device:${ref.modelId}`
    : `cloud:${ref.provider}:${ref.model}`;
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
  return { kind: 'device', modelId: HARBOR_MODEL_ID, modelName: HARBOR_MODEL_NAME };
}

/** A fresh stack: Harbor is the first Reasoning LLM, nothing placed yet. */
export function emptyStack(): AppStack {
  return { reasoning: harborRef(), active: [], saved: {} };
}
