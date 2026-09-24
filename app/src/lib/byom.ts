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

/** Where a BYOM endpoint runs, for the teal/amber location language. A server
 *  on this machine, the home network, or a tailnet is `local` (teal, "your
 *  server"); anything else is someone's cloud (amber), even when the person
 *  holds the key, because the words leave for a host they do not run.
 *
 *  Local: localhost and *.localhost, 127.0.0.0/8, ::1, 0.0.0.0, the private
 *  IPv4 ranges (10/8, 172.16/12, 192.168/16), link-local 169.254/16, IPv6
 *  unique-local fc00::/7 and link-local fe80::/10, *.local (mDNS), *.ts.net
 *  (Tailscale MagicDNS), and 100.64.0.0/10 (Tailscale's CGNAT range). An
 *  address that does not parse reads as cloud: never claim local on a guess. */
export function byomReach(baseUrl: string): 'local' | 'cloud' {
  let host: string;
  try {
    const raw = baseUrl.trim();
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`).hostname;
  } catch {
    return 'cloud';
  }
  host = host
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!host) return 'cloud';
  if (host === 'localhost' || host.endsWith('.localhost')) return 'local';
  if (host.endsWith('.local') || host.endsWith('.ts.net')) return 'local';

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return 'local';
    if (a === 172 && b >= 16 && b <= 31) return 'local';
    if (a === 192 && b === 168) return 'local';
    if (a === 169 && b === 254) return 'local';
    if (a === 100 && b >= 64 && b <= 127) return 'local';
    return 'cloud';
  }

  if (host.includes(':')) {
    if (host === '::1' || host === '::') return 'local';
    // An IPv4-mapped address (::ffff:10.0.0.2) reads as its IPv4 self.
    // The URL parser writes it in hex (::ffff:a00:2), so both spellings count.
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
    if (mapped) return byomReach(`http://${mapped[1]}`);
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1]!, 16);
      const lo = parseInt(mappedHex[2]!, 16);
      return byomReach(`http://${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return 'local';
    if (/^fe[89ab][0-9a-f]?:/.test(host)) return 'local';
    return 'cloud';
  }
  return 'cloud';
}

/** Normalize a pasted base URL: trim, drop a trailing slash, and strip a
 *  trailing /chat/completions if the user pasted the full path by mistake. */
export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  url = url.replace(/\/chat\/completions$/, '');
  return url;
}
