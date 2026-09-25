// A failure a person reads should be a plain line, never a raw `err.message`
// ("Failed to fetch", "Request failed (500).", a git stderr dump). Known
// shapes map to a sentence that names the fix; anything else reads as the one
// honest fallback. Our own copy passes through when it is thrown as a
// PlainError, so a message written for people is not flattened.

/** The one line for a failure this helper does not recognize. */
export const PLAIN_ERROR_FALLBACK = 'That did not go through. Check your connection and try again.';

/** An error whose message is already written for a person. */
export class PlainError extends Error {
  readonly plain = true;
  constructor(message: string) {
    super(message);
    this.name = 'PlainError';
  }
}

const KNOWN: Array<[RegExp, string]> = [
  // The network, in each engine's own words.
  [
    /failed to fetch|networkerror|network request failed|load failed|err_network|econnrefused|enotfound|ehostunreach|etimedout|timed? ?out|aborterror|the operation was aborted/i,
    PLAIN_ERROR_FALLBACK,
  ],
  // Sign-in.
  [
    /invalid login credentials|invalid (email|password)|invalid_grant/i,
    'That email and password do not match. Check them and try again.',
  ],
  [/email not confirmed/i, 'Confirm your email first. The link is in your inbox.'],
  [
    /user already registered|already been registered|already exists.*user/i,
    'That email already has an account. Sign in instead.',
  ],
  [
    /password should be at least|weak password|password is too short/i,
    'Use a longer password, at least 8 characters.',
  ],
  [
    /unable to validate email|invalid email|email address .* is invalid/i,
    'That email address does not look right. Check it and try again.',
  ],
  [/expired|otp_expired|link is invalid/i, 'That link has expired. Ask for a new one.'],
  [/sign-in is not configured/i, 'Sign-in is not available on this build.'],
  // Limits and access.
  [
    /rate limit|too many requests|\b429\b/i,
    'Too many tries just now. Wait a minute, then try again.',
  ],
  [
    /\b(401|403)\b|unauthori[sz]ed|forbidden|permission denied/i,
    'That was not allowed. Check your sign-in or access, then try again.',
  ],
  // Repositories.
  [
    /could not read username|authentication failed|terminal prompts disabled|invalid username or (password|token)/i,
    'That repository is private and your computer has no access to it. Connect its platform in Repositories, then try again.',
  ],
  [
    /a different repository already uses the folder/i,
    'Another repository already has that folder name on your computer. Rename or move that folder, then try again.',
  ],
  [
    /repository not found|could not read from remote/i,
    'That repository was not found, or it is private. Check the address and your access.',
  ],
  [
    /already exists and is not an empty directory|destination path .* already exists/i,
    'That repository is already on your computer.',
  ],
];

/** The plain line for a failure, for a toast or an inline hint. */
export function plainError(err: unknown): string {
  if (err instanceof PlainError) return err.message;
  const raw =
    err instanceof Error ? `${err.name}: ${err.message}` : typeof err === 'string' ? err : '';
  if (!raw.trim()) return PLAIN_ERROR_FALLBACK;
  for (const [pattern, line] of KNOWN) if (pattern.test(raw)) return line;
  return PLAIN_ERROR_FALLBACK;
}
