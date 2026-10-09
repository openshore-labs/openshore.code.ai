// What a provider's removal takes with it (bring your own keys, 2026-10-09).
// Disconnecting a cloud provider takes its models off every status's stack,
// the way disconnecting a connected model already does (disconnectByom): a
// placement keyed cloud:<id>:<model> would otherwise stay with no key behind
// it, and, for a provider whose models load live, with no window or image
// lookup either. A plain function the store wires into disconnectProvider.
// Test: app/test/store.test.ts.
import { PROFILE_ORDER } from '../lib/profiles.js';
import { harborRef, refKey, type ProfileStacks } from '../lib/stack.js';

/** Every status's stack with nothing left that runs on this provider: its
 *  models leave the active specialists and the saved placements, and a
 *  Reasoning anchor on one falls back to the built-in guide. */
export function sweepProviderRefs(
  stacks: ProfileStacks | undefined,
  providerId: string,
): ProfileStacks | undefined {
  if (!stacks) return stacks;
  // The trailing colon keeps one provider's id from matching another's.
  const prefix = `cloud:${providerId}:`;
  const gone = (key: string) => key.startsWith(prefix);
  const out: ProfileStacks = { ...stacks };
  for (const p of PROFILE_ORDER) {
    const st = out[p];
    if (!st) continue;
    const active = st.active.filter((m) => !gone(refKey(m.ref)));
    const saved = Object.fromEntries(Object.entries(st.saved).filter(([key]) => !gone(key)));
    const reasoning = st.reasoning && gone(refKey(st.reasoning)) ? harborRef() : st.reasoning;
    out[p] = { ...st, active, saved, reasoning };
  }
  return out;
}
