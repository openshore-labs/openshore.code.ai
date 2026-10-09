// Keys on your server (2026-10-09): the one namespace a provider's key may be
// stored under and named from config. A provider id is short, lower case and
// plain, and its key lives at `provider-key:<id>` in the credential store, so
// an endpoint's `apiKeyRef` can never name the Claude key, the GitHub token,
// the data key or a session's keys. Pure, so the protocol can carry it.

/** A provider id the key routes and `osc key` accept. */
export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** The credential name a provider's key lives under, and the only shape an
 *  endpoint's `apiKeyRef` may take. */
export const PROVIDER_KEY_REF_PATTERN = /^provider-key:[a-z0-9][a-z0-9-]{0,40}$/;

export function isProviderId(id: unknown): id is string {
  return typeof id === 'string' && PROVIDER_ID_PATTERN.test(id);
}

export function isProviderKeyRef(ref: unknown): ref is string {
  return typeof ref === 'string' && PROVIDER_KEY_REF_PATTERN.test(ref);
}

/** The credential name for a provider id, e.g. "provider-key:openrouter". */
export function providerKeyRef(id: string): string {
  return `provider-key:${id}`;
}
