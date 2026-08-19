// A per-key async mutex. The daemon is single-process but async, so two
// /outbox/apply calls for the same repo could interleave their awaits and
// corrupt the temporary-index dance. Serializing per repo path keeps each
// apply atomic, which is exactly what the client's ULID-order and
// stop-on-conflict rules assume.
const chains = new Map<string, Promise<unknown>>();

export async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  // Swallow the prior result/error so one caller's failure never rejects the
  // next in line; each caller still gets its own fn()'s result or error.
  const run = prev.then(
    () => fn(),
    () => fn(),
  );
  chains.set(key, run);
  try {
    return await run;
  } finally {
    // If nothing else queued behind us, drop the entry so the map stays small.
    if (chains.get(key) === run) chains.delete(key);
  }
}
