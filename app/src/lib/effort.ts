// Reasoning effort, the same idea Claude exposes: how hard the model should
// think before it answers. It defaults to High and is chosen from the composer
// (a pill) or the top of the model sheet. Kept in its own dependency-free
// module so the drivers can read the active value and fold it into their system
// prompt without importing the store (which would be a cycle: the store imports
// the drivers).

export type Effort = 'low' | 'medium' | 'high';

// Ordered high -> low on purpose: that is the order the selector shows, with
// High first so the strong default reads as the headline, not the floor.
export const EFFORTS: readonly Effort[] = ['high', 'medium', 'low'] as const;

export const DEFAULT_EFFORT: Effort = 'high';

export function effortLabel(e: Effort): string {
  return e === 'high' ? 'High' : e === 'medium' ? 'Medium' : 'Low';
}

// The live value, mirrored from persisted settings by the store on load and on
// every change. Drivers read it at send time via effortDirective().
let active: Effort = DEFAULT_EFFORT;

export function setActiveEffort(e: Effort): void {
  active = e;
}

export function activeEffort(): Effort {
  return active;
}

// One short line a driver appends to its system prompt so the choice actually
// shapes the answer. Deliberately plain and provider-agnostic: it reads as a
// working instruction to any model, local or cloud, rather than a vendor knob.
export function effortDirective(e: Effort = active): string {
  switch (e) {
    case 'high':
      return 'Reasoning effort: high. Think the problem all the way through before answering, and prefer a thorough, correct answer over a fast one.';
    case 'medium':
      return 'Reasoning effort: medium. Think it through, then answer at a balanced depth.';
    case 'low':
      return 'Reasoning effort: low. Answer directly and briefly, without extended deliberation.';
  }
}
