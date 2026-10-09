// Connecting models at an address (bring your own keys, Part 2, 2026-10-09).
// The Stack's Connect a model reads an address's own list and lets the person
// tick several; each ticked model becomes its own connection, sharing an
// addressId, so every reader, sweep and saved placement keyed byom:<id> keeps
// working unchanged. Plain functions the store wires into connectByom,
// disconnectByom and setByomForwards; the store writes the key under each
// connection's own secret name.
// Test: app/test/byomAddress.test.tsx.
import { keepsListedWindow, type ByomConnection, type ByomWire } from '../lib/byom.js';
import { PROFILE_ORDER } from '../lib/profiles.js';
import { harborRef, refKey, type ProfileStacks, type StackModelRef } from '../lib/stack.js';

/** One model the person picked at an address: ticked from its list (with
 *  the name and window the list gives), or typed. */
export interface ByomPick {
  id: string;
  label?: string;
  contextTokens?: number;
}

export interface ByomConnectInput {
  /** The name the person typed for the address. */
  label: string;
  /** Already normalized for its format. */
  baseUrl: string;
  wire?: ByomWire;
  forwardsToCloud?: boolean;
  models: ByomPick[];
  /** This device's own tailnet, for whether a listed window is kept. */
  ownTailnetSuffix?: string | null;
}

/** A fresh local id with a prefix ("byom_", "addr_"). */
export function newLocalId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The connections for one go at one address: one per picked model, each
 *  model once, in the order picked. One model keeps the typed name; several
 *  are named by it and their model, so the bench tells them apart. A listed
 *  window is kept only where it is the window served (`keepsListedWindow`). */
export function byomConnectionsFor(
  input: ByomConnectInput,
  makeId: (prefix: string) => string = newLocalId,
): ByomConnection[] {
  const seen = new Set<string>();
  const models = input.models
    .map((m) => ({ ...m, id: m.id.trim() }))
    .filter((m) => m.id && !seen.has(m.id) && Boolean(seen.add(m.id)));
  if (!models.length) return [];
  const name = input.label.trim();
  const addressId = makeId('addr_');
  const keepWindow = keepsListedWindow(
    input.baseUrl,
    input.ownTailnetSuffix ?? null,
    input.forwardsToCloud,
  );
  return models.map((m) => {
    const window = m.contextTokens;
    return {
      id: makeId('byom_'),
      label: models.length === 1 ? name : `${name} · ${m.label?.trim() || m.id}`,
      baseUrl: input.baseUrl,
      model: m.id,
      ...(input.wire === 'anthropic' ? { wire: 'anthropic' as const } : {}),
      addressId,
      ...(input.forwardsToCloud === true ? { forwardsToCloud: true } : {}),
      ...(keepWindow && window !== undefined && Number.isFinite(window) && window > 0
        ? { contextTokens: Math.floor(window) }
        : {}),
    };
  });
}

/** The connections that share `conn`'s address, `conn` included, when it was
 *  connected with others in one go; just `conn` otherwise. */
export function byomSiblings(all: ByomConnection[], conn: ByomConnection): ByomConnection[] {
  if (!conn.addressId) return [conn];
  return all.filter((c) => c.addressId === conn.addressId);
}

/** Every status's stack with none of these connections left in it: they
 *  leave the active specialists and the saved placements, and a Reasoning
 *  anchor on one falls back to the built-in guide, so no status is left with
 *  a dangling anchor. */
export function sweepByomRefs(
  stacks: ProfileStacks | undefined,
  ids: readonly string[],
): ProfileStacks {
  const gone = new Set(ids.map((id) => `byom:${id}`));
  const out: ProfileStacks = { ...stacks };
  for (const p of PROFILE_ORDER) {
    const st = out[p];
    if (!st) continue;
    const active = st.active.filter((m) => !gone.has(refKey(m.ref)));
    const saved = Object.fromEntries(Object.entries(st.saved).filter(([key]) => !gone.has(key)));
    const reasoning = st.reasoning && gone.has(refKey(st.reasoning)) ? harborRef() : st.reasoning;
    out[p] = { ...st, active, saved, reasoning };
  }
  return out;
}

/** The connections from `conn`'s address, and every placed ref of theirs,
 *  with the forwarding mark set or cleared (2026-10-09). The mark is the
 *  person's word about the address, so it applies to every model from it.
 *  A placed ref is a frozen copy, so each one is rewritten too, and the
 *  judges that read the ref (the chip, the Image reading slots) agree with
 *  the one that reads the connection (the pack seat). Cleared, a window the
 *  list reported is dropped where it is no longer the window served
 *  (`keepsListedWindow`); set, none comes back, since the list is not kept,
 *  and the seat keeps the 8192 guess. */
export function markByomForwarding(
  byomModels: ByomConnection[],
  stacks: ProfileStacks | undefined,
  conn: ByomConnection,
  on: boolean,
  ownTailnetSuffix: string | null,
): { byomModels: ByomConnection[]; stacks: ProfileStacks } {
  const ids = new Set(byomSiblings(byomModels, conn).map((c) => c.id));
  const mark = <T extends { forwardsToCloud?: boolean }>(x: T): T => {
    const { forwardsToCloud: _was, ...rest } = x;
    return (on ? { ...rest, forwardsToCloud: true } : rest) as T;
  };
  const nextModels = byomModels.map((c) => {
    if (!ids.has(c.id)) return c;
    const marked = mark(c);
    if (!on && !keepsListedWindow(c.baseUrl, ownTailnetSuffix, false)) {
      const { contextTokens: _window, ...rest } = marked;
      return rest;
    }
    return marked;
  });
  const remark = (ref: StackModelRef): StackModelRef =>
    ref.kind === 'byom' && ids.has(ref.id) ? mark(ref) : ref;
  const out: ProfileStacks = { ...stacks };
  for (const p of PROFILE_ORDER) {
    const st = out[p];
    if (!st) continue;
    out[p] = {
      ...st,
      active: st.active.map((m) => ({ ...m, ref: remark(m.ref) })),
      reasoning: st.reasoning && remark(st.reasoning),
    };
  }
  return { byomModels: nextModels, stacks: out };
}
