// The Pairing screen's status line for the phone connection, as one
// pure function so every case is pinned by a test. When the last bind failed
// (`bindError`), UX review cleanup 5 replaces the older line, which blamed Tailscale
// even when Tailscale was up. The raw error goes to the log, never the screen.
import type { DaemonInfo } from './electronBridge.js';

/** An address another program already holds, as Node words a failed listen. */
export function portTaken(bindError: string | undefined): boolean {
  return Boolean(bindError && /\bEADDRINUSE\b/.test(bindError));
}

/** How to bring Tailscale up on this computer: the app everywhere, and the
 *  command only on Linux, where there may be no app (UX review 2026-10-01: a Mac or
 *  Windows person was being shown "sudo"). */
function signInLine(linux: boolean): string {
  return linux
    ? 'Open the Tailscale app and sign in (or run sudo tailscale up)'
    : 'Open the Tailscale app and sign in';
}

/** Whether this desktop is a Linux one, read from the page itself. */
export function onLinux(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    /linux/i.test(navigator.userAgent) &&
    !/android/i.test(navigator.userAgent)
  );
}

export function hubStatusLine(
  info: DaemonInfo | undefined,
  opts: { linux?: boolean } = {},
): string {
  const signIn = signInLine(opts.linux ?? false);
  if (info?.bindError) {
    // Up on loopback after the tailnet refused, or not up at all; either
    // way the re-bind poll keeps trying.
    const line = info.running
      ? 'On, but only for this computer. It could not open its Tailscale address, so the phone cannot reach it yet. It keeps trying.'
      : 'Could not turn on. It keeps trying.';
    return portTaken(info.bindError)
      ? `${line} Another program is using port ${info.port}. If OpenShore is also running in a terminal, close it there.`
      : line;
  }
  if (info?.running) {
    return info.mode === 'loopback'
      ? `On, but only for this computer. Tailscale is not up, so the phone cannot reach it yet. ${signIn}.`
      : 'On. Your phone can reach this computer over Tailscale.';
  }
  return info?.tailscaleUp
    ? 'Off. Turn it on and the phone app can connect.'
    : `Tailscale is not up on this computer. ${signIn}, then turn this on.`;
}
