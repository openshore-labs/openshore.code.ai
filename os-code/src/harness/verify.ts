// The premium harness: verify before it claims done (tenet 3, and the
// interaction model's "verify, then report plainly"). After the agent finishes
// a task that changed files, the harness runs the project's own check command
// (its tests, its typecheck, whatever the person configured) and reports
// verified, not verified, or skipped, so nobody has to read the transcript to
// learn whether the work actually holds. This is the signature the model does
// not have to remember to do.
//
// This file holds only the pure shapes and the retry prompt, so the harness
// core stays free of Node built-ins (tenet 5, guarded by harnessPurity.test.ts).
// The Node half that actually runs the command is core/agent/verifyRun.ts.

export interface VerifyConfig {
  /** The check command, e.g. "pnpm test" or "npm run typecheck". Unset means
   *  verify is off and nothing runs. */
  command?: string;
  /** Wall-clock cap in seconds. */
  timeoutSeconds?: number;
  /** How many times a failing check is handed back to the model for another
   *  go before the task reports not verified. Zero means report only. */
  maxRetries?: number;
}

export interface VerifyResult {
  /** False when no command was configured, so nothing ran. */
  ran: boolean;
  passed: boolean;
  summary: string;
  /** A tail of the command output, for the transcript detail fold. */
  detail?: string;
}

/** The observation the loop hands back to the model when verify fails and a
 *  retry remains. Coding has an oracle, so the failure itself is the best
 *  instruction: the exact output, then one plain ask. The model is told which
 *  go this is so it does not thrash, and told not to claim a pass it did not
 *  earn (the honesty bar). */
export function verifyRetryPrompt(result: VerifyResult, round: number, maxRetries: number): string {
  const output = result.detail?.trim() ? result.detail.trim() : '(the command produced no output)';
  return [
    `[verify result]`,
    result.summary,
    `Output tail:`,
    output,
    '',
    `Fix the cause (retry ${round} of ${maxRetries}). Inspect the failing output, make the smallest change that makes the check pass, and only then answer again. Do not answer without changing something, and do not claim the check passes; the harness runs it and reports the result.`,
  ].join('\n');
}
