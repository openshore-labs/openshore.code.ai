// Small checks the main process makes on what the renderer, the browser or a
// local page hands it, kept free of Electron so the tests pin them exactly as
// main.ts runs them (the D2 shell package). main.ts wires each one in.
import { isDiskTop, within } from './vaultDir.js';

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
  if (isDiskTop(real, p)) return 'root';
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

// ------------------------------------------------------ outbound HTTP headers

/** The headers the renderer's guarded fetch (osc:httpFetch) may send. The
 *  desktop's Claude key check rides it (validateProviderKey through
 *  nativeFetch), so Claude's key, its API version and an identity-linked
 *  key's workspace pass too (2026-10-09: they were dropped, and the check went
 *  out with no key, so a good key read as rejected). */
export const HTTP_FETCH_HEADERS: ReadonlySet<string> = new Set([
  'content-type',
  'x-auth-token',
  'authorization',
  'x-api-key',
  'anthropic-version',
  'anthropic-workspace-id',
]);

/** The headers that name a credential or the account it acts in: dropped on
 *  a cross-origin redirect, so a key never follows a hop to a host it was
 *  not issued for. */
export const HTTP_FETCH_CREDENTIALS: ReadonlySet<string> = new Set([
  'authorization',
  'x-auth-token',
  'x-api-key',
  'anthropic-workspace-id',
]);

/** The request headers the guarded fetch sends: the allowed names in any
 *  case, their values as given; anything else is left behind. */
export function httpFetchHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (HTTP_FETCH_HEADERS.has(name.toLowerCase())) out[name] = value;
  }
  return out;
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

// ------------------------------------------------------ the second key's words

/** A native confirm's words: its question, the detail under it, and the
 *  button that says yes (Cancel is always the other, and the default). */
export interface ConfirmWords {
  message: string;
  detail: string;
  confirm: string;
}

/**
 * Trusting a folder (CX cleanup 2). The dialog is the one check the page
 * cannot fake, so it says what trusting does: each setting that would apply,
 * worded as the trust card words it, then the folder. `waiting` comes from
 * the engine in main (`EngineHost.trustWaiting`), never from the page.
 */
export function trustConfirm(waiting: readonly string[], folder: string): ConfirmWords {
  const lines = waiting.map((line) => `• It ${line}.`);
  const apply = lines.length
    ? `Its own settings will apply on this computer:\n${lines.join('\n')}`
    : 'Its own settings will apply on this computer.';
  return {
    message: 'Trust this folder?',
    detail: `${apply}\nTrust it only if you know who made it. If its settings change, OpenShore asks again.\n\n${folder}`,
    confirm: 'Trust folder',
  };
}

/** Copying a repository to this computer. `address` is already cleaned of
 *  any login (main's cloneUrlForDialog). */
export function cloneConfirm(address: string): ConfirmWords {
  return {
    message: 'Copy this repository to your computer?',
    detail: `OpenShore downloads a copy into its projects folder so you can work on it in a chat. Its own settings stay off until you trust it.\n\n${address}`,
    confirm: 'Copy repository',
  };
}

/** Turning on launch at login. */
export const LAUNCH_AT_LOGIN_CONFIRM: ConfirmWords = {
  message: 'Start OpenShore with your computer?',
  detail:
    'It opens in the background each time you sign in to this computer, so your phone can reach it and your routines can run. Turn it off any time from the same switch.',
  confirm: 'Start with my computer',
};
