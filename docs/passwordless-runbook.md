# Runbook: sign-in without passwords, passkeys, and App Lock (2026-10-12)

The founder's call (2026-10-12): no passwords. One email carries a 6-digit
code and a sign-in link; passkeys come next as the faster way in; App Lock
keeps the app closed on a phone someone else is holding. The CTO and CX
rulings are in `os-code/DECISIONS.md` (2026-10-12); the security and privacy
run is `docs/security-privacy-review-2026-10-12-passwordless.md`.

What is on `main` already, and safe as it stands:

- The app asks for no password anywhere. The link is PKCE, so it signs in
  only on the device that asked; the code works on any device.
- Migration `0028_passwordless.sql`, **unapplied**.
- `supabase/config.toml` and the two templates in `supabase/templates/`,
  **not set** on the hosted project yet (step 3, in the dashboard).
- Passkeys and App Lock, built. Passkeys stay hidden until step 6; App Lock is
  a Settings switch on iPhone and iPad, off by default.
- On openshore.ai (`OpenShore.ai-marketing-site`): the scanner-safe page
  `/sign-in/continue/`, the seat-purchase login by code, and the privacy
  policy without passwords.

Until steps 1 to 3 are done, existing sign-ins keep working, and a new email
sign-in still works: the hosted project's current template sends a link, and
the app now trades it with PKCE. The code only appears in emails after step 3.

## Founder steps, in order

### 1. Email that can actually be delivered (Supabase dashboard)

Supabase's built-in sender allows about 2 emails an hour for the whole
project, which is not enough once every sign-in is an email.

1. Pick an SMTP provider and set it under Authentication, Emails, SMTP
   Settings. **Turn off click and open tracking** at the provider: a rewritten
   link leaks the token to the provider and gets opened by its scanners.
2. Add the provider to the privacy policy's processors list
   (`OpenShore.ai-marketing-site/src/privacy.njk`, section on who processes
   data). Claude can write that line once the provider is named.

### 2. Publish openshore.ai first

Deploy `OpenShore.ai-marketing-site` from `main` so
`https://openshore.ai/sign-in/continue/` is live **before** step 3. The new
email's link goes through that page; until it is live, the link would 404
(the code would still work).

### 3. Set the codes and the emails (Supabase dashboard, not `config push`)

Do this in the dashboard, not with `supabase config push`: `config.toml` also
holds local values (`site_url` is `http://localhost:5173`), and a push would
write them over production's (CTO review, 2026-10-12). The values below are
the ones `supabase/config.toml` records.

1. Authentication, Providers, Email: **Email OTP length 6**, **Email OTP
   expiration 600** seconds. Leave Confirm email on.
2. Authentication, Rate Limits: emails sent no more than **once every 60
   seconds** per address (leave the verify limit as it is).
3. Authentication, Emails, Templates:
   - **Magic Link** and **Confirm signup**: subject `Your OpenShore sign-in
     code`, body the whole of `supabase/templates/sign-in.html`.
   - **Reset Password**: subject `OpenShore has no passwords`, body the whole
     of `supabase/templates/no-password.html`.
4. Leave passkeys off for now (step 6).

Then send yourself a sign-in from the app: the email should show the code
first, and its link should open `openshore.ai/sign-in/continue/` and, after
Continue, the app.

### 4. Push 0028 (the passwords go)

Follow `docs/vault-gate1-runbook.md`, sections 2 to 8, for **0028 only**
(preflight, backup, `supabase db push --linked --skip-vault`). Then, in the
SQL editor:

```sql
-- No account keeps a password.
select count(*) from auth.users where coalesce(encrypted_password, '') <> '';  -- expect 0
-- Both triggers are in place.
select tgname, tgrelid::regclass from pg_trigger where tgname like 'oscode_%';
-- expect oscode_no_password on auth.users
-- and   oscode_passkey_step_up on auth.webauthn_credentials
```

If the second query shows no `oscode_passkey_step_up` row, the platform
refused the trigger: passkeys stay off (skip step 6) and Claude takes it back
to the CTO. Append 0028's row to `supabase/production-history.tsv` in the
same change that records the push (the CTO 11 rule).

Nobody is signed out by this. Anyone who signed in with a password stays
signed in; the next time they sign in, it is by email.

### 5. App Review sign-in

Apple's reviewer cannot use a password any more. See the ruling in
`os-code/DECISIONS.md` (2026-10-12, App Review sign-in) and update the review
notes in openshore-hq before the next submission.

### 6. Turn passkeys on (when you want them)

Only after step 4 showed the step-up trigger.

1. Apple Developer, Identifiers, `ai.openshore.oscode`: enable **Associated
   Domains**, and regenerate the provisioning profile.
2. Tell Claude your Team ID. Claude then adds to
   `app/ios/App/App/App.entitlements`:
   `com.apple.developer.associated-domains` = `webcredentials:openshore.ai`,
   and to the site `src/static/.well-known/apple-app-site-association`:
   `{"webcredentials":{"apps":["<TeamID>.ai.openshore.oscode"]}}` (served as
   JSON, no redirect). These wait for the Team ID because an entitlement the
   App ID lacks fails signing, and a wrong Team ID silently breaks passkeys.
3. Deploy the site, then in the dashboard turn on passkeys with the relying
   party `openshore.ai`, display name `OpenShore`, origin
   `https://openshore.ai`, and set `[auth.passkey] enabled = true` in
   `supabase/config.toml` so the record matches.
4. Set `VITE_PASSKEYS=1` in the iOS build's environment (Codemagic), build,
   and on a device: Settings, Your account, Create a passkey; sign out; Sign
   in with a passkey.

Before step 6, check the status of the GoTrue passkey finding the CTO named
(ANT-2026-0JJXMV3G).

### 7. App Lock on a device

Nothing to set up. On an iPhone: Settings, Privacy, App Lock. Check that the
app switcher shows a plain cover, that a notice while it is on says only "A
reply is ready.", and that a routine on the computer keeps running while the
phone is locked.

## What is not built yet

- Passkeys on the desktop: the CTO's design (the system browser on
  `openshore.ai/sign-in/passkey`, the session sealed to the app's own key and
  returned over `oscode://`) is a later package.
- App Lock on the desktop: Electron's Touch ID prompt has no passcode
  fallback, and Windows and Linux have no system prompt, so the row is hidden
  there (CX).
