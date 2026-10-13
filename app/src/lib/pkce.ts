// PKCE for the email sign-in link (RFC 7636, S256). The app keeps a random
// verifier and sends only its hash with the request; the link comes back with
// a one-time code that the auth server trades for a session only alongside
// that verifier. So a link opened on another device, or by a mail scanner,
// signs nobody in: the verifier never left the device that asked.

/** base64url without padding, as RFC 7636 spells it. */
function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh verifier: 32 random bytes, 43 characters once encoded, the
 *  shortest length RFC 7636 allows and the most entropy it asks for. */
export function newCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/** The S256 challenge for a verifier. */
export async function codeChallengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}
