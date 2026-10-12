// The team vault's live refresh (Vault M2 2.7, tech review G6): while a team note is
// open, the page is visible, and the device is online, its head is checked
// every 30 s with a little jitter, so teammates' saves reach an open note
// without a reopen. Errors back off to five minutes and reset on success.
// Pure, so the schedule is testable without timers.

/** The wait before the next check after `failures` checks in a row failed:
 *  30, 60, 120, 240 s, then 300 s for good, each within 10% either way. */
export const VAULT_POLL_BACKOFF_S = [30, 60, 120, 240, 300] as const;

export function vaultPollDelayMs(failures: number, rand = Math.random()): number {
  const step =
    VAULT_POLL_BACKOFF_S[Math.min(Math.max(failures, 0), VAULT_POLL_BACKOFF_S.length - 1)]!;
  return Math.round(step * 1000 * (0.9 + 0.2 * rand));
}
