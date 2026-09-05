// The on-device record of what the ethics layer did.
//
// Three small files under ~/.os-code/ethics/:
//   records.jsonl    one line per block, append only
//   consents.json    authorization assertions, per subject
//   reports.jsonl    Tier 1 reports prepared for an operator
//
// What is written is deliberately thin: a category, a tier, a timestamp, a
// hash, and the signal names. The offending text is never written here, and
// there is no code path in this file that could write it, because the record
// type it takes does not carry it.
//
// This is the desktop half of the audit trail. The app posts the same record
// shape to the account (app/src/lib/ethics.ts), so a person's history is
// complete whichever device they used. A local-model session writes here and
// nowhere else, which is what keeps "local stays local" true of the guardrail
// itself: no prompt, and no derivative of a prompt beyond its hash, leaves the
// machine because of screening.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { oscHome } from '../../config/load.js';
import type { EthicsRecord } from './chokepoint.js';
import type { ConsentAssertion } from './classify.js';
import type { AbuseReport } from './enforcement.js';
import { logger } from '../../util/log.js';

const log = logger('ethics');

function ethicsDir(): string {
  const dir = join(oscHome(), 'ethics');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function recordsPath(): string {
  return join(ethicsDir(), 'records.jsonl');
}

function consentsPath(): string {
  return join(ethicsDir(), 'consents.json');
}

function reportsPath(): string {
  return join(ethicsDir(), 'reports.jsonl');
}

/** Append one record. Never throws: a full disk must not turn a block into a
 *  pass, and the block has already happened by the time this runs. */
export function writeRecord(record: EthicsRecord): void {
  try {
    appendFileSync(recordsPath(), `${JSON.stringify(record)}\n`, 'utf8');
  } catch (err) {
    log.warn('could not write the ethics record', { err: String(err) });
  }
}

/** Every record on this machine, oldest first. */
export function readRecords(): EthicsRecord[] {
  try {
    const raw = readFileSync(recordsPath(), 'utf8');
    return raw
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as EthicsRecord;
        } catch {
          return undefined;
        }
      })
      .filter((r): r is EthicsRecord => Boolean(r));
  } catch {
    return [];
  }
}

/** The authorization assertions on file. */
export function readConsents(): ConsentAssertion[] {
  try {
    const raw = readFileSync(consentsPath(), 'utf8');
    const parsed = JSON.parse(raw) as ConsentAssertion[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Record an assertion. Replaces any earlier one for the same subject, so the
 *  file holds the current claim and its timestamp, not a pile of duplicates. */
export function writeConsent(assertion: ConsentAssertion): void {
  try {
    const existing = readConsents().filter(
      (c) => c.subject.trim().toLowerCase() !== assertion.subject.trim().toLowerCase(),
    );
    writeFileSync(consentsPath(), JSON.stringify([...existing, assertion], null, 2), 'utf8');
  } catch (err) {
    log.warn('could not record the authorization assertion', { err: String(err) });
  }
}

/** Store a prepared report for the operator. Storing is not submitting, and
 *  nothing in this file claims otherwise. */
export function writeReport(report: AbuseReport & { status: string; detail: string }): void {
  try {
    appendFileSync(reportsPath(), `${JSON.stringify(report)}\n`, 'utf8');
  } catch (err) {
    log.warn('could not store the prepared report', { err: String(err) });
  }
}
