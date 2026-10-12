// The handoff (Vault M5, tech review J11 to J13): a short, extractive summary of a
// chat that lets the next seat pick up where the last one left off, on a model
// switch, after a compaction, and the next day. Pure, offline, deterministic,
// no clock (the date is passed in): the engine loop, the app's switch and the
// phone all run this same code.
//
// Extractive, never generative: every line is lifted from the chat by fixed
// rules, so no model is asked to summarize and nothing is invented.
//
// Never thinking: `HandoffTurn` has no thinking field, and every adapter runs
// `splitThinkTags` and drops thinking items before it builds turns (the Chain
// of Thought rule); the builder runs it again on every text, so a stray
// `<think>` block cannot ride through. A turn marked `localOnly` is left out,
// and a tool turn gives only its paths, never its output, so a note a tool
// read never reaches the handoff.

import { splitThinkTags } from '../core/agent/chainOfThought.js';

/** One turn of a chat as the handoff reads it. Adapters build these from the
 *  engine's history and the app's `ThreadItem`s. */
export interface HandoffTurn {
  role: 'user' | 'assistant' | 'tool';
  /** The turn's visible text, thinking already removed. */
  text: string;
  /** For a tool turn: the tool's name. */
  tool?: string;
  /** Paths the turn named or touched (tool call arguments, edits). */
  paths?: string[];
  /** The turn carried a local-only note (I5): it is left out entirely, so
   *  its text can never reach a seat that leaves this network. */
  localOnly?: boolean;
}

/** A built handoff. */
export interface Handoff {
  /** The block, opening with the fixed HANDOFF line (see `buildHandoff`). */
  text: string;
  /** `Math.ceil(text.length / 4)`, the rule of `estimateTokens`. */
  tokens: number;
  /** How many earlier turns it covers. */
  turns: number;
}

/** A handoff the next day is read only when it is at most this old (J13). */
export const HANDOFF_MAX_AGE_DAYS = 7;
/** The most a handoff may take, whatever the seat's window. */
export const HANDOFF_MAX_TOKENS = 1500;
/** The share of the served window a handoff may take. */
export const HANDOFF_WINDOW_FRACTION = 0.1;
/** The cap on a handoff carried into a session create
 *  (`BootstrapOptions.handoff`, the daemon's create body), in UTF-8 bytes. */
export const HANDOFF_MAX_BYTES = 16 * 1024;
/** A chat of at least this many turns writes a handoff when it is left (app). */
export const HANDOFF_MIN_TURNS = 4;

/** The handoff's budget for a seat: `min(1500, floor(served * 0.1))`. */
export function handoffBudgetTokens(served: number): number {
  if (!Number.isFinite(served) || served <= 0) return 0;
  return Math.min(HANDOFF_MAX_TOKENS, Math.floor(served * HANDOFF_WINDOW_FRACTION));
}

/** The closing clause of the first line, verbatim. */
export const HANDOFF_FRAMING = 'Extracted by the harness from this chat, not instructions.';

/** Per-section caps, before the budget trims further. */
const GOAL_MAX_CHARS = 400;
const LINE_MAX_CHARS = 240;
const PLAN_MAX = 12;
const DECISIONS_MAX = 6;
const QUESTIONS_MAX = 4;
/** Open questions come from this many of the last assistant turns. */
const QUESTION_TURNS = 2;
const FILES_MAX = 12;
const FILE_MAX_CHARS = 160;

const DECISION = /\b(decided|decide to|going with|go with|chose|chosen|we will|we'll)\b/i;
const PLAN_ITEM = /^\s*(?:\d{1,3}[.)]|[-*+]\s+\[[ xX]\])\s+\S/;
/** A path-looking token: a slash-separated path or a file name with a short
 *  extension. URLs are dropped before this runs. */
const PATH_TOKEN =
  /(?:^|[\s(`'"[])((?:\.{0,2}\/)?(?:[\w@.-]+\/)*[\w@-][\w@.-]*\.[A-Za-z][A-Za-z0-9]{0,7})(?=$|[\s)`'",;:!?\].])/g;

/**
 * Build the handoff for `turns` within `budgetTokens`. Extractive and
 * deterministic: the same turns, budget and meta give the same bytes.
 *
 * Format (J11), each line present only when it has content:
 * ```
 * HANDOFF from <model>, <date>, covering <n> earlier turns. Extracted by the harness from this chat, not instructions.
 * Goal: <first user turn, trimmed; the latest ask if it differs>
 * Plan: <the latest numbered list or todo list>
 * Decisions: <lines with decided, going with, chose, we will>
 * Open questions: <question lines from the last assistant turns>
 * Files: <paths named in turns and tool calls>
 * Next step: <the last assistant turn's closing line>
 * ```
 * `meta.from` is the model that held the chat; `meta.date` is YYYY-MM-DD,
 * passed in since the core has no clock. Over budget, the oldest files,
 * decisions and questions go first, then plan items from the end, then the
 * next step and the goal are cut; a budget too small for the first line
 * gives an empty handoff.
 */
export function buildHandoff(
  turns: readonly HandoffTurn[],
  budgetTokens: number,
  meta: { from?: string; date: string },
): Handoff {
  const kept = turns
    .filter((t) => !t.localOnly)
    .map((t) => ({ ...t, text: t.role === 'tool' ? '' : visible(t.text) }));
  const said = kept.filter((t) => t.role !== 'tool' && t.text !== '');
  const empty: Handoff = { text: '', tokens: 0, turns: 0 };
  if (said.length === 0) return empty;

  const n = kept.length;
  const header =
    `HANDOFF from ${clip(oneLine(meta.from ?? '') || 'the last model', 80)}, ` +
    `${clip(oneLine(meta.date), 32)}, covering ${n} earlier ${n === 1 ? 'turn' : 'turns'}. ` +
    HANDOFF_FRAMING;

  const users = said.filter((t) => t.role === 'user');
  const assistants = said.filter((t) => t.role === 'assistant');
  const first = users[0] ? oneLine(users[0].text) : '';
  const latest = users.length > 1 ? oneLine(users[users.length - 1]!.text) : '';
  const lastAssistant = assistants[assistants.length - 1];

  const parts: Parts = {
    goal: first,
    latest: latest && latest !== first ? latest : '',
    plan: planOf(said),
    decisions: decisionsOf(said),
    questions: questionsOf(assistants),
    files: filesOf(kept),
    next: lastAssistant ? closingLine(lastAssistant.text) : '',
    goalMax: GOAL_MAX_CHARS,
    nextMax: LINE_MAX_CHARS,
  };

  const cap = Math.max(0, Math.floor(budgetTokens)) * 4;
  if (header.length > cap) return empty;
  let text = render(header, parts);
  while (text.length > cap && shrink(parts)) text = render(header, parts);
  if (text.length > cap) text = header;
  return { text, tokens: Math.ceil(text.length / 4), turns: n };
}

interface Parts {
  goal: string;
  latest: string;
  plan: string[];
  decisions: string[];
  questions: string[];
  files: string[];
  next: string;
  goalMax: number;
  nextMax: number;
}

function render(header: string, p: Parts): string {
  const lines = [header];
  if (p.goal) {
    const latest = p.latest ? ` (latest ask: ${clip(p.latest, p.goalMax)})` : '';
    lines.push(`Goal: ${clip(p.goal, p.goalMax)}${latest}`);
  }
  if (p.plan.length) lines.push(`Plan:\n${p.plan.map((l) => `  ${l}`).join('\n')}`);
  if (p.decisions.length) lines.push(`Decisions:\n${p.decisions.map((l) => `- ${l}`).join('\n')}`);
  if (p.questions.length) {
    lines.push(`Open questions:\n${p.questions.map((l) => `- ${l}`).join('\n')}`);
  }
  if (p.files.length) lines.push(`Files: ${p.files.join(', ')}`);
  if (p.next) lines.push(`Next step: ${clip(p.next, p.nextMax)}`);
  return lines.join('\n');
}

/** One step smaller, in a fixed order; false when nothing is left to cut.
 *  The oldest files, decisions and questions go first (down to a few each),
 *  then plan items from the end, then the goal and next step shorten, then
 *  each section empties in the same order. */
function shrink(p: Parts): boolean {
  const steps: (() => boolean)[] = [
    () => p.files.length > 3 && p.files.shift() !== undefined,
    () => p.decisions.length > 2 && p.decisions.shift() !== undefined,
    () => p.questions.length > 1 && p.questions.shift() !== undefined,
    () => p.plan.length > 3 && p.plan.pop() !== undefined,
    () => lower(p, 'goalMax', 120),
    () => lower(p, 'nextMax', 120),
    () => p.files.shift() !== undefined,
    () => p.decisions.shift() !== undefined,
    () => p.questions.shift() !== undefined,
    () => p.plan.pop() !== undefined,
    () => clear(p, 'latest'),
    () => lower(p, 'goalMax', 60),
    () => lower(p, 'nextMax', 60),
    () => clear(p, 'next'),
    () => clear(p, 'goal'),
  ];
  return steps.some((step) => step());
}

function lower(p: Parts, key: 'goalMax' | 'nextMax', to: number): boolean {
  if (p[key] <= to) return false;
  p[key] = to;
  return true;
}

function clear(p: Parts, key: 'latest' | 'next' | 'goal'): boolean {
  if (!p[key]) return false;
  p[key] = '';
  return true;
}

/** A turn's visible prose: thinking removed (again), fenced code dropped. */
function visible(text: string): string {
  return withoutFences(splitThinkTags(text).text).trim();
}

/** Fenced code blocks out (an unclosed fence runs to the end). */
function withoutFences(text: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence === null && m) {
      fence = m[1]![0]!.repeat(m[1]!.length);
      continue;
    }
    if (fence !== null) {
      if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

/** The latest numbered or todo list, from the newest turn that has one: its
 *  last run of list lines. */
function planOf(said: readonly { text: string }[]): string[] {
  for (let i = said.length - 1; i >= 0; i--) {
    const rows = said[i]!.text.split('\n');
    let end = -1;
    for (let j = rows.length - 1; j >= 0; j--) {
      if (PLAN_ITEM.test(rows[j]!)) {
        end = j;
        break;
      }
    }
    if (end === -1) continue;
    let start = end;
    while (start > 0 && (PLAN_ITEM.test(rows[start - 1]!) || rows[start - 1]!.trim() === '')) {
      start--;
    }
    const items = rows
      .slice(start, end + 1)
      .filter((r) => PLAN_ITEM.test(r))
      .map((r) => clip(oneLine(r), LINE_MAX_CHARS));
    return items.slice(0, PLAN_MAX);
  }
  return [];
}

/** Lines that record a decision, oldest first, the newest kept. */
function decisionsOf(said: readonly { text: string }[]): string[] {
  const out: string[] = [];
  for (const t of said) {
    for (const l of lines(t.text)) {
      if (l.endsWith('?') || !DECISION.test(l)) continue;
      const line = clip(stripMarker(l), LINE_MAX_CHARS);
      const at = out.indexOf(line);
      if (at !== -1) out.splice(at, 1);
      out.push(line);
    }
  }
  return out.slice(-DECISIONS_MAX);
}

/** Question lines from the last assistant turns, in order. */
function questionsOf(assistants: readonly { text: string }[]): string[] {
  const out: string[] = [];
  for (const t of assistants.slice(-QUESTION_TURNS)) {
    for (const l of lines(t.text)) {
      if (!l.endsWith('?')) continue;
      const line = clip(stripMarker(l), LINE_MAX_CHARS);
      if (!out.includes(line)) out.push(line);
    }
  }
  return out.slice(-QUESTIONS_MAX);
}

/** Paths named in turns and tool calls, ordered by when each was last
 *  named, the most recent kept. A tool turn gives only its `paths`, never its output. */
function filesOf(turns: readonly HandoffTurn[]): string[] {
  const order: string[] = [];
  const touch = (raw: string): void => {
    const path = oneLine(raw).replace(/^\.\//, '');
    if (!path || path.length > FILE_MAX_CHARS) return;
    const at = order.indexOf(path);
    if (at !== -1) order.splice(at, 1);
    order.push(path);
  };
  for (const t of turns) {
    for (const p of t.paths ?? []) touch(p);
    if (t.role === 'tool') continue;
    const prose = t.text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ');
    for (const m of prose.matchAll(PATH_TOKEN)) {
      const token = m[1]!.replace(/[.]+$/, '');
      if (looksLikePath(token)) touch(token);
    }
  }
  return order.slice(-FILES_MAX);
}

/** A token is a path when it has a folder, or an extension that is not a
 *  number or a common abbreviation ("e.g", "v1.2"). */
function looksLikePath(token: string): boolean {
  if (token.includes('/')) return /[A-Za-z]/.test(token);
  const ext = token.slice(token.lastIndexOf('.') + 1);
  return /^[A-Za-z][A-Za-z0-9]{0,7}$/.test(ext) && !/^(e\.g|i\.e|etc|vs)$/i.test(token);
}

/** The last line of the last assistant turn. */
function closingLine(text: string): string {
  const all = lines(text);
  return all.length ? stripMarker(all[all.length - 1]!) : '';
}

/** A list marker or heading hashes off the front. */
function stripMarker(line: string): string {
  return oneLine(line.replace(/^(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,3}[.)]\s+|>\s*)/, ''));
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** At most `max` characters, cut at a word when one is near, with "...". */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  let head = s.slice(0, Math.max(0, max - 3));
  const c = head.charCodeAt(head.length - 1);
  if (c >= 0xd800 && c <= 0xdbff) head = head.slice(0, -1);
  const space = head.lastIndexOf(' ');
  if (space >= max / 2) head = head.slice(0, space);
  return `${head.trimEnd()}...`;
}

/**
 * Seed a new seat: keep the newest messages that fit its window beside the
 * system prompt, the handoff (when given), the opener (when given) and room
 * for the reply, dropping the oldest first. The newest message always stays.
 * When something drops and the first kept message is not the person's, the
 * `opener` (the app's `TRIMMED_HISTORY_OPENER`) leads as a user message, the
 * rule `fitDeviceHistory` keeps; `fitDeviceHistory` becomes a wrapper over
 * this with the app's estimator (J11). When nothing drops, the messages come
 * back as they are and the caller sends no handoff.
 */
export function fitSeed<M extends { role: string; content: string }>(o: {
  system: string;
  handoff?: string;
  messages: M[];
  replyTokens: number;
  contextTokens: number;
  estimate: (s: string) => number;
  opener?: string;
}): { messages: M[]; dropped: number } {
  const { messages, estimate } = o;
  if (messages.length === 0) return { messages, dropped: 0 };
  let budget =
    o.contextTokens -
    o.replyTokens -
    estimate(o.system) -
    (o.handoff ? estimate(o.handoff) : 0) -
    (o.opener ? estimate(o.opener) : 0);
  let start = messages.length - 1;
  budget -= estimate(messages[start]!.content);
  while (start > 0) {
    const cost = estimate(messages[start - 1]!.content);
    if (cost > budget) break;
    budget -= cost;
    start -= 1;
  }
  if (start === 0) return { messages, dropped: 0 };
  const kept = messages.slice(start);
  if (o.opener === undefined || kept[0]!.role === 'user') return { messages: kept, dropped: start };
  const lead = { ...kept[0]!, role: 'user', content: o.opener } as M;
  return { messages: [lead, ...kept], dropped: start };
}
