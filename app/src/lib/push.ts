// The phone half of completion push. When the user opens a desktop session (the
// walk-away-able path, where the loop runs on their own machine), this registers
// for notifications, hands the daemon an opaque grant, and beats while the app is
// foreground so the daemon knows when the user is watching.
//
// All of it is iOS-only and best-effort: a failure here never blocks a session,
// it just means no push until the next try. Nothing here runs off a real iPhone
// (the web mock reports no permission and no token).
import type { PluginListenerHandle } from '@capacitor/core';
import { Llama } from './llamaPlugin.js';
import { isPhone } from './platform.js';
import { functionUrl, invokeFunction as supabaseInvoke, type Session } from './supabase.js';
import type { DaemonTarget } from '../drivers/remoteDriver.js';

// How long to wait for APNs to hand back a token after permission is granted.
// Registration is asynchronous: the token arrives via the 'pushToken' event.
const TOKEN_WAIT_MS = 12_000;

async function tokenWithWait(): Promise<{
  token: string;
  environment: 'sandbox' | 'production';
} | null> {
  const current = await Llama.getPushToken();
  if (current.token) return { token: current.token, environment: current.environment };
  return new Promise((resolve) => {
    let handle: PluginListenerHandle | undefined;
    const timer = setTimeout(() => {
      void handle?.remove();
      resolve(null);
    }, TOKEN_WAIT_MS);
    void Llama.addListener('pushToken', ({ token, environment }) => {
      clearTimeout(timer);
      void handle?.remove();
      resolve({ token, environment });
    }).then((h) => {
      handle = h;
    });
  });
}

/**
 * Register this device with the user's daemon for completion push. Returns true
 * only when the whole chain succeeded, so the caller can remember not to ask
 * again. Any failure (permission denied, no token, an offline daemon) returns
 * false without throwing.
 */
export async function registerPushForDaemon(
  daemon: DaemonTarget,
  session: Session,
): Promise<boolean> {
  if (!isPhone()) return false;
  const sendUrl = functionUrl('push-send');
  if (!sendUrl) return false; // sign-in / Supabase not configured on this build
  try {
    const perm = await Llama.requestPushPermission();
    if (!perm.granted) return false;
    const tok = await tokenWithWait();
    if (!tok) return false;

    // Bind the device token to this user (service-role write behind the function).
    await supabaseInvoke('push-register', session.accessToken, {
      token: tok.token,
      environment: tok.environment,
    });
    // Mint an opaque grant and hand it, plus the push-send URL, to the daemon.
    const { grant } = await supabaseInvoke<{ grant: string }>('push-grant', session.accessToken, {
      label: 'iPhone',
    });
    const res = await fetch(`${daemon.baseUrl}/push/register`, {
      method: 'POST',
      headers: { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ grant, sendUrl }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Tell the daemon the phone is foreground on this session, so it holds the push
 *  back while the user is watching. Best-effort; a missed beat just risks one
 *  extra banner. */
export async function beatDesktopSession(daemon: DaemonTarget, sessionId: string): Promise<void> {
  await fetch(`${daemon.baseUrl}/push/beat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  }).catch(() => {});
}
