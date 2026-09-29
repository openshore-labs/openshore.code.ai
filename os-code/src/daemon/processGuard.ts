// Process-level guards (H1). One stray promise rejection used to end the whole
// process: `osc serve` exited, and inside the desktop app the engine, the
// daemon, and every paired phone's session went down with it. These handlers
// log the fault and keep the process up, and tell each session that is
// working right now, once, in its own transcript, so a stalled step has a
// reason and a way on (Stop, then send again).
//
// Installed once per process by its host (commands/serve.ts for `osc serve`,
// the Electron main process for the desktop). A second install is a no-op.
import { announceProcessFault } from './session.js';
import { logger } from '../util/log.js';

const log = logger('process');

export type ProcessFaultKind = 'unhandledRejection' | 'uncaughtException';

let installed:
  | {
      onRejection: (reason: unknown) => void;
      onException: (err: Error) => void;
    }
  | undefined;

function describe(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack };
  return { message: String(err) };
}

/**
 * Keep this process up through a stray fault. `where` names the host in the
 * log line; `onFault` lets the host add its own status (the desktop tells its
 * window) after the log and the in-session notice.
 */
export function installProcessGuards(opts: {
  where: string;
  onFault?: (kind: ProcessFaultKind, err: unknown) => void;
}): () => void {
  if (installed) return () => {};
  const handle = (kind: ProcessFaultKind, err: unknown): void => {
    try {
      log.error('a fault was caught and the process kept running', {
        where: opts.where,
        kind,
        ...describe(err),
      });
    } catch {
      // Logging must never throw from here.
    }
    try {
      announceProcessFault();
    } catch {
      // The notice is a courtesy.
    }
    try {
      opts.onFault?.(kind, err);
    } catch {
      // The host's own status is a courtesy too.
    }
  };
  const handlers = {
    onRejection: (reason: unknown) => handle('unhandledRejection', reason),
    onException: (err: Error) => handle('uncaughtException', err),
  };
  process.on('unhandledRejection', handlers.onRejection);
  process.on('uncaughtException', handlers.onException);
  installed = handlers;
  return () => {
    process.off('unhandledRejection', handlers.onRejection);
    process.off('uncaughtException', handlers.onException);
    if (installed === handlers) installed = undefined;
  };
}
