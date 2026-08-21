// Apple signed-payload verification for the iOS In-App Purchase rail, shared by
// link-apple-purchase (a signed StoreKit transaction the app captured) and
// apple-notifications (an App Store Server Notification V2 `signedPayload`).
// Both a transaction JWS and a notification are JWS envelopes signed by an
// Apple-issued leaf certificate that chains to an Apple Root CA; verifying the
// signature AND the chain is the only thing that lets us trust the enclosed
// originalTransactionId / expiresDate / revocationDate. A client claim is never
// trusted without this.
//
// This wraps Apple's OFFICIAL library `@apple/app-store-server-library`
// (imported via the `npm:` specifier that Supabase edge functions support). Its
// `SignedDataVerifier` does the full cryptographic verification: signature,
// certificate chain up to a trusted Apple root, bundle id, and environment.
//
// The verifier needs the Apple Root CA certificates as DER buffers. The four
// published roots are embedded below as base64 DER (see APPLE_ROOT_* constants).
// Each may also be supplied as a function secret of the same name, which wins
// over the embedded value, so the founder can rotate/paste without editing code.
//
// Env (Supabase function secrets):
//   APPLE_BUNDLE_ID    - the app's bundle id (e.g. ai.openshore.oscode). The
//                        verifier rejects any payload not signed for this bundle.
//   APPLE_APP_APPLE_ID - the app's numeric Apple ID (App Store id). REQUIRED by
//                        the library to verify PRODUCTION payloads; optional for
//                        Sandbox/TestFlight. Set it before going live.
//   APPLE_ROOT_CA_G3_DER_BASE64 (+ _G2_, _INC_, _COMPUTER_) - optional overrides
//                        for the embedded root CA bytes.
//
// Note: APPLE_ISSUER_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY (the .p8) are for the
// App Store Server API (server-to-server CALLS to Apple, e.g. look up a
// subscription). This file only VERIFIES inbound signed data, which needs the
// root CAs + bundle id + app Apple id, not the .p8. Those three secrets are
// harmless to set now and are wired here for when a lookup call is added.
import {
  Environment,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
  SignedDataVerifier,
} from 'npm:@apple/app-store-server-library@1';
import { Buffer } from 'node:buffer';

// Friendly aliases for the exported shapes (the task's DecodedTransaction /
// DecodedNotification), so callers do not import library-internal names.
export type DecodedTransaction = JWSTransactionDecodedPayload;
export type DecodedNotification = ResponseBodyV2DecodedPayload;

// ---------------------------------------------------------------------------
// Apple Root CA certificates (base64 DER).
//
// PLACEHOLDERS: the real DER bytes could NOT be fetched in the build sandbox
// (www.apple.com is blocked by egress policy). Paste the real base64 DER of each
// certificate here OR set the matching function secret. Get the bytes with, e.g.:
//   curl -s https://www.apple.com/certificateauthority/AppleRootCA-G3.cer | base64 -w0
// Sources (Apple, "Apple PKI"):
//   AppleRootCA-G3.cer                -> APPLE_ROOT_CA_G3
//   AppleRootCA-G2.cer                -> APPLE_ROOT_CA_G2
//   AppleIncRootCertificate.cer       -> APPLE_ROOT_INC
//   AppleComputerRootCertificate.cer  -> APPLE_ROOT_COMPUTER
//
// Modern StoreKit JWS and App Store Server Notifications V2 chain to
// AppleRootCA-G3, so G3 is the load-bearing one; the others are included for a
// complete trust set. Any constant left as the PASTE_ sentinel (and with no
// matching secret) is skipped; if that leaves NO usable root, verification
// throws a clear configuration error rather than silently trusting nothing.
const PASTE = 'PASTE_REAL_BASE64_DER_HERE_';
const APPLE_ROOT_CA_G3_DER_BASE64 = PASTE + 'AppleRootCA_G3';
const APPLE_ROOT_CA_G2_DER_BASE64 = PASTE + 'AppleRootCA_G2';
const APPLE_ROOT_INC_DER_BASE64 = PASTE + 'AppleIncRootCertificate';
const APPLE_ROOT_COMPUTER_DER_BASE64 = PASTE + 'AppleComputerRootCertificate';

// A root is "configured" only if a real value exists (secret override or a
// pasted constant that is not the sentinel).
function configuredRoot(secretName: string, embedded: string): string | null {
  const value = (Deno.env.get(secretName) ?? embedded).replace(/\s+/g, '');
  if (!value || value.startsWith(PASTE)) return null;
  return value;
}

// Memoized DER buffers for the trusted roots. Throws (surfaced to the caller as
// a verification failure) when nothing is configured, so an unconfigured deploy
// fails loud instead of accepting unverifiable payloads.
let cachedRoots: Buffer[] | null = null;
function appleRootCerts(): Buffer[] {
  if (cachedRoots) return cachedRoots;
  const roots: Buffer[] = [];
  for (const [secretName, embedded] of [
    ['APPLE_ROOT_CA_G3_DER_BASE64', APPLE_ROOT_CA_G3_DER_BASE64],
    ['APPLE_ROOT_CA_G2_DER_BASE64', APPLE_ROOT_CA_G2_DER_BASE64],
    ['APPLE_ROOT_INC_DER_BASE64', APPLE_ROOT_INC_DER_BASE64],
    ['APPLE_ROOT_COMPUTER_DER_BASE64', APPLE_ROOT_COMPUTER_DER_BASE64],
  ] as const) {
    const b64 = configuredRoot(secretName, embedded);
    if (b64) roots.push(Buffer.from(b64, 'base64'));
  }
  if (roots.length === 0) {
    throw new Error(
      'Apple root CA certificates are not configured. Paste the real base64 DER ' +
        'into apple.ts (APPLE_ROOT_CA_G3_DER_BASE64 et al.) or set the matching ' +
        'function secrets. Verification cannot proceed without a trusted root.',
    );
  }
  cachedRoots = roots;
  return roots;
}

// ---------------------------------------------------------------------------
// Verifier construction.
//
// A SignedDataVerifier is bound to ONE environment (Sandbox or Production) and
// rejects a payload from the other; production also requires the app Apple id.
// We keep one verifier per environment and select it by peeking at the (as yet
// unverified) environment claim in the JWS. The peek only PICKS which trusted
// verifier runs; the verifier then cryptographically confirms the signature,
// chain, bundle id, AND that the environment matches, so a forged environment
// claim cannot bypass anything.
const BUNDLE_ID = Deno.env.get('APPLE_BUNDLE_ID') ?? '';
const APP_APPLE_ID_RAW = Deno.env.get('APPLE_APP_APPLE_ID');
const APP_APPLE_ID = APP_APPLE_ID_RAW ? Number(APP_APPLE_ID_RAW) : undefined;

// Online OCSP checks are off: an edge function should not add a blocking network
// round-trip to Apple's OCSP responder on every call (and that host may be
// firewalled). The offline chain + signature verification is the security gate;
// refunds/revocations arrive as their own notifications regardless.
const ENABLE_ONLINE_CHECKS = false;

const verifiers = new Map<Environment, SignedDataVerifier>();
function verifierFor(environment: Environment): SignedDataVerifier {
  let verifier = verifiers.get(environment);
  if (!verifier) {
    if (!BUNDLE_ID) {
      throw new Error('APPLE_BUNDLE_ID is not set; cannot verify Apple payloads.');
    }
    verifier = new SignedDataVerifier(
      appleRootCerts(),
      ENABLE_ONLINE_CHECKS,
      environment,
      BUNDLE_ID,
      APP_APPLE_ID,
    );
    verifiers.set(environment, verifier);
  }
  return verifier;
}

// Decode a JWS payload segment WITHOUT verifying it, only to read the
// environment claim so we can select the right verifier. Never trust anything
// else from this; the verify step below is the trust boundary.
// deno-lint-ignore no-explicit-any
function peekPayload(jws: string): any {
  const parts = jws.split('.');
  if (parts.length !== 3) throw new Error('Malformed Apple JWS (expected 3 segments).');
  const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = new TextDecoder().decode(Buffer.from(b64, 'base64'));
  return JSON.parse(json);
}

// Map an environment claim to the enum. Anything that is not explicitly Sandbox
// is treated as Production; the Production verifier then rejects a mismatch, so
// an unrecognized value cannot silently pass as Sandbox.
function environmentOf(value: unknown): Environment {
  return value === Environment.SANDBOX ? Environment.SANDBOX : Environment.PRODUCTION;
}

// Verify + decode a signed StoreKit transaction (JWS). Throws on any signature,
// chain, bundle, or environment failure.
export async function verifyTransaction(jws: string): Promise<DecodedTransaction> {
  const env = environmentOf(peekPayload(jws)?.environment);
  return await verifierFor(env).verifyAndDecodeTransaction(jws);
}

// Verify + decode an App Store Server Notification V2 `signedPayload`. Throws on
// any verification failure. The enclosed data.signedTransactionInfo is itself a
// JWS; verify it separately with verifyTransaction to trust its fields.
export async function verifyNotification(signedPayload: string): Promise<DecodedNotification> {
  const env = environmentOf(peekPayload(signedPayload)?.data?.environment);
  return await verifierFor(env).verifyAndDecodeNotification(signedPayload);
}
