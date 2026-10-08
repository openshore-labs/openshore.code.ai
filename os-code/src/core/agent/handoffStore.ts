// The engine's handoff store (Vault M5, CTO J13): the latest handoff for one
// owner, workspace and project, kept on this machine in
// `oscHome()/handoffs/<key>.json`, never in the vault (so no carve-out) and
// never in the repo. The loop writes one after a compaction and after each
// task that ends complete; a fresh session's first task may read it back the
// next day, at most HANDOFF_MAX_AGE_DAYS old.
//
// Latest only: each write replaces the file. The text is redacted, then sealed
// with the machine's data key when there is one, like the session journal,
// since it is the person's own chat. Every read and write is best effort: a
// broken store loses a summary, never a task.
//
// This file also holds the adapter from the engine's history to the pure
// `HandoffTurn`s `buildHandoff` reads: thinking is split out and dropped, a
// local-only message is left out, harness-written prompts are not the
// person's ask, and tool results are data, so only the calls' paths ride.
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { oscHome } from '../../config/home.js';
import type { ChatMessage } from '../../providers/types.js';
import { HANDOFF_MAX_AGE_DAYS, type HandoffTurn } from '../../harness/handoff.js';
import { isSealed, loadOrCreateDataKey, openString, sealString } from '../security/atRest.js';
import { redactSecrets } from '../security/redaction.js';
import { splitThinkTags } from './chainOfThought.js';

/** One stored handoff, as `oscHome()/handoffs/<key>.json` holds it. */
export interface HandoffRecord {
  text: string;
  /** When it was written, ISO 8601. */
  at: string;
  /** The model that held the chat. */
  model: string;
  /** How many earlier turns it covers. */
  turns: number;
  /** The record's format: 2 for one written by this engine (0.1.64 on),
   *  whose adapter leaves every local-only message out. A record without it
   *  was written before that fix and may carry a private note's words, so
   *  `sweepPreFixHandoffs` removes it (CX and CMO, 2026-10-08, A). Stamped on
   *  write; a caller need not set it. */
  v?: 2;
}

/** The marker `sweepPreFixHandoffs` leaves once it ran, beside the folder. */
export function handoffSweepMarker(): string {
  return join(oscHome(), 'handoffs-swept');
}

/**
 * Remove every stored handoff written before the local-only fix (a record
 * without `v: 2`, or one that cannot be opened to tell), then leave a marker
 * so it runs once per machine. Bootstrap calls it; a no-op once the marker
 * exists. Best effort: a sweep that fails leaves no marker and runs again.
 */
export function sweepPreFixHandoffs(): void {
  const marker = handoffSweepMarker();
  try {
    if (existsSync(marker)) return;
    const dir = handoffsDir();
    if (existsSync(dir)) {
      let dk: ReturnType<typeof loadOrCreateDataKey> | undefined;
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.json')) continue;
        const path = join(dir, name);
        let current = false;
        try {
          const raw = readFileSync(path, 'utf8');
          let clear: string | null = raw;
          if (isSealed(raw)) {
            dk ??= loadOrCreateDataKey();
            clear = dk ? openString(dk.key, raw) : null;
          }
          current = clear !== null && (JSON.parse(clear) as { v?: unknown }).v === 2;
        } catch {
          current = false;
        }
        if (!current) rmSync(path, { force: true });
      }
    }
    mkdirSync(dirname(marker), { recursive: true, mode: 0o700 });
    writeFileSync(marker, '', { mode: 0o600 });
  } catch {
    // The next bootstrap tries again.
  }
}

/** Who and where a handoff belongs to. */
export interface HandoffScope {
  /** The session's owner on a shared hub; empty or undefined for the machine's own. */
  owner?: string;
  cwd: string;
  projectName?: string;
}

/** The store's folder. */
export function handoffsDir(): string {
  return join(oscHome(), 'handoffs');
}

function realCwd(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return resolve(cwd);
  }
}

/** `sha256(owner + '\0' + realpath(cwd) + '\0' + projectName)`, hex. */
export function handoffKey(scope: HandoffScope): string {
  return createHash('sha256')
    .update(`${scope.owner ?? ''}\0${realCwd(scope.cwd)}\0${scope.projectName ?? ''}`)
    .digest('hex');
}

function fileFor(scope: HandoffScope): string {
  return join(handoffsDir(), `${handoffKey(scope)}.json`);
}

/** Write the latest handoff for a scope, atomically. False when it could not
 *  be written. */
export function writeHandoff(scope: HandoffScope, record: HandoffRecord): boolean {
  try {
    const dir = handoffsDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const clean: HandoffRecord = { ...record, text: redactSecrets(record.text), v: 2 };
    const json = JSON.stringify(clean);
    const dk = loadOrCreateDataKey();
    const path = fileFor(scope);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, dk ? sealString(dk.key, json) : json, { mode: 0o600 });
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}

/** A clock skew allowance for a stamp slightly in the future. */
const FUTURE_SLACK_MS = 60 * 60 * 1000;

/** The latest handoff for a scope when it is at most `maxAgeDays` old;
 *  undefined when there is none, it is too old, or it cannot be opened. */
export function readHandoff(
  scope: HandoffScope,
  options: { now?: Date; maxAgeDays?: number } = {},
): HandoffRecord | undefined {
  try {
    const path = fileFor(scope);
    if (!existsSync(path)) return undefined;
    const raw = readFileSync(path, 'utf8');
    let clear: string | null = raw;
    if (isSealed(raw)) {
      const dk = loadOrCreateDataKey();
      clear = dk ? openString(dk.key, raw) : null;
    }
    if (clear === null) return undefined;
    const parsed = JSON.parse(clear) as Partial<HandoffRecord>;
    if (typeof parsed.text !== 'string' || !parsed.text.trim()) return undefined;
    if (typeof parsed.at !== 'string') return undefined;
    const at = Date.parse(parsed.at);
    if (!Number.isFinite(at)) return undefined;
    const now = (options.now ?? new Date()).getTime();
    const maxAgeMs = (options.maxAgeDays ?? HANDOFF_MAX_AGE_DAYS) * 24 * 60 * 60 * 1000;
    if (now - at > maxAgeMs || at - now > FUTURE_SLACK_MS) return undefined;
    return {
      text: parsed.text,
      at: parsed.at,
      model: typeof parsed.model === 'string' ? parsed.model : '',
      turns: typeof parsed.turns === 'number' ? parsed.turns : 0,
    };
  } catch {
    return undefined;
  }
}

/** Remove one scope's handoff. */
export function deleteHandoff(scope: HandoffScope): void {
  try {
    rmSync(fileFor(scope), { force: true });
  } catch {}
}

/** Remove every stored handoff: part of the action that clears the chats and
 *  their journals (J13). */
export function clearHandoffs(): void {
  try {
    rmSync(handoffsDir(), { recursive: true, force: true });
  } catch {}
}

// ---------------------------------------------------------------------------
// The adapter: engine history to HandoffTurns
// ---------------------------------------------------------------------------

/** The JSON-in-text bridge's observation frame (loop.ts pushObservation). */
const TEXT_OBSERVATION = /^\[[^\]\n]+ result\]\n/;

/** Prompts the harness itself writes as user turns (repair, verify retry,
 *  the no-write nudges).
 *  They are not the person's ask, so they never become the Goal. */
const HARNESS_PROMPT =
  /^(\[(verify result|tool-call problems)\]|Your last tool call could not be used\.|You wrote code in your reply but changed no file\.|Your edit did not apply and nothing changed)/;

/** The compaction summary's frame (context/compaction.ts). The summary is
 *  kept, as an assistant turn: it is the model's account of the folded turns,
 *  not the person's ask. */
const SUMMARY_FRAME = /^\[Conversation so far[^\]\n]*\]\n/;

/** The most paths one call contributes. */
const PATHS_PER_CALL = 8;

function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text!)
    .join('\n');
}

/** The paths a tool call names in its arguments (`path`, `file`, `paths`,
 *  `from`, `to`, and the like). */
function callPaths(args: Record<string, unknown> | undefined, argsText: string): string[] {
  let parsed = args;
  if (!parsed) {
    try {
      const v = JSON.parse(argsText) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) parsed = v as Record<string, unknown>;
    } catch {}
  }
  if (!parsed) return [];
  const out: string[] = [];
  const add = (v: unknown): void => {
    if (typeof v === 'string' && v.trim() && v.length <= 512 && !v.includes('\n')) {
      if (!out.includes(v)) out.push(v);
    }
  };
  for (const [key, value] of Object.entries(parsed)) {
    if (!/^(path|paths|file|files|filePath|from|to|target)$/i.test(key)) continue;
    if (Array.isArray(value)) value.forEach(add);
    else add(value);
    if (out.length >= PATHS_PER_CALL) break;
  }
  return out.slice(0, PATHS_PER_CALL);
}

/**
 * The engine history as HandoffTurns, in order. Never thinking (split out of
 * the text and dropped; `thinkingBlocks` are never read), never a local-only
 * message, never the system prompt, never a tool result's content.
 */
export function handoffTurnsFromHistory(history: readonly ChatMessage[]): HandoffTurn[] {
  const turns: HandoffTurn[] = [];
  for (const m of history) {
    if (m.role === 'system' || m.localOnly) continue;
    if (m.role === 'tool') continue;
    const text = textOf(m.content);
    if (m.role === 'user' && SUMMARY_FRAME.test(text)) {
      const summary = text.replace(SUMMARY_FRAME, '').trim();
      if (summary) turns.push({ role: 'assistant', text: summary });
      continue;
    }
    if (m.role === 'user') {
      if (TEXT_OBSERVATION.test(text) || HARNESS_PROMPT.test(text)) continue;
      const visible = splitThinkTags(text).text.trim();
      if (visible) turns.push({ role: 'user', text: visible });
      continue;
    }
    const visible = splitThinkTags(text).text.trim();
    if (visible) turns.push({ role: 'assistant', text: visible });
    for (const call of m.toolCalls ?? []) {
      const paths = callPaths(call.args, call.argsText);
      turns.push({ role: 'tool', text: '', tool: call.name, ...(paths.length ? { paths } : {}) });
    }
  }
  return turns;
}
