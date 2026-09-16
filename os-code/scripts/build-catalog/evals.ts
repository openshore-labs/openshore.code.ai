// Eval provenance. curation/eval.json maps a model id to either a bare number
// (an older file: a published probe average) or an entry that says where the
// number came from: `published` (a seed number, the one-shot probe) or
// `measured` (a run of `osc eval` on a named box, on a date, with the attempts
// used). A measured deep score is the loop number, the one a card may quote,
// and it satisfies the orchestrator gate on its own.
import type { EvalEntry, EvalInput } from './types.js';

export function normalizeEval(entry: EvalInput | undefined): EvalEntry | undefined {
  if (entry === undefined) return undefined;
  if (typeof entry === 'number') return { probe: entry, source: 'published' };
  return entry;
}

/** The score the gate and the fit read: the probe when present, else the
 *  measured deep score. Undefined when the entry carries no finite number. */
export function evalScore(entry: EvalInput | undefined): number | undefined {
  const e = normalizeEval(entry);
  if (!e) return undefined;
  const score = typeof e.probe === 'number' ? e.probe : e.deep;
  return typeof score === 'number' && Number.isFinite(score) ? score : undefined;
}

export function evalSource(entry: EvalInput | undefined): 'published' | 'measured' | undefined {
  return normalizeEval(entry)?.source;
}
