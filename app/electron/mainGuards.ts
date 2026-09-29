// Small checks the main process makes on what the renderer, the browser or a
// local page hands it, kept free of Electron so the tests pin them exactly as
// main.ts runs them (the D2 shell package). main.ts wires each one in.
import { dirname } from 'node:path';
import { within } from './vaultDir.js';

// ------------------------------------------------------------ session roots

/** Why a folder cannot be a session's root. */
export type SessionRootRefusal = 'root' | 'home' | 'home-ancestor' | 'osc-home';

/**
 * Why `real` (a realpath) is too broad for the coding agent to work in, or
 * undefined when it is fine. The same lines the vault chooser draws: the top
 * of a disk, the home folder itself or anything above it, and OpenShore's own
 * settings folder (keys, paired devices, sessions) from either side. A project
 * inside home is the normal case and passes.
 */
export function sessionRootRefusal(
  real: string,
  env: { home: string; oscHome: string; platform: NodeJS.Platform },
): SessionRootRefusal | undefined {
  const p = env.platform;
  if (dirname(real) === real) return 'root';
  if (within(real, env.home, p) && within(env.home, real, p)) return 'home';
  if (within(env.home, real, p)) return 'home-ancestor';
  if (within(real, env.oscHome, p) || within(env.oscHome, real, p)) return 'osc-home';
  return undefined;
}

// ------------------------------------------------------ device permissions

/** What the app's own page may use without a prompt: the clipboard write
 *  behind every Copy button, and full screen for a video. */
const APP_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write', 'fullscreen']);

/**
 * Whether the main window may have a device permission. Electron's default
 * grants every request (camera, microphone, location, notifications) to any
 * page without asking. Only the app's own bundled page is ever answered yes,
 * and for the microphone only audio: dictation and voice mode listen through
 * the web speech engine on the desktop. The camera, location, notifications,
 * and opening other apps by link are always no.
 */
export function appPermissionAllowed(
  permission: string,
  details: { requestingUrl?: string; mediaTypes?: readonly string[]; mediaType?: string },
  appEntryHref: string,
): boolean {
  if (details.requestingUrl?.split('#')[0] !== appEntryHref) return false;
  if (permission === 'media') {
    const types = details.mediaTypes ?? (details.mediaType ? [details.mediaType] : []);
    return types.length > 0 && types.every((type) => type === 'audio');
  }
  return APP_PERMISSIONS.has(permission);
}

// ---------------------------------------------------- OAuth loopback answer

/** The path the desktop's Google sign-in redirects to (gdriveAuth.ts). */
export const OAUTH_REDIRECT_PATH = '/oauth2redirect';

/** What one request to the sign-in listener means. `ignore`: not the
 *  redirect (a favicon, a stray local request), so answer 404 and keep
 *  listening. `incomplete`: the redirect without its state, so show an error
 *  page and keep listening. `done`: the answer, success or refusal. */
export type OAuthCallback =
  | { kind: 'ignore' }
  | { kind: 'incomplete' }
  | { kind: 'done'; result: { code: string; state: string } | { error: string } };

export function readOAuthCallback(
  method: string | undefined,
  rawUrl: string | undefined,
): OAuthCallback {
  // A browser sends a path. Read it as one on this listener's own origin, so
  // a request line like `//other.host/...` stays a path and never a host.
  if (method !== 'GET' || !rawUrl?.startsWith('/')) return { kind: 'ignore' };
  let url: URL;
  try {
    url = new URL(`http://127.0.0.1${rawUrl}`);
  } catch {
    return { kind: 'ignore' };
  }
  if (url.pathname !== OAUTH_REDIRECT_PATH) return { kind: 'ignore' };
  // Google sends the state back on success and on refusal alike, so a
  // request without one is not Google's answer to this sign-in.
  const state = url.searchParams.get('state');
  if (!state) return { kind: 'incomplete' };
  const error = url.searchParams.get('error');
  if (error) return { kind: 'done', result: { error } };
  const code = url.searchParams.get('code');
  if (!code) return { kind: 'incomplete' };
  return { kind: 'done', result: { code, state } };
}
