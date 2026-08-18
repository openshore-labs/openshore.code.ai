// GitHub auth: device-flow OAuth plus a PAT fallback, same credential store.
// The device flow needs an OAuth app client id; OS Code reads it from
// OSC_GITHUB_CLIENT_ID so a self-hoster can register their own app. The PAT
// path works out of the box with zero setup.
import { deleteCredential, getCredential, setCredential } from './store.js';

const TOKEN_NAME = 'github-token';

export function getGithubToken(): string | undefined {
  return getCredential(TOKEN_NAME) ?? process.env.GITHUB_TOKEN ?? undefined;
}

export function isGithubConnected(): boolean {
  return Boolean(getGithubToken());
}

export function logoutGithub(): void {
  deleteCredential(TOKEN_NAME);
}

export interface DeviceCode {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  intervalSeconds: number;
  expiresInSeconds: number;
}

export function githubClientId(): string | undefined {
  return process.env.OSC_GITHUB_CLIENT_ID || undefined;
}

/** Step 1 of the device flow: get the code the user types into github.com. */
export async function startDeviceFlow(clientId: string): Promise<DeviceCode> {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: 'repo read:org' }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} starting the device flow.`);
  const body = (await res.json()) as Record<string, unknown>;
  return {
    userCode: String(body.user_code),
    verificationUri: String(body.verification_uri),
    deviceCode: String(body.device_code),
    intervalSeconds: Number(body.interval ?? 5),
    expiresInSeconds: Number(body.expires_in ?? 900),
  };
}

/** Step 2: poll until the user approves (or the code expires). */
export async function pollDeviceFlow(
  clientId: string,
  device: DeviceCode,
  onWait?: () => void,
): Promise<string> {
  const deadline = Date.now() + device.expiresInSeconds * 1000;
  let interval = device.intervalSeconds * 1000;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error('The device code expired before it was approved. Run osc auth github again.');
    }
    await new Promise((r) => setTimeout(r, interval));
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        device_code: device.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (typeof body.access_token === 'string') {
      setCredential(TOKEN_NAME, body.access_token);
      return body.access_token;
    }
    if (body.error === 'authorization_pending') {
      onWait?.();
      continue;
    }
    if (body.error === 'slow_down') {
      interval += 5000;
      continue;
    }
    throw new Error(`GitHub device flow failed: ${String(body.error_description ?? body.error)}`);
  }
}

/** PAT fallback: validate the token, then store it. */
export async function loginWithPat(token: string): Promise<{ ok: boolean; detail: string; login?: string }> {
  const trimmed = token.trim();
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { authorization: `Bearer ${trimmed}`, accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401) {
      return { ok: false, detail: 'GitHub rejected that token. Check it has not expired and has repo scope.' };
    }
    if (!res.ok) return { ok: false, detail: `GitHub answered ${res.status}; try again in a moment.` };
    const body = (await res.json()) as { login?: string };
    setCredential(TOKEN_NAME, trimmed);
    return { ok: true, detail: `Connected to GitHub as ${body.login ?? 'you'}.`, login: body.login };
  } catch (err) {
    return { ok: false, detail: `Could not reach GitHub: ${(err as Error).message}` };
  }
}
