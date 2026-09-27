// The Node half of the harness's verify step: run the project's own check
// command and report verified, not verified, or skipped. The pure shapes and
// the retry prompt stay in harness/verify.ts, so the harness core imports no
// Node built-in (tenet 5, guarded by harnessPurity.test.ts).
//
// Safety: this runs a configured shell command without an approval prompt, so
// the loop only calls it where shell may auto-run at all (the local-interactive
// profile; see maybeVerify in loop.ts). A project config that sets a command it
// should not is contained by that gate, the same way hooks are.
import { execSync } from 'node:child_process';
import type { VerifyConfig, VerifyResult } from '../../harness/verify.js';

const MAX_DETAIL = 2000;

function tail(text: string): string {
  const t = text.trimEnd();
  return t.length > MAX_DETAIL ? `... ${t.slice(-MAX_DETAIL)}` : t;
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
