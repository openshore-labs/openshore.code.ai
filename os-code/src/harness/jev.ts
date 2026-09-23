// The premium harness, the first Harness Current: Jev (founder, 2026-09-23).
//
// Jev is TypeSafe AI's System One decision model. It does not chat: a call
// sends `state` plus a map of typed `questions` and gets back a typed answer
// for each (a choice among labels, a yes/no with a probability, or a score).
// That is exactly the shape a harness wants for the mechanical decisions it
// makes AROUND a seat: is this cheap enough for a local model, or does it need
// the paid seat; which kind of work is this so it routes to the right seat;
// does the produced result look like it satisfies the task. A frontier chat
// model can answer those too, but each answer costs a full generation; Jev
// answers in one parallel pass at a fraction of the price, which is the
// cost-saving method a Harness Current layers in.
//
// Honesty bar (tenet 2): nothing here claims a dollar saving. The functions
// return a decision and a plain line; whether the layer nets out is a number
// `osc eval` must show on the reference box before any copy says "saves".
//
// This module is PURE of Node built-ins (tenet 5): the only I/O is `fetch`,
// which is a web standard the phone host has too, and it is injectable so the
// jobs are unit tested with no network.
import type { HarnessCurrentsHandle, JevHandle } from '../currents/model.js';
import { JEV_DEFAULT_MODEL } from '../currents/model.js';

/** The System One endpoint under a TypeSafe base URL. */
export const JEV_SYSTEMONE_PATH = '/v1/systemone';

/** A typed question, the three kinds the System One API takes. */
export type JevQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'noul'; instructions: string }
  | { type: 'score'; instructions: string; min?: number; max?: number };

export type JevQuestions = Record<string, JevQuestion>;

/** One parsed answer. `probability` is Jev's own confidence when it reports
 *  one (0..1). `value` is the chosen label (choice), the yes/no (noul), or the
 *  score (score). Undefined fields mean the response did not carry them. */
export interface JevAnswer {
  value?: string | boolean | number;
  probability?: number;
}

export type JevAnswers = Record<string, JevAnswer>;

/** The minimal fetch shape the client needs, so a test can pass a fake. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Build the System One request body. Pure, so a test pins the wire shape. */
export function buildSystemOneBody(
  handle: JevHandle,
  state: unknown,
  questions: JevQuestions,
): { model: string; state: unknown; questions: JevQuestions } {
  return { model: handle.model?.trim() || JEV_DEFAULT_MODEL, state, questions };
}

/** Post one System One request and parse the answers. Never throws: a network
 *  or API failure returns undefined so the caller proceeds without Jev (the
 *  harness current simply does not apply this turn), never blocking a seat. */
export async function askJev(
  handle: JevHandle,
  state: unknown,
  questions: JevQuestions,
  fetchImpl: FetchLike,
): Promise<JevAnswers | undefined> {
  const url = handle.baseUrl.replace(/\/+$/, '') + JEV_SYSTEMONE_PATH;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (handle.apiKey) headers.authorization = `Bearer ${handle.apiKey}`;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildSystemOneBody(handle, state, questions)),
    });
    if (!res.ok) return undefined;
    const body = await res.json();
    return parseAnswers(body, Object.keys(questions));
  } catch {
    return undefined;
  }
}

/** Pull the answers map out of a System One response, tolerant of the exact
 *  envelope: the answers may sit at the top level or under `answers`. Each
 *  question's key is read back and its value normalized. */
export function parseAnswers(body: unknown, keys: string[]): JevAnswers | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const o = body as Record<string, unknown>;
  const src =
    o.answers && typeof o.answers === 'object' ? (o.answers as Record<string, unknown>) : o;
  const out: JevAnswers = {};
  for (const key of keys) {
    if (key in src) out[key] = readAnswer(src[key]);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Normalize one answer value into { value, probability }, tolerant of the
 *  shapes a typed answer can take: a bare boolean/number/string, or an object
 *  carrying the value under a few common field names and a confidence. */
export function readAnswer(raw: unknown): JevAnswer {
  if (typeof raw === 'boolean' || typeof raw === 'number' || typeof raw === 'string') {
    return { value: raw };
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const value = firstDefined(o.choice, o.value, o.answer, o.label, o.decision, o.score);
    const probability = firstNumber(o.probability, o.confidence, o.p, o.score_probability);
    const out: JevAnswer = {};
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out.value = value;
    }
    if (probability !== undefined) out.probability = probability;
    return out;
  }
  return {};
}

// ----------------------------------------------------------------- the jobs

/** The categories a classify decision may return, passed in by the caller so
 *  this module stays generic (the app knows which seats are placed). */
export interface ClassifyInput {
  /** The person's request text (or a compact digest of the turn's state). */
  request: string;
  /** Candidate work kinds and a short description of each, e.g.
   *  { coding: 'writing or editing code', reasoning: 'hard multi-step thought' }. */
  categories: Record<string, string>;
}

export interface ClassifyResult {
  category: string;
  probability?: number;
  line: string;
}

/** Classify the turn into one of the candidate categories, so the stack can
 *  route it to the cheapest seat placed for that kind of work. */
export function buildClassifyQuestions(input: ClassifyInput): JevQuestions {
  return {
    category: {
      type: 'choice',
      instructions: 'What kind of work does this request mainly need?',
      criteria: input.categories,
    },
  };
}

export function readClassify(
  answers: JevAnswers,
  input: ClassifyInput,
): ClassifyResult | undefined {
  const a = answers.category;
  const value = typeof a?.value === 'string' ? a.value : undefined;
  if (!value || !(value in input.categories)) return undefined;
  return {
    category: value,
    probability: a?.probability,
    line: `Jev routed this to the ${value} seat${pct(a?.probability)}.`,
  };
}

export interface GateResult {
  /** True when the work is judged to need the paid, more capable seat. */
  escalate: boolean;
  probability?: number;
  line: string;
}

/** The escalation gate: before spending on a paid/cloud seat, ask cheaply
 *  whether a smaller local seat could carry this turn. `state` is the request. */
export function buildGateQuestions(): JevQuestions {
  return {
    needsFrontier: {
      type: 'noul',
      instructions:
        'Does this request need the most capable paid model, rather than a small local model? Answer yes only when the work is genuinely hard (long multi step reasoning, subtle debugging, large context).',
    },
  };
}

export function readGate(answers: JevAnswers): GateResult | undefined {
  const a = answers.needsFrontier;
  if (a?.value === undefined) return undefined;
  const escalate = truthy(a.value);
  return {
    escalate,
    probability: a.probability,
    line: escalate
      ? `Jev judged this needs the paid seat${pct(a.probability)}.`
      : `Jev judged a local seat can handle this${pct(a.probability)}, so the paid seat was not spent.`,
  };
}

export interface JudgeResult {
  passed: boolean;
  probability?: number;
  line: string;
}

/** The verify judge: when there is no check command to run (no oracle), ask
 *  whether the produced result looks like it satisfies the task. `state`
 *  carries the task and the result. This never overrides a real check; the
 *  loop only consults it where `runVerify` had nothing to run. */
export function buildJudgeQuestions(): JevQuestions {
  return {
    satisfied: {
      type: 'noul',
      instructions: 'Does the result satisfy what the task asked for, completely and correctly?',
    },
  };
}

export function readJudge(answers: JevAnswers): JudgeResult | undefined {
  const a = answers.satisfied;
  if (a?.value === undefined) return undefined;
  const passed = truthy(a.value);
  return {
    passed,
    probability: a.probability,
    line: passed
      ? `Jev judged the result satisfies the task${pct(a.probability)}.`
      : `Jev judged the result does not yet satisfy the task${pct(a.probability)}.`,
  };
}

// --------------------------------------------------------------- the advisor

/** The per-session Jev advisor the loop and the stack consult. Built from the
 *  handed-over harness-currents handle; absent when no harness current is on,
 *  so every consult site is a plain `if (advisor)` and off is truly off. */
export class JevAdvisor {
  constructor(
    private readonly handle: JevHandle,
    private readonly fetchImpl: FetchLike,
  ) {}

  /** Build an advisor from a session handle, or undefined when Jev is not the
   *  active harness current (or nothing usable was handed over). */
  static from(
    handle: HarnessCurrentsHandle | undefined,
    fetchImpl: FetchLike | undefined,
  ): JevAdvisor | undefined {
    if (!handle?.jev?.baseUrl || !fetchImpl) return undefined;
    return new JevAdvisor(handle.jev, fetchImpl);
  }

  async classify(input: ClassifyInput): Promise<ClassifyResult | undefined> {
    const answers = await askJev(
      this.handle,
      input.request,
      buildClassifyQuestions(input),
      this.fetchImpl,
    );
    return answers ? readClassify(answers, input) : undefined;
  }

  async gate(request: string): Promise<GateResult | undefined> {
    const answers = await askJev(this.handle, request, buildGateQuestions(), this.fetchImpl);
    return answers ? readGate(answers) : undefined;
  }

  /** Steer a turn in ONE call: ask the gate (needs the paid seat?) and the
   *  classifier (which kind of work?) together, since System One takes many
   *  questions per request. One cloud call, both answers. Either may be
   *  undefined if the model did not answer that question. */
  async steer(
    input: ClassifyInput,
  ): Promise<{ gate?: GateResult; classify?: ClassifyResult } | undefined> {
    const questions = { ...buildGateQuestions(), ...buildClassifyQuestions(input) };
    const answers = await askJev(this.handle, input.request, questions, this.fetchImpl);
    if (!answers) return undefined;
    return { gate: readGate(answers), classify: readClassify(answers, input) };
  }

  async judge(task: string, result: string): Promise<JudgeResult | undefined> {
    const answers = await askJev(
      this.handle,
      { task, result },
      buildJudgeQuestions(),
      this.fetchImpl,
    );
    return answers ? readJudge(answers) : undefined;
  }
}

// ----------------------------------------------------------------- helpers

function truthy(v: string | number | boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v >= 0.5;
  return /^(yes|true|y|1)$/i.test(v.trim());
}

function pct(p: number | undefined): string {
  if (p === undefined || Number.isNaN(p)) return '';
  const n = p <= 1 ? p * 100 : p;
  return ` (${Math.round(n)}% sure)`;
}

function firstDefined(...vals: unknown[]): unknown {
  for (const v of vals) if (v !== undefined && v !== null) return v;
  return undefined;
}

function firstNumber(...vals: unknown[]): number | undefined {
  for (const v of vals) if (typeof v === 'number' && !Number.isNaN(v)) return v;
  return undefined;
}
