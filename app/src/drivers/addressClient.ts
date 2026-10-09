// The Anthropic SDK client for an address you connect in the Anthropic format
// (bring your own keys, Part 2, 2026-10-09). It sends the address your key, or
// none for a keyless server on your own network, and nothing of Claude's: no
// workspace header, no retries, no credential the SDK could find for itself,
// and none of the SDK's own client and platform headers, which the
// OpenAI-format path never sends either. Kept apart from stackDriver so a test
// can build it on the real SDK and read the headers it actually sends.
// Test: app/test/byomAnthropicHeaders.test.ts.
import Anthropic from '@anthropic-ai/sdk';
import { normalizeAnthropicBase } from '../lib/byom.js';

/** What an address is not sent: the SDK's version, the browser and its
 *  version, a retry count and timeout, the helper it was called through
 *  (set per request, so only the fetch can take it off), and any bearer a
 *  credential could add (the key goes as `x-api-key` alone). What still goes:
 *  `accept`, `content-type`, `anthropic-version`, the key, and
 *  `anthropic-dangerous-direct-browser-access`, which Anthropic's own API
 *  asks of a browser and which names nothing of the person. */
export const ADDRESS_DROPPED_HEADERS = [
  'user-agent',
  'x-stainless-lang',
  'x-stainless-package-version',
  'x-stainless-os',
  'x-stainless-arch',
  'x-stainless-runtime',
  'x-stainless-runtime-version',
  'x-stainless-retry-count',
  'x-stainless-timeout',
  'x-stainless-helper-method',
  'authorization',
] as const;

/** The SDK with no credential chain of its own: with no key it would look
 *  for one on the machine (a profile, an environment token) and could add it
 *  as a bearer. An address gets the person's key or nothing. */
class AddressAnthropic extends Anthropic {
  protected override _shouldResolveDefaultCredentials(): boolean {
    return false;
  }
}

/** `transport` with the dropped headers taken off every request, whatever
 *  the SDK set them from. */
export function addressFetch(transport: typeof fetch): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    for (const name of ADDRESS_DROPPED_HEADERS) headers.delete(name);
    return transport(input, { ...init, headers });
  };
}

/** A client for one address, on `transport` (the Claude path's streaming
 *  fetch in the app). */
export function addressAnthropic(o: {
  baseUrl: string;
  key: string | null;
  transport: typeof fetch;
}): Anthropic {
  return new AddressAnthropic({
    apiKey: o.key,
    authToken: null,
    baseURL: normalizeAnthropicBase(o.baseUrl),
    dangerouslyAllowBrowser: true,
    fetch: addressFetch(o.transport),
    maxRetries: 0,
    // A keyless server: the request goes without a key, said outright, since
    // the SDK otherwise refuses a request that carries neither.
    ...(o.key ? {} : { defaultHeaders: { 'x-api-key': null } }),
  });
}
