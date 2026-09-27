// Bring Your Own Model (BYOM): connect a model YOU control, by pointing OS
// Code at any OpenAI-compatible endpoint (a self-hosted vLLM or Ollama server,
// a fine-tune behind your own gateway, another provider's API). It rides the
// exact same OpenAI-compatible path the built-in cloud providers use, so a
// BYOM model lands on your Bench and places into the stack like any other.
//
// The endpoint URL and model id are plain metadata, persisted in settings. The
// API key (optional: a local server may need none) lives in the device secret
// store, keyed by the connection id, never in settings.
import { hostIsLocal } from 'os-code/protocol';
import type { StackModelRef } from './stack.js';

/** A user-connected model endpoint. Metadata only; the key is in the secret
 *  store under byomSecretKey(id). */
export interface ByomConnection {
  /** Stable local id, generated at connect time. */
  id: string;
  /** Friendly display name the user typed. */
  label: string;
  /** OpenAI-compatible base URL, e.g. https://host/v1 (no trailing
   *  /chat/completions). */
  baseUrl: string;
  /** The model id to send in the request body. */
  model: string;
  /** The window this endpoint serves, when the person knows it (Vault M5,
   *  CTO J4): the pack is sized from it, else 8192. App-only, device local. */
  contextTokens?: number;
}

/** The window a BYOM seat is assumed to serve when its connection does not
 *  say (CTO J4). */
export const BYOM_DEFAULT_CONTEXT_TOKENS = 8192;

/** The secret-store key holding a BYOM connection's API key. */
export function byomSecretKey(id: string): string {
  return `oscode.secret.byom.${id}`;
}

/** The stack ref for a connected BYOM model. */
export function byomRef(conn: ByomConnection): StackModelRef {
  return { kind: 'byom', id: conn.id, label: conn.label, baseUrl: conn.baseUrl, model: conn.model };
}

/** Where a BYOM endpoint runs, for the teal/amber location language. A server
 *  on this machine, the home network, or this device's own tailnet is `local`
 *  (teal, "your server"); anything else is someone's cloud (amber), even when
 *  the person holds the key, because the words leave for a host they do not
 *  run.
 *
 *  Judged by address with the one shared judge, `hostIsLocal` from
 *  os-code/protocol (Vault M5, CTO J2), the same call that decides whether a
 *  BYOM seat may read a local-only note, so the pill's color and what the seat
 *  is sent never disagree. A `*.ts.net` name is local only on this device's
 *  own tailnet (`ownTailnetSuffix`, from the paired hub's address); another
 *  tailnet's Funnel host is someone else's server. An address that does not
 *  parse reads as cloud: never claim local on a guess. */
export function byomReach(
  baseUrl: string,
  ownTailnetSuffix: string | null = null,
): 'local' | 'cloud' {
  const host = byomHost(baseUrl);
  if (!host) return 'cloud';
  return hostIsLocal(host, { ownTailnetSuffix }) ? 'local' : 'cloud';
}

/** The hostname a BYOM base URL points at (a bare `host:port` reads as
 *  http), or undefined when it does not parse. */
export function byomHost(baseUrl: string): string | undefined {
  try {
    const raw = baseUrl.trim();
    if (!raw) return undefined;
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`).hostname;
    return host || undefined;
  } catch {
    return undefined;
  }
}

/** Normalize a pasted base URL: trim, drop a trailing slash, and strip a
 *  trailing /chat/completions if the user pasted the full path by mistake. */
export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  url = url.replace(/\/chat\/completions$/, '');
  return url;
}
