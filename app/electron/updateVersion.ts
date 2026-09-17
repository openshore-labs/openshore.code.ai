// Pure helper for the desktop update check (main.ts), pinned by a test the
// same way lifecycle.ts's helpers are: a plain string compare would treat
// "0.1.10" as older than "0.1.9" ("1" < "9"), which is exactly backwards.

/** True when `latest` is a newer dotted version than `current`. Missing
 *  segments compare as 0, so "1.2" and "1.2.0" are equal. */
export function versionIsNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map((n) => parseInt(n, 10) || 0);
  const b = current.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}
