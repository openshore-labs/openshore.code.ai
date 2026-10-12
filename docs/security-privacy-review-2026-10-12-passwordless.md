# Security and privacy review: sign-in without passwords (2026-10-12)

The CTO's checklist (`.claude/skills/security-privacy-review/SKILL.md`) run on
the change that removes passwords, adds the email code and the PKCE link,
migration 0028, passkeys and App Lock. An adversarial review of the build by
the CTO came first; its findings and what became of each are in
`os-code/DECISIONS.md` (2026-10-12, CTO review of the build).

## Verdict

Ship with the founder's steps in `docs/passwordless-runbook.md`. No open
must-fix. Passkeys stay off until their gate.

## Findings

| # | Severity | Finding | Outcome |
|---|---|---|---|
| 1 | High | App Lock showed the last screen for a few frames on a locked return | Fixed: the native side holds the cover until the lock screen is drawn |
| 2 | Medium | Setting the clock back skipped App Lock | Fixed: time away on the system uptime clock |
| 3 | Medium | Leaving during our own unlock prompt skipped the lock; "Immediately" locked on Control Center | Fixed: only a real trip to the background counts |
| 4 | Medium | The passkey step-up is not tied to the registering session | Accepted residual risk; follow-up: a "passkey added" notice |
| 5 | Medium | Code checks are limited per IP, not per account | Accepted residual risk; 8 digits if abuse shows |
| 6 | Low | A refused sign-in left its server session live; the switch guard compared emails | Fixed |
| 7 | Low | A new account's link lives 5 minutes, not 10 | Copy promises 10 minutes for the code only |
| 8 | Low | The continue page accepted non-PKCE tokens and a development return | Fixed |
| 9 | Low | `/recover` still sent a stock reset email; `config push` would overwrite production's `site_url` | Fixed: a no-password reset email; the runbook sets auth in the dashboard |
| 10 | Low | The privacy policy's passkey line was incomplete | Fixed |
| 11 | Low | The Swift passkey state was touched off the main queue | Fixed |
| 12 | High (App Review) | Apple's reviewer signed in with a password | Ruled: a review mailbox, no auth exception (DECISIONS) |

## Data we keep

| Data | Where | Why | Retention | Call |
|---|---|---|---|---|
| Password hash | `auth.users.encrypted_password` | none now | cleared by 0028, kept empty by trigger | drop |
| Email address, account id | `auth.users` | to sign in | until the account is deleted | keep |
| One-time code (hashed) | GoTrue `one_time_tokens` | the code and the link | used once, invalid after 10 minutes | keep |
| PKCE flow state | GoTrue `flow_state` | the link's exchange | GoTrue's own expiry | keep |
| PKCE verifier | the device's secret store only | the link's exchange | 10 minutes, deleted once used | keep |
| Passkey public key, id, authenticator kind, name, counter, backup flags, transports, dates | `auth.webauthn_credentials` | passkey sign-in | until removed or the account is deleted (cascade) | keep, only if the person adds one |
| Passkey challenges | `auth.webauthn_challenges` | the ceremony | 5 minutes, GoTrue's cleanup deletes them | keep |
| Sign-in method and time | `auth.mfa_amr_claims` | the passkey step-up | with the session | keep |
| IP on sign-in | GoTrue audit log | GoTrue's own | 7 days (0027) | keep |
| App Lock setting | the device only | the lock | until changed | keep |

## Claims checked

- `app/src/lib/egressManifest.ts`: "Your email address to send you a sign-in
  code and link... if you add a passkey, a signature from it". True: the same
  account host as before; no new host.
- The privacy policy (`OpenShore.ai-marketing-site/src/privacy.njk`): no
  password hash; the passkey line lists what GoTrue keeps. The SMTP provider
  is added to the processors once the founder picks it (runbook step 1).
- `PrivacyInfo.xcprivacy`: no new data type (the public key is under the
  account id already declared); LocalAuthentication and AuthenticationServices
  use no required-reason API. `NSFaceIDUsageDescription` added for App Lock.
- No log line carries a code, link, verifier or token (the new modules log
  nothing).
- No edge function can mint a session (`app/test/passwordless.test.ts`).

## Not verified here

- The two Swift plugins have not been compiled on a Mac (no Mac in this
  environment); `app/test/nativePlugins.test.ts` holds their contracts to the
  JS. An `xcodebuild` run and the device checks in the runbook come before
  release.
- The hosted project's behaviour after the dashboard settings and 0028: the
  runbook's checks.
