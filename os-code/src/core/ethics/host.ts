// Wiring the ethics layer into the desktop engine.
//
// The layer itself is pure and knows nothing about disks or accounts. This file
// is the one place that connects it to the machine: consents come from the
// on-device store, blocks are journaled, and Tier 1 blocks prepare a report for
// the operator instead of pretending one was filed.

import type { GuardContext } from './guardedProvider.js';
import type { ScreenResult } from './chokepoint.js';
import { readConsents, writeConsent, writeRecord, writeReport } from './journal.js';
import { prepareReport } from './enforcement.js';
import { logger } from '../../util/log.js';

const log = logger('ethics');

export interface EngineEthicsOptions {
  /** Told about every block, so the session can show it in the transcript. */
  onBlock?: (result: ScreenResult) => void;
}

/**
 * The GuardContext the engine uses. Reads consents fresh on every call, so an
 * assertion made in this session applies to the next turn without a restart.
 */
export function engineEthicsContext(options: EngineEthicsOptions = {}): GuardContext {
  return {
    consents: () => readConsents(),
    onAssertion: (assertion) => {
      writeConsent(assertion);
      log.info('authorization assertion recorded', { subject: assertion.subject });
    },
    onBlock: (result) => {
      if (result.record) writeRecord(result.record);
      // A Tier 1 block owes a report where law requires or permits one. The
      // report is prepared and stored for the operator. It is NOT submitted,
      // and the stored status says exactly that.
      const category = result.decision.category;
      if (
        result.record &&
        (category === 'csam' || category === 'ncii' || category === 'weapons-uplift')
      ) {
        void prepareReport({
          category,
          // The desktop engine runs as one person on their own machine and
          // holds no account id, so the record hash is the identifier here. The
          // app posts the account-scoped version of the same event.
          accountId: 'local-device',
          requestHash: result.record.requestHash,
          occurredAt: result.record.timestamp,
        })
          .then((outcome) => {
            writeReport({ ...outcome.report, status: outcome.status, detail: outcome.detail });
          })
          .catch((err: unknown) => {
            log.warn('could not prepare the report', { err: String(err) });
          });
      }
      options.onBlock?.(result);
    },
  };
}
