// The Anthropic SDK (about 140 KB minified) loads on the first request a
// Claude seat or an Anthropic-format address makes, never at launch
// (scripts/tier-bundle.mjs holds what a launch may load).
import type AnthropicSdk from '@anthropic-ai/sdk';

type Sdk = typeof AnthropicSdk;

let loading: Promise<Sdk> | undefined;
let loaded: Sdk | undefined;

/** The SDK's client class, imported the first time a seat needs it. A failed
 *  import is tried again on the next call. */
export function loadAnthropic(): Promise<Sdk> {
  loading ??= import('@anthropic-ai/sdk').then(
    (m) => (loaded = m.default),
    (err: unknown) => {
      loading = undefined;
      throw err;
    },
  );
  return loading;
}

/** The client class once `loadAnthropic` has resolved, else undefined. An
 *  error the SDK threw cannot exist before then, so an `instanceof` check
 *  that finds nothing loaded is rightly false. */
export function loadedAnthropic(): Sdk | undefined {
  return loaded;
}
