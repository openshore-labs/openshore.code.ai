// THE CHOKEPOINT.
//
// Every prompt that reaches a model, and every completion that comes back,
// passes through this file. There is one class, two methods, and no way around
// them that a normal code path can take: on the desktop the provider registry
// hands out only guarded providers (providers/registry.ts), and in the app
// every driver calls this module before it puts a prompt on the wire
// (app/src/lib/ethics.ts). test/ethicsNoBypass.test.ts fails the build if a new
// call site appears that does not.
//
// FIVE PROPERTIES THIS FILE IS RESPONSIBLE FOR
//
//  1. Both sides. screenInput before the model sees anything, screenOutput
//     before a person or a file sees the answer.
//  2. Model-agnostic. It takes text and a model path label. It knows nothing
//     about Anthropic, Ollama, llama.cpp, or the phone's plugin, and behaves
//     identically for all of them. A cloud provider's own policy is an extra
//     fence on top, never a substitute for this one.
//  3. Fail closed. Any throw, any timeout, any missing dependency ends as a
//     block. There is no path through this file that turns an error into a
//     pass. Degraded never means unfiltered.
//  4. Always on. Nothing here reads a config value, an environment variable,
//     or a setting. There is no argument that disables it, because there is no
//     code that would honor one.
//  5. Content minimization. The record carries a hash, a category, and signal
//     names. It never carries the text.

import { sha256 } from './hash.js';
import {
  blockedBy,
  classifyRules,
  consentCovers,
  localIntentCheck,
  permitted,
  readAssertion,
  tierOf,
  type ConsentAssertion,
  type EthicsCategory,
  type EthicsDecision,
  type IntentCheck,
} from './classify.js';
import { detectSignals, signalNames, type SignalHit } from './signals.js';

/** Which model served, or would have served, this request. */
export type ModelPath = 'local' | 'cloud';

/**
 * The structured audit record written for every block. Deliberately small: a
 * hash instead of the content, a category tag instead of a description, so
 * enforcement and any lawful report have what they need and nothing harmful is
 * retained. See docs/ethics-layer.md for the retention posture.
 */
export interface EthicsRecord {
  category: EthicsCategory;
  tier: 1 | 2 | 3;
  /** ISO 8601, UTC. */
  timestamp: string;
  /** SHA-256 of the screened text. Never reversible to the content. */
  requestHash: string;
  modelPath: ModelPath;
  action: 'blocked' | 'allowed-with-assertion';
  side: 'input' | 'output';
  /** Signal names only, as evidence for a reviewer. No matched text. */
  signals: string[];
  /** Tier 2 only: the subject named, so an assertion can be audited. */
  subject?: string;
}

export type RecordSink = (record: EthicsRecord) => void;

export interface ScreenRequest {
  /** The text to screen: a prompt, an instruction, attached text, or a completion. */
  text: string;
  modelPath: ModelPath;
  /** Authorization assertions already on file for this account. */
  consents?: ConsentAssertion[];
}

export interface ScreenResult {
  decision: EthicsDecision;
  /** Present when something was recorded. Absent for a plain Tier 3 pass. */
  record?: EthicsRecord;
  /** A new assertion read out of this text, for the caller to persist. */
  newAssertion?: ConsentAssertion;
}

export interface GuardDeps {
  /** The intent check. Defaults to the local, offline one. */
  intentCheck?: IntentCheck;
  /** Milliseconds the intent check may take before the request is blocked. */
  intentTimeoutMs?: number;
  /** Where records go. The engine writes a journal; the app posts to the account. */
  onRecord?: RecordSink;
  /** Clock seam, for tests. */
  now?: () => Date;
}

const DEFAULT_TIMEOUT_MS = 2000;

export class EthicsGuard {
  private readonly intentCheck: IntentCheck;
  private readonly timeoutMs: number;
  private readonly onRecord?: RecordSink;
  private readonly now: () => Date;

  constructor(deps: GuardDeps = {}) {
    // A missing check is not an absent check: the shipped local one is the
    // floor, and it needs no network, no model, and no configuration.
    this.intentCheck = deps.intentCheck ?? localIntentCheck;
    this.timeoutMs = deps.intentTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onRecord = deps.onRecord;
    this.now = deps.now ?? (() => new Date());
  }

  /** Screen a prompt before any model sees it. */
  async screenInput(request: ScreenRequest): Promise<ScreenResult> {
    return this.screen(request, 'input');
  }

  /** Screen a completion before any person or file sees it. */
  async screenOutput(request: ScreenRequest): Promise<ScreenResult> {
    return this.screen(request, 'output');
  }

  private async screen(request: ScreenRequest, side: 'input' | 'output'): Promise<ScreenResult> {
    // The whole body sits inside one try. Every throw below, from a bad regex
    // to a classifier that is not there, lands in the catch and becomes a
    // block. This is the fail-closed guarantee, and it is why the catch does
    // not inspect the error: no error is recoverable into a pass.
    try {
      const text = request.text ?? '';
      if (!text.trim()) {
        return { decision: permitted([]) };
      }
      const hits = detectSignals(text);
      const verdict = classifyRules(text, hits);

      if (verdict.kind === 'permitted') {
        // Tier 3. Nothing is added: no refusal, no warning, no note. The
        // request goes to the model exactly as the person wrote it.
        return { decision: permitted(hits) };
      }

      if (verdict.kind === 'block') {
        const decision = blockedBy(verdict.category, verdict.reason, hits, verdict.subject);
        return this.withRecord(decision, request, side, 'blocked');
      }

      if (verdict.kind === 'consent-required') {
        // Tier 2. An assertion in this very message counts: asserting
        // authorization is one sentence in the chat, and it is recorded
        // against the account either way.
        const fresh = side === 'input' ? readAssertion(text) : undefined;
        const consents = fresh ? [...(request.consents ?? []), fresh] : request.consents;
        const subject = verdict.subject ?? fresh?.subject;
        if (consentCovers(consents, subject)) {
          const decision: EthicsDecision = {
            action: 'allow',
            tier: 2,
            category: 'likeness',
            reason: 'authorization asserted for this subject',
            signals: signalNames(hits),
            subject,
            // The assertion is a deterrent and an accountability record, not
            // proof. Anything this produces carries provenance metadata.
            requiresProvenance: true,
          };
          const result = this.withRecord(decision, request, side, 'allowed-with-assertion');
          return fresh ? { ...result, newAssertion: fresh } : result;
        }
        const decision = blockedBy('likeness', verdict.reason, hits, subject);
        return this.withRecord(decision, request, side, 'blocked');
      }

      // A candidate the rules could not settle. The intent check resolves it,
      // under a timeout, and a failure to answer is a block.
      const confirmed = await this.runIntentCheck(text, verdict.category, hits);
      if (confirmed.confirmed) {
        const decision = blockedBy(verdict.category, confirmed.reason, hits);
        return this.withRecord(decision, request, side, 'blocked');
      }
      return { decision: permitted(hits) };
    } catch {
      // Fail closed. The request is blocked and recorded as a check failure,
      // which is NOT counted as a violation by the person: enforcement.ts
      // ignores this category when it escalates.
      const decision = failedCheck();
      return this.withRecord(decision, request, side, 'blocked');
    }
  }

  /** The intent check under a timeout. A throw or a timeout means blocked. */
  private async runIntentCheck(
    text: string,
    candidate: EthicsCategory,
    hits: SignalHit[],
  ): Promise<{ confirmed: boolean; reason: string }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('the intent check did not answer in time')),
          this.timeoutMs,
        );
      });
      // Anything thrown here, by the check or by the timeout, propagates to the
      // caller's catch and becomes a fail-closed block. It is deliberately NOT
      // caught into a "confirmed" verdict: that would record a check failure as
      // a finding against the person.
      return await Promise.race([
        this.intentCheck({ text, candidate, signals: signalNames(hits) }),
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private withRecord(
    decision: EthicsDecision,
    request: ScreenRequest,
    side: 'input' | 'output',
    action: EthicsRecord['action'],
  ): ScreenResult {
    const record: EthicsRecord = {
      category: decision.category,
      tier: decision.tier,
      timestamp: this.now().toISOString(),
      requestHash: sha256(request.text ?? ''),
      modelPath: request.modelPath,
      action,
      side,
      signals: decision.signals,
      subject: decision.subject,
    };
    try {
      this.onRecord?.(record);
    } catch {
      // A sink that throws must not turn a block into a crash, and must never
      // turn it into a pass. The decision stands; the record is best effort.
    }
    return { decision, record };
  }
}

/** The decision produced when a check could not complete. */
export function failedCheck(): EthicsDecision {
  return {
    action: 'block',
    tier: tierOf('check-failed'),
    category: 'check-failed',
    reason: 'a safety check did not complete',
    message:
      'The safety checks could not finish, so nothing was sent to the model. Try that again.',
    signals: [],
  };
}

/**
 * The single guard instance a process uses. Built once, holds no configuration,
 * and cannot be replaced with a disabled one: the setter takes dependencies
 * (a record sink, a stronger intent check), never an on/off state.
 */
let shared: EthicsGuard | undefined;

export function ethicsGuard(): EthicsGuard {
  if (!shared) shared = new EthicsGuard();
  return shared;
}

/**
 * Install the host's record sink and, optionally, a stronger intent check.
 * There is no argument here that turns screening off, by design.
 */
export function configureEthicsGuard(deps: GuardDeps): EthicsGuard {
  shared = new EthicsGuard(deps);
  return shared;
}
