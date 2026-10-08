// What a person reads when a model download fails with the network up
// (Desktop Offline follow-up, 2026-10-08): what failed in a few words and the
// way on, never the model server's own error. The network-down line stays
// its own (install.ts OFFLINE_DOWNLOAD). Pure on purpose: the app names
// DeepBlue through the same lines (os-code/protocol), so the stop card, the
// First Seat and Settings say what the engine says.

/** Why a pull did not finish. `offline` is this computer with no network;
 *  the rest happen with the network up. */
export type PullFailure = 'offline' | 'not-found' | 'disk' | 'unreachable' | 'stopped' | 'failed';

/** What a pull answers: a plain line, and why when it failed. */
export interface PullResult {
  ok: boolean;
  detail: string;
  reason?: PullFailure;
}

/** Why a pull failed, from the model server's own error text. Anything it
 *  does not recognise is a plain failure, and Try again is the way on. */
export function pullFailure(cause: string): Exclude<PullFailure, 'offline' | 'stopped'> {
  if (/no space left|not enough (disk )?space|disk (is )?full|ENOSPC/i.test(cause)) return 'disk';
  if (
    /no such host|dial tcp|i\/o timeout|network is unreachable|connection refused|tls handshake|context deadline exceeded|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH/i.test(
      cause,
    )
  ) {
    return 'unreachable';
  }
  if (/file does not exist|not found|manifest unknown|no such model/i.test(cause)) {
    return 'not-found';
  }
  return 'failed';
}

/** The line a failed pull leaves, naming the model and the way on. Engine
 *  words say "your computer", because a paired phone shows them too. */
export function pullFailedLine(name: string, reason: Exclude<PullFailure, 'offline'>): string {
  switch (reason) {
    case 'not-found':
      return `Ollama has no model called ${name}. Check the name, then try again.`;
    case 'disk':
      return `Not enough disk space on your computer for ${name}. Free some space, then try again.`;
    case 'unreachable':
      return 'Could not reach the Ollama library from your computer. Check its internet connection, then try again.';
    case 'stopped':
      return `The download of ${name} stopped partway. Try again.`;
    case 'failed':
      return `Could not download ${name}. Try again.`;
  }
}
