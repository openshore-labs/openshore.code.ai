// Passkeys (founder 2026-10-12; CTO and CX rulings the same day). GoTrue's own
// passkeys (/auth/v1/passkeys, its 2026 release) with openshore.ai as the
// relying party. Only a native ceremony can speak for openshore.ai from inside
// the app (a WKWebView at capacitor://localhost or Electron's own origin
// cannot), so the ceremony runs in the oscode-passkey plugin
// (ASAuthorizationPlatformPublicKeyCredentialProvider, user verification
// required) and this file is the only one that calls /passkeys.
//
// What is stored on the server is GoTrue's: the credential id, the public key,
// the authenticator's name, the sign count and when it was added and last
// used. The private key never leaves the person's keychain.
//
// Off unless the build says VITE_PASSKEYS=1 and the platform can run the
// ceremony: the founder's gate (docs/passwordless-runbook.md) turns it on.
import { registerPlugin } from '@capacitor/core';
import { platform } from './platform.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const BUILD_FLAG = import.meta.env.VITE_PASSKEYS as string | undefined;

/** The relying party, as supabase/config.toml's [auth.webauthn] names it. */
export const RP_ID = 'openshore.ai';

/** How recent an email sign-in must be before a passkey can be added: 0028's
 *  step-up trigger holds the same 10 minutes on the server. */
export const STEP_UP_MS = 10 * 60_000;

// ------------------------------------------------------------ the plugin

export interface PasskeyRegisterOptions {
  rpId: string;
  /** base64url, as GoTrue sends it. */
  challenge: string;
  /** base64url user handle. */
  userId: string;
  userName: string;
  /** base64url ids the keychain already holds for this account. */
  exclude: string[];
}

export interface PasskeyAssertOptions {
  rpId: string;
  challenge: string;
}

/** A credential as the plugin returns it, every binary field base64url. */
export interface NativeRegistration {
  id: string;
  clientDataJSON: string;
  attestationObject: string;
}

export interface NativeAssertion {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle?: string;
}

export interface OscodePasskeyContract {
  /** Whether this device can run a passkey ceremony for openshore.ai. */
  available(): Promise<{ available: boolean }>;
  /** Make a passkey. Rejects with code "canceled" when the person backs out. */
  register(options: PasskeyRegisterOptions): Promise<NativeRegistration>;
  /** Sign in with a passkey the keychain holds for the relying party. */
  assert(options: PasskeyAssertOptions): Promise<NativeAssertion>;
}

class PasskeyWeb implements OscodePasskeyContract {
  async available() {
    return { available: false };
  }
  async register(): Promise<NativeRegistration> {
    throw new Error('Passkeys are not available here.');
  }
  async assert(): Promise<NativeAssertion> {
    throw new Error('Passkeys are not available here.');
  }
}

export const OscodePasskey = registerPlugin<OscodePasskeyContract>('OscodePasskey', {
  web: () => new PasskeyWeb() as unknown as OscodePasskeyContract,
});

/** Whether passkeys are offered on this build and device: the founder's flag,
 *  an iPhone or iPad, and the plugin saying yes. */
export async function passkeysAvailable(): Promise<boolean> {
  if (BUILD_FLAG !== '1' || platform() !== 'ios') return false;
  try {
    return (await OscodePasskey.available()).available;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ GoTrue's shapes

interface CreationOptions {
  challenge: string;
  rp?: { id?: string };
  user: { id: string; name: string };
  excludeCredentials?: Array<{ id: string }>;
}

interface RequestOptions {
  challenge: string;
  rpId?: string;
}

/** What the plugin needs to make a passkey, from GoTrue's options. The relying
 *  party is always ours: an options body naming another is refused. */
export function registerOptionsFrom(options: CreationOptions): PasskeyRegisterOptions {
  const rp = options.rp?.id ?? RP_ID;
  if (rp !== RP_ID) throw new Error('The sign-in server named another site.');
  return {
    rpId: RP_ID,
    challenge: options.challenge,
    userId: options.user.id,
    userName: options.user.name,
    exclude: (options.excludeCredentials ?? []).map((c) => c.id),
  };
}

export function assertOptionsFrom(options: RequestOptions): PasskeyAssertOptions {
  const rp = options.rpId ?? RP_ID;
  if (rp !== RP_ID) throw new Error('The sign-in server named another site.');
  return { rpId: RP_ID, challenge: options.challenge };
}

/** The registration as WebAuthn's JSON (what GoTrue's verify parses). */
export function registrationJson(r: NativeRegistration): Record<string, unknown> {
  return {
    id: r.id,
    rawId: r.id,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: r.clientDataJSON,
      attestationObject: r.attestationObject,
      transports: ['internal', 'hybrid'],
    },
    clientExtensionResults: {},
  };
}

export function assertionJson(a: NativeAssertion): Record<string, unknown> {
  return {
    id: a.id,
    rawId: a.id,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: a.clientDataJSON,
      authenticatorData: a.authenticatorData,
      signature: a.signature,
      ...(a.userHandle ? { userHandle: a.userHandle } : {}),
    },
    clientExtensionResults: {},
  };
}

// ------------------------------------------------------------ step-up

interface AmrEntry {
  method?: string;
  timestamp?: number;
}

/** The ways this access token's session proved who it is, and when (the
 *  token's own `amr` claim). Undefined when the token cannot be read. */
export function sessionMethods(accessToken: string): AmrEntry[] | undefined {
  const part = accessToken.split('.')[1];
  if (!part) return undefined;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json) as { amr?: unknown };
    return Array.isArray(claims.amr) ? (claims.amr as AmrEntry[]) : [];
  } catch {
    return undefined;
  }
}

/** Whether this session signed in by email (code or link) recently enough to
 *  add a passkey. 0028's trigger is the line that holds; this only spares the
 *  person a refusal. */
export function recentEmailProof(accessToken: string, now: number = Date.now()): boolean {
  const methods = sessionMethods(accessToken) ?? [];
  return methods.some(
    (m) =>
      ['otp', 'magiclink', 'email/signup'].includes(m.method ?? '') &&
      typeof m.timestamp === 'number' &&
      now - m.timestamp * 1000 < STEP_UP_MS,
  );
}

// ------------------------------------------------------------ the API

export interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
}

/** A refusal from the passkey API, keeping GoTrue's error code. */
export class PasskeyError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'PasskeyError';
  }
}

function base(): string {
  if (!SUPABASE_URL) throw new Error('Sign-in is not configured on this build.');
  return `${SUPABASE_URL}/auth/v1/passkeys`;
}

function headers(accessToken?: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    apikey: SUPABASE_ANON ?? '',
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  };
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${base()}${path}`, init);
  if (!res.ok) {
    let code: string | undefined;
    let said = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error_code?: string; msg?: string; message?: string };
      code = body.error_code;
      said = body.msg ?? body.message ?? said;
    } catch {
      // No JSON: the status says it.
    }
    throw new PasskeyError(said, code);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Make a passkey for the signed-in account: GoTrue's options, the native
 *  ceremony, then GoTrue's verify. */
export async function addPasskey(accessToken: string): Promise<void> {
  const begun = await call<{ challenge_id: string; options: CreationOptions }>(
    '/registration/options',
    { method: 'POST', headers: headers(accessToken), body: '{}' },
  );
  const made = await OscodePasskey.register(registerOptionsFrom(begun.options));
  await call('/registration/verify', {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify({ challenge_id: begun.challenge_id, credential: registrationJson(made) }),
  });
}

/** The raw session GoTrue answers a passkey sign-in with. */
export interface PasskeySession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email?: string };
}

/** Sign in with a passkey the keychain holds: no address needed. */
export async function signInWithPasskey(): Promise<PasskeySession> {
  const begun = await call<{ challenge_id: string; options: RequestOptions }>(
    '/authentication/options',
    { method: 'POST', headers: headers(), body: '{}' },
  );
  const proof = await OscodePasskey.assert(assertOptionsFrom(begun.options));
  return call<PasskeySession>('/authentication/verify', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ challenge_id: begun.challenge_id, credential: assertionJson(proof) }),
  });
}

export async function listPasskeys(accessToken: string): Promise<Passkey[]> {
  const rows = await call<
    Array<{ id: string; friendly_name?: string; created_at: string; last_used_at?: string }>
  >('/', { method: 'GET', headers: headers(accessToken) });
  return (rows ?? []).map((r) => ({
    id: r.id,
    name: r.friendly_name || 'Passkey',
    createdAt: r.created_at,
    ...(r.last_used_at ? { lastUsedAt: r.last_used_at } : {}),
  }));
}

export async function removePasskey(accessToken: string, id: string): Promise<void> {
  await call(`/${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers(accessToken) });
}

// ------------------------------------------------------------ the words (CX Q2)

export const PASSKEY_OFFER_TITLE = 'Sign in faster next time';
export const PASSKEY_EXPLAINER =
  'A passkey signs you in with the same unlock you use for this device, instead of an email code. Your password manager keeps it, and OpenShore stores only a public key.';
export const CREATE_PASSKEY = 'Create a passkey';
export const NOT_NOW = 'Not now';
export const PASSKEYS_TITLE = 'Passkeys';
export const SIGN_IN_WITH_PASSKEY = 'Sign in with a passkey';
export const SIGN_IN_WITH_EMAIL = 'Sign in with email instead';
export const PASSKEY_ADDED = 'Passkey added.';
export const PASSKEY_REMOVED = 'Passkey removed.';
export const REMOVE_PASSKEY_TITLE = 'Remove this passkey?';
export const REMOVE_PASSKEY_BODY =
  'You can still sign in by email. Your password manager keeps its copy until you delete it there.';
export const CONFIRM_FIRST =
  'First, confirm it is you. We will email a code to the address on this account.';
export const PASSKEY_CANCELED = 'No passkey was made.';

/** "Added 12 Oct 2026 · Last used 14 Oct 2026", in the reader's own format. */
export function passkeyLine(p: Passkey, locale?: string): string {
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  return p.lastUsedAt
    ? `Added ${day(p.createdAt)} · Last used ${day(p.lastUsedAt)}`
    : `Added ${day(p.createdAt)}`;
}

/** A plain line for a passkey refusal. */
export function passkeyProblem(err: unknown): string {
  const code = err instanceof PasskeyError ? err.code : undefined;
  const said = err instanceof Error ? err.message : '';
  if (/cancel/i.test(said) || (err as { code?: string })?.code === 'canceled') {
    return PASSKEY_CANCELED;
  }
  if (code === 'too_many_passkeys') return 'This account has the most passkeys it can hold.';
  if (/passkey_needs_recent_email|insufficient_aal/i.test(`${code ?? ''} ${said}`)) {
    return 'Confirm it is you by email first, then add the passkey.';
  }
  return 'The passkey did not go through. Try again.';
}
