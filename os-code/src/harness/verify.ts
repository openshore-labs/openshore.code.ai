// The premium harness: verify before it claims done (tenet 3, and the
// interaction model's "verify, then report plainly"). After the agent finishes
// a task that changed files, the harness runs the project's own check command
// (its tests, its typecheck, whatever the person configured) and reports
// verified, not verified, or skipped, so nobody has to read the transcript to
// learn whether the work actually holds. This is the signature the model does
// not have to remember to do.
//
// Safety: this runs a configured shell command without an approval prompt, so
// the loop only calls it where shell may auto-run at all (the local-interactive
// profile; see maybeVerify in loop.ts). A project config that sets a command it
// should not is contained by that gate, the same way hooks are.
import { execSync } from 'node:child_process';

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

const MAX_DETAIL = 2000;

function tail(text: string): string {
  const t = text.trimEnd();
  return t.length > MAX_DETAIL ? `... ${t.slice(-MAX_DETAIL)}` : t;
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

/** Run the configured check command in `cwd`. Never throws: a non-zero exit is
 *  a "not verified" result, not an error. */
export function runVerify(cwd: string, config: VerifyConfig | undefined): VerifyResult {
  const command = config?.command?.trim();
  if (!command) return { ran: false, passed: false, summary: 'No verify command configured.' };
  try {
    const out = execSync(command, {
      cwd,
      timeout: (config?.timeoutSeconds ?? 120) * 1000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      ran: true,
      passed: true,
      summary: `Verified: \`${command}\` passed.`,
      detail: tail(out ?? ''),
    };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const output = [e.stdout, e.stderr].filter(Boolean).join('\n') || e.message || 'command failed';
    return {
      ran: true,
      passed: false,
      summary: `Not verified: \`${command}\` did not pass.`,
      detail: tail(output),
    };
  }
}
