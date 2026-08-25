// One place names the out-of-usage fallback line, so the cloud driver that emits
// it and the transcript affordance that offers the one-tap jump to a local model
// agree on the exact words. A leaf module on purpose: the transcript can read it
// without pulling in the SDK-heavy driver.
export const SWITCH_TO_LOCAL = 'Switch to a local model to keep going.';

/** True when a stopped message is the out-of-usage case that offers local. */
export function offersLocalFallback(message: string): boolean {
  return message.includes(SWITCH_TO_LOCAL);
}
