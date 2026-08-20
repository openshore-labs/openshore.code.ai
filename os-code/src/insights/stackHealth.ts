// Stack Health: a fully local read of how the user is actually using their AI
// stack. Every number here is folded from the session journals already on disk
// under ~/.os-code/sessions and the local usage.json. Nothing is sent anywhere,
// nothing is sampled, and nothing is invented: this module only reads files the
// engine already writes. It is the aggregation endpoint the dashboard reads
// through (the WebView never touches the filesystem itself).
//
// Two honesty constraints shape the shape of this data:
//   1. Journals carry no per-event timestamp, only a per-session updatedAt. So
//      the timeline buckets a whole session into the day/hour it last ran, not
//      each turn. Trends are session-grained on purpose, and say so.
//   2. "Dollars saved" is an estimate, not a receipt: it reprices the tokens
//      that ran locally at a named cloud reference rate (Claude Sonnet). The
//      basis travels with the number so the UI can show what it assumes.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config/load.js';
import { listSessions, sessionsDir, type SessionInfo } from '../daemon/session.js';
import { isSealed, loadOrCreateDataKey, openString } from '../core/security/atRest.js';
import type { DriverEvent } from '../core/agent/types.js';
import type {
  StackHealth,
  StackHealthBucket,
  StackHealthCrewMember,
  StackHealthRange,
  StackHealthSealFact,
} from './stackHealthTypes.js';

export type {
  StackHealth,
  StackHealthBucket,
  StackHealthCrewMember,
  StackHealthRange,
  StackHealthSealFact,
} from './stackHealthTypes.js';

/** The cloud rate local work is repriced against for the savings estimate.
 *  Matches the Claude Sonnet row in auth/usage.ts PRICES; a conservative,
 *  named reference so "saved" is an honest counterfactual, not a guess. */
export const SAVINGS_BASIS = { model: 'Claude Sonnet', inPerM: 3, outPerM: 15 } as const;

// A session with its parsed journal, the unit the fold works over.
interface LoadedSession {
  info: SessionInfo;
  events: DriverEvent[];
}

// ---------------------------------------------------------------- disk reads

/** Read one session's journal: sealed lines open with the data key, plaintext
 *  (pre-encryption) lines pass through, and anything unreadable is skipped,
 *  never fatal. */
function readJournal(id: string): DriverEvent[] {
  const path = join(sessionsDir(), id, 'events.jsonl');
  if (!existsSync(path)) return [];
  const out: DriverEvent[] = [];
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const dk = loadOrCreateDataKey();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const clear = isSealed(line) ? (dk ? openString(dk.key, line) : null) : line;
    if (clear === null) continue;
    try {
      const parsed = JSON.parse(clear) as { seq: number; event: DriverEvent };
      if (parsed && parsed.event) out.push(parsed.event);
    } catch {
      // A malformed line degrades to skipped, never a thrown read.
    }
  }
  return out;
}

interface AtRestCacheEntry {
  statKey?: string;
  plain: number;
  sealed: number;
}

// Keyed by the full file path (never just the session id): different
// environments (different OSC_HOME, as tests exercise) can reuse the same
// session id, and a path-scoped cache is the only safe key. A per-file entry
// is recomputed only when its (mtime, size) signature changes, so repeated
// stackHealth() calls in one process re-read only what actually grew.
const journalScanCache = new Map<string, AtRestCacheEntry>();
const titleScanCache = new Map<string, AtRestCacheEntry>();

function fileStatKey(path: string): string | undefined {
  try {
    const st = statSync(path);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return undefined;
  }
}

/** The at-rest truth, checked, not asserted: prefix-scan EVERY session
 *  journal AND title (in range or not) and count what is still plaintext. The
 *  seal claims green only when this comes back zero, so the claim covers all
 *  history on disk, not just the window being viewed. Prefix checks only, no
 *  decrypting, so the scan stays cheap; per-file results are cached by
 *  (mtime, size) so an unchanged file is never re-read. */
function scanAtRest(): { plainLines: number; sealedLines: number; plainTitles: number } {
  const out = { plainLines: 0, sealedLines: 0, plainTitles: 0 };
  const dir = sessionsDir();
  if (!existsSync(dir)) return out;
  for (const id of readdirSync(dir)) {
    const journalPath = join(dir, id, 'events.jsonl');
    const key = fileStatKey(journalPath);
    let entry = journalScanCache.get(journalPath);
    if (!entry || entry.statKey !== key) {
      entry = { statKey: key, plain: 0, sealed: 0 };
      if (key) {
        try {
          const raw = readFileSync(journalPath, 'utf8');
          for (const line of raw.split('\n')) {
            if (!line.trim()) continue;
            if (isSealed(line)) entry.sealed += 1;
            else entry.plain += 1;
          }
        } catch {}
      }
      journalScanCache.set(journalPath, entry);
    }
    out.plainLines += entry.plain;
    out.sealedLines += entry.sealed;

    const infoPath = join(dir, id, 'info.json');
    const infoKey = fileStatKey(infoPath);
    let titleEntry = titleScanCache.get(infoPath);
    if (!titleEntry || titleEntry.statKey !== infoKey) {
      titleEntry = { statKey: infoKey, plain: 0, sealed: 0 };
      if (infoKey) {
        try {
          const info = JSON.parse(readFileSync(infoPath, 'utf8')) as { title?: string };
          if (typeof info.title === 'string' && info.title && !isSealed(info.title)) {
            titleEntry.plain = 1;
          }
        } catch {}
      }
      titleScanCache.set(infoPath, titleEntry);
    }
    out.plainTitles += titleEntry.plain;
  }
  return out;
}

/** Test seam: forget the cached scan (tests swap OSC_HOME between cases and
 *  reuse session ids across environments). */
export function _resetAtRestScanCache(): void {
  journalScanCache.clear();
  titleScanCache.clear();
}

function cutoff(now: Date, range: StackHealthRange): number {
  const t = now.getTime();
  const day = 86_400_000;
  switch (range) {
    case 'day':
      return t - day;
    case 'week':
      return t - 7 * day;
    case 'month':
      return t - 30 * day;
    case 'year':
      return t - 365 * day;
    case 'all':
      return 0;
  }
}

// ------------------------------------------------------------------ the fold

interface Totals {
  localTurns: number;
  cloudTurns: number;
  localPrompt: number;
  localCompletion: number;
  cloudPrompt: number;
  cloudCompletion: number;
  cloudDollars: number;
  cloudFlips: number;
  toolRuns: number;
  toolDenied: number;
  approvalsRequested: number;
  approvalsDenied: number;
  tasksAttempted: number;
  complete: number;
  declined: number;
  error: number;
  other: number;
  /** turns handled per model id, for crew attribution. */
  turnsByModel: Map<string, number>;
}

function zeroTotals(): Totals {
  return {
    localTurns: 0,
    cloudTurns: 0,
    localPrompt: 0,
    localCompletion: 0,
    cloudPrompt: 0,
    cloudCompletion: 0,
    cloudDollars: 0,
    cloudFlips: 0,
    toolRuns: 0,
    toolDenied: 0,
    approvalsRequested: 0,
    approvalsDenied: 0,
    tasksAttempted: 0,
    complete: 0,
    declined: 0,
    error: 0,
    other: 0,
    turnsByModel: new Map(),
  };
}

/** Fold one session's events into totals. `currentKind` tracks the active
 *  provider so each usage event is attributed to the turn that produced it;
 *  turn-start and model-switch both move it. */
function foldSession(events: DriverEvent[], into: Totals): void {
  let currentKind: 'local' | 'cloud' = 'local';
  for (const event of events) {
    switch (event.type) {
      case 'task-start':
        into.tasksAttempted += 1;
        break;
      case 'turn-start':
        currentKind = event.providerKind;
        if (event.providerKind === 'cloud') into.cloudTurns += 1;
        else into.localTurns += 1;
        into.turnsByModel.set(event.model, (into.turnsByModel.get(event.model) ?? 0) + 1);
        break;
      case 'model-switch':
        currentKind = event.providerKind;
        if (event.providerKind === 'cloud') into.cloudFlips += 1;
        break;
      case 'usage':
        if (currentKind === 'cloud') {
          into.cloudPrompt += event.promptTokens;
          into.cloudCompletion += event.completionTokens;
          into.cloudDollars += event.dollars;
        } else {
          into.localPrompt += event.promptTokens;
          into.localCompletion += event.completionTokens;
        }
        break;
      case 'tool-start':
        into.toolRuns += 1;
        break;
      case 'tool-denied':
        into.toolDenied += 1;
        break;
      case 'approval-request':
        into.approvalsRequested += 1;
        break;
      case 'approval-resolved':
        if (!event.approved) into.approvalsDenied += 1;
        break;
      case 'task-done':
        if (event.reason === 'complete') into.complete += 1;
        else if (event.reason === 'declined') into.declined += 1;
        else if (event.reason === 'error') into.error += 1;
        else into.other += 1;
        break;
      default:
        break;
    }
  }
}

function priceLocal(prompt: number, completion: number): number {
  return (prompt * SAVINGS_BASIS.inPerM + completion * SAVINGS_BASIS.outPerM) / 1_000_000;
}

// -------------------------------------------------------------- crew + seal

interface StackSummary {
  orchestrator?: { model: string; kind: 'local' | 'cloud' };
  specialists: Array<{ role: string; model: string; kind: 'local' | 'cloud' }>;
}

function summarizeStack(): StackSummary {
  const { config } = loadConfig();
  const kindOf = (provider: string): 'local' | 'cloud' =>
    config.providers[provider]?.kind === 'anthropic' ? 'cloud' : 'local';
  const orch = config.stack.orchestrator;
  const orchestrator = orch ? { model: orch.model, kind: kindOf(orch.provider) } : undefined;
  const specialists = Object.entries(config.stack.specialists)
    .filter(([role]) => role !== 'imageGen')
    .map(([role, ref]) => {
      const r = ref as { provider?: string; model?: string };
      return {
        role,
        model: r.model ?? '',
        kind: r.provider ? kindOf(r.provider) : ('local' as const),
      };
    })
    .filter((s) => s.model);
  return { orchestrator, specialists };
}

function buildCrew(
  stack: StackSummary,
  turnsByModel: Map<string, number>,
): StackHealthCrewMember[] {
  const crew: StackHealthCrewMember[] = [];
  if (stack.orchestrator) {
    crew.push({
      role: 'orchestrator',
      model: stack.orchestrator.model,
      kind: stack.orchestrator.kind,
      turns: turnsByModel.get(stack.orchestrator.model) ?? 0,
    });
  }
  for (const s of stack.specialists) {
    crew.push({
      role: s.role,
      model: s.model,
      kind: s.kind,
      turns: turnsByModel.get(s.model) ?? 0,
    });
  }
  return crew;
}

/** The privacy seal facts, every one computed, none asserted. Telemetry is off
 *  by construction. Data-left-device reflects real cloud calls rather than a
 *  fake zero. Encryption-at-rest is graded from the actual disk scan and from
 *  the backend that holds the key: green means a system keychain holds the key
 *  AND no plaintext line or title remains anywhere on disk; anything less says
 *  exactly what is less about it. */
function buildSeal(
  cloudTurns: number,
  atRest: { plainLines: number; sealedLines: number; plainTitles: number },
  keyProtection: 'keychain' | 'encrypted-file' | undefined,
): StackHealthSealFact[] {
  let encrypted: StackHealthSealFact;
  if (!keyProtection) {
    encrypted = {
      key: 'encryptedAtRest',
      state: 'pending',
      label: 'Sessions are not yet encrypted at rest.',
    };
  } else if (atRest.plainLines > 0) {
    encrypted = {
      key: 'encryptedAtRest',
      state: 'note',
      label: `Encrypting your sessions. ${atRest.plainLines} older ${atRest.plainLines === 1 ? 'line is' : 'lines are'} not yet sealed.`,
    };
  } else if (atRest.plainTitles > 0) {
    encrypted = {
      key: 'encryptedAtRest',
      state: 'note',
      label: `Encrypting your sessions. ${atRest.plainTitles} older ${atRest.plainTitles === 1 ? 'title is' : 'titles are'} not yet sealed.`,
    };
  } else if (keyProtection === 'encrypted-file') {
    encrypted = {
      key: 'encryptedAtRest',
      state: 'note',
      label: 'Sessions are encrypted at rest. A system keychain would hold the key more safely.',
    };
  } else {
    encrypted = {
      key: 'encryptedAtRest',
      state: 'good',
      label: 'Sessions are encrypted at rest. The key lives in your system keychain.',
    };
  }
  return [
    {
      key: 'telemetry',
      state: 'good',
      label: 'No telemetry. Nothing about your use is collected.',
    },
    cloudTurns === 0
      ? { key: 'dataLeftDevice', state: 'good', label: 'Nothing left this device this period.' }
      : {
          key: 'dataLeftDevice',
          state: 'note',
          label: `${cloudTurns} cloud ${cloudTurns === 1 ? 'turn' : 'turns'} sent to your provider, on your own key.`,
        },
    encrypted,
  ];
}

// --------------------------------------------------------------- timeline

interface BucketPlan {
  starts: number[];
  labels: string[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Bucket boundaries and labels for the range. Session-grained: a session lands
 *  in the bucket its updatedAt falls in. Boundaries oldest-first. */
function planBuckets(now: Date, range: StackHealthRange, earliest: number): BucketPlan {
  const day = 86_400_000;
  const hour = 3_600_000;
  const starts: number[] = [];
  const labels: string[] = [];
  const t = now.getTime();
  if (range === 'day') {
    for (let i = 23; i >= 0; i--) {
      const d = new Date(t - i * hour);
      starts.push(d.getTime() - (d.getTime() % hour));
      labels.push(`${((d.getHours() + 11) % 12) + 1}${d.getHours() < 12 ? 'a' : 'p'}`);
    }
  } else if (range === 'week') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(t - i * day);
      starts.push(d.getTime());
      labels.push(WEEKDAYS[d.getDay()]);
    }
  } else if (range === 'month') {
    for (let i = 29; i >= 0; i--) {
      const d = new Date(t - i * day);
      starts.push(d.getTime());
      labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
    }
  } else if (range === 'year') {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      starts.push(d.getTime());
      labels.push(MONTHS[d.getMonth()]);
    }
  } else {
    // all-time: monthly from the earliest session to now, capped at 24 columns.
    const first = new Date(earliest || t);
    let months =
      (now.getFullYear() - first.getFullYear()) * 12 + (now.getMonth() - first.getMonth());
    months = Math.min(Math.max(months, 0), 23);
    for (let i = months; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      starts.push(d.getTime());
      labels.push(MONTHS[d.getMonth()]);
    }
  }
  return { starts, labels };
}

function bucketIndex(starts: number[], when: number): number {
  // Last boundary that is <= when.
  let idx = -1;
  for (let i = 0; i < starts.length; i++) {
    if (when >= starts[i]) idx = i;
    else break;
  }
  return idx;
}

// ------------------------------------------------------------------ compute

/** Read every session in range, fold it, and return the dashboard payload.
 *  Pure read: it opens only files the engine already wrote. */
export function computeStackHealth(
  range: StackHealthRange = 'week',
  now: Date = new Date(),
): StackHealth {
  const dir = sessionsDir();
  const infos = existsSync(dir) ? listSessions() : [];
  const since = cutoff(now, range);

  const totals = zeroTotals();
  const inRange: LoadedSession[] = [];
  let earliest = now.getTime();
  for (const info of infos) {
    const when = Date.parse(info.updatedAt);
    if (Number.isNaN(when) || when < since) continue;
    const events = readJournal(info.id);
    inRange.push({ info, events });
    foldSession(events, totals);
    if (when < earliest) earliest = when;
  }

  const stack = summarizeStack();
  const savedDollars = priceLocal(totals.localPrompt, totals.localCompletion);
  const wouldHavePaid = savedDollars + totals.cloudDollars;
  const totalTurns = totals.localTurns + totals.cloudTurns;
  // The seal is measured, not asserted: scan every journal on disk for
  // plaintext and ask the key store which backend really holds the key.
  const atRest = scanAtRest();
  const keyProtection = loadOrCreateDataKey()?.protection;

  // Timeline: re-fold per session into its bucket (cheap; sessions are few).
  const plan = planBuckets(now, range, earliest);
  const timeline: StackHealthBucket[] = plan.starts.map((start, i) => ({
    label: plan.labels[i],
    start: new Date(start).toISOString(),
    localTurns: 0,
    cloudTurns: 0,
    savedDollars: 0,
    cloudDollars: 0,
  }));
  for (const s of inRange) {
    const idx = bucketIndex(plan.starts, Date.parse(s.info.updatedAt));
    if (idx < 0) continue;
    const b = zeroTotals();
    foldSession(s.events, b);
    const bucket = timeline[idx];
    bucket.localTurns += b.localTurns;
    bucket.cloudTurns += b.cloudTurns;
    bucket.savedDollars += priceLocal(b.localPrompt, b.localCompletion);
    bucket.cloudDollars += b.cloudDollars;
  }

  return {
    range,
    generatedAt: now.toISOString(),
    empty: totalTurns === 0 && totals.tasksAttempted === 0,

    savedDollars,
    cloudDollars: totals.cloudDollars,
    wouldHavePaid,
    savingsBasis: SAVINGS_BASIS,

    privacyRing: {
      localTurns: totals.localTurns,
      cloudTurns: totals.cloudTurns,
      fraction: totalTurns > 0 ? totals.localTurns / totalTurns : 0,
    },
    flowRing: {
      tasksDone: totals.complete,
      tasksAttempted: totals.tasksAttempted,
      fraction: totals.tasksAttempted > 0 ? totals.complete / totals.tasksAttempted : 0,
    },
    savedRing: {
      savedDollars,
      wouldHavePaid,
      fraction: wouldHavePaid > 0 ? savedDollars / wouldHavePaid : 0,
    },

    tokens: {
      local: { prompt: totals.localPrompt, completion: totals.localCompletion },
      cloud: { prompt: totals.cloudPrompt, completion: totals.cloudCompletion },
    },
    cloudFlips: totals.cloudFlips,
    tools: {
      runs: totals.toolRuns,
      denied: totals.toolDenied,
      approvalsRequested: totals.approvalsRequested,
      approvalsDenied: totals.approvalsDenied,
    },
    outcomes: {
      complete: totals.complete,
      declined: totals.declined,
      error: totals.error,
      other: totals.other,
    },

    crew: buildCrew(stack, totals.turnsByModel),
    seal: buildSeal(totals.cloudTurns, atRest, keyProtection),
    timeline,
  };
}

// Exported for tests: the pure fold, decoupled from disk.
export const __test = { foldSession, zeroTotals, priceLocal, planBuckets, bucketIndex };
