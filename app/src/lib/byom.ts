// Bring Your Own Model (BYOM): connect a model YOU control, by pointing OS
// Code at any OpenAI-compatible endpoint (a self-hosted vLLM or Ollama server,
// a fine-tune behind your own gateway, another provider's API). It rides the
// exact same OpenAI-compatible path the built-in cloud providers use, so a
// BYOM model lands on your Bench and places into the stack like any other.
//
// The endpoint URL and model id are plain metadata, persisted in settings. The
// API key (optional: a local server may need none) lives in the device secret
// store, keyed by the connection id, never in settings.
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
}

/** The secret-store key holding a BYOM connection's API key. */
export function byomSecretKey(id: string): string {
  return `oscode.secret.byom.${id}`;
}

/** The stack ref for a connected BYOM model. */
export function byomRef(conn: ByomConnection): StackModelRef {
  return { kind: 'byom', id: conn.id, label: conn.label, baseUrl: conn.baseUrl, model: conn.model };
}

/** Normalize a pasted base URL: trim, drop a trailing slash, and strip a
 *  trailing /chat/completions if the user pasted the full path by mistake. */
export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  url = url.replace(/\/chat\/completions$/, '');
  return url;
}
