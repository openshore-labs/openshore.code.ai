// What a test needs to run the same on Linux, macOS and Windows (the
// windows-latest CI job, tech review ruling 10). Each helper names the one difference
// between the machines it covers, so a test says what it means and never
// loosens what it checks.
import { rmSync } from 'node:fs';

/** HOME and USERPROFILE as they were before a test moved home. */
export interface SavedHome {
  HOME: string | undefined;
  USERPROFILE: string | undefined;
}

/** The home variables as they are now, to put back after the test. */
export function saveHome(): SavedHome {
  return { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
}

/** Point the person's home at `dir`. The engine finds home with
 *  os.homedir(), which reads HOME on Linux and macOS but USERPROFILE on
 *  Windows, so a test that moves home moves both. */
export function setHome(dir: string): void {
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
}

/** Put the home variables back exactly: one that was unset is unset again,
 *  never the string "undefined". */
export function restoreHome(saved: SavedHome): void {
  for (const name of ['HOME', 'USERPROFILE'] as const) {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

/** The codes Windows answers a folder removal with while something still
 *  holds the folder or a file in it. */
const HELD = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES']);

/** Remove a test's temp folder. Windows refuses to remove a folder while a
 *  process has it as its working folder or holds a file in it open, and a
 *  program that was just stopped (or the short git status a session runs when
 *  a task ends) lets go a moment later. So the removal is tried again, for up
 *  to `waitMs` (inside vitest's ten-second hook limit), while the answer is one
 *  of those codes; any other error, or one that outlasts the wait, still fails
 *  the test. Linux and macOS remove it on the first try. */
export async function removeTempDir(dir: string, waitMs = 5_000): Promise<void> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      // Node's own retries cover a folder whose files were just let go; they
      // do not start when the first answer is EBUSY, which the loop covers.
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!HELD.has(code) || Date.now() > deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/** Whether a listen failed because the port cannot be had: taken by another
 *  program (EADDRINUSE), or, on Windows, inside a range the system reserved
 *  for itself (EACCES). Either way a test picks another port. */
export function portUnavailable(err: unknown): boolean {
  return /EADDRINUSE|EACCES/.test(String(err));
}
