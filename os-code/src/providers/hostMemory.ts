// This computer's memory, in whole GB, read once per process (Vault M4, tech review
// I1). The served window (`servedContextTokens` in harness/profile.ts) keys
// its ceiling off this number, and a changed `num_ctx` makes Ollama reload the
// model, so the number must not drift between requests: it is read the first
// time it is asked for and kept. No probe, no spawnSync. It is the same
// rounding as `hardwareFacts().ramGB`, so the app can compute the same window.
import { totalmem } from 'node:os';

let cached: number | undefined;

/** Total memory in GB, `Math.round(totalmem() / 1024 ** 3)`, fixed per process. */
export function hostRamGB(): number {
  if (cached === undefined) cached = Math.round(totalmem() / 1024 ** 3);
  return cached;
}
