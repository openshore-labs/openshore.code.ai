// Opening web pages, the person's choice for the coding agent on their
// computer (founder, 2026-10-02; the CTO review's H3): ask before each page
// (the default), always allow (a blanket yes), or never. It lives in the
// computer's own config (`tools.webFetch`), so every session there follows
// it, a reopened one included; the app keeps a copy to show and carries a
// change to the desktop's engine or to the paired computer.
import { bridge } from './electronBridge.js';
import { isDesktop } from './platform.js';
import type { DaemonTarget } from '../drivers/remoteDriver.js';

export type WebFetchMode = 'ask' | 'allow' | 'off';

export const WEB_FETCH_MODES: readonly WebFetchMode[] = ['ask', 'allow', 'off'];

export const WEB_FETCH_LABEL: Record<WebFetchMode, string> = {
  ask: 'Ask',
  allow: 'Always',
  off: 'Never',
};

/** The line under the row, in plain words, for the mode on now. */
export function webFetchLine(mode: WebFetchMode): string {
  if (mode === 'allow') {
    return 'The coding agent opens web pages without asking. A page on your own network still asks.';
  }
  if (mode === 'off') return 'The coding agent never opens web pages. Web search is separate.';
  return 'The coding agent asks before it opens a web page. You can allow it for the rest of a chat.';
}

/** Carry the choice to the computer that runs the coding agent: this
 *  desktop's own engine, else the paired computer. False when neither is
 *  in reach (the app's copy still holds, and is sent next time). */
export async function pushWebFetchMode(
  mode: WebFetchMode,
  settings: { daemon?: DaemonTarget; preferRemoteHub?: boolean },
): Promise<boolean> {
  const b = isDesktop() ? bridge() : undefined;
  if (b?.webFetchMode && !settings.preferRemoteHub) {
    await b.webFetchMode(mode);
    return true;
  }
  const target = settings.daemon;
  if (!target) return false;
  try {
    const res = await fetch(`${target.baseUrl}/settings/web-fetch`, {
      method: 'POST',
      headers: { authorization: `Bearer ${target.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
