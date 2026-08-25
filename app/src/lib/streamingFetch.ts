// The one fetch that must NOT go through Capacitor's native HTTP.
//
// When `CapacitorHttp` is enabled (it is, so the CORS-blocked JSON calls that
// web search and Google Drive make can reach their servers), the iOS/Android
// native bridge replaces `window.fetch` with a version that buffers the whole
// response body before resolving. That is correct for those JSON calls, but it
// silently breaks every STREAMING path: the desktop daemon's Server-Sent-Event
// stream (`res.body.getReader()`) never resolves, and the Anthropic SDK's
// incremental `messages.stream` hangs. On a real phone that turns the flagship
// remote-coding session, and any cloud chat, into a spinner that never fills.
//
// The native bridge always stashes the original, unpatched WebView fetch as
// `window.CapacitorWebFetch` (it assigns it BEFORE deciding whether to patch),
// so streaming paths can reach past the patch by name. WKWebView has supported
// streamed fetch response bodies since iOS 14.5, so the original fetch streams
// correctly; only the native replacement does not.
//
// Everywhere `CapacitorWebFetch` is absent (the web build, dev, Electron, or an
// iOS build with native HTTP turned off) this is exactly `window.fetch`, so
// off-device behavior is unchanged. The failure mode is therefore safe: the
// worst case is that a streaming call behaves as it does today, never that a
// working non-streaming call breaks.
type FetchFn = typeof fetch;

interface MaybePatchedGlobal {
  CapacitorWebFetch?: FetchFn;
  fetch: FetchFn;
}

/** The unpatched WebView fetch when Capacitor patched the global, else the
 *  ordinary `fetch`. Use this for SSE streams and the Anthropic SDK; use the
 *  ordinary `fetch` or `nativeFetch` everywhere else. */
export function streamingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const g = globalThis as unknown as MaybePatchedGlobal;
  const impl = g.CapacitorWebFetch ?? g.fetch;
  // Call unbound: the WebView fetch does not depend on its receiver. Guarding
  // the `this` binding to `undefined` matches how the native bridge itself
  // stores and later invokes the reference.
  return impl(input, init);
}
