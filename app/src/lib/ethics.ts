// The app's side of the ethics layer.
//
// The rules themselves are NOT here. They live in the engine's pure modules and
// arrive through 'os-code/protocol', so the phone, the desktop shell, and the
// engine all screen with the same code. That is deliberate: two
// implementations would drift, and the one that drifted would be the one
// nobody was testing.
//
// What is here is the wiring: where consents are kept on this device, where a
// block is recorded, and how a record reaches the account when the person is
// signed in.
//
// PRIVACY POSTURE, STATED PRECISELY
//
// Screening itself never touches the network. The classifier is local, so a
// prompt to an on-device model stays on the device even though it was screened,
// and "local stays local" is not quietly broken by the filter.
//
// A BLOCK is recorded to the account when the person is signed in, because
// enforcement has to survive a reinstall. What travels is the record and
// nothing else: a category, a tier, a timestamp, a SHA-256 of the request, and
// the model path. The prompt never travels. When the person is signed out, or
// the account backend is not configured on this build, the record stays on the
// device and nothing is sent at all.

import {
  EthicsGuard,
  evaluateEnforcement,
  type ConsentAssertion,
  type EthicsRecord,
  type ModelPath,
  type ScreenResult,
} from 'os-code/protocol';
import { storeGetJson, storeSetJson } from './platform.js';
import { insert, isConfigured, rpc } from './supabase.js';
import { freshSession, loadStoredSession } from './authSession.js';

const CONSENTS_KEY = 'oscode.ethics.consents.v1';
const RECORDS_KEY = 'oscode.ethics.records.v1';

/** How many records are kept on the device. Enough for the ladder to work
 *  offline, small enough that it never becomes a store of its own. */
const LOCAL_RECORD_CAP = 500;

let consentCache: ConsentAssertion[] = [];
let recordCache: EthicsRecord[] = [];
let loaded = false;

/** Read the device's consent and record stores once, at first use. */
export async function loadEthicsState(): Promise<void> {
  if (loaded) return;
  consentCache = (await storeGetJson<ConsentAssertion[]>(CONSENTS_KEY)) ?? [];
  recordCache = (await storeGetJson<EthicsRecord[]>(RECORDS_KEY)) ?? [];
  loaded = true;
}

export function knownConsents(): ConsentAssertion[] {
  return consentCache;
}

export function knownRecords(): EthicsRecord[] {
  return recordCache;
}

/** Record an authorization assertion, replacing any earlier one for the same
 *  subject so the store holds the current claim rather than a pile. */
export async function rememberConsent(assertion: ConsentAssertion): Promise<void> {
  await loadEthicsState();
  const subject = assertion.subject.trim().toLowerCase();
  consentCache = [
    ...consentCache.filter((c) => c.subject.trim().toLowerCase() !== subject),
    assertion,
  ];
  await storeSetJson(CONSENTS_KEY, consentCache);
}

/** Forget an assertion. The person can withdraw one at any time. */
export async function forgetConsent(subject: string): Promise<void> {
  await loadEthicsState();
  const wanted = subject.trim().toLowerCase();
  consentCache = consentCache.filter((c) => c.subject.trim().toLowerCase() !== wanted);
  await storeSetJson(CONSENTS_KEY, consentCache);
}

/**
 * Store a record on the device and, when signed in, on the account. Never
 * throws: a block has already happened by the time this runs, and a failure to
 * write the paperwork must not undo it.
 */
export async function recordEthicsEvent(record: EthicsRecord): Promise<void> {
  try {
    await loadEthicsState();
    recordCache = [...recordCache, record].slice(-LOCAL_RECORD_CAP);
    await storeSetJson(RECORDS_KEY, recordCache);
  } catch {
    // Device storage is full or unavailable. The block still stands.
  }
  await postRecord(record);
}

/**
 * Send one record to the account, then run the enforcement ladder.
 *
 * The ladder is evaluated from the account's history, and its outcome is
 * recorded server-side. A termination is where the IP-ban PROPOSAL is created,
 * and it is only ever a proposal: see the migration, which has no function that
 * applies one.
 *
 * Silent no-op when signed out or when the account backend is not configured on
 * this build. In that case the block still happened and the record still lives
 * on the device: enforcement degrades, screening does not.
 */
async function postRecord(record: EthicsRecord): Promise<void> {
  try {
    if (!isConfigured()) return;
    const stored = await loadStoredSession();
    if (!stored) return;
    const session = await freshSession(stored);
    await insert('guardrail_events', session.accessToken, {
      category: record.category,
      tier: record.tier,
      occurred_at: record.timestamp,
      request_hash: record.requestHash,
      model_path: record.modelPath,
      action: record.action,
      side: record.side,
      signals: record.signals,
      subject: record.subject ?? null,
    });
    if (record.action !== 'blocked') return;
    // A failed check is the layer failing closed, not a person misbehaving, so
    // it never escalates. evaluateEnforcement filters it out; this returns
    // early so a check failure does not even ask.
    if (record.category === 'check-failed') return;

    const outcome = evaluateEnforcement(recordCache);
    await rpc('record_enforcement', session.accessToken, {
      p_level: outcome.level,
      p_action: outcome.action,
      p_reason: outcome.reason,
    });
    if (outcome.reportRequired && record.tier === 1) {
      await rpc('queue_abuse_report', session.accessToken, {
        p_category: record.category,
        p_request_hash: record.requestHash,
        p_occurred_at: record.timestamp,
      });
    }
  } catch {
    // Offline, or the account rejected it. The device copy is the fallback, and
    // the block does not depend on this call.
  }
}

/** The enforcement standing of this account, from what this device knows. */
export function enforcementStanding(): ReturnType<typeof evaluateEnforcement> {
  return evaluateEnforcement(recordCache);
}

let guard: EthicsGuard | undefined;

/**
 * The app's single guard. Built once, holds no configuration, and there is no
 * argument anywhere in this module that turns screening off.
 */
export function appGuard(): EthicsGuard {
  if (!guard) {
    guard = new EthicsGuard({
      onRecord: (record) => {
        void recordEthicsEvent(record);
      },
    });
  }
  return guard;
}

export interface AppScreenResult extends ScreenResult {
  blocked: boolean;
}

/** Screen a prompt before any model on any path sees it. */
export async function screenPrompt(text: string, modelPath: ModelPath): Promise<AppScreenResult> {
  await loadEthicsState();
  const result = await appGuard().screenInput({
    text,
    modelPath,
    consents: consentCache,
  });
  if (result.newAssertion) await rememberConsent(result.newAssertion);
  return { ...result, blocked: result.decision.action === 'block' };
}

/** Screen an answer before any person sees it. */
export async function screenAnswer(text: string, modelPath: ModelPath): Promise<AppScreenResult> {
  await loadEthicsState();
  const result = await appGuard().screenOutput({
    text,
    modelPath,
    consents: consentCache,
  });
  return { ...result, blocked: result.decision.action === 'block' };
}
