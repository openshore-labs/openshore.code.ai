// A small HTTP shim for the calls that a WebView cannot make directly. Third
// party APIs like Codemagic, OpenAI, and Gemini send no CORS headers, so a plain
// fetch from capacitor://localhost (iOS) or file:// (Electron) is blocked. This
// routes those requests through the native layer instead: CapacitorHttp on iOS,
// an IPC handler on Electron, and a plain fetch on the web (dev), all behind one
// fetch-like adapter so call sites barely change.
//
// It is non-streaming by design (CapacitorHttp buffers). Streaming paths, the
// Anthropic SDK and the desktop daemon SSE, must NOT go through here; they have
// their own CORS story and would lose streaming.
import { CapacitorHttp } from '@capacitor/core';
import { platform } from './platform.js';
import { bridge } from './electronBridge.js';

export interface NativeRequest {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** Request body, already serialized (e.g. JSON.stringify). */
  body?: string;
  /** How to read the response. Defaults to json. */
  responseType?: 'json' | 'text';
}

export interface NativeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

function hasJsonContentType(headers?: Record<string, string>): boolean {
  if (!headers) return false;
  return Object.entries(headers).some(
    ([k, v]) => k.toLowerCase() === 'content-type' && /json/i.test(v),
  );
}

export async function nativeFetch(url: string, req: NativeRequest = {}): Promise<NativeResponse> {
  const method = req.method ?? 'GET';

  if (platform() === 'ios') {
    // Capacitor serializes a JSON body from an object; hand it one when the
    // caller declared JSON, otherwise pass the raw string through.
    let data: unknown = req.body;
    if (req.body && hasJsonContentType(req.headers)) {
      try {
        data = JSON.parse(req.body);
      } catch {
        data = req.body;
      }
    }
    const res = await CapacitorHttp.request({
      url,
      method,
      headers: req.headers,
      data: method === 'POST' ? data : undefined,
      responseType: req.responseType ?? 'json',
    });
    const ok = res.status >= 200 && res.status < 300;
    return {
      ok,
      status: res.status,
      json: async () => (typeof res.data === 'string' ? JSON.parse(res.data) : res.data),
      text: async () => (typeof res.data === 'string' ? res.data : JSON.stringify(res.data)),
    };
  }

  if (platform() === 'electron') {
    const b = bridge();
    if (b) {
      const res = await b.httpFetch({ url, method, headers: req.headers, body: req.body });
      return {
        ok: res.ok,
        status: res.status,
        json: async () => JSON.parse(res.body),
        text: async () => res.body,
      };
    }
    // Fall through to plain fetch if the bridge is somehow absent.
  }

  const res = await fetch(url, {
    method,
    headers: req.headers,
    body: method === 'POST' ? req.body : undefined,
  });
  return {
    ok: res.ok,
    status: res.status,
    json: () => res.json(),
    text: () => res.text(),
  };
}
